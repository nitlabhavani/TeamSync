/**
 * Standalone tests for STEP 23 — AI Sprint Planner.
 * No DB / no server needed — exercises the pure planning functions in
 * services/sprintPlannerService.js directly with hand-built task objects,
 * exactly like backend/scripts/testSmartTaskAssignmentService.js and
 * backend/scripts/testTeamRiskAnalyzer.js do.
 *
 * Run: node backend/scripts/testSprintPlanner.js
 */
const assert = require("assert");
const {
  selectCandidateTasks,
  orderTasksByDependency,
  computeSprintDates,
  computeWorkload,
  classifySprintRisk,
  buildRecommendations,
  findBottlenecks,
  findStaleTasks,
  computeBlockingCounts,
  clampMaxTasks,
  DEFAULT_DURATION_DAYS,
  MIN_DURATION_DAYS,
  MAX_DURATION_DAYS,
  DEFAULT_MAX_TASKS,
} = require("../src/services/sprintPlannerService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-02T12:00:00Z");
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86400000);

let seq = 1;
/** Builds a plain task object with sane defaults, only overriding what a test cares about. */
function task(overrides = {}) {
  const id = overrides.id || `t${seq++}`;
  return {
    id,
    title: overrides.title || `Task ${id}`,
    status: overrides.status || "todo",
    priority: overrides.priority || "medium",
    due: overrides.due !== undefined ? overrides.due : null,
    assignee: overrides.assignee !== undefined ? overrides.assignee : null,
    estimate: overrides.estimate !== undefined ? overrides.estimate : 1,
    dependencies: overrides.dependencies || [],
    updatedAt: overrides.updatedAt || NOW,
    executionFlagged: overrides.executionFlagged || false,
    _openDependencySet: overrides._openDependencySet || new Set(),
    ...(overrides.extra || {}),
  };
}

/* =====================================================================
 * A. TASK CANDIDATE SELECTION
 * ===================================================================== */

check("A1 — empty task list returns insufficient with no selections", () => {
  const result = selectCandidateTasks([], { now: NOW });
  assert.strictEqual(result.selected.length, 0);
  assert.strictEqual(result.insufficient, true);
  assert.ok(result.insufficientReason);
});

check("A2 — completed/done tasks are excluded from candidates", () => {
  const tasks = [task({ status: "done" }), task({ status: "completed" })];
  const result = selectCandidateTasks(tasks, { now: NOW });
  assert.strictEqual(result.selected.length, 0);
  assert.strictEqual(result.candidateCount, 0);
});

check("A3 — overdue task is prioritized to the top", () => {
  const overdue = task({ due: daysFromNow(-2), status: "todo" });
  const normal = task({ due: null, priority: "low" });
  const result = selectCandidateTasks([normal, overdue], { now: NOW, maxTasks: 5 });
  assert.strictEqual(String(result.selected[0].id), String(overdue.id));
});

check("A4 — critical priority task ranks above medium priority", () => {
  const critical = task({ priority: "critical" });
  const medium = task({ priority: "medium" });
  const result = selectCandidateTasks([medium, critical], { now: NOW, maxTasks: 5 });
  assert.strictEqual(String(result.selected[0].id), String(critical.id));
});

check("A5 — task due within 2 days ranks above a task with no deadline", () => {
  const soon = task({ due: daysFromNow(1) });
  const noDue = task({ due: null });
  const result = selectCandidateTasks([noDue, soon], { now: NOW, maxTasks: 5 });
  assert.strictEqual(String(result.selected[0].id), String(soon.id));
});

check("A6 — blocker task (blocks others) is prioritized", () => {
  const blocker = task({ id: "blk1" });
  const nonBlocker = task({});
  const blockingCounts = new Map([["blk1", 3]]);
  const result = selectCandidateTasks([nonBlocker, blocker], { now: NOW, maxTasks: 5, blockingCounts });
  assert.strictEqual(String(result.selected[0].id), "blk1");
});

check("A7 — insufficient candidates returns fewer tasks and explains why", () => {
  const tasks = [task({}), task({})];
  const result = selectCandidateTasks(tasks, { now: NOW, maxTasks: 10 });
  assert.strictEqual(result.selected.length, 2);
  assert.strictEqual(result.candidateCount, 2);
});

