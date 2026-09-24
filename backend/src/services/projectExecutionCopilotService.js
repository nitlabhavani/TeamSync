/**
 * STEP 21 — AI Project Execution Copilot.
 *
 * This is an AGGREGATION / ORCHESTRATION layer only, exactly like
 * services/projectHealthService.js (Step 20). It computes NO new risk
 * score, forecast, or health verdict of its own — every action produced
 * here traces back to a real, already-computed evidence field from:
 *
 *   - services/teamRiskAnalyzer.js         (Team Risk & Early Warning — Step 15/16)
 *   - services/projectForecastService.js   (Project Forecast + Intervention
 *                                            Recommendations — Step 19)
 *   - services/projectHealthService.js     (Project Health Command Center — Step 20)
 *   - services/deadlineNudgeService.js     (per-task early warnings, via teamRiskAnalyzer)
 *   - services/collaborationRiskService.js (per-student collaboration risk, via teamRiskAnalyzer)
 *   - services/smartTaskAssignmentService.js (reassignment scoring — Step 17)
 *   - services/interventionRecommendationService.js (recommendations, via projectForecastService)
 *
 * The existing Team Risk formula, Project Forecast formula, Project Health
 * aggregation, and the assignment-recommendation scoring are NEVER modified
 * or recomputed differently here — this module only reads, ranks, and
 * repackages their outputs into a compact "what should I do today / this
 * week" execution plan for the Guide/Team Leader.
 *
 * Layer 1 (gatherExecutionCopilotEvidence) does all DB/service calls.
 * Layer 2 (computeExecutionCopilot) is a PURE, deterministic function of the
 * evidence bundle — no DB, no I/O — exactly like computeTeamRisk/
 * computeForecast/computeProjectHealth, and it is what
 * backend/scripts/testProjectExecutionCopilot.js exercises directly with
 * hand-built evidence objects.
 */
const Task = require("../models/Task");
const User = require("../models/User");
const ProjectExecutionSnapshot = require("../models/ProjectExecutionSnapshot");
const { notifyUsers } = require("./notificationService");
const { analyzeGroupRisk, gatherGroupEvidence } = require("./teamRiskAnalyzer");
const { runProjectForecast, gatherForecastEvidence } = require("./projectForecastService");
const { getProjectHealth, countCriticalCodeIssues } = require("./projectHealthService");
const { getRecommendation } = require("./smartTaskAssignmentService");

/** Dashboard status ranks, most-to-least healthy. Reuses the exact same
 * vocabulary/thresholds as ProjectHealthSnapshot's HEALTH_RANK (Step 20) —
 * overallStatus IS the Command Center's `health`, not a second scale. */
const STATUS_RANK = { HEALTHY: 4, STABLE: 3, NEEDS_ATTENTION: 2, AT_RISK: 1, CRITICAL: 0, INSUFFICIENT_DATA: 5 };

/** Priority 1-7 ordering from the Step 21 spec — every candidate action is
 * bucketed into exactly one of these categories before ranking. */
const CATEGORY_RANK = {
  CRITICAL_RISK: 1,
  BLOCKED: 2,
  SUBMISSION: 3,
  WORKLOAD: 4,
  COLLABORATION: 5,
  ORIGINALITY: 6,
  OPTIMIZATION: 7,
};

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, MODERATE: 2, LOW: 1 };

/** teamRiskAnalyzer warning `type` -> execution-copilot action category.
 * Purely a relabeling for grouping/prioritization; the underlying warning
 * object is passed through untouched (mirrors projectHealthService's
 * WARNING_TYPE_BUCKET). */
const WARNING_CATEGORY = {
  DEADLINE_RISK: "CRITICAL_RISK",
  TASK_STALL: "BLOCKED",
  LOW_PROGRESS: "CRITICAL_RISK",
  SUBMISSION_REVIEW_BACKLOG: "SUBMISSION",
  REPEATED_CHANGES_REQUESTED: "SUBMISSION",
  REPEATED_REJECTION: "SUBMISSION",
  LOW_COLLABORATION: "COLLABORATION",
  TEAM_IDLE: "COLLABORATION",
  DUPLICATE_SUBMISSION_RISK: "ORIGINALITY",
  STUDENT_OVERLOAD: "WORKLOAD",
};

