/**
 * STEP 18 — AI Task Intelligence / Smart Planning.
 *
 * Deliberately does NOT reimplement anything Steps 15–17 already built:
 *   - subtask/priority/effort GENERATION -> ai-engine/analyzers/taskPlanAnalyzer.py
 *     (which itself reuses taskExpansionAnalyzer.py's domain detection —
 *     see that file's own docstring)
 *   - recommended assignee -> smartTaskAssignmentService.getRecommendation
 *     (Step 17 Feature 1) — called directly, never re-scored here
 *   - team/group risk signals -> teamRiskAnalyzer.gatherGroupEvidence +
 *     computeTeamRisk (Steps 15/16) — called directly, never re-derived
 * This module's own, new logic is limited to: sanitizing the engine's
 * plan, the deterministic fallback plan, and combining the above into a
 * suggested priority + deadline buffer with transparent reasons.
 *
 * SECURITY: the AI engine only ever supplies subtask TEXT (title strings)
 * — it never supplies a student/assignee ID. The recommended assignee is
 * always a real group.members id chosen by smartTaskAssignmentService,
 * never anything the AI engine's response could influence. See
 * sanitizePlanForStorage() for text sanitization before anything is
 * persisted.
 */
const aiEngine = require("./aiEngineClient");
const { gatherGroupEvidence, computeTeamRisk } = require("./teamRiskAnalyzer");
const { getRecommendation } = require("./smartTaskAssignmentService");

const DIFFICULTIES = new Set(["LOW", "MEDIUM", "HIGH"]);
const MIN_SUBTASKS = 3;
const MAX_SUBTASKS = 7;
const MAX_TEXT_LEN = 300; // generous cap for any single generated string
const MAX_LIST_LEN = 12;

/* ---------------------------------------------------------------------
 * Sanitization — every generated/applied string passes through this,
 * whether it came from the AI engine or from the guide's own edit of an
 * applied plan. Strips HTML-ish tags and control characters, caps length.
 * ------------------------------------------------------------------- */
function sanitizeText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "") // strip anything that looks like a tag
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // strip control chars (keep \n\t)
    .trim()
    .slice(0, MAX_TEXT_LEN);
}

function sanitizeStringList(list, max = MAX_LIST_LEN) {
  if (!Array.isArray(list)) return [];
  return list
    .map(sanitizeText)
    .filter(Boolean)
    .slice(0, max);
}

/** Never fabricates detailed content — the spec's own documented shape for Feature 2 falls back the same way; Feature 18 follows the same contract. */
function fallbackPlan(title) {
  const subject = sanitizeText(title) || "this task";
  return {
    domain: "general",
    subtasks: [
      { title: `Break "${subject}" down into concrete steps`, difficulty: "MEDIUM", estimatedHours: 2, dependsOnIndex: null },
      { title: "Implement the core functionality", difficulty: "MEDIUM", estimatedHours: 3, dependsOnIndex: 0 },
      { title: "Test the result", difficulty: "LOW", estimatedHours: 1, dependsOnIndex: 1 },
    ],
    acceptanceCriteria: [`"${subject}" behaves as described in the task title`],
    testingChecklist: [`Verify: "${subject}" behaves as described in the task title`],
    estimatedDifficulty: "UNKNOWN",
    estimatedTotalEffort: null,
  };
}

/**
 * Treats the engine's response (and, when re-used for an applied-plan
 * edit, the guide's own submitted content) as untrusted input — every
 * field is type-checked and sanitized; nothing is passed through
 * unchecked. Returns null when the shape is unusable (caller falls back).
 */