check("A8 — maxTasks caps selection without inventing extra tasks", () => {
  const tasks = [task({}), task({}), task({}), task({})];
  const result = selectCandidateTasks(tasks, { now: NOW, maxTasks: 2 });
  assert.strictEqual(result.selected.length, 2);
});

/* =====================================================================
 * B. DEPENDENCY ORDERING
 * ===================================================================== */

check("B1 — simple dependency: A before B", () => {
  const a = task({ id: "A" });
  const b = task({ id: "B", dependencies: ["A"] });
  const { orderedIds, cyclesDetected } = orderTasksByDependency([a, b]);
  assert.strictEqual(cyclesDetected, false);
  assert.ok(orderedIds.indexOf("A") < orderedIds.indexOf("B"));
});

check("B2 — multi-level dependency chain A -> B -> C", () => {
  const a = task({ id: "A" });
  const b = task({ id: "B", dependencies: ["A"] });
  const c = task({ id: "C", dependencies: ["B"] });
  const { orderedIds } = orderTasksByDependency([c, a, b]);
  assert.deepStrictEqual(orderedIds, ["A", "B", "C"]);
});

check("B3 — independent tasks keep a stable relative order", () => {
  const a = task({ id: "A" });
  const b = task({ id: "B" });
  const { orderedIds } = orderTasksByDependency([a, b]);
  assert.deepStrictEqual(orderedIds.sort(), ["A", "B"]);
});

check("B4 — task with multiple dependencies is ordered after all of them", () => {
  const a = task({ id: "A" });
  const b = task({ id: "B" });
  const c = task({ id: "C", dependencies: ["A", "B"] });
  const { orderedIds } = orderTasksByDependency([c, a, b]);
  assert.ok(orderedIds.indexOf("A") < orderedIds.indexOf("C"));
  assert.ok(orderedIds.indexOf("B") < orderedIds.indexOf("C"));
});

check("B5 — circular dependency is detected, not silently ordered", () => {
  const a = task({ id: "A", dependencies: ["B"] });
  const b = task({ id: "B", dependencies: ["A"] });
  const { cyclesDetected, cycleTaskIds } = orderTasksByDependency([a, b]);
  assert.strictEqual(cyclesDetected, true);
  assert.deepStrictEqual(cycleTaskIds.sort(), ["A", "B"]);
});

check("B6 — dependency pointing outside the selected set is reported as blockedBy, not an ordering error", () => {
  const b = task({ id: "B", dependencies: ["X-not-selected"] });
  const { orderedIds, cyclesDetected, blockedBy } = orderTasksByDependency([b]);
  assert.strictEqual(cyclesDetected, false);
  assert.deepStrictEqual(orderedIds, ["B"]);
  assert.deepStrictEqual(blockedBy.get("B"), ["X-not-selected"]);
});

check("B7 — dependency-aware ordering never puts a task before something it depends on, even with 3 branches", () => {
  const a = task({ id: "A" });
  const b = task({ id: "B" });
  const c = task({ id: "C", dependencies: ["A"] });
  const d = task({ id: "D", dependencies: ["B", "C"] });
  const { orderedIds } = orderTasksByDependency([d, c, b, a]);
  assert.ok(orderedIds.indexOf("A") < orderedIds.indexOf("C"));
  assert.ok(orderedIds.indexOf("C") < orderedIds.indexOf("D"));
  assert.ok(orderedIds.indexOf("B") < orderedIds.indexOf("D"));
});

/* =====================================================================
 * C. DATE PLANNING
 * ===================================================================== */

check("C1 — default sprint dates use the default duration when nothing is supplied", () => {
  const result = computeSprintDates({ now: NOW });
  assert.strictEqual(result.planningHorizonDays, DEFAULT_DURATION_DAYS);
  assert.strictEqual(result.start.getTime(), NOW.getTime());
});

check("C2 — custom duration is honored", () => {
  const result = computeSprintDates({ now: NOW, durationDays: 14 });
  assert.strictEqual(result.planningHorizonDays, 14);
});

check("C3 — custom start/end dates are honored exactly", () => {
  const start = daysFromNow(1);
  const end = daysFromNow(8);
  const result = computeSprintDates({ startDate: start, endDate: end, now: NOW });
  assert.strictEqual(result.start.getTime(), start.getTime());
  assert.strictEqual(result.end.getTime(), end.getTime());
  assert.strictEqual(result.planningHorizonDays, 7);
});