/** interventionRecommendationService `type` -> execution-copilot action
 * category (Step 19 recommendation types, reused as-is — see that file's
 * own docstring for the full list). */
const RECOMMENDATION_CATEGORY = {
  PRIORITIZE_OVERDUE_TASK: "CRITICAL_RISK",
  RESOLVE_BLOCKED_TASK: "BLOCKED",
  REASSIGN_OVERLOADED_TASK: "WORKLOAD",
  FOLLOW_UP_WITH_INACTIVE_MEMBER: "COLLABORATION",
  REVIEW_PENDING_SUBMISSION: "SUBMISSION",
  BREAK_DOWN_LARGE_TASK: "OPTIMIZATION",
  REDUCE_TASK_SCOPE: "OPTIMIZATION",
  ADD_DEADLINE_BUFFER: "OPTIMIZATION",
  MONITOR_PROGRESS: "OPTIMIZATION",
  NO_ACTION_REQUIRED: "OPTIMIZATION",
};

const MAX_TODAY_ACTIONS = 5;
const MAX_WEEK_ACTIONS = 8;

/* ============================================================
 * LAYER 1 — evidence gathering (DB + existing services)
 * ============================================================ */

/**
 * Picks, for each candidate student, their single most urgent open task
 * (overdue first, then stalled) from the already-computed overdue/stalled
 * task lists. Pure data selection — no scoring, no DB.
 */
function pickUrgentTaskForStudent(studentId, overdueTasks, stalledTasks) {
  const overdue = overdueTasks.find((t) => t.assigneeId === studentId);
  if (overdue) return overdue;
  return stalledTasks.find((t) => t.assigneeId === studentId) || null;
}

/**
 * Feature 2 (recommendedReassignments) — for members already flagged
 * AT_RISK/CRITICAL by teamRiskAnalyzer's per-student risk (Step 15), finds
 * one concrete task of theirs that is overdue or stalled and asks the
 * EXISTING smartTaskAssignmentService.getRecommendation for who else in the
 * group would be a better fit. Never re-scores assignment fit itself —
 * only selects which task/student pairs are worth asking about, and only
 * surfaces a suggestion when the existing scorer picks someone different
 * from the current assignee.
 */
async function findReassignmentCandidates(group, affectedStudents, overdueTasks, stalledTasks) {
  const candidateIds = (affectedStudents || [])
    .filter((s) => s.riskLevel === "AT_RISK" || s.riskLevel === "CRITICAL")
    .map((s) => String(s.studentId));

  const picked = [];
  for (const studentId of candidateIds) {
    const task = pickUrgentTaskForStudent(studentId, overdueTasks, stalledTasks);
    if (task) picked.push({ ...task, assigneeId: studentId });
    if (picked.length >= 3) break;
  }
  if (!picked.length) return [];

  const [members, taskDocs] = await Promise.all([
    User.find({ _id: { $in: group.members } }).select("name").lean(),
    Task.find({ _id: { $in: picked.map((t) => t.taskId) } }).select("title description").lean(),
  ]);
  const taskById = new Map(taskDocs.map((t) => [String(t._id), t]));

  const out = [];
  for (const candidate of picked) {
    const taskDoc = taskById.get(candidate.taskId);
    if (!taskDoc) continue;
    // eslint-disable-next-line no-await-in-loop -- small, capped (<=3) loop
    const rec = await getRecommendation(group, { title: taskDoc.title, description: taskDoc.description }, members);
    if (rec.recommendedStudent && String(rec.recommendedStudent.id) !== String(candidate.assigneeId)) {
      out.push({
        taskId: candidate.taskId,
        taskTitle: candidate.title,
        fromStudentId: candidate.assigneeId,
        toStudentId: rec.recommendedStudent.id,
        toStudentName: rec.recommendedStudent.name,
        reason: rec.reasons?.[0] || "A better workload/fit match is available in the group.",
        suggestedAction: `Consider reassigning "${candidate.title}" to ${rec.recommendedStudent.name}.`,
      });
    }
  }
  return out;
}

