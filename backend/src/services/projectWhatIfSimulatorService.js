/**
 * STEP 25 — AI PROJECT WHAT-IF SIMULATOR.
 *
 * This is an ORCHESTRATION layer only, exactly like projectHealthService.js
 * (Step 20) and projectExecutionCopilotService.js (Step 21). It computes NO
 * new Team Risk / Forecast / Health / Sprint scoring formula — it re-runs
 * the EXISTING pure compute functions against a cloned, in-memory,
 * hypothetical task/group representation instead of the real one:
 *
 *   - teamRiskAnalyzer.js         : reduceTeamRiskEvidence + computeTeamRisk
 *                                    + computeAllStudentRisks (Step 15/16)
 *   - projectForecastService.js   : reduceForecastEvidence + computeForecast
 *                                    (Step 19)
 *   - projectHealthService.js     : computeProjectHealth (Step 20) — reused
 *                                    directly; healthScore/health status are
 *                                    an average of the two results above,
 *                                    never re-derived here.
 *   - projectExecutionCopilotService.js : executionScore/overallStatus are
 *                                    IDENTICAL to health.healthScore/health
 *                                    in that module's own computeExecutionCopilot
 *                                    (see its Feature 1 comment) — reused by
 *                                    reference, not recomputed.
 *   - sprintPlannerService.js     : computeWorkload, classifySprintRisk
 *                                    (Step 23)
 *   - conflictDetectionService.js : runDetectors (Step 24) — task-related
 *                                    detectors only; message-only detectors
 *                                    are unaffected by task-only changes.
 *
 * -----------------------------------------------------------------------
 * READ-ONLY SAFETY
 *
 * Nothing in this file ever calls a mutation service, `.save()`s a
 * Mongoose document, or writes a model. All "hypothetical" tasks/groups are
 * PLAIN OBJECTS produced by cloning `.lean()` query results — Task/Group
 * Mongoose documents are never loaded or touched. No notification is ever
 * sent, no snapshot is ever persisted, and no other Step 1-24 model
 * (Message, Submission, TeamRiskSnapshot, ProjectForecastSnapshot,
 * ProjectHealthSnapshot, ProjectExecutionSnapshot, TeamPerformanceSnapshot,
 * SprintPlan, ConflictSnapshot, Notification) is ever written by this
 * module.
 *
 * -----------------------------------------------------------------------
 * SUPPORTED CHANGE TYPES (see SUPPORTED_CHANGE_TYPES below):
 *   TASK_DEADLINE, TASK_REASSIGNMENT, TASK_STATUS, TASK_PRIORITY,
 *   TASK_BLOCKER, PROJECT_DEADLINE, WORKLOAD_REDISTRIBUTION, SPRINT_CHANGE
 *
 * UNSUPPORTED (see UNSUPPORTED_CHANGE_TYPES below):
 *   MEMBER_AVAILABILITY — neither User nor Group stores any capacity /
 *   availability / hours-per-week field, so this can only be guessed. The
 *   capabilities endpoint reports it as unsupported with a reason instead
 *   of the simulator inventing a number.
 *
 * See STEP25_REPORT.md for the full reuse map and known limitations.
 */
const Task = require("../models/Task");
const Group = require("../models/Group");
const Message = require("../models/Message");
const { TASK_STATUSES, TASK_PRIORITIES } = require("../models/Task");
const {
  fetchTeamRiskRawData,
  reduceTeamRiskEvidence,
  computeTeamRisk,
  computeAllStudentRisks,
  DONE_STATUSES: TEAM_RISK_DONE_STATUSES,
} = require("./teamRiskAnalyzer");
const {
  fetchForecastRawData,
  reduceForecastEvidence,
  computeForecast,
} = require("./projectForecastService");
const { computeProjectHealth } = require("./projectHealthService");
const { computeWorkload, classifySprintRisk } = require("./sprintPlannerService");
const {
  gatherGroupConflictEvidence,
  runDetectors: runConflictDetectors,
} = require("./conflictDetectionService");

const DONE_STATUSES = TEAM_RISK_DONE_STATUSES || ["done", "completed"];

