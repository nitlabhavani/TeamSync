/**
 * STEP 23 — AI Sprint Planner.
 *
 * Deliberately does NOT reimplement anything Steps 15–22 already built:
 *   - team risk            -> teamRiskAnalyzer.gatherGroupEvidence / computeTeamRisk
 *   - project forecast     -> projectForecastService.computeForecast (via getProjectHealth's
 *                             already-gathered evidence, or run fresh if not cached)
 *   - project health        -> projectHealthService.getProjectHealth
 *   - execution copilot     -> projectExecutionCopilotService.getExecutionCopilot
 *   - team performance      -> teamPerformanceService.getTeamPerformance
 *   - assignment suggestion -> smartTaskAssignmentService.getRecommendation /
 *                              canRequestRecommendation
 * This module's own, new logic is limited to: candidate task selection,
 * dependency-aware ordering, sprint date derivation, workload aggregation,
 * a transparent categorical sprint-risk rollup, evidence-based
 * recommendation text, and stale-plan detection on Apply.
 *
 * Architecture (mirrors teamRiskAnalyzer.js / smartTaskAssignmentService.js):
 *   LAYER 1 — evidence gathering (DB access)
 *   LAYER 2 — pure planning/computation (no DB, deterministic, unit-testable)
 *   LAYER 3 — orchestration (used by the controller)
 *
 * This is a PLANNING/RECOMMENDATION feature. Nothing in LAYER 1/2 mutates a
 * Task. Only sprintPlannerController.apply (LAYER 3, explicit user action)
 * ever writes to real Task documents, and even then only after re-validating
 * the plan is not stale (see findStaleTasks).
 */
const Task = require("../models/Task");
const SprintPlan = require("../models/SprintPlan");
const { gatherGroupEvidence, computeTeamRisk } = require("./teamRiskAnalyzer");
const { getProjectHealth } = require("./projectHealthService");
const { getExecutionCopilot } = require("./projectExecutionCopilotService");

const DAY_MS = 86400000;
const OPEN_STATUSES = new Set([
  "backlog", "todo", "in_progress", "review",
  "pending", "submitted", "ai_review", "guide_review", "changes_requested", "overdue",
]);
const DONE_STATUSES = new Set(["done", "completed"]);

const DEFAULT_DURATION_DAYS = 7;
const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 60;
const DEFAULT_MAX_TASKS = 10;
const MAX_MAX_TASKS = 30;

/* ============================================================
 * LAYER 2A — task candidate selection (pure)
 * ============================================================ */

/**
 * @param {Array} tasks  plain task objects: { id, status, priority, due,
 *   dependencies: [taskId], assignee, estimate, updatedAt }
 * @param {object} opts  { now, maxTasks, blockingCounts: Map<taskId, number> }
 */
function selectCandidateTasks(tasks, opts = {}) {
  const now = opts.now || new Date();
  const maxTasks = clampMaxTasks(opts.maxTasks);
  const blockingCounts = opts.blockingCounts || new Map();

  const eligible = (tasks || []).filter((t) => t && !DONE_STATUSES.has(t.status));

  if (eligible.length === 0) {
    return {
      selected: [],
      candidateCount: 0,
      insufficient: true,
      insufficientReason: "No open (not-done) tasks exist in this group to plan a sprint from.",
    };
  }

  const scored = eligible.map((t) => ({ task: t, score: scoreCandidate(t, { now, blockingCounts }) }));
  scored.sort((a, b) => b.score.value - a.score.value || compareDue(a.task.due, b.task.due));

  const selected = scored.slice(0, maxTasks).map((s) => ({ ...s.task, selectionScore: s.score.value, selectionReasons: s.score.reasons }));

  return {
    selected,
    candidateCount: eligible.length,
    insufficient: selected.length === 0,
    insufficientReason: selected.length === 0 ? "No eligible candidate tasks met the sprint-selection criteria." : null,
  };
}

function clampMaxTasks(maxTasks) {
  const n = Number(maxTasks);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TASKS;
  return Math.min(MAX_MAX_TASKS, Math.round(n));
}