function sanitizePlan(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.subtasks)) return null;

  const subtasks = data.subtasks
    .slice(0, MAX_SUBTASKS)
    .map((s, i) => {
      const title = sanitizeText(s?.title);
      if (!title) return null;
      const difficulty = DIFFICULTIES.has(s?.difficulty) ? s.difficulty : "MEDIUM";
      const estimatedHours = Number.isFinite(Number(s?.estimatedHours)) && Number(s.estimatedHours) > 0
        ? Math.min(200, Math.round(Number(s.estimatedHours)))
        : null;
      // Never trust an arbitrary dependsOnIndex from the engine — it must
      // point to an earlier subtask actually present in THIS plan, or null.
      const rawDep = Number.isInteger(s?.dependsOnIndex) ? s.dependsOnIndex : null;
      const dependsOnIndex = rawDep !== null && rawDep >= 0 && rawDep < i ? rawDep : null;
      return { title, difficulty, estimatedHours, dependsOnIndex };
    })
    .filter(Boolean);

  if (subtasks.length < MIN_SUBTASKS) return null;

  return {
    domain: typeof data.domain === "string" ? data.domain.slice(0, 40) : "general",
    subtasks,
    acceptanceCriteria: sanitizeStringList(data.acceptanceCriteria),
    testingChecklist: sanitizeStringList(data.testingChecklist),
    estimatedDifficulty: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(data.estimatedDifficulty)
      ? data.estimatedDifficulty
      : "UNKNOWN",
    estimatedTotalEffort: typeof data.estimatedTotalEffort === "string" ? sanitizeText(data.estimatedTotalEffort) : null,
  };
}

async function generateSubtaskPlan({ title, description }) {
  const cleanTitle = sanitizeText(title);
  if (!cleanTitle) return fallbackPlan(title);
  const engineResp = await aiEngine.analyzeTaskPlan({ title: cleanTitle, description: sanitizeText(description) });
  if (engineResp.ok) {
    const sanitized = sanitizePlan(engineResp.data);
    if (sanitized) return sanitized;
  }
  return fallbackPlan(title);
}

/* ---------------------------------------------------------------------
 * Priority / deadline-buffer reasoning — reuses evidence.tasks (from
 * teamRiskAnalyzer.gatherGroupEvidence) and task.dependencies (an
 * EXISTING Task field — see models/Task.js: "Other Tasks in this group
 * that must be done first (from the AI plan)"), never invents a
 * dependency graph that doesn't exist in the data.
 * ------------------------------------------------------------------- */

function computeSuggestedPriority({ due, teamRisk, evidence, blockingOpenDependencyCount }) {
  let score = 0;
  const reasons = [];

  if (due) {
    const daysLeft = (new Date(due).getTime() - Date.now()) / 86400000;
    if (daysLeft <= 2) {
      score += 3;
      reasons.push("Due within 2 days");
    } else if (daysLeft <= 7) {
      score += 2;
      reasons.push("Due within a week");
    }
  }

  if (teamRisk?.riskLevel === "CRITICAL") {
    score += 3;
    reasons.push("This group's team risk is currently flagged CRITICAL");
  } else if (teamRisk?.riskLevel === "HIGH") {
    score += 2;
    reasons.push("This group's team risk is currently flagged HIGH");
  }

  if (evidence?.tasks?.overdue > 0) {
    score += 1;
    reasons.push(`${evidence.tasks.overdue} other task(s) in this group are already overdue`);
  }
  if (evidence?.tasks?.dueSoonNoProgress > 0) {
    score += 1;
    reasons.push(`${evidence.tasks.dueSoonNoProgress} task(s) are due soon with no progress`);
  }

  if (blockingOpenDependencyCount > 0) {
    score += 1;
    reasons.push(`${blockingOpenDependencyCount} task(s) are waiting on this one to finish first`);
  }

  let priority;
  if (score >= 5) priority = "critical";
  else if (score >= 3) priority = "high";
  else if (score >= 1) priority = "medium";
  else priority = "low";

  if (!reasons.length) reasons.push("No elevated deadline, risk, or dependency signals found");

  return { priority, reasons };
}

function computeDeadlineBufferDays({ teamRisk, evidence }) {
  let days = 0;
  const reasons = [];
  if (teamRisk?.riskLevel === "CRITICAL" || teamRisk?.riskLevel === "HIGH") {
    days += 2;
    reasons.push(`Group risk is ${teamRisk.riskLevel.toLowerCase()} — extra buffer recommended`);
  }
  if (evidence?.tasks?.stalled > 0) {
    days += 1;
    reasons.push(`${evidence.tasks.stalled} task(s) in this group are currently stalled`);
  }
  if (!reasons.length) reasons.push("No workload/risk signals suggesting extra buffer is needed");
  return { days, reasons };
}