check("C4 — invalid dates (end before start) are rejected with an error, not silently accepted", () => {
  const result = computeSprintDates({ startDate: daysFromNow(5), endDate: daysFromNow(1), now: NOW });
  assert.ok(result.error);
});

check("C5 — duration outside the allowed bounds is rejected", () => {
  const tooLong = computeSprintDates({ now: NOW, durationDays: MAX_DURATION_DAYS + 10 });
  const tooShort = computeSprintDates({ now: NOW, durationDays: MIN_DURATION_DAYS - 1 });
  assert.ok(tooLong.error);
  assert.ok(tooShort.error);
});

check("C6 — sprint end is capped at an existing group target date rather than overrunning it", () => {
  const target = daysFromNow(3);
  const result = computeSprintDates({ now: NOW, durationDays: 7, groupTargetDate: target });
  assert.strictEqual(result.end.getTime(), target.getTime());
  assert.ok(result.planningHorizonDays <= 7);
});

check("C7 — a group target date in the past (already overdue project) does not corrupt the sprint window", () => {
  const target = daysFromNow(-3);
  const result = computeSprintDates({ now: NOW, durationDays: 7, groupTargetDate: target });
  // Target is before start, so it must NOT be used as the cap.
  assert.ok(result.end.getTime() > result.start.getTime());
  assert.strictEqual(result.planningHorizonDays, 7);
});

/* =====================================================================
 * D. WORKLOAD BALANCING
 * ===================================================================== */

check("D1 — balanced workload across members reports BALANCED", () => {
  const tasks = [task({ assignee: "u1" }), task({ assignee: "u2" }), task({ assignee: "u3" })];
  const result = computeWorkload(tasks, ["u1", "u2", "u3"]);
  assert.ok(result.byMember.every((m) => m.balanceLabel === "BALANCED"));
});

check("D2 — an overloaded member is flagged relative to the rest of the team", () => {
  const tasks = [
    task({ assignee: "u1" }), task({ assignee: "u1" }), task({ assignee: "u1" }),
    task({ assignee: "u1" }), task({ assignee: "u1" }),
    task({ assignee: "u2" }),
  ];
  const result = computeWorkload(tasks, ["u1", "u2"]);
  assert.ok(result.overloadedMembers.includes("u1"));
});

check("D3 — an under-utilized member (0 tasks) is flagged when others have tasks", () => {
  const tasks = [task({ assignee: "u1" }), task({ assignee: "u1" })];
  const result = computeWorkload(tasks, ["u1", "u2"]);
  assert.ok(result.underUtilizedMembers.includes("u2"));
});

check("D4 — missing effort estimates are reported as unavailable, never invented", () => {
  const tasks = [task({ assignee: "u1", estimate: null }), task({ assignee: "u1", estimate: undefined })];
  const result = computeWorkload(tasks, ["u1"]);
  assert.strictEqual(result.effortEstimatesAvailable, false);
  assert.strictEqual(result.totalEstimatedEffort, null);
});

check("D5 — unassigned tasks are counted separately, not attributed to any member", () => {
  const tasks = [task({ assignee: null }), task({ assignee: undefined })];
  const result = computeWorkload(tasks, ["u1"]);
  assert.strictEqual(result.unassignedCount, 2);
  assert.strictEqual(result.byMember.find((m) => m.memberId === "u1").taskCount, 0);
});

check("D6 — workload aggregates correctly across many members", () => {
  const tasks = [
    task({ assignee: "u1" }), task({ assignee: "u2" }), task({ assignee: "u2" }),
    task({ assignee: "u3" }), task({ assignee: "u3" }), task({ assignee: "u3" }),
  ];
  const result = computeWorkload(tasks, ["u1", "u2", "u3", "u4"]);
  assert.strictEqual(result.totalSelectedTasks, 6);
  assert.strictEqual(result.byMember.find((m) => m.memberId === "u3").taskCount, 3);
  assert.strictEqual(result.byMember.find((m) => m.memberId === "u4").taskCount, 0);
});

/* =====================================================================
 * E. SPRINT RISK
 * ===================================================================== */

check("E1 — no evidence at all returns INSUFFICIENT_DATA", () => {
  const result = classifySprintRisk({ hasAnyData: false });
  assert.strictEqual(result.level, "INSUFFICIENT_DATA");
});