function compareDue(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

/** Transparent, additive scoring — never a black box. Every point is tied to
 * a real evidence field (§6 of the spec's priority ordering). */
function scoreCandidate(task, { now, blockingCounts }) {
  let value = 0;
  const reasons = [];

  const isOverdue = task.due && new Date(task.due) < now && !DONE_STATUSES.has(task.status);
  if (isOverdue) {
    value += 5;
    reasons.push("Task is overdue");
  }

  const blockCount = blockingCounts.get(String(task.id)) || 0;
  if (blockCount > 0) {
    value += Math.min(4, blockCount) + 2;
    reasons.push(`Blocks ${blockCount} other task(s)`);
  }

  if (task.due && !isOverdue) {
    const daysLeft = (new Date(task.due).getTime() - now.getTime()) / DAY_MS;
    if (daysLeft <= 2) {
      value += 3;
      reasons.push("Due within 2 days");
    } else if (daysLeft <= 7) {
      value += 2;
      reasons.push("Due within a week");
    }
  }

  if (task.priority === "critical") {
    value += 3;
    reasons.push("Priority: critical");
  } else if (task.priority === "high") {
    value += 2;
    reasons.push("Priority: high");
  }

  const openDeps = (task.dependencies || []).filter((depId) => task._openDependencySet?.has(String(depId)));
  if (openDeps && openDeps.length > 0) {
    value -= 1; // slight deprioritization: task is itself blocked
    reasons.push(`Waiting on ${openDeps.length} unfinished dependency(ies)`);
  }

  if (task.executionFlagged) {
    value += 2;
    reasons.push("Flagged by Execution Copilot as a near-term action");
  }

  if (reasons.length === 0) reasons.push("No elevated urgency signals; included by priority/age only");

  return { value, reasons };
}

/* ============================================================
 * LAYER 2B — dependency-aware ordering (pure, deterministic)
 * ============================================================ */

/**
 * Topological ordering restricted to the selected task set. Dependency
 * edges pointing at a task NOT in the selected set are treated as external
 * blockers (reported via blockedBy) rather than ordering constraints, since
 * this planner never invents or reorders tasks outside the sprint.
 *
 * @param {Array} selectedTasks [{ id, dependencies: [taskId] }]
 * @returns {{ orderedIds, cyclesDetected, cycleTaskIds, blockedBy: Map }}
 */
function orderTasksByDependency(selectedTasks) {
  const ids = selectedTasks.map((t) => String(t.id));
  const idSet = new Set(ids);
  const depsOf = new Map();
  const blockedBy = new Map();

  selectedTasks.forEach((t) => {
    const deps = (t.dependencies || []).map(String);
    const internalDeps = deps.filter((d) => idSet.has(d));
    const externalDeps = deps.filter((d) => !idSet.has(d));
    depsOf.set(String(t.id), internalDeps);
    blockedBy.set(String(t.id), externalDeps);
  });

  // Kahn's algorithm
  const inDegree = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  depsOf.forEach((deps, id) => {
    deps.forEach((d) => {
      adj.get(d).push(id);
      inDegree.set(id, inDegree.get(id) + 1);
    });
  });

  // Stable priority: tasks with no deps first, ties broken by original order.
  const queue = ids.filter((id) => inDegree.get(id) === 0);
  const orderedIds = [];
  const visited = new Set();

  while (queue.length > 0) {
    queue.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const id = queue.shift();
    orderedIds.push(id);
    visited.add(id);
    (adj.get(id) || []).forEach((next) => {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    });
  }

  const cycleTaskIds = ids.filter((id) => !visited.has(id));
  const cyclesDetected = cycleTaskIds.length > 0;

  // Cycle members: append in original order so every selected task still
  // gets a position (never silently dropped), but flagged via cyclesDetected.
  if (cyclesDetected) {
    cycleTaskIds.forEach((id) => orderedIds.push(id));
  }

  return { orderedIds, cyclesDetected, cycleTaskIds, blockedBy };
}

/* ============================================================
 * LAYER 2C — sprint dates (pure)
 * ============================================================ */

/**
 * @param {object} opts { startDate, endDate, durationDays, now, groupTargetDate }
 */
function computeSprintDates(opts = {}) {
  const now = opts.now || new Date();
  const reasons = [];

  if (opts.startDate && opts.endDate) {
    const start = new Date(opts.startDate);
    const end = new Date(opts.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { error: "Invalid sprint start/end date supplied." };
    }
    if (end <= start) {
      return { error: "Sprint end date must be after the sprint start date." };
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (days < MIN_DURATION_DAYS || days > MAX_DURATION_DAYS) {
      return { error: `Sprint duration must be between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS} days.` };
    }
    reasons.push("Using explicit sprint start/end dates supplied by the caller");
    return { start, end, planningHorizonDays: days, reasons };
  }

  let durationDays = DEFAULT_DURATION_DAYS;
  if (opts.durationDays !== undefined && opts.durationDays !== null) {
    const d = Number(opts.durationDays);
    if (!Number.isFinite(d) || d < MIN_DURATION_DAYS || d > MAX_DURATION_DAYS) {
      return { error: `Sprint duration must be a number between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS} days.` };
    }
    durationDays = Math.round(d);
    reasons.push(`Using explicit ${durationDays}-day sprint duration`);
  } else {
    reasons.push(`No sprint dates/duration supplied — defaulting to a ${DEFAULT_DURATION_DAYS}-day planning window`);
  }

  const start = opts.startDate ? new Date(opts.startDate) : new Date(now);
  if (Number.isNaN(start.getTime())) return { error: "Invalid sprint start date supplied." };

  let end = new Date(start.getTime() + durationDays * DAY_MS);

  // Never extend a sprint past a real, existing group target date — use it
  // as evidence, never invent an unrelated date.
  if (opts.groupTargetDate) {
    const target = new Date(opts.groupTargetDate);
    if (!Number.isNaN(target.getTime()) && target > start && target < end) {
      end = target;
      reasons.push("Sprint end capped at the project's existing target/deadline date");
    }
  }

  const actualDays = Math.max(MIN_DURATION_DAYS, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  return { start, end, planningHorizonDays: actualDays, reasons };
}

/* ============================================================
 * LAYER 2D — workload balancing (pure)
 * ============================================================ */

/**
 * @param {Array} selectedTasks [{ id, assignee, estimate }]
 * @param {Array} memberIds     all group member ids (so 0-task members show as under-utilized)
 */
function computeWorkload(selectedTasks, memberIds = []) {
  const byMember = new Map(memberIds.map((id) => [String(id), { memberId: String(id), taskCount: 0, effort: 0 }]));
  let unassignedCount = 0;
  let effortKnownForAll = true;

  selectedTasks.forEach((t) => {
    const hasEffort = Number.isFinite(Number(t.estimate)) && Number(t.estimate) > 0;
    if (!hasEffort) effortKnownForAll = false;
    if (!t.assignee) {
      unassignedCount += 1;
      return;
    }
    const key = String(t.assignee);
    if (!byMember.has(key)) byMember.set(key, { memberId: key, taskCount: 0, effort: 0 });
    const entry = byMember.get(key);
    entry.taskCount += 1;
    entry.effort += hasEffort ? Number(t.estimate) : 0;
  });

  const entries = Array.from(byMember.values());
  const assignedEntries = entries.filter((e) => e.taskCount > 0);
  const avg = assignedEntries.length
    ? assignedEntries.reduce((sum, e) => sum + e.taskCount, 0) / assignedEntries.length
    : 0;

  const overloaded = [];
  const underUtilized = [];
  const totalAssignedTasks = assignedEntries.reduce((sum, e) => sum + e.taskCount, 0);
  const byMemberOut = entries.map((e) => {
    let balanceLabel = "BALANCED";
    if (e.taskCount > 0 && avg > 0 && e.taskCount >= avg + 2) {
      balanceLabel = "OVERLOADED";
      overloaded.push(e.memberId);
    } else if (e.taskCount === 0 && entries.length > 1 && assignedEntries.length > 0) {
      balanceLabel = "UNDER_UTILIZED";
      underUtilized.push(e.memberId);
    }
    const percentage = totalAssignedTasks > 0 ? Math.round((e.taskCount / totalAssignedTasks) * 100) : 0;
    return { memberId: e.memberId, taskCount: e.taskCount, effort: e.effort, percentage, balanceLabel };
  });

  return {
    totalSelectedTasks: selectedTasks.length,
    unassignedCount,
    effortEstimatesAvailable: effortKnownForAll && selectedTasks.length > 0,
    totalEstimatedEffort: effortKnownForAll && selectedTasks.length > 0
      ? entries.reduce((sum, e) => sum + e.effort, 0)
      : null,
    byMember: byMemberOut,
    overloadedMembers: overloaded,
    underUtilizedMembers: underUtilized,
  };
}

/* ============================================================
 * LAYER 2E — sprint risk (pure, categorical aggregation only —
 * NEVER a replacement 0-100 team-risk formula; see spec §10)
 * ============================================================ */

const SPRINT_RISK_LEVELS = ["INSUFFICIENT_DATA", "LOW_RISK", "MODERATE_RISK", "HIGH_RISK", "CRITICAL_RISK"];

/**
 * @param {object} evidence {
 *   teamRiskLevel, forecastStatus, healthStatus,   // existing snapshots' own labels
 *   blockedTaskCount, overdueSelectedCount, dueSoon48hCount,
 *   workloadImbalanced, hasAnyData
 * }
 */
function classifySprintRisk(evidence = {}) {
  if (!evidence.hasAnyData) {
    return { level: "INSUFFICIENT_DATA", factors: ["Not enough evidence (no team risk/forecast/task data) to classify sprint risk."] };
  }

  let points = 0;
  const factors = [];

  if (evidence.teamRiskLevel === "CRITICAL") { points += 3; factors.push("Team risk is currently CRITICAL"); }
  else if (evidence.teamRiskLevel === "HIGH") { points += 2; factors.push("Team risk is currently HIGH"); }
  else if (evidence.teamRiskLevel === "MODERATE") { points += 1; factors.push("Team risk is currently MODERATE"); }

  if (evidence.forecastStatus === "CRITICAL") { points += 3; factors.push("Project forecast is CRITICAL"); }
  else if (evidence.forecastStatus === "LIKELY_LATE") { points += 2; factors.push("Project forecast is LIKELY_LATE"); }
  else if (evidence.forecastStatus === "AT_RISK") { points += 1; factors.push("Project forecast is AT_RISK"); }

  if (evidence.healthStatus === "CRITICAL") { points += 2; factors.push("Project health is CRITICAL"); }
  else if (evidence.healthStatus === "AT_RISK") { points += 1; factors.push("Project health is AT_RISK"); }

  if (evidence.blockedTaskCount > 0) {
    points += Math.min(2, evidence.blockedTaskCount);
    factors.push(`${evidence.blockedTaskCount} selected task(s) are blocked by unfinished dependencies`);
  }
  if (evidence.overdueSelectedCount > 0) {
    points += Math.min(2, evidence.overdueSelectedCount);
    factors.push(`${evidence.overdueSelectedCount} selected task(s) are already overdue`);
  }
  if (evidence.dueSoon48hCount > 0) {
    points += 1;
    factors.push(`${evidence.dueSoon48hCount} selected task(s) have a deadline within 48 hours`);
  }
  if (evidence.workloadImbalanced) {
    points += 1;
    factors.push("Selected workload is unevenly distributed across members");
  }

  let level;
  if (points >= 7) level = "CRITICAL_RISK";
  else if (points >= 4) level = "HIGH_RISK";
  else if (points >= 1) level = "MODERATE_RISK";
  else level = "LOW_RISK";

  if (factors.length === 0) factors.push("No elevated risk factors found in current evidence");

  return { level, factors };
}

/* ============================================================
 * LAYER 2F — recommendations (pure, evidence-based only)
 * ============================================================ */

function buildRecommendations(ctx = {}) {
  const recs = [];
  const {
    bottlenecks = [], blockedTaskCount = 0, dueSoon48hCount = 0,
    teamRiskLevel, forecastStatus, overloadedMembers = [], underUtilizedMembers = [],
    reassignSuggestions = [],
  } = ctx;

  bottlenecks.slice(0, 3).forEach((b) => {
    recs.push(`${b.title} is a sprint bottleneck — ${b.blockCount} task(s) depend on it finishing first.`);
  });

  if (blockedTaskCount > 0) {
    recs.push(`${blockedTaskCount} selected task(s) are blocked by unfinished dependencies — resolve those first.`);
  }
  if (dueSoon48hCount > 0) {
    recs.push(`${dueSoon48hCount} selected task(s) have a deadline within 48 hours — schedule them early in the sprint.`);
  }
  if (teamRiskLevel === "CRITICAL" || teamRiskLevel === "HIGH") {
    recs.push(`Current team risk is ${teamRiskLevel}; avoid adding non-critical tasks to this sprint.`);
  }
  if (forecastStatus === "AT_RISK" || forecastStatus === "LIKELY_LATE" || forecastStatus === "CRITICAL") {
    recs.push(`Project forecast is currently ${forecastStatus}; prioritize milestone-critical tasks.`);
  }
  if (overloadedMembers.length > 0) {
    recs.push(`Consider redistributing work: ${overloadedMembers.length} member(s) are carrying a heavier load than the rest of the team.`);
  }
  reassignSuggestions.slice(0, 3).forEach((s) => recs.push(s));
  if (underUtilizedMembers.length > 0 && overloadedMembers.length > 0) {
    recs.push("Some members have spare capacity while others are overloaded — reassignment could help balance the sprint.");
  }

  if (recs.length === 0) {
    recs.push("No elevated risk or workload signals found for this sprint — the current plan looks balanced.");
  }
  return recs;
}

/** Bottleneck tasks = selected tasks with the highest blockingCounts. */
function findBottlenecks(selectedTasks, blockingCounts) {
  return selectedTasks
    .map((t) => ({ id: t.id, title: t.title, blockCount: blockingCounts.get(String(t.id)) || 0 }))
    .filter((b) => b.blockCount > 0)
    .sort((a, b) => b.blockCount - a.blockCount);
}

/* ============================================================
 * LAYER 2G — stale-plan validation (pure)
 * ============================================================ */

/**
 * @param {Array} plannedTasks  SprintPlan.plannedTasks (with *AtGeneration fields)
 * @param {Map}   currentTasksById  Map<taskId, currentTaskPlainObject|null> (null = deleted)
 * @param {string} groupId
 */
function findStaleTasks(plannedTasks, currentTasksById, groupId) {
  const stale = [];
  plannedTasks.forEach((pt) => {
    const id = String(pt.task);
    const current = currentTasksById.get(id);
    if (!current) {
      stale.push({ taskId: id, reason: "TASK_DELETED" });
      return;
    }
    if (String(current.group) !== String(groupId)) {
      stale.push({ taskId: id, reason: "TASK_MOVED_GROUP" });
      return;
    }
    if (
      current.status !== pt.statusAtGeneration ||
      String(current.assignee || "") !== String(pt.assigneeAtGeneration || "") ||
      isoOrNull(current.due) !== isoOrNull(pt.dueAtGeneration) ||
      (current.updatedAt && pt.updatedAtAtGeneration && new Date(current.updatedAt).getTime() !== new Date(pt.updatedAtAtGeneration).getTime())
    ) {
      stale.push({ taskId: id, reason: "TASK_CHANGED" });
    }
  });
  return stale;
}

function isoOrNull(d) {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ============================================================
 * LAYER 1 — evidence gathering (DB access)
 * ============================================================ */

/** Builds a blockingCounts map: taskId -> how many OPEN tasks list it as a dependency. */
function computeBlockingCounts(tasks) {
  const map = new Map();
  tasks.forEach((t) => {
    if (DONE_STATUSES.has(t.status)) return;
    (t.dependencies || []).forEach((depId) => {
      const key = String(depId);
      map.set(key, (map.get(key) || 0) + 1);
    });
  });
  return map;
}

async function gatherSprintPlannerEvidence(group, { now = new Date() } = {}) {
  const tasks = await Task.find({ group: group._id }).lean();
  const plain = tasks.map((t) => ({
    id: t._id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: t.due || null,
    assignee: t.assignee || null,
    estimate: t.estimate,
    dependencies: (t.dependencies || []).map(String),
    updatedAt: t.updatedAt,
    module: t.module || "",
  }));

  const openIdSet = new Set(plain.filter((t) => !DONE_STATUSES.has(t.status)).map((t) => String(t.id)));
  plain.forEach((t) => {
    t._openDependencySet = new Set((t.dependencies || []).filter((d) => openIdSet.has(String(d))));
  });

  const blockingCounts = computeBlockingCounts(plain);

  // Reuse existing evidence/services — never recompute their formulas.
  const [riskEvidence, health, execution] = await Promise.all([
    gatherGroupEvidence(group),
    getProjectHealth(group, { persist: false }).catch(() => null),
    getExecutionCopilot(group, { persist: false }).catch(() => null),
  ]);
  const teamRisk = computeTeamRisk(riskEvidence);

  const executionFlaggedIds = new Set(
    [
      ...(execution?.todayActions || []),
      ...(execution?.criticalActions || []),
    ]
      .map((a) => a?.taskId)
      .filter(Boolean)
      .map(String)
  );
  plain.forEach((t) => {
    t.executionFlagged = executionFlaggedIds.has(String(t.id));
  });

  return {
    tasks: plain,
    blockingCounts,
    teamRisk,
    health,
    execution,
    memberIds: (group.members || []).map(String),
    groupTargetDate: group.targetDate || group.deadline || null,
    now,
  };
}

/* ============================================================
 * LAYER 3 — orchestration
 * ============================================================ */

async function buildSprintPreview(group, input = {}) {
  const now = new Date();
  const dates = computeSprintDates({
    startDate: input.startDate,
    endDate: input.endDate,
    durationDays: input.durationDays,
    now,
    groupTargetDate: group.targetDate || group.deadline || null,
  });
  if (dates.error) return { error: dates.error };

  const evidence = await gatherSprintPlannerEvidence(group, { now });

  const candidateResult = selectCandidateTasks(evidence.tasks, {
    now,
    maxTasks: input.maxTasks,
    blockingCounts: evidence.blockingCounts,
  });

  const selected = candidateResult.selected;
  const ordering = orderTasksByDependency(selected);

  const orderedTasks = ordering.orderedIds.map((id, idx) => selected.find((t) => String(t.id) === id) || null).filter(Boolean);

  // Recommended start/due spread evenly across the sprint window in
  // dependency order — deterministic, never invents an unrelated date.
  const spanMs = dates.end.getTime() - dates.start.getTime();
  const step = orderedTasks.length > 0 ? spanMs / orderedTasks.length : 0;

  const plannedTasks = orderedTasks.map((t, idx) => {
    const recommendedStart = new Date(dates.start.getTime() + step * idx);
    const naturalDue = t.due && new Date(t.due) < dates.end && new Date(t.due) > dates.start ? new Date(t.due) : new Date(dates.start.getTime() + step * (idx + 1));
    const blockedBy = Array.from(ordering.blockedBy.get(String(t.id)) || []);
    const dependencyTaskIds = (t.dependencies || []).filter((d) => selected.some((s) => String(s.id) === String(d)));
    const blockCount = evidence.blockingCounts.get(String(t.id)) || 0;

    return {
      taskId: t.id,
      title: t.title,
      priority: t.priority,
      currentStatus: t.status,
      currentAssignee: t.assignee,
      recommendedOrder: idx + 1,
      recommendedStart,
      recommendedDue: naturalDue,
      estimatedEffort: Number.isFinite(Number(t.estimate)) && Number(t.estimate) > 0 ? Number(t.estimate) : null,
      dependencyTaskIds,
      blockedBy,
      riskLevel: t.due && new Date(t.due) < now ? "HIGH" : blockCount > 0 ? "MODERATE" : "LOW",
      reason: (t.selectionReasons || []).join("; "),
      recommendation: blockCount > 0 ? `${blockCount} other task(s) are waiting on this one.` : "",
      statusAtGeneration: t.status,
      dueAtGeneration: t.due,
      assigneeAtGeneration: t.assignee,
      updatedAtAtGeneration: t.updatedAt,
    };
  });

  const workload = computeWorkload(selected, evidence.memberIds);

  const overdueSelectedCount = selected.filter((t) => t.due && new Date(t.due) < now).length;
  const dueSoon48hCount = selected.filter((t) => t.due && !((new Date(t.due) < now)) && (new Date(t.due).getTime() - now.getTime()) <= 2 * DAY_MS).length;
  const blockedTaskCount = plannedTasks.filter((p) => p.blockedBy.length > 0).length;

  const riskClassification = classifySprintRisk({
    hasAnyData: evidence.tasks.length > 0,
    teamRiskLevel: evidence.teamRisk?.riskLevel,
    forecastStatus: evidence.health?.forecast?.status || null,
    healthStatus: evidence.health?.health || null,
    blockedTaskCount,
    overdueSelectedCount,
    dueSoon48hCount,
    workloadImbalanced: workload.overloadedMembers.length > 0 && workload.underUtilizedMembers.length > 0,
  });

  const bottlenecks = findBottlenecks(selected, evidence.blockingCounts);

  const recommendations = buildRecommendations({
    bottlenecks,
    blockedTaskCount,
    dueSoon48hCount,
    teamRiskLevel: evidence.teamRisk?.riskLevel,
    forecastStatus: evidence.health?.forecast?.status || null,
    overloadedMembers: workload.overloadedMembers,
    underUtilizedMembers: workload.underUtilizedMembers,
    reassignSuggestions: workload.overloadedMembers.length && workload.underUtilizedMembers.length
      ? [`Consider assigning one of the overloaded member's tasks to an under-utilized member to balance the sprint.`]
      : [],
  });

  return {
    sprintStart: dates.start,
    sprintEnd: dates.end,
    planningHorizonDays: dates.planningHorizonDays,
    dateReasons: dates.reasons,
    plannedTasks,
    workloadSummary: {
      totalSelectedTasks: workload.totalSelectedTasks,
      totalEstimatedEffort: workload.totalEstimatedEffort,
      effortEstimatesAvailable: workload.effortEstimatesAvailable,
      byMember: workload.byMember,
      overloadedMembers: workload.overloadedMembers,
      underUtilizedMembers: workload.underUtilizedMembers,
    },
    dependencySummary: {
      totalDependencies: plannedTasks.reduce((sum, p) => sum + p.dependencyTaskIds.length, 0),
      blockedTaskCount,
      bottleneckTaskIds: bottlenecks.map((b) => b.id),
      cyclesDetected: ordering.cyclesDetected,
    },
    riskSummary: {
      sprintRiskLevel: riskClassification.level,
      factors: riskClassification.factors,
      teamRiskLevelAtGeneration: evidence.teamRisk?.riskLevel || null,
      forecastStatusAtGeneration: evidence.health?.forecast?.status || null,
      healthStatusAtGeneration: evidence.health?.health || null,
    },
    recommendations,
    baselineMetrics: {
      totalOpenTasks: evidence.tasks.filter((t) => !DONE_STATUSES.has(t.status)).length,
      eligibleCandidateCount: candidateResult.candidateCount,
    },
    insufficient: candidateResult.insufficient,
    insufficientReason: candidateResult.insufficientReason,
  };
}

/** Student-safe view — only the tasks assigned to `userId`, no team-wide reasoning. */
function shapeForStudent(plan, userId) {
  const mine = (plan.plannedTasks || []).filter((p) => p.currentAssignee && String(p.currentAssignee) === String(userId) || (p.task && String(p.task) === undefined));
  const filtered = (plan.plannedTasks || []).filter((p) => {
    const assignee = p.currentAssignee ?? p.assigneeAtGeneration;
    return assignee && String(assignee) === String(userId);
  });
  return {
    title: plan.title,
    sprintStart: plan.sprintStart,
    sprintEnd: plan.sprintEnd,
    status: plan.status,
    myTasks: filtered.map((p) => ({
      taskId: p.task || p.taskId,
      title: p.title,
      priority: p.priority,
      recommendedOrder: p.recommendedOrder,
      recommendedDue: p.recommendedDue,
    })),
  };
}

module.exports = {
  // constants
  OPEN_STATUSES,
  DONE_STATUSES,
  SPRINT_RISK_LEVELS,
  DEFAULT_DURATION_DAYS,
  MIN_DURATION_DAYS,
  MAX_DURATION_DAYS,
  DEFAULT_MAX_TASKS,
  MAX_MAX_TASKS,
  // pure functions (tested directly)
  selectCandidateTasks,
  scoreCandidate,
  orderTasksByDependency,
  computeSprintDates,
  computeWorkload,
  classifySprintRisk,
  buildRecommendations,
  findBottlenecks,
  findStaleTasks,
  computeBlockingCounts,
  clampMaxTasks,
  shapeForStudent,
  // orchestration
  gatherSprintPlannerEvidence,
  buildSprintPreview,
};