/**
 * Full guide-only planning summary. NEVER persisted verbatim — only the
 * student-safe subset (subtasks/acceptanceCriteria/testingChecklist/
 * estimatedTotalEffort) is written to Task.aiPlan when the guide applies
 * it (see taskController.applyTaskPlan). priorityReasons/mainRisks/
 * recommendedAssignee reasoning must never reach a student.
 *
 * @param {object} group   Mongoose Group doc
 * @param {object} task    { title, description, due?, dependencies? } — an
 *                         existing task's fields, or a draft the guide is
 *                         about to create
 * @param {Array}  members [{ _id, name }] populated group members
 * @param {Array}  openDependencyTasks  existing, not-yet-done Task docs
 *                         this task depends on (Task.dependencies,
 *                         populated) — only ever real DB data, never
 *                         AI-invented
 * @param {Array}  blockingTasks tasks that list THIS task in their own
 *                         dependencies and are not yet done
 */
async function buildPlanningSummary({ group, task, members, openDependencyTasks = [], blockingTasks = [] }) {
  const [subtaskPlan, evidence] = await Promise.all([
    generateSubtaskPlan({ title: task.title, description: task.description }),
    gatherGroupEvidence(group),
  ]);

  const teamRisk = computeTeamRisk(evidence);
  const assignmentRec = await getRecommendation(group, { title: task.title, description: task.description }, members);

  const dependencyReasons = openDependencyTasks.length
    ? [`Waiting on ${openDependencyTasks.length} other not-yet-done task(s): ${openDependencyTasks.map((t) => t.title).slice(0, 3).join(", ")}`]
    : [];

  const { priority, reasons: priorityReasonsRaw } = computeSuggestedPriority({
    due: task.due,
    teamRisk,
    evidence,
    blockingOpenDependencyCount: blockingTasks.length,
  });
  const priorityReasons = [...priorityReasonsRaw, ...dependencyReasons];

  const { days: recommendedDeadlineBufferDays, reasons: deadlineBufferReasons } = computeDeadlineBufferDays({
    teamRisk,
    evidence,
  });

  const totalEstimatedHours = subtaskPlan.subtasks.reduce((sum, s) => sum + (s.estimatedHours || 0), 0);

  const mainRisks = [
    ...(teamRisk.criticalRisks || []),
    ...(teamRisk.warnings || []).slice(0, 3).map((w) => w.title),
  ].slice(0, 5);

  return {
    // Student-safe (persisted verbatim on Apply):
    subtasks: subtaskPlan.subtasks,
    acceptanceCriteria: subtaskPlan.acceptanceCriteria,
    testingChecklist: subtaskPlan.testingChecklist,
    estimatedTotalEffort: subtaskPlan.estimatedTotalEffort,
    estimatedDifficulty: subtaskPlan.estimatedDifficulty,
    // Guide-only (returned here, NEVER written to Task.aiPlan):
    suggestedPriority: priority,
    priorityReasons,
    recommendedAssignee: assignmentRec.recommendedStudent,
    recommendedAssigneeReasons: assignmentRec.reasons,
    recommendedAssigneeScore: assignmentRec.score,
    recommendedDeadlineBufferDays,
    deadlineBufferReasons,
    mainRisks,
    totalEstimatedHours,
    subtaskCount: subtaskPlan.subtasks.length,
    generatedAt: new Date(),
  };
}

/** The subset of a generated plan that is safe to persist/show to students. */
function studentSafePlan(planningSummary) {
  return {
    subtasks: planningSummary.subtasks,
    acceptanceCriteria: planningSummary.acceptanceCriteria,
    testingChecklist: planningSummary.testingChecklist,
    estimatedTotalEffort: planningSummary.estimatedTotalEffort,
  };
}

module.exports = {
  sanitizeText,
  sanitizeStringList,
  sanitizePlan,
  fallbackPlan,
  generateSubtaskPlan,
  computeSuggestedPriority,
  computeDeadlineBufferDays,
  buildPlanningSummary,
  studentSafePlan,
};