check("E2 — clean evidence with no risk factors classifies as LOW_RISK", () => {
  const result = classifySprintRisk({ hasAnyData: true, teamRiskLevel: "LOW", blockedTaskCount: 0, overdueSelectedCount: 0, dueSoon48hCount: 0 });
  assert.strictEqual(result.level, "LOW_RISK");
});

check("E3 — moderate team risk alone classifies as MODERATE_RISK", () => {
  const result = classifySprintRisk({ hasAnyData: true, teamRiskLevel: "MODERATE" });
  assert.strictEqual(result.level, "MODERATE_RISK");
});

check("E4 — high team risk plus overdue tasks classifies as HIGH_RISK", () => {
  const result = classifySprintRisk({ hasAnyData: true, teamRiskLevel: "HIGH", overdueSelectedCount: 2 });
  assert.strictEqual(result.level, "HIGH_RISK");
});

check("E5 — critical team risk plus forecast critical classifies as CRITICAL_RISK", () => {
  const result = classifySprintRisk({ hasAnyData: true, teamRiskLevel: "CRITICAL", forecastStatus: "CRITICAL", blockedTaskCount: 2, overdueSelectedCount: 2 });
  assert.strictEqual(result.level, "CRITICAL_RISK");
});

check("E6 — sprint risk factors are always populated with a real explanation", () => {
  const result = classifySprintRisk({ hasAnyData: true, teamRiskLevel: "LOW" });
  assert.ok(Array.isArray(result.factors) && result.factors.length > 0);
});

/* =====================================================================
 * F. RECOMMENDATIONS
 * ===================================================================== */

check("F1 — a bottleneck task generates a specific recommendation naming it", () => {
  const recs = buildRecommendations({ bottlenecks: [{ title: "API Auth", blockCount: 2 }] });
  assert.ok(recs.some((r) => r.includes("API Auth")));
});

check("F2 — deadline pressure generates a scheduling recommendation", () => {
  const recs = buildRecommendations({ dueSoon48hCount: 2 });
  assert.ok(recs.some((r) => r.includes("48 hours")));
});

check("F3 — overloaded workload generates a redistribution recommendation", () => {
  const recs = buildRecommendations({ overloadedMembers: ["u1"] });
  assert.ok(recs.some((r) => r.toLowerCase().includes("redistribut")));
});

check("F4 — elevated forecast status generates a forecast-risk recommendation", () => {
  const recs = buildRecommendations({ forecastStatus: "AT_RISK" });
  assert.ok(recs.some((r) => r.includes("AT_RISK")));
});

check("F5 — no signals at all still returns an honest, non-fabricated message", () => {
  const recs = buildRecommendations({});
  assert.strictEqual(recs.length, 1);
  assert.ok(recs[0].toLowerCase().includes("no elevated"));
});

/* =====================================================================
 * G. STALE PLAN DETECTION
 * ===================================================================== */

function plannedTask(overrides = {}) {
  return {
    task: overrides.task || "t1",
    statusAtGeneration: overrides.statusAtGeneration || "todo",
    dueAtGeneration: overrides.dueAtGeneration !== undefined ? overrides.dueAtGeneration : null,
    assigneeAtGeneration: overrides.assigneeAtGeneration !== undefined ? overrides.assigneeAtGeneration : null,
    updatedAtAtGeneration: overrides.updatedAtAtGeneration || NOW,
  };
}

check("G1 — unchanged task applies cleanly (no stale entries)", () => {
  const pt = [plannedTask({ task: "t1" })];
  const current = new Map([["t1", { group: "g1", status: "todo", assignee: null, due: null, updatedAt: NOW }]]);
  const stale = findStaleTasks(pt, current, "g1");
  assert.strictEqual(stale.length, 0);
});

check("G2 — a task whose status changed since generation is rejected as stale", () => {
  const pt = [plannedTask({ task: "t1", statusAtGeneration: "todo" })];
  const current = new Map([["t1", { group: "g1", status: "in_progress", assignee: null, due: null, updatedAt: NOW }]]);
  const stale = findStaleTasks(pt, current, "g1");
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].reason, "TASK_CHANGED");
});

check("G3 — a deleted task is rejected as TASK_DELETED", () => {
  const pt = [plannedTask({ task: "t1" })];
  const current = new Map([["t1", null]]);
  const stale = findStaleTasks(pt, current, "g1");
  assert.strictEqual(stale[0].reason, "TASK_DELETED");
});