/* ============================================================
 * CAPABILITIES — what this simulator can/can't evaluate, and why.
 * ============================================================ */

const SUPPORTED_CHANGE_TYPES = [
  "TASK_DEADLINE",
  "TASK_REASSIGNMENT",
  "TASK_STATUS",
  "TASK_PRIORITY",
  "TASK_BLOCKER",
  "PROJECT_DEADLINE",
  "WORKLOAD_REDISTRIBUTION",
  "SPRINT_CHANGE",
];

const UNSUPPORTED_CHANGE_TYPES = ["MEMBER_AVAILABILITY"];

const UNSUPPORTED_REASONS = {
  MEMBER_AVAILABILITY:
    "No reliable availability/capacity data exists in the current User or Group model (no hours-per-week, vacation, or workload-capacity field), so this cannot be simulated without guessing.",
};

const KNOWN_CHANGE_TYPES = new Set([...SUPPORTED_CHANGE_TYPES, ...UNSUPPORTED_CHANGE_TYPES]);

function getCapabilities() {
  return {
    supportedChanges: SUPPORTED_CHANGE_TYPES,
    unsupportedChanges: UNSUPPORTED_CHANGE_TYPES,
    reason: { ...UNSUPPORTED_REASONS },
    notes: {
      SPRINT_CHANGE:
        "Recalculates sprint workload/risk for the group's current sprint task set after any other task-level changes in the same simulation. Does not resize or regenerate the sprint plan itself — that remains the dedicated AI Sprint Planner.",
      WORKLOAD_REDISTRIBUTION:
        "Applied as a batch of task reassignments; validated exactly like TASK_REASSIGNMENT (target members must already belong to the group).",
      TASK_BLOCKER:
        "Uses the real Task.dependencies field. 'Unblocking' a task means treating its recorded dependencies as resolved for this simulation only — nothing is written back.",
    },
  };
}

/* ============================================================
 * PLAIN-OBJECT HELPERS (pure, no DB, no mutation of inputs)
 * ============================================================ */

function cloneTask(t) {
  return {
    ...t,
    _id: t._id,
    dependencies: Array.isArray(t.dependencies) ? [...t.dependencies] : [],
  };
}