/**
 * Gathers everything computeExecutionCopilot needs, by calling the
 * EXISTING services rather than re-deriving anything. `persist` controls
 * whether the underlying Team Risk / Forecast snapshots are written (same
 * side effects as a guide opening the AI Team Risk / AI Project Forecast
 * pages — this does not introduce a new persistence path for those two
 * systems). Project Health is always read with `persist:false` here — its
 * own snapshot/notification lifecycle stays owned by projectHealthService,
 * never duplicated by the Copilot.
 */
async function gatherExecutionCopilotEvidence(group, { persist = true } = {}) {
  const [teamRisk, forecast, health, forecastEvidence, groupEvidence, criticalCodeIssues, history] = await Promise.all([
    analyzeGroupRisk(group, { persist }),
    runProjectForecast(group, { persist }),
    getProjectHealth(group, { persist: false }),
    gatherForecastEvidence(group),
    gatherGroupEvidence(group),
    countCriticalCodeIssues(group._id),
    ProjectExecutionSnapshot.find({ group: group._id }).sort("-createdAt").limit(5).lean(),
  ]);

  const reassignmentSuggestions = await findReassignmentCandidates(
    group,
    teamRisk.affectedStudents,
    forecastEvidence.overdueTasks,
    forecastEvidence.stalledTasks
  );

  return {
    groupId: String(group._id),
    groupName: group.name,
    generatedAt: new Date(),
    teamRisk,
    forecast,
    health,
    overdueTasks: forecastEvidence.overdueTasks,
    stalledTasks: forecastEvidence.stalledTasks,
    pendingReviewTasks: forecastEvidence.pendingReviewTasks,
    largeUnstartedTasks: forecastEvidence.largeUnstartedTasks,
    submissions: groupEvidence.submissions,
    originality: groupEvidence.originality,
    riskyTasks: groupEvidence.riskyTasks,
    criticalCodeIssues,
    reassignmentSuggestions,
    history: history.map((h) => ({
      executionScore: h.executionScore,
      overallStatus: h.overallStatus,
      generatedAt: h.createdAt,
    })),
  };
}

/* ============================================================
 * LAYER 2 — pure aggregation (no DB, deterministic)
 * ============================================================ */

/** Feature 6 — trend vs. the most recent persisted snapshot only. Never
 * invents a trend when there is no prior history (mirrors
 * determineHealthTrend/determineForecastTrend). Tolerance of ±5, per spec. */
function determineExecutionTrend(currentScore, history) {
  const previous = (history || []).find((h) => typeof h.executionScore === "number");
  if (currentScore == null || !previous) {
    return { trend: "INSUFFICIENT_DATA", previousScore: previous?.executionScore ?? null };
  }
  const delta = currentScore - previous.executionScore;
  if (delta >= 5) return { trend: "IMPROVING", previousScore: previous.executionScore };
  if (delta <= -5) return { trend: "WORSENING", previousScore: previous.executionScore };
  return { trend: "STABLE", previousScore: previous.executionScore };
}

/** Maps a candidate's severity-ish field (warning severity, recommendation
 * priority, early-warning severity) onto the action's own CRITICAL/HIGH/
 * MEDIUM/LOW `priority` field. Never invents a severity — falls back to
 * MEDIUM only when the source evidence genuinely carries no severity. */
function toActionPriority(rawSeverityOrPriority) {
  const v = String(rawSeverityOrPriority || "").toUpperCase();
  if (v === "CRITICAL") return "CRITICAL";
  if (v === "HIGH") return "HIGH";
  if (v === "MEDIUM" || v === "MODERATE") return "MEDIUM";
  if (v === "LOW") return "LOW";
  return "MEDIUM";
}