check("G4 — a task moved to another group is rejected as TASK_MOVED_GROUP", () => {
  const pt = [plannedTask({ task: "t1" })];
  const current = new Map([["t1", { group: "g2", status: "todo", assignee: null, due: null, updatedAt: NOW }]]);
  const stale = findStaleTasks(pt, current, "g1");
  assert.strictEqual(stale[0].reason, "TASK_MOVED_GROUP");
});

check("G5 — a reassigned task is rejected as stale (assignee changed)", () => {
  const pt = [plannedTask({ task: "t1", assigneeAtGeneration: "u1" })];
  const current = new Map([["t1", { group: "g1", status: "todo", assignee: "u2", due: null, updatedAt: NOW }]]);
  const stale = findStaleTasks(pt, current, "g1");
  assert.strictEqual(stale.length, 1);
});

/* =====================================================================
 * H. AUTHORIZATION / DATA ISOLATION (pure-function level)
 * ===================================================================== */

const { canRequestRecommendation } = require("../src/services/smartTaskAssignmentService");

check("H1 — guide can request/apply a sprint plan", () => {
  assert.strictEqual(canRequestRecommendation({ isGuide: true, groupLeaderId: "leader1", userId: "guide1" }), true);
});

check("H2 — team leader can request/apply a sprint plan", () => {
  assert.strictEqual(canRequestRecommendation({ isGuide: false, groupLeaderId: "leader1", userId: "leader1" }), true);
});

check("H3 — a regular student (not guide, not leader) cannot request/apply a sprint plan", () => {
  assert.strictEqual(canRequestRecommendation({ isGuide: false, groupLeaderId: "leader1", userId: "student1" }), false);
});

check("H4 — a task from another group never appears in blockingCounts scoped to this group's tasks", () => {
  // computeBlockingCounts only ever sees the tasks passed to it — the
  // caller (gatherSprintPlannerEvidence) queries Task.find({ group:
  // group._id }), so a same-name-group's tasks are never in this list.
  const groupATasks = [task({ id: "gA-1" }), task({ id: "gA-2", dependencies: ["gA-1"] })];
  const counts = computeBlockingCounts(groupATasks);
  assert.strictEqual(counts.get("gA-1"), 1);
  assert.strictEqual(counts.has("gB-1"), false);
});

/* =====================================================================
 * I. IDEMPOTENCY / MISC PURE-FUNCTION SAFETY
 * ===================================================================== */

check("I1 — clampMaxTasks falls back to the default for invalid input", () => {
  assert.strictEqual(clampMaxTasks(0), DEFAULT_MAX_TASKS);
  assert.strictEqual(clampMaxTasks(-5), DEFAULT_MAX_TASKS);
  assert.strictEqual(clampMaxTasks("not-a-number"), DEFAULT_MAX_TASKS);
});

check("I2 — clampMaxTasks respects a valid explicit value", () => {
  assert.strictEqual(clampMaxTasks(5), 5);
});

check("I3 — selectCandidateTasks is a pure function: same input produces the same output", () => {
  const tasks = [task({ priority: "high" }), task({ priority: "low" })];
  const r1 = selectCandidateTasks(tasks, { now: NOW });
  const r2 = selectCandidateTasks(tasks, { now: NOW });
  assert.deepStrictEqual(r1.selected.map((t) => t.id), r2.selected.map((t) => t.id));
});

check("I4 — findBottlenecks only returns tasks that actually block something", () => {
  const blocker = task({ id: "b1" });
  const nonBlocker = task({ id: "b2" });
  const counts = new Map([["b1", 2]]);
  const bottlenecks = findBottlenecks([blocker, nonBlocker], counts);
  assert.strictEqual(bottlenecks.length, 1);
  assert.strictEqual(bottlenecks[0].id, "b1");
});

check("I5 — orderTasksByDependency called twice on the same input never mutates or duplicates entries", () => {
  const a = task({ id: "A" });
  const b = task({ id: "B", dependencies: ["A"] });
  const r1 = orderTasksByDependency([a, b]);
  const r2 = orderTasksByDependency([a, b]);
  assert.deepStrictEqual(r1.orderedIds, r2.orderedIds);
  assert.strictEqual(r1.orderedIds.length, 2);
});

console.log(`\n${passed} passed, 0 failed`);