function idsEqual(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function isTaskDone(task) {
  return DONE_STATUSES.includes(task.status);
}

/** Real-data-only "blocked" signal: a task is blocked if any of its
 * recorded Task.dependencies points to another task in this group that is
 * not yet done. Reuses the exact same DONE_STATUSES vocabulary as
 * teamRiskAnalyzer/sprintPlannerService — not a second status taxonomy. */
function countBlockedTasks(tasks) {
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  let blocked = 0;
  const blockedTasks = [];
  for (const task of tasks) {
    if (isTaskDone(task)) continue;
    const deps = task.dependencies || [];
    const unresolved = deps.filter((depId) => {
      const dep = byId.get(String(depId));
      return dep && !isTaskDone(dep);
    });
    if (unresolved.length > 0) {
      blocked += 1;
      blockedTasks.push({ taskId: String(task._id), title: task.title, unresolvedDependencyCount: unresolved.length });
    }
  }
  return { count: blocked, tasks: blockedTasks };
}

/* ============================================================
 * VALIDATION — every hypothetical change checked against REAL data
 * ============================================================ */

/**
 * Validates one change against the real (baseline) task list + group
 * membership. Returns { ok: true } or { ok: false, reason }. Never mutates
 * anything — pure.
 */
function validateChange(change, { tasksById, group }) {
  if (!change || typeof change !== "object") {
    return { ok: false, reason: "Change must be an object." };
  }
  const { type, taskId } = change;

  if (!type || !KNOWN_CHANGE_TYPES.has(type)) {
    return { ok: false, reason: `Unknown or unsupported change type: ${type}` };
  }
  if (UNSUPPORTED_CHANGE_TYPES.includes(type)) {
    return { ok: false, reason: UNSUPPORTED_REASONS[type] || "This change type is not supported." };
  }

  const needsTask = ["TASK_DEADLINE", "TASK_REASSIGNMENT", "TASK_STATUS", "TASK_PRIORITY", "TASK_BLOCKER"].includes(
    type
  );
  let task = null;
  if (needsTask) {
    if (!taskId) return { ok: false, reason: `${type} requires a taskId.` };
    task = tasksById.get(String(taskId));
    if (!task) return { ok: false, reason: `Task ${taskId} was not found in this group.` };
  }

  switch (type) {
    case "TASK_DEADLINE": {
      const d = new Date(change.value);
      if (!change.value || Number.isNaN(d.getTime())) {
        return { ok: false, reason: `Invalid or missing deadline date for task ${taskId}.` };
      }
      return { ok: true, task, value: d };
    }
    case "TASK_REASSIGNMENT": {
      const memberId = change.memberId;
      if (!memberId) return { ok: false, reason: `TASK_REASSIGNMENT requires a memberId.` };
      const isMember = (group.members || []).some((m) => idsEqual(m, memberId));
      if (!isMember) {
        return { ok: false, reason: `Member ${memberId} does not currently belong to this group.` };
      }
      return { ok: true, task, value: String(memberId) };
    }
    case "TASK_STATUS": {
      if (!TASK_STATUSES.includes(change.value)) {
        return { ok: false, reason: `Invalid task status: ${change.value}` };
      }
      return { ok: true, task, value: change.value };
    }
    case "TASK_PRIORITY": {
      if (!TASK_PRIORITIES.includes(change.value)) {
        return { ok: false, reason: `Invalid task priority: ${change.value}` };
      }
      return { ok: true, task, value: change.value };
    }
    case "TASK_BLOCKER": {
      return { ok: true, task, value: "RESOLVE" };
    }
    case "PROJECT_DEADLINE": {
      const d = new Date(change.value);
      if (!change.value || Number.isNaN(d.getTime())) {
        return { ok: false, reason: "Invalid or missing project deadline date." };
      }
      return { ok: true, task: null, value: d };
    }
    case "WORKLOAD_REDISTRIBUTION": {
      const assignments = Array.isArray(change.assignments) ? change.assignments : [];
      if (!assignments.length) {
        return { ok: false, reason: "WORKLOAD_REDISTRIBUTION requires a non-empty assignments array." };
      }
      const resolved = [];
      for (const a of assignments) {
        const t = tasksById.get(String(a.taskId));
        if (!t) return { ok: false, reason: `Task ${a.taskId} was not found in this group.` };
        const isMember = (group.members || []).some((m) => idsEqual(m, a.memberId));
        if (!isMember) return { ok: false, reason: `Member ${a.memberId} does not currently belong to this group.` };
        resolved.push({ task: t, memberId: String(a.memberId) });
      }
      return { ok: true, task: null, value: resolved };
    }
    case "SPRINT_CHANGE": {
      // No independent effect of its own beyond marking the simulation as
      // sprint-aware (see getCapabilities().notes.SPRINT_CHANGE) — always
      // valid, it just flags that sprint metrics should be included.
      return { ok: true, task: null, value: change.value || {} };
    }
    default:
      return { ok: false, reason: `Unhandled change type: ${type}` };
  }
}

/**
 * Detects contradictory changes within the SAME batch — e.g. two different
 * TASK_DEADLINE values for the same task, or two different
 * TASK_REASSIGNMENT targets for the same task. Pure.
 */
function detectConflicts(acceptedChanges) {
  const conflicts = [];
  const byTaskAndType = new Map();
  for (const c of acceptedChanges) {
    if (!c.taskId) continue;
    const key = `${c.taskId}:${c.type}`;
    if (!byTaskAndType.has(key)) byTaskAndType.set(key, []);
    byTaskAndType.get(key).push(c);
  }
  for (const [key, group] of byTaskAndType) {
    if (group.length < 2) continue;
    const distinctValues = new Set(group.map((c) => JSON.stringify(c.value ?? c.change?.value ?? null)));
    if (distinctValues.size > 1) {
      const [taskId, type] = key.split(":");
      conflicts.push({
        type: "CONTRADICTORY_CHANGE",
        taskId,
        message: `Multiple incompatible hypothetical ${type.replace(/_/g, " ").toLowerCase()} values were supplied for the same task.`,
      });
    }
  }
  return conflicts;
}

/* ============================================================
 * APPLYING CHANGES — in-memory only, deterministic order
 * ============================================================ */

/**
 * Applies a list of ALREADY-VALIDATED changes to CLONED plain task/group
 * objects. Never touches Mongoose documents or the database. Deterministic
 * order = the order changes were supplied in (later WORKLOAD_REDISTRIBUTION
 * entries for the same task simply overwrite earlier ones, same as any
 * other duplicate — conflict detection runs separately, before this).
 */
function applyChanges(baselineTasks, group, validatedChanges) {
  const tasks = baselineTasks.map(cloneTask);
  const tasksById = new Map(tasks.map((t) => [String(t._id), t]));
  let projectedGroup = { ...group, expectedCompletion: group.expectedCompletion };

  const appliedLog = [];

  for (const vc of validatedChanges) {
    switch (vc.type) {
      case "TASK_DEADLINE": {
        const t = tasksById.get(String(vc.taskId));
        const before = t.due;
        t.due = vc.value;
        appliedLog.push({ type: vc.type, taskId: vc.taskId, before, after: t.due });
        break;
      }
      case "TASK_REASSIGNMENT": {
        const t = tasksById.get(String(vc.taskId));
        const before = t.assignee;
        t.assignee = vc.value;
        appliedLog.push({ type: vc.type, taskId: vc.taskId, before, after: t.assignee });
        break;
      }
      case "TASK_STATUS": {
        const t = tasksById.get(String(vc.taskId));
        const before = t.status;
        t.status = vc.value;
        if (isTaskDone(t)) t.updatedAt = new Date();
        appliedLog.push({ type: vc.type, taskId: vc.taskId, before, after: t.status });
        break;
      }
      case "TASK_PRIORITY": {
        const t = tasksById.get(String(vc.taskId));
        const before = t.priority;
        t.priority = vc.value;
        appliedLog.push({ type: vc.type, taskId: vc.taskId, before, after: t.priority });
        break;
      }
      case "TASK_BLOCKER": {
        const t = tasksById.get(String(vc.taskId));
        const before = t.dependencies?.length || 0;
        t.dependencies = [];
        appliedLog.push({ type: vc.type, taskId: vc.taskId, before, after: 0 });
        break;
      }
      case "PROJECT_DEADLINE": {
        const before = projectedGroup.expectedCompletion;
        projectedGroup = { ...projectedGroup, expectedCompletion: vc.value };
        appliedLog.push({ type: vc.type, before, after: vc.value });
        break;
      }
      case "WORKLOAD_REDISTRIBUTION": {
        for (const { task, memberId } of vc.value) {
          const t = tasksById.get(String(task._id));
          const before = t.assignee;
          t.assignee = memberId;
          appliedLog.push({ type: vc.type, taskId: String(task._id), before, after: memberId });
        }
        break;
      }
      case "SPRINT_CHANGE":
        appliedLog.push({ type: vc.type, before: null, after: vc.value });
        break;
      default:
        break;
    }
  }

  return { tasks: Array.from(tasksById.values()), group: projectedGroup, appliedLog };
}

/* ============================================================
 * METRIC BUNDLE — one function, used for BOTH baseline and projected
 * ============================================================ */

/**
 * Builds the full comparable metric bundle for a given (real or
 * hypothetical) task list + group, by re-running the EXISTING pure
 * compute functions. `messages` is always the REAL, unmodified message
 * history (we never simulate chat) — only tasks/group are hypothetical.
 */
function buildMetricBundle({ tasks, group, messages, now }) {
  const groupId = String(group._id);
  const groupName = group.name;

  // ---- Team Risk (reused: reduceTeamRiskEvidence + computeTeamRisk) ----
  const teamRiskRaw = {
    now,
    tasks,
    messagesThisWeek: 0,
    messagesLastWeek: 0,
    lastMessage: null,
    history: [],
  };
  const teamRiskEvidence = reduceTeamRiskEvidence(teamRiskRaw, group);
  const teamRisk = computeTeamRisk(teamRiskEvidence);
  const studentRisks = computeAllStudentRisks(teamRiskEvidence);
  const affectedStudents = studentRisks
    .filter((s) => s.riskLevel !== "ON_TRACK")
    .map((s) => ({ studentId: s.studentId, riskLevel: s.riskLevel, riskScore: s.riskScore, reasons: s.reasons }));

  // ---- Project Forecast (reused: reduceForecastEvidence + computeForecast) ----
  const forecastRaw = { now, tasks, teamRisk, teamRiskEvidence, history: [] };
  const forecastEvidence = reduceForecastEvidence(forecastRaw, group);
  const forecast = computeForecast(forecastEvidence);

  // ---- Project Health (reused: computeProjectHealth, unchanged formula) ----
  const health = computeProjectHealth({
    groupId,
    groupName,
    generatedAt: now,
    teamRisk,
    forecast: { ...forecast, completedTasks: forecastEvidence.tasks.completed, totalTasks: forecastEvidence.tasks.total },
    originality: teamRiskEvidence.originality,
    submissions: teamRiskEvidence.submissions,
    criticalCodeIssues: 0, // unaffected by task-only changes; not simulated (submissions/code unchanged)
    history: [],
  });

  // ---- Execution readiness — IDENTICAL to computeExecutionCopilot's own
  // executionScore/overallStatus assignment (health.healthScore/health.health).
  const execution = { executionScore: health.healthScore, overallStatus: health.health };

  // ---- Workload balance (reused: sprintPlannerService.computeWorkload) ----
  const openTasks = tasks.filter((t) => !isTaskDone(t));
  const memberIds = (group.members || []).map((m) => String(m));
  const workload = computeWorkload(openTasks, memberIds);

  // ---- Blocked task count (real Task.dependencies field) ----
  const blocked = countBlockedTasks(tasks);

  // ---- Sprint risk (reused: sprintPlannerService.classifySprintRisk) ----
  const dueSoon48h = openTasks.filter((t) => {
    if (!t.due) return false;
    const hrs = (new Date(t.due) - now) / (1000 * 60 * 60);
    return hrs >= 0 && hrs <= 48;
  }).length;
  const sprintRisk = classifySprintRisk({
    hasAnyData: forecastEvidence.tasks.total > 0,
    teamRiskLevel: teamRisk.riskLevel,
    forecastStatus: forecast.status,
    healthStatus: health.health,
    blockedTaskCount: blocked.count,
    overdueSelectedCount: forecastEvidence.overdueTasks.length,
    dueSoon48hCount: dueSoon48h,
    workloadImbalanced: workload.overloadedMembers.length > 0 || workload.underUtilizedMembers.length > 0,
  });

  // ---- Conflict impact (reused: conflictDetectionService.runDetectors,
  // real messages, hypothetical tasks — task-related detectors only) ----
  let conflictImpact = { simulated: false, reason: "Conflict impact not simulated." };
  if (messages) {
    try {
      const plainTasks = tasks.map((t) => ({
        id: String(t._id),
        title: t.title,
        status: t.status,
        priority: t.priority,
        due: t.due || null,
        assignee: t.assignee || null,
      }));
      const conflicts = runConflictDetectors(messages, plainTasks, now);
      conflictImpact = { simulated: true, conflictCount: conflicts.length };
    } catch {
      conflictImpact = { simulated: false, reason: "Conflict impact not simulated." };
    }
  }

  return {
    projectStatus: health.health,
    completionProbability: forecast.probability,
    riskScore: teamRisk.riskScore,
    riskLevel: teamRisk.riskLevel,
    healthScore: health.healthScore,
    executionScore: execution.executionScore,
    executionStatus: execution.overallStatus,
    workloadBalance: {
      overloadedMembers: workload.overloadedMembers,
      underUtilizedMembers: workload.underUtilizedMembers,
      byMember: workload.byMember,
      balanced: workload.overloadedMembers.length === 0 && workload.underUtilizedMembers.length === 0,
    },
    overdueTaskCount: forecastEvidence.overdueTasks.length,
    blockedTaskCount: blocked.count,
    reviewBacklogCount: forecastEvidence.pendingReviewTasks.length,
    highRiskTaskCount: (teamRiskEvidence.riskyTasks || []).length,
    deadlinePressure: forecast.status,
    daysRemaining: forecastEvidence.deadline.daysRemaining,
    teamAttention: affectedStudents,
    sprintRisk,
    conflictImpact,
    forecastDisclaimer: forecast.disclaimer,
    healthDisclaimer: health.disclaimer,
  };
}

/* ============================================================
 * BASELINE vs PROJECTED comparison
 * ============================================================ */

/** metric -> "higher is better" (true) or "lower is better" (false). Only
 * numeric metrics are compared; everything else is surfaced as-is. */
const METRIC_DIRECTION = {
  completionProbability: true,
  riskScore: false,
  healthScore: true,
  executionScore: true,
  overdueTaskCount: false,
  blockedTaskCount: false,
  reviewBacklogCount: false,
  highRiskTaskCount: false,
};

function safeNum(v) {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function buildDelta(baseline, projected) {
  const delta = {};
  const improved = [];
  const worsened = [];
  const unchanged = [];

  for (const [metric, higherIsBetter] of Object.entries(METRIC_DIRECTION)) {
    const b = safeNum(baseline[metric]);
    const p = safeNum(projected[metric]);
    if (b == null || p == null) {
      delta[metric] = { value: null, status: "INSUFFICIENT_DATA", reason: "Metric could not be calculated for baseline or projected state." };
      continue;
    }
    const diff = Math.round((p - b) * 100) / 100;
    delta[metric] = diff;
    if (diff === 0) {
      unchanged.push(metric);
    } else if ((diff > 0) === higherIsBetter) {
      improved.push(metric);
    } else {
      worsened.push(metric);
    }
  }

  // Non-numeric / categorical fields also tracked as unchanged/changed.
  if (baseline.projectStatus === projected.projectStatus) unchanged.push("projectStatus");
  else if (baseline.projectStatus != null && projected.projectStatus != null) {
    delta.projectStatus = { from: baseline.projectStatus, to: projected.projectStatus };
  }

  return { delta, improved, worsened, unchanged };
}

function buildCounterfactualExplanations(baseline, projected, appliedLog) {
  const explanations = [];
  const push = (metric, reasons) => {
    const b = safeNum(baseline[metric]);
    const p = safeNum(projected[metric]);
    if (b == null || p == null || b === p) return;
    explanations.push({
      metric,
      baseline: b,
      projected: p,
      delta: Math.round((p - b) * 100) / 100,
      direction: p > b ? "IMPROVED_IF_HIGHER_IS_BETTER" : "DECREASED",
      reasons,
    });
  };

  const reasons = [];
  const deadlineMoves = appliedLog.filter((a) => a.type === "TASK_DEADLINE");
  if (deadlineMoves.length) reasons.push(`${deadlineMoves.length} task deadline(s) were changed.`);
  const reassignments = appliedLog.filter((a) => a.type === "TASK_REASSIGNMENT" || a.type === "WORKLOAD_REDISTRIBUTION");
  if (reassignments.length) reasons.push(`${reassignments.length} task(s) were reassigned.`);
  const statusChanges = appliedLog.filter((a) => a.type === "TASK_STATUS");
  if (statusChanges.length) reasons.push(`${statusChanges.length} task status change(s) were applied.`);
  const blockerResolves = appliedLog.filter((a) => a.type === "TASK_BLOCKER");
  if (blockerResolves.length) reasons.push(`${blockerResolves.length} task(s) had their dependencies marked resolved.`);
  const deadlineExt = appliedLog.filter((a) => a.type === "PROJECT_DEADLINE");
  if (deadlineExt.length) reasons.push("The project deadline was changed.");

  if (!reasons.length) reasons.push("No changes were applied in this scenario.");

  ["completionProbability", "riskScore", "healthScore", "executionScore", "overdueTaskCount", "blockedTaskCount"].forEach(
    (m) => push(m, reasons)
  );

  return explanations;
}

function buildImpactSummary(baseline, projected, delta) {
  const details = [];
  if (delta.completionProbability && typeof delta.completionProbability === "number") {
    details.push(
      delta.completionProbability > 0
        ? `Projected completion probability improves by ${delta.completionProbability} points.`
        : `Projected completion probability decreases by ${Math.abs(delta.completionProbability)} points.`
    );
  }
  if (delta.riskScore && typeof delta.riskScore === "number") {
    details.push(
      delta.riskScore < 0
        ? `Team risk score decreases by ${Math.abs(delta.riskScore)} points.`
        : `Team risk score increases by ${delta.riskScore} points.`
    );
  }
  if (baseline.overdueTaskCount !== projected.overdueTaskCount) {
    details.push(`Overdue task count changes from ${baseline.overdueTaskCount} to ${projected.overdueTaskCount}.`);
  }
  if (baseline.blockedTaskCount !== projected.blockedTaskCount) {
    details.push(`Blocked task count changes from ${baseline.blockedTaskCount} to ${projected.blockedTaskCount}.`);
  }
  if (!details.length) details.push("No measurable change to projected outcomes was found.");

  let headline = "The project outcome is projected to stay about the same.";
  const scoreRank = { CRITICAL: 0, AT_RISK: 1, LIKELY_LATE: 1, NEEDS_ATTENTION: 1, HIGH: 1, MODERATE: 2, STABLE: 3, ON_TRACK: 4, LOW: 4, HEALTHY: 5 };
  const bRank = scoreRank[baseline.projectStatus] ?? 2;
  const pRank = scoreRank[projected.projectStatus] ?? 2;
  if (pRank > bRank) headline = "The project is projected to become more stable.";
  else if (pRank < bRank) headline = "The project is projected to become less stable.";

  return { headline, details };
}

/* ============================================================
 * ORCHESTRATION — one full simulation run
 * ============================================================ */

/**
 * Fetches the real, current tasks/group/messages needed for a simulation.
 * DB reads only — no computation, no mutation.
 */
async function fetchSimulationBaseData(group) {
  const now = new Date();
  const [rawTasks, conflictEvidence] = await Promise.all([
    Task.find({ group: group._id }).lean(),
    gatherGroupConflictEvidence(group._id).catch(() => ({ messages: [] })),
  ]);
  return { now, tasks: rawTasks, messages: conflictEvidence.messages || [] };
}

/**
 * Runs one what-if simulation for a group. `changes` is the raw array from
 * the request body. Returns accepted/rejected/warnings/conflicts plus
 * baseline/projected/delta/summary — or an INVALID_SIMULATION result if
 * contradictory changes were supplied.
 */
async function runWhatIfSimulation(group, changes = [], { baseData = null } = {}) {
  const data = baseData || (await fetchSimulationBaseData(group));
  const { now, tasks, messages } = data;
  const tasksById = new Map(tasks.map((t) => [String(t._id), t]));

  const accepted = [];
  const rejected = [];
  const warnings = [];

  for (const raw of Array.isArray(changes) ? changes : []) {
    const result = validateChange(raw, { tasksById, group });
    if (result.ok) {
      accepted.push({ ...raw, taskId: raw.taskId ? String(raw.taskId) : undefined, value: result.value, _resolved: result });
    } else {
      rejected.push({ change: raw, reason: result.reason });
    }
  }

  const conflicts = detectConflicts(accepted);
  if (conflicts.length) {
    return {
      status: "INVALID_SIMULATION",
      conflicts,
      accepted: [],
      rejected,
      warnings,
    };
  }

  const baseline = buildMetricBundle({ tasks: tasks.map(cloneTask), group, messages, now });

  const { tasks: projectedTasks, group: projectedGroup, appliedLog } = applyChanges(tasks, group, accepted);
  const projected = buildMetricBundle({ tasks: projectedTasks, group: projectedGroup, messages, now });

  const { delta, improved, worsened, unchanged } = buildDelta(baseline, projected);
  const counterfactuals = buildCounterfactualExplanations(baseline, projected, appliedLog);
  const summary = buildImpactSummary(baseline, projected, delta);

  if (!accepted.length) {
    warnings.push("No valid changes were supplied — projected state is identical to baseline.");
  }

  return {
    status: "OK",
    groupId: String(group._id),
    accepted: accepted.map((a) => ({
      type: a.type,
      taskId: a.taskId,
      memberId: a.memberId,
      value:
        a.type === "WORKLOAD_REDISTRIBUTION"
          ? a.value.map((v) => ({ taskId: String(v.task._id), memberId: v.memberId }))
          : a.value,
    })),
    rejected,
    warnings,
    conflicts: [],
    baseline,
    projected,
    delta,
    impact: { positive: improved.map(describeMetric), negative: worsened.map(describeMetric), unchanged: unchanged.map(describeMetric) },
    counterfactuals,
    summary,
    recommended: improved.length > worsened.length && improved.length > 0,
    applyable: false,
    generatedAt: now,
    disclaimer: "Simulation only — no project data was changed.",
  };
}

const METRIC_LABELS = {
  completionProbability: "Projected completion probability",
  riskScore: "Team risk score",
  healthScore: "Project health score",
  executionScore: "Execution readiness score",
  overdueTaskCount: "Overdue task count",
  blockedTaskCount: "Blocked task count",
  reviewBacklogCount: "Review backlog",
  highRiskTaskCount: "High-risk task count",
  projectStatus: "Project status",
};

function describeMetric(metric) {
  return METRIC_LABELS[metric] || metric;
}

/* ============================================================
 * SCENARIO COMPARISON
 * ============================================================ */

const HEALTH_RANK = { HEALTHY: 5, STABLE: 4, NEEDS_ATTENTION: 3, AT_RISK: 2, CRITICAL: 1, INSUFFICIENT_DATA: 0 };

async function compareScenarios(group, scenarios = [], { baseData: providedBaseData = null } = {}) {
  const baseData = providedBaseData || (await fetchSimulationBaseData(group));

  const results = [];
  // Scenario 0 is always the real current state (no changes).
  const baselineRun = await runWhatIfSimulation(group, [], { baseData });
  results.push({ id: "baseline", label: "Current project", ...baselineRun });

  let index = 1;
  for (const scenario of Array.isArray(scenarios) ? scenarios : []) {
    const label = scenario.label || `Scenario ${index}`;
    const id = scenario.id || `scenario-${index}`;
    // eslint-disable-next-line no-await-in-loop -- small, bounded list of scenarios
    const run = await runWhatIfSimulation(group, scenario.changes || [], { baseData });
    results.push({ id, label, ...run });
    index += 1;
  }

  const ranked = [...results]
    .filter((r) => r.status === "OK")
    .sort((a, b) => {
      const rankDiff = (HEALTH_RANK[b.projected.projectStatus] ?? 0) - (HEALTH_RANK[a.projected.projectStatus] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return (b.projected.completionProbability ?? -1) - (a.projected.completionProbability ?? -1);
    })
    .map((r) => r.id);

  const topId = ranked[0];
  const secondId = ranked[1];
  let bestScenarioId = null;
  if (topId) {
    const top = results.find((r) => r.id === topId);
    const second = secondId ? results.find((r) => r.id === secondId) : null;
    const clearlyBetter =
      !second ||
      top.projected.projectStatus !== second.projected.projectStatus ||
      (top.projected.completionProbability ?? 0) !== (second.projected.completionProbability ?? 0);
    if (clearlyBetter) bestScenarioId = topId;
  }

  return {
    scenarios: results,
    ranking: ranked,
    bestScenarioId,
    note: bestScenarioId
      ? undefined
      : "No single scenario is clearly best on the available measurable outcomes — review the trade-offs.",
  };
}

module.exports = {
  getCapabilities,
  SUPPORTED_CHANGE_TYPES,
  UNSUPPORTED_CHANGE_TYPES,
  validateChange,
  detectConflicts,
  applyChanges,
  buildMetricBundle,
  buildDelta,
  buildCounterfactualExplanations,
  buildImpactSummary,
  countBlockedTasks,
  fetchSimulationBaseData,
  runWhatIfSimulation,
  compareScenarios,
};