/**
 * Builds the full ranked candidate-action list from real evidence only.
 * Every action traces back to a concrete warning / recommendation /
 * early-warning / collaboration-risk / originality flag already computed
 * elsewhere — nothing here invents a task, student, or count.
 */
function buildActionCandidates(evidence) {
  const { teamRisk, forecast, overdueTasks, stalledTasks, originality, criticalCodeIssues, reassignmentSuggestions } = evidence;
  const candidates = [];
  const add = (category, priority, entry) => candidates.push({ category, priority, ...entry });

  // --- CRITICAL_RISK: forecast/team-risk level itself, then per-task overdue evidence ---
  if (forecast.status === "CRITICAL") {
    add("CRITICAL_RISK", "CRITICAL", {
      type: "FORECAST_CRITICAL",
      title: "Project forecast is CRITICAL",
      description: `${evidence.groupName} is at risk of missing its deadline (on-time probability: ${
        forecast.probability != null ? `${forecast.probability}%` : "unknown"
      }).`,
      reason: forecast.trendMessage || "Project forecast has dropped to CRITICAL.",
      suggestedAction: "Review the AI Project Forecast and address the highest-priority intervention recommendations.",
    });
  }
  if (teamRisk.riskLevel === "CRITICAL") {
    add("CRITICAL_RISK", "CRITICAL", {
      type: "TEAM_RISK_CRITICAL",
      title: "Team risk is CRITICAL",
      description: `${evidence.groupName}'s overall team risk score is ${teamRisk.riskScore}/100.`,
      reason: teamRisk.reasons?.[0] || "Multiple risk signals detected.",
      suggestedAction: "Review the AI Team Risk dashboard and address the top warnings.",
    });
  }
  for (const t of [...overdueTasks].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5)) {
    add("CRITICAL_RISK", t.daysOverdue >= 3 ? "CRITICAL" : "HIGH", {
      type: "OVERDUE_TASK",
      title: `Resolve overdue task: ${t.title}`,
      description: `Overdue by ${t.daysOverdue} day${t.daysOverdue === 1 ? "" : "s"}.`,
      taskId: t.taskId,
      studentId: t.assigneeId,
      reason: `Task is ${t.daysOverdue} day${t.daysOverdue === 1 ? "" : "s"} past its due date.`,
      suggestedAction: "Contact the assignee and agree on a concrete completion plan, or reassign if blocked.",
    });
  }

  // --- BLOCKED: stalled/blocked tasks ---
  for (const t of [...stalledTasks].sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate).slice(0, 5)) {
    add("BLOCKED", t.daysSinceUpdate >= 14 ? "HIGH" : "MEDIUM", {
      type: "BLOCKED_TASK",
      title: `Unblock stalled task: ${t.title}`,
      description: `No update in ${t.daysSinceUpdate} day${t.daysSinceUpdate === 1 ? "" : "s"}.`,
      taskId: t.taskId,
      studentId: t.assigneeId,
      reason: `No progress update in ${t.daysSinceUpdate}+ day(s).`,
      suggestedAction: "Review dependencies and reassign if required.",
    });
  }

  // --- Group-level warnings (SUBMISSION / WORKLOAD / COLLABORATION / ORIGINALITY / remaining CRITICAL_RISK,BLOCKED) ---
  for (const w of teamRisk.warnings || []) {
    const category = WARNING_CATEGORY[w.type] || "OPTIMIZATION";
    add(category, toActionPriority(w.severity), {
      type: w.type,
      title: w.title,
      description: w.description,
      reason: w.description,
      suggestedAction: w.recommendation,
    });
  }

  // --- Per-task deadline early warnings (Step 16) not already covered above ---
  const knownTaskIds = new Set([...overdueTasks.map((t) => t.taskId), ...stalledTasks.map((t) => t.taskId)]);
  for (const w of teamRisk.earlyWarnings || []) {
    if (!w || w.level === "ON_TRACK" || knownTaskIds.has(w.taskId)) continue;
    add("CRITICAL_RISK", toActionPriority(w.severity), {
      type: "EARLY_WARNING",
      title: w.level === "AT_RISK" ? `${w.title} is at risk of missing its deadline` : `${w.title} deadline is approaching`,
      description: w.reason,
      taskId: w.taskId,
      studentId: w.assignee?.id || null,
      reason: w.reason,
      suggestedAction: w.recommendedAction,
    });
  }

  // --- Per-student collaboration risk (Step 16) ---
  for (const c of teamRisk.collaborationRisks || []) {
    if (c.riskLevel === "LOW") continue;
    add("COLLABORATION", toActionPriority(c.riskLevel), {
      type: "COLLABORATION_RISK",
      title: "Team member may need support",
      description: c.flags?.[0]?.reason || "Collaboration/communication signal detected.",
      studentId: c.studentId,
      reason: c.flags?.[0]?.reason || "Collaboration/communication signal detected.",
      suggestedAction: c.recommendation,
    });
  }

  // --- Originality / code quality (Step 14/17, tallied only) ---
  for (const f of (originality?.flaggedSubmissions || []).slice(0, 3)) {
    add("ORIGINALITY", f.severity === "DUPLICATE" ? "HIGH" : f.severity === "HIGH" ? "HIGH" : "MEDIUM", {
      type: "ORIGINALITY_FLAG",
      title: `Review flagged submission: ${f.taskTitle}`,
      description: `Originality check flagged this submission as ${f.severity}.`,
      taskId: f.taskId,
      studentId: f.studentId,
      reason: `Submission similarity flagged as ${f.severity}. This is a signal for review, not proof of misconduct.`,
      suggestedAction: "Manually compare the flagged submissions before making an academic-integrity decision.",
    });
  }
  if (criticalCodeIssues > 0) {
    add("ORIGINALITY", criticalCodeIssues >= 3 ? "HIGH" : "MEDIUM", {
      type: "CODE_QUALITY",
      title: "Critical code issues detected",
      description: `${criticalCodeIssues} critical-severity code review issue${criticalCodeIssues === 1 ? "" : "s"} in the latest submissions.`,
      reason: `${criticalCodeIssues} critical-severity code review issue${criticalCodeIssues === 1 ? "" : "s"} found.`,
      suggestedAction: "Ask the assignee(s) to address the critical findings before the next review.",
    });
  }

  // --- Workload: recommended reassignments (Step 17, reused as-is) ---
  for (const r of reassignmentSuggestions || []) {
    add("WORKLOAD", "MEDIUM", {
      type: "RECOMMENDED_REASSIGNMENT",
      title: `Consider reassigning: ${r.taskTitle}`,
      description: r.reason,
      taskId: r.taskId,
      studentId: r.fromStudentId,
      reason: r.reason,
      suggestedAction: r.suggestedAction,
    });
  }

  // --- Remaining intervention recommendations (Step 19, reused as-is) not already represented above ---
  const representedTaskIds = new Set(candidates.map((c) => c.taskId).filter(Boolean));
  for (const r of forecast.recommendations || []) {
    const relatedTaskId = r.evidence?.taskId;
    if (relatedTaskId && representedTaskIds.has(relatedTaskId)) continue;
    if (r.type === "NO_ACTION_REQUIRED") continue;
    add(RECOMMENDATION_CATEGORY[r.type] || "OPTIMIZATION", toActionPriority(r.priority), {
      type: r.type,
      title: r.title,
      description: r.reason,
      taskId: relatedTaskId || null,
      studentId: r.evidence?.assigneeId || r.evidence?.studentId || null,
      reason: r.reason,
      suggestedAction: r.suggestedAction,
    });
  }

  // Deterministic ranking: category priority (1-7) first, then severity,
  // then stable insertion order for ties.
  candidates.forEach((c, i) => {
    c._order = i;
  });
  candidates.sort((a, b) => {
    const catDiff = (CATEGORY_RANK[a.category] || 99) - (CATEGORY_RANK[b.category] || 99);
    if (catDiff !== 0) return catDiff;
    const sevDiff = (SEVERITY_RANK[b.priority] || 0) - (SEVERITY_RANK[a.priority] || 0);
    if (sevDiff !== 0) return sevDiff;
    return a._order - b._order;
  });

  // Feature 18 — duplicate action prevention: same type + taskId/studentId
  // pair never appears twice.
  const seen = new Set();
  const deduped = [];
  for (const c of candidates) {
    const key = `${c.type}:${c.taskId || ""}:${c.studentId || ""}:${c.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    delete c._order;
    deduped.push(c);
  }

  return deduped;
}

/**
 * Feature 3 — Smart Daily Plan. Splits the ranked candidate list into
 * "Today" (max 5) and "This Week" (max 8, non-overlapping with Today).
 */
function buildDailyPlan(actions) {
  const today = actions.slice(0, MAX_TODAY_ACTIONS);
  const thisWeek = actions.slice(MAX_TODAY_ACTIONS, MAX_TODAY_ACTIONS + MAX_WEEK_ACTIONS);
  return { today, thisWeek };
}

/**
 * Feature 1/2/3/4/6 — the pure aggregation. Given a fully-gathered evidence
 * bundle (see gatherExecutionCopilotEvidence), returns the exact Execution
 * Copilot payload. Deterministic: the same evidence always produces the
 * same output.
 */
function computeExecutionCopilot(evidence) {
  const { teamRisk, forecast, health, groupId, groupName, generatedAt } = evidence;

  const teamHasData = teamRisk.riskLevel !== "INSUFFICIENT_DATA";
  const forecastHasData = forecast.status !== "INSUFFICIENT_DATA";

  if (!teamHasData && !forecastHasData) {
    return {
      groupId,
      groupName,
      overallStatus: "INSUFFICIENT_DATA",
      executionScore: null,
      trend: "INSUFFICIENT_DATA",
      topPriority: null,
      criticalActions: [],
      todayActions: [],
      thisWeekActions: [],
      blockedTasks: [],
      atRiskTasks: [],
      teamAttention: [],
      recommendedReassignments: [],
      deadlineActions: [],
      collaborationActions: [],
      submissionActions: [],
      positiveSignals: [],
      reasoning: ["No tasks or activity have been recorded for this group yet."],
      disclaimer: "executionScore reuses the Project Health Command Center's aggregated indicator; it is not a new scoring system.",
      generatedAt,
    };
  }

  // Feature 1 — executionScore/overallStatus REUSE the already-computed
  // Project Health aggregation as-is (Step 20) — never a second blended
  // score. This keeps the Copilot's headline number byte-identical to what
  // the guide already sees on the Command Center card.
  const executionScore = health.healthScore;
  const overallStatus = health.health;

  const { trend } = determineExecutionTrend(executionScore, evidence.history);

  const actions = buildActionCandidates(evidence);
  const criticalActions = actions.filter((a) => a.priority === "CRITICAL");
  const { today, thisWeek } = buildDailyPlan(actions);

  const blockedTasks = evidence.stalledTasks.map((t) => ({
    taskId: t.taskId,
    title: t.title,
    studentId: t.assigneeId,
    daysSinceUpdate: t.daysSinceUpdate,
    status: t.status,
  }));

  const atRiskTasks = (teamRisk.earlyWarnings || [])
    .filter((w) => w.level === "AT_RISK")
    .map((w) => ({
      taskId: w.taskId,
      title: w.title,
      studentId: w.assignee?.id || null,
      reason: w.reason,
      daysLeft: w.daysLeft,
    }));

  const teamAttention = (teamRisk.affectedStudents || []).map((s) => {
    const collab = (teamRisk.collaborationRisks || []).find((c) => String(c.studentId) === String(s.studentId));
    return {
      studentId: s.studentId,
      riskLevel: s.riskLevel,
      reasons: s.reasons,
      collaborationFlags: collab ? collab.flags : [],
    };
  });

  const deadlineActions = actions.filter((a) => a.category === "CRITICAL_RISK" || a.category === "BLOCKED");
  const collaborationActions = actions.filter((a) => a.category === "COLLABORATION");
  const submissionActions = actions.filter((a) => a.category === "SUBMISSION");

  // Feature — positive signals REUSE Project Health's already-built list
  // (Step 20's buildPositiveSignals), never recomputed here.
  const positiveSignals = health.positiveSignals || [];

  // Reasoning — short, evidence-traceable strings explaining the headline
  // status. Every line already exists elsewhere (health/forecast/team-risk
  // messages) — nothing fabricated.
  const reasoning = [];
  if (health.disclaimer) reasoning.push(health.disclaimer);
  for (const issue of (health.topIssues || []).slice(0, 3)) reasoning.push(issue.reason || issue.title);
  if (forecast.trendMessage) reasoning.push(forecast.trendMessage);
  if (teamRisk.trendMessage) reasoning.push(teamRisk.trendMessage);
  if (!reasoning.length) reasoning.push("No significant issues detected from current evidence.");

  return {
    groupId,
    groupName,
    overallStatus,
    executionScore,
    trend,
    topPriority: actions[0] || null,
    criticalActions,
    todayActions: today,
    thisWeekActions: thisWeek,
    blockedTasks,
    atRiskTasks,
    teamAttention,
    recommendedReassignments: evidence.reassignmentSuggestions || [],
    deadlineActions,
    collaborationActions,
    submissionActions,
    positiveSignals,
    reasoning,
    disclaimer: "executionScore reuses the Project Health Command Center's aggregated indicator; it is not a new scoring system.",
    generatedAt,
  };
}

/* ============================================================
 * LAYER 3 — orchestration: gather -> compute -> persist -> notify
 * ============================================================ */

/**
 * Feature 7 — only notify on a genuinely important new execution issue,
 * mirroring the wasAlreadySevere/isEscalation patterns used by
 * teamRiskAnalyzer.js / projectForecastService.js / projectHealthService.js.
 * Pure and exported so it is directly unit-testable without a database.
 */
function shouldNotifyExecutionIssue(result, previousSnapshot) {
  const lastNotified = previousSnapshot?.lastNotifiedStatus ?? null;
  const lastNotifiedRank = lastNotified != null ? STATUS_RANK[lastNotified] : undefined;
  const newRank = STATUS_RANK[result.overallStatus];
  const isEscalation =
    lastNotifiedRank !== undefined && newRank !== undefined && newRank < lastNotifiedRank && newRank <= STATUS_RANK.NEEDS_ATTENTION;
  const firstEscalation = lastNotified === null && newRank !== undefined && newRank <= STATUS_RANK.NEEDS_ATTENTION;

  const previousCriticalCount = previousSnapshot?.criticalActionCount ?? 0;
  const newCriticalAppeared = result.criticalActions.length > 0 && previousCriticalCount === 0;

  const forecastBecameCritical =
    result.forecast?.status === "CRITICAL" && previousSnapshot?.forecastStatus !== "CRITICAL";

  const previousOverdueCount = previousSnapshot?.overdueTaskCount ?? 0;
  const overdueCount = result.summary?.overdueTasks ?? 0;
  const multipleNewOverdue = overdueCount >= 3 && previousOverdueCount < 3;

  return isEscalation || firstEscalation || newCriticalAppeared || forecastBecameCritical || multipleNewOverdue;
}

/**
 * The single entry point the controller/scheduler/weekly-report call.
 * `persist=true` also writes a ProjectExecutionSnapshot and notifies the
 * guide when a genuinely important new execution issue appears (Feature 7),
 * reusing notificationService exactly like the other AI services — no
 * second notification mechanism.
 */
async function getExecutionCopilot(group, { persist = true } = {}) {
  const evidence = await gatherExecutionCopilotEvidence(group, { persist });
  const result = computeExecutionCopilot(evidence);

  // Attach lightweight summary counts used both by the UI and by the
  // notification-threshold check above (never persisted beyond the counts
  // already on the snapshot).
  result.forecast = { status: evidence.forecast.status, probability: evidence.forecast.probability };
  result.summary = {
    overdueTasks: evidence.overdueTasks.length,
    stalledTasks: evidence.stalledTasks.length,
    criticalActions: result.criticalActions.length,
    todayActions: result.todayActions.length,
    thisWeekActions: result.thisWeekActions.length,
  };

  if (persist && result.overallStatus !== "INSUFFICIENT_DATA") {
    const previous = await ProjectExecutionSnapshot.findOne({ group: group._id }).sort({ createdAt: -1 });

    const snapshot = await ProjectExecutionSnapshot.create({
      group: group._id,
      executionScore: result.executionScore,
      overallStatus: result.overallStatus,
      trend: result.trend,
      topPriorityType: result.topPriority?.type || null,
      criticalActionCount: result.criticalActions.length,
      todayActionCount: result.todayActions.length,
      thisWeekActionCount: result.thisWeekActions.length,
      forecastStatus: evidence.forecast.status,
      overdueTaskCount: evidence.overdueTasks.length,
      lastNotifiedStatus: previous?.lastNotifiedStatus || null,
    });

    result.alerted = false;
    if (shouldNotifyExecutionIssue(result, previous) && group.guide) {
      const recipients = [group.guide];
      if (group.leader && String(group.leader) !== String(group.guide)) recipients.push(group.leader);
      await notifyUsers(recipients, {
        title: result.overallStatus === "CRITICAL" ? "Execution Copilot: CRITICAL issue detected" : "New execution issue detected",
        body: result.topPriority
          ? `${group.name}: ${result.topPriority.title}. Review the AI Execution Copilot for the full plan.`
          : `${group.name}'s execution status changed to ${result.overallStatus.replace("_", " ")}.`,
        type: "risk",
        link: "/guide/dashboard",
        group: group._id,
      });
      snapshot.lastNotifiedStatus = result.overallStatus;
      await snapshot.save();
      result.alerted = true;
    }
  }

  return result;
}

async function getExecutionCopilotHistory(groupId, limit = 30) {
  return ProjectExecutionSnapshot.find({ group: groupId }).sort("-createdAt").limit(limit);
}

/* ============================================================
 * SCHEDULER — isolated call alongside the existing deadline/risk scans
 * ============================================================ */

async function scanAllGroupsExecutionCopilot() {
  const Group = require("../models/Group");
  const groups = await Group.find({ status: "active" });
  let alerted = 0;
  let scanned = 0;
  for (const group of groups) {
    try {
      // eslint-disable-next-line no-await-in-loop -- mirrors scanAllGroupsTeamRisk/scanAllGroupsForecast
      const result = await getExecutionCopilot(group, { persist: true });
      scanned += 1;
      if (result.alerted) alerted += 1;
    } catch (err) {
      console.error(`[execution-copilot] scan failed for group ${group._id}: ${err.message}`);
    }
  }
  return { groups: groups.length, scanned, alerted };
}

module.exports = {
  gatherExecutionCopilotEvidence,
  computeExecutionCopilot,
  determineExecutionTrend,
  buildActionCandidates,
  buildDailyPlan,
  toActionPriority,
  shouldNotifyExecutionIssue,
  findReassignmentCandidates,
  getExecutionCopilot,
  getExecutionCopilotHistory,
  scanAllGroupsExecutionCopilot,
  STATUS_RANK,
  CATEGORY_RANK,
};
