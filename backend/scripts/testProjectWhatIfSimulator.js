/**
 * Standalone tests for STEP 25 — AI Project What-If Simulator. No DB / no
 * server / no live AI engine needed — exercises the pure/deterministic
 * functions in services/projectWhatIfSimulatorService.js directly with
 * hand-built plain task/group objects, exactly like
 * backend/scripts/testTeamRiskAnalyzer.js / testProjectForecast.js /
 * testSprintPlanner.js do for their own pure layers. `runWhatIfSimulation`
 * and `compareScenarios` accept an injectable `baseData` so even the
 * "orchestration" entry points are testable without a database connection.
 *
 * Run: node backend/scripts/testProjectWhatIfSimulator.js
 */
const assert = require("assert");
const {
  getCapabilities,
  SUPPORTED_CHANGE_TYPES,
  UNSUPPORTED_CHANGE_TYPES,
  validateChange,
  detectConflicts,
  applyChanges,
  buildMetricBundle,
  buildDelta,
  countBlockedTasks,
  runWhatIfSimulation,
  compareScenarios,
} = require("../src/services/projectWhatIfSimulatorService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};
const checkAsync = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-03T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const GROUP_ID = "507f1f77bcf86cd799439011";
const GROUP_ID_2 = "507f1f77bcf86cd799439022"; // second group, for isolation tests
const M1 = "507f1f77bcf86cd799439001"; // leader
const M2 = "507f1f77bcf86cd799439002";
const M3 = "507f1f77bcf86cd799439003"; // not a member of GROUP_ID
const GUIDE = "507f1f77bcf86cd799439099";

function makeGroup(overrides = {}) {
  return {
    _id: GROUP_ID,
    name: "Team Nimbus",
    members: [M1, M2],
    guide: GUIDE,
    leader: M1,
    expectedCompletion: new Date(NOW.getTime() + 10 * DAY),
    createdAt: new Date(NOW.getTime() - 20 * DAY),
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    _id: overrides._id || "t1",
    title: overrides.title || "Task",
    status: "todo",
    priority: "medium",
    due: new Date(NOW.getTime() + 5 * DAY),
    assignee: M1,
    estimate: 4,
    dependencies: [],
    createdAt: new Date(NOW.getTime() - 5 * DAY),
    updatedAt: new Date(NOW.getTime() - 5 * DAY),
    submissions: [],
    ...overrides,
  };
}

function baseData(tasks, messages = []) {
  return { now: NOW, tasks, messages };
}

/* ============================================================
 * 1-10 — capabilities + basic validation
 * ============================================================ */

check("1 — capabilities lists all required supported change types", () => {
  const caps = getCapabilities();
  [
    "TASK_DEADLINE",
    "TASK_REASSIGNMENT",
    "TASK_STATUS",
    "TASK_PRIORITY",
    "TASK_BLOCKER",
    "PROJECT_DEADLINE",
    "WORKLOAD_REDISTRIBUTION",
    "SPRINT_CHANGE",
  ].forEach((t) => assert.ok(caps.supportedChanges.includes(t), `missing ${t}`));
});

check("2 — capabilities reports MEMBER_AVAILABILITY as unsupported with a reason", () => {
  const caps = getCapabilities();
  assert.ok(caps.unsupportedChanges.includes("MEMBER_AVAILABILITY"));
  assert.ok(typeof caps.reason.MEMBER_AVAILABILITY === "string" && caps.reason.MEMBER_AVAILABILITY.length > 10);
});

check("3 — SUPPORTED/UNSUPPORTED constants never overlap", () => {
  const overlap = SUPPORTED_CHANGE_TYPES.filter((t) => UNSUPPORTED_CHANGE_TYPES.includes(t));
  assert.strictEqual(overlap.length, 0);
});

check("4 — validateChange accepts a valid TASK_DEADLINE", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const tasksById = new Map([["t1", t1]]);
  const r = validateChange({ type: "TASK_DEADLINE", taskId: "t1", value: "2026-09-20" }, { tasksById, group });
  assert.ok(r.ok);
});

check("5 — validateChange rejects a malformed date", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const tasksById = new Map([["t1", t1]]);
  const r = validateChange({ type: "TASK_DEADLINE", taskId: "t1", value: "not-a-date" }, { tasksById, group });
  assert.strictEqual(r.ok, false);
});

check("6 — validateChange rejects a cross-group / unknown task id", () => {
  const group = makeGroup();
  const tasksById = new Map();
  const r = validateChange({ type: "TASK_DEADLINE", taskId: "not-in-group", value: "2026-09-20" }, { tasksById, group });
  assert.strictEqual(r.ok, false);
  assert.ok(/not found/i.test(r.reason));
});

check("7 — validateChange rejects a member outside the group (TASK_REASSIGNMENT)", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const tasksById = new Map([["t1", t1]]);
  const r = validateChange({ type: "TASK_REASSIGNMENT", taskId: "t1", memberId: M3 }, { tasksById, group });
  assert.strictEqual(r.ok, false);
  assert.ok(/does not currently belong/i.test(r.reason));
});

check("8 — validateChange accepts a valid TASK_REASSIGNMENT to a real member", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const tasksById = new Map([["t1", t1]]);
  const r = validateChange({ type: "TASK_REASSIGNMENT", taskId: "t1", memberId: M2 }, { tasksById, group });
  assert.ok(r.ok);
});

check("9 — validateChange rejects an invalid TASK_STATUS value", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const tasksById = new Map([["t1", t1]]);
  const r = validateChange({ type: "TASK_STATUS", taskId: "t1", value: "not-a-real-status" }, { tasksById, group });
  assert.strictEqual(r.ok, false);
});

check("10 — validateChange rejects an invalid TASK_PRIORITY value", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const tasksById = new Map([["t1", t1]]);
  const r = validateChange({ type: "TASK_PRIORITY", taskId: "t1", value: "urgent-ish" }, { tasksById, group });
  assert.strictEqual(r.ok, false);
});

/* ============================================================
 * 11-20 — more validation + conflicts
 * ============================================================ */

check("11 — validateChange accepts a valid PROJECT_DEADLINE", () => {
  const group = makeGroup();
  const r = validateChange({ type: "PROJECT_DEADLINE", value: "2026-10-01" }, { tasksById: new Map(), group });
  assert.ok(r.ok);
});

check("12 — validateChange rejects a malformed PROJECT_DEADLINE", () => {
  const group = makeGroup();
  const r = validateChange({ type: "PROJECT_DEADLINE", value: "banana" }, { tasksById: new Map(), group });
  assert.strictEqual(r.ok, false);
});

check("13 — validateChange rejects MEMBER_AVAILABILITY as unsupported", () => {
  const group = makeGroup();
  const r = validateChange({ type: "MEMBER_AVAILABILITY", memberId: M1, value: "unavailable" }, { tasksById: new Map(), group });
  assert.strictEqual(r.ok, false);
  assert.ok(/availability/i.test(r.reason));
});

check("14 — validateChange rejects a totally unknown change type", () => {
  const group = makeGroup();
  const r = validateChange({ type: "TELEPORT_TASK", value: 1 }, { tasksById: new Map(), group });
  assert.strictEqual(r.ok, false);
});

check("15 — validateChange accepts TASK_BLOCKER for a real task", () => {
  const group = makeGroup();
  const t1 = makeTask({ dependencies: ["dep1"] });
  const r = validateChange({ type: "TASK_BLOCKER", taskId: "t1" }, { tasksById: new Map([["t1", t1]]), group });
  assert.ok(r.ok);
});

check("16 — validateChange accepts WORKLOAD_REDISTRIBUTION with valid assignments", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const t2 = makeTask({ _id: "t2" });
  const tasksById = new Map([["t1", t1], ["t2", t2]]);
  const r = validateChange(
    { type: "WORKLOAD_REDISTRIBUTION", assignments: [{ taskId: "t1", memberId: M2 }, { taskId: "t2", memberId: M1 }] },
    { tasksById, group }
  );
  assert.ok(r.ok);
  assert.strictEqual(r.value.length, 2);
});

check("17 — validateChange rejects WORKLOAD_REDISTRIBUTION with an empty assignments list", () => {
  const group = makeGroup();
  const r = validateChange({ type: "WORKLOAD_REDISTRIBUTION", assignments: [] }, { tasksById: new Map(), group });
  assert.strictEqual(r.ok, false);
});

check("18 — validateChange rejects WORKLOAD_REDISTRIBUTION referencing an outside member", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const r = validateChange(
    { type: "WORKLOAD_REDISTRIBUTION", assignments: [{ taskId: "t1", memberId: M3 }] },
    { tasksById: new Map([["t1", t1]]), group }
  );
  assert.strictEqual(r.ok, false);
});

check("19 — validateChange accepts SPRINT_CHANGE (flag-only, always valid)", () => {
  const group = makeGroup();
  const r = validateChange({ type: "SPRINT_CHANGE", value: { durationDays: 10 } }, { tasksById: new Map(), group });
  assert.ok(r.ok);
});

check("20 — detectConflicts flags two different deadlines for the same task", () => {
  const conflicts = detectConflicts([
    { type: "TASK_DEADLINE", taskId: "t1", value: new Date("2026-09-10") },
    { type: "TASK_DEADLINE", taskId: "t1", value: new Date("2026-09-20") },
  ]);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "CONTRADICTORY_CHANGE");
});

/* ============================================================
 * 21-30 — more conflicts, apply/mutation-safety, blocked tasks
 * ============================================================ */

check("21 — detectConflicts flags two different reassignment targets for the same task", () => {
  const conflicts = detectConflicts([
    { type: "TASK_REASSIGNMENT", taskId: "t1", value: M1 },
    { type: "TASK_REASSIGNMENT", taskId: "t1", value: M2 },
  ]);
  assert.strictEqual(conflicts.length, 1);
});

check("22 — detectConflicts does not flag two DIFFERENT tasks with different deadlines", () => {
  const conflicts = detectConflicts([
    { type: "TASK_DEADLINE", taskId: "t1", value: new Date("2026-09-10") },
    { type: "TASK_DEADLINE", taskId: "t2", value: new Date("2026-09-20") },
  ]);
  assert.strictEqual(conflicts.length, 0);
});

check("23 — detectConflicts does not flag duplicate IDENTICAL changes", () => {
  const conflicts = detectConflicts([
    { type: "TASK_STATUS", taskId: "t1", value: "done" },
    { type: "TASK_STATUS", taskId: "t1", value: "done" },
  ]);
  assert.strictEqual(conflicts.length, 0);
});

check("24 — applyChanges never mutates the original task objects", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const originalDue = t1.due;
  const validated = [{ type: "TASK_DEADLINE", taskId: "t1", value: new Date("2026-09-25") }];
  applyChanges([t1], group, validated);
  assert.strictEqual(t1.due, originalDue, "original task.due must be untouched");
});

check("25 — applyChanges never mutates the original group object", () => {
  const group = makeGroup();
  const originalExpected = group.expectedCompletion;
  applyChanges([], group, [{ type: "PROJECT_DEADLINE", value: new Date("2026-12-01") }]);
  assert.strictEqual(group.expectedCompletion, originalExpected, "original group.expectedCompletion must be untouched");
});

check("26 — applyChanges produces a projected task with the new deadline", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const { tasks } = applyChanges([t1], group, [{ type: "TASK_DEADLINE", taskId: "t1", value: new Date("2026-09-25") }]);
  assert.strictEqual(tasks[0].due.toISOString(), new Date("2026-09-25").toISOString());
});

check("27 — applyChanges produces a projected group with the new project deadline", () => {
  const group = makeGroup();
  const { group: projected } = applyChanges([], group, [{ type: "PROJECT_DEADLINE", value: new Date("2026-12-01") }]);
  assert.strictEqual(projected.expectedCompletion.toISOString(), new Date("2026-12-01").toISOString());
});

check("28 — TASK_BLOCKER clears the projected task's dependencies without touching the original", () => {
  const group = makeGroup();
  const t1 = makeTask({ dependencies: ["depA", "depB"] });
  const { tasks } = applyChanges([t1], group, [{ type: "TASK_BLOCKER", taskId: "t1" }]);
  assert.strictEqual(tasks[0].dependencies.length, 0);
  assert.strictEqual(t1.dependencies.length, 2, "original dependencies must be untouched");
});

check("29 — countBlockedTasks finds a task blocked by an unfinished dependency", () => {
  const dep = makeTask({ _id: "dep1", status: "todo" });
  const t1 = makeTask({ _id: "t1", dependencies: ["dep1"] });
  const { count, tasks } = countBlockedTasks([dep, t1]);
  assert.strictEqual(count, 1);
  assert.strictEqual(tasks[0].taskId, "t1");
});

check("30 — countBlockedTasks does not count a task whose dependency is already done", () => {
  const dep = makeTask({ _id: "dep1", status: "done" });
  const t1 = makeTask({ _id: "t1", dependencies: ["dep1"] });
  const { count } = countBlockedTasks([dep, t1]);
  assert.strictEqual(count, 0);
});

/* ============================================================
 * 31-40 — metric bundle / baseline vs projected / delta
 * ============================================================ */

check("31 — buildMetricBundle returns INSUFFICIENT_DATA-safe output for an empty task list", () => {
  const group = makeGroup();
  const bundle = buildMetricBundle({ tasks: [], group, messages: [], now: NOW });
  assert.strictEqual(bundle.completionProbability, null);
  assert.strictEqual(bundle.projectStatus, "INSUFFICIENT_DATA");
});

check("32 — buildMetricBundle counts an overdue task correctly", () => {
  const group = makeGroup();
  const t1 = makeTask({ due: new Date(NOW.getTime() - 2 * DAY), status: "todo" });
  const bundle = buildMetricBundle({ tasks: [t1], group, messages: [], now: NOW });
  assert.strictEqual(bundle.overdueTaskCount, 1);
});

check("33 — buildDelta reports INSUFFICIENT_DATA for a metric that is null on both sides", () => {
  const group = makeGroup();
  const baseline = buildMetricBundle({ tasks: [], group, messages: [], now: NOW });
  const projected = buildMetricBundle({ tasks: [], group, messages: [], now: NOW });
  const { delta } = buildDelta(baseline, projected);
  assert.strictEqual(delta.completionProbability.status, "INSUFFICIENT_DATA");
});

check("34 — buildDelta classifies a probability increase as improved", () => {
  const baseline = { completionProbability: 50, riskScore: 40, healthScore: 60, executionScore: 60, overdueTaskCount: 2, blockedTaskCount: 0, reviewBacklogCount: 0, highRiskTaskCount: 1, projectStatus: "AT_RISK" };
  const projected = { completionProbability: 70, riskScore: 20, healthScore: 75, executionScore: 75, overdueTaskCount: 0, blockedTaskCount: 0, reviewBacklogCount: 0, highRiskTaskCount: 0, projectStatus: "STABLE" };
  const { improved, worsened } = buildDelta(baseline, projected);
  assert.ok(improved.includes("completionProbability"));
  assert.ok(improved.includes("riskScore")); // risk DROPPED -> improved
  assert.strictEqual(worsened.length, 0);
});

check("35 — buildDelta classifies a risk increase as worsened", () => {
  const baseline = { completionProbability: 70, riskScore: 20, healthScore: 75, executionScore: 75, overdueTaskCount: 0, blockedTaskCount: 0, reviewBacklogCount: 0, highRiskTaskCount: 0, projectStatus: "STABLE" };
  const projected = { completionProbability: 70, riskScore: 40, healthScore: 75, executionScore: 75, overdueTaskCount: 0, blockedTaskCount: 0, reviewBacklogCount: 0, highRiskTaskCount: 0, projectStatus: "STABLE" };
  const { worsened } = buildDelta(baseline, projected);
  assert.ok(worsened.includes("riskScore"));
});

check("36 — buildDelta reports an identical metric as unchanged", () => {
  const baseline = { completionProbability: 70, riskScore: 20, healthScore: 75, executionScore: 75, overdueTaskCount: 0, blockedTaskCount: 0, reviewBacklogCount: 0, highRiskTaskCount: 0, projectStatus: "STABLE" };
  const projected = { ...baseline };
  const { unchanged } = buildDelta(baseline, projected);
  assert.ok(unchanged.includes("completionProbability"));
  assert.ok(unchanged.includes("projectStatus"));
});

check("37 — buildMetricBundle Team Risk reuses the real teamRiskAnalyzer thresholds (LOW at score 0)", () => {
  const group = makeGroup();
  const t1 = makeTask({ status: "done", due: new Date(NOW.getTime() - DAY) }); // done -> not overdue
  const bundle = buildMetricBundle({ tasks: [t1], group, messages: [], now: NOW });
  assert.strictEqual(bundle.riskLevel, "LOW");
});

check("38 — buildMetricBundle Project Forecast reuses computeForecast (ON_TRACK for a healthy group)", () => {
  const group = makeGroup({ expectedCompletion: new Date(NOW.getTime() + 30 * DAY), createdAt: new Date(NOW.getTime() - 2 * DAY) });
  const t1 = makeTask({ status: "done" });
  const t2 = makeTask({ _id: "t2", status: "done" });
  const bundle = buildMetricBundle({ tasks: [t1, t2], group, messages: [], now: NOW });
  assert.strictEqual(bundle.deadlinePressure, "ON_TRACK");
});

check("39 — buildMetricBundle Project Health reuses computeProjectHealth (healthScore is a number when data exists)", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const bundle = buildMetricBundle({ tasks: [t1], group, messages: [], now: NOW });
  assert.strictEqual(typeof bundle.healthScore, "number");
});

check("40 — buildMetricBundle execution readiness is identical to health score/status (Step 21's own reuse rule)", () => {
  const group = makeGroup();
  const t1 = makeTask();
  const bundle = buildMetricBundle({ tasks: [t1], group, messages: [], now: NOW });
  assert.strictEqual(bundle.executionScore, bundle.healthScore);
  assert.strictEqual(bundle.executionStatus, bundle.projectStatus);
});

/* ============================================================
 * 41-50 — full orchestration (runWhatIfSimulation / compareScenarios)
 * ============================================================ */

(async () => {
  await checkAsync("41 — runWhatIfSimulation returns INVALID_SIMULATION for contradictory changes", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [
      { type: "TASK_DEADLINE", taskId: "t1", value: "2026-09-10" },
      { type: "TASK_DEADLINE", taskId: "t1", value: "2026-09-20" },
    ], { baseData: baseData([t1]) });
    assert.strictEqual(r.status, "INVALID_SIMULATION");
    assert.strictEqual(r.conflicts[0].type, "CONTRADICTORY_CHANGE");
  });

  await checkAsync("42 — runWhatIfSimulation with an empty scenario returns baseline === projected", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [], { baseData: baseData([t1]) });
    assert.strictEqual(r.status, "OK");
    assert.deepStrictEqual(r.baseline.projectStatus, r.projected.projectStatus);
    assert.strictEqual(r.warnings.length > 0, true);
  });

  await checkAsync("43 — runWhatIfSimulation moving a deadline out reduces overdue count", async () => {
    const group = makeGroup();
    const t1 = makeTask({ due: new Date(NOW.getTime() - 3 * DAY) }); // overdue
    const r = await runWhatIfSimulation(group, [{ type: "TASK_DEADLINE", taskId: "t1", value: new Date(NOW.getTime() + 7 * DAY) }], {
      baseData: baseData([t1]),
    });
    assert.strictEqual(r.baseline.overdueTaskCount, 1);
    assert.strictEqual(r.projected.overdueTaskCount, 0);
  });

  await checkAsync("44 — runWhatIfSimulation rejects an invalid change without rejecting valid ones in the same batch", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(
      group,
      [
        { type: "TASK_PRIORITY", taskId: "t1", value: "high" },
        { type: "TASK_STATUS", taskId: "t1", value: "not-a-status" },
      ],
      { baseData: baseData([t1]) }
    );
    assert.strictEqual(r.status, "OK");
    assert.strictEqual(r.accepted.length, 1);
    assert.strictEqual(r.rejected.length, 1);
    assert.strictEqual(r.projected.projectStatus !== undefined, true);
  });

  await checkAsync("45 — runWhatIfSimulation cross-group task id is rejected, not silently applied", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const otherGroupTask = makeTask({ _id: "other-group-task" });
    // otherGroupTask is deliberately NOT included in this group's baseData.
    const r = await runWhatIfSimulation(group, [{ type: "TASK_DEADLINE", taskId: "other-group-task", value: "2026-09-20" }], {
      baseData: baseData([t1]),
    });
    assert.strictEqual(r.accepted.length, 0);
    assert.strictEqual(r.rejected.length, 1);
  });

  await checkAsync("46 — runWhatIfSimulation is deterministic for the same input", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const bd = baseData([t1]);
    const change = [{ type: "TASK_PRIORITY", taskId: "t1", value: "critical" }];
    const r1 = await runWhatIfSimulation(group, change, { baseData: bd });
    const r2 = await runWhatIfSimulation(group, change, { baseData: bd });
    assert.deepStrictEqual(r1.projected, r2.projected);
  });

  await checkAsync("47 — runWhatIfSimulation never sets applyable: true (no automatic mutation)", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [{ type: "TASK_STATUS", taskId: "t1", value: "done" }], { baseData: baseData([t1]) });
    assert.strictEqual(r.applyable, false);
  });

  await checkAsync("48 — runWhatIfSimulation response never includes a notification/persistence side-effect flag", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [{ type: "TASK_STATUS", taskId: "t1", value: "done" }], { baseData: baseData([t1]) });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, "notified"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, "persisted"), false);
    assert.ok(r.disclaimer.toLowerCase().includes("no project data was changed"));
  });

  await checkAsync("49 — compareScenarios always includes the real current state as 'baseline'", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const cmp = await compareScenarios(group, [], { baseData: baseData([t1]) });
    assert.ok(cmp.scenarios.find((s) => s.id === "baseline"));
  });

  await checkAsync("50 — compareScenarios keeps each scenario's projected state isolated from the others", async () => {
    const group = makeGroup();
    const t1 = makeTask({ due: new Date(NOW.getTime() - 2 * DAY) });
    const cmp = await compareScenarios(
      group,
      [
        { id: "s1", label: "Push deadline", changes: [{ type: "TASK_DEADLINE", taskId: "t1", value: new Date(NOW.getTime() + 10 * DAY) }] },
        { id: "s2", label: "Mark done", changes: [{ type: "TASK_STATUS", taskId: "t1", value: "done" }] },
      ],
      { baseData: baseData([t1]) }
    );
    const s1 = cmp.scenarios.find((s) => s.id === "s1");
    const s2 = cmp.scenarios.find((s) => s.id === "s2");
    assert.strictEqual(s1.projected.overdueTaskCount, 0);
    assert.notStrictEqual(s1.projected.projectStatus, undefined);
    assert.notStrictEqual(s2.projected.projectStatus, undefined);
  });

  await checkAsync("51 — compareScenarios ranks scenarios and (when unambiguous) picks a best one", async () => {
    const group = makeGroup();
    const t1 = makeTask({ due: new Date(NOW.getTime() - 2 * DAY) });
    const cmp = await compareScenarios(
      group,
      [{ id: "s1", label: "Push deadline", changes: [{ type: "TASK_DEADLINE", taskId: "t1", value: new Date(NOW.getTime() + 10 * DAY) }] }],
      { baseData: baseData([t1]) }
    );
    assert.strictEqual(cmp.ranking.length, 2);
    assert.ok(cmp.ranking.includes("s1"));
    assert.ok(cmp.ranking.includes("baseline"));
  });

  await checkAsync("52 — a large (many-change) scenario still returns a coherent projected state", async () => {
    const group = makeGroup();
    const tasks = Array.from({ length: 20 }, (_, i) => makeTask({ _id: `t${i}`, due: new Date(NOW.getTime() + (i - 10) * DAY) }));
    const changes = tasks.slice(0, 10).map((t) => ({ type: "TASK_DEADLINE", taskId: t._id, value: new Date(NOW.getTime() + 20 * DAY) }));
    const r = await runWhatIfSimulation(group, changes, { baseData: baseData(tasks) });
    assert.strictEqual(r.status, "OK");
    assert.strictEqual(r.accepted.length, 10);
  });

  await checkAsync("53 — mixed valid/invalid/contradictory-free batch reports accepted+rejected+warnings shape", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(
      group,
      [
        { type: "TASK_PRIORITY", taskId: "t1", value: "high" },
        { type: "TASK_REASSIGNMENT", taskId: "t1", memberId: M3 }, // invalid — outsider
      ],
      { baseData: baseData([t1]) }
    );
    assert.strictEqual(r.status, "OK");
    assert.strictEqual(r.accepted.length, 1);
    assert.strictEqual(r.rejected.length, 1);
    assert.ok(Array.isArray(r.warnings));
  });

  await checkAsync("54 — API-shape check: OK result has baseline/projected/delta/impact/summary/counterfactuals", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [{ type: "TASK_PRIORITY", taskId: "t1", value: "high" }], { baseData: baseData([t1]) });
    ["baseline", "projected", "delta", "impact", "summary", "counterfactuals", "accepted", "rejected", "conflicts"].forEach((k) =>
      assert.ok(Object.prototype.hasOwnProperty.call(r, k), `missing ${k}`)
    );
  });

  await checkAsync("55 — group isolation: a task belonging to group 2 cannot be simulated against group 1", async () => {
    const group1 = makeGroup({ _id: GROUP_ID });
    const group2Task = makeTask({ _id: "g2-task" }); // exists, but not in group1's baseData
    const group1Task = makeTask({ _id: "g1-task" });
    const r = await runWhatIfSimulation(group1, [{ type: "TASK_STATUS", taskId: "g2-task", value: "done" }], {
      baseData: baseData([group1Task]),
    });
    assert.strictEqual(r.accepted.length, 0);
    assert.strictEqual(r.rejected[0].reason.includes("not found"), true);
  });

  await checkAsync("56 — same-name groups stay isolated (different _id, same name, independent task sets)", async () => {
    const groupA = makeGroup({ _id: GROUP_ID, name: "Capstone Team" });
    const groupB = makeGroup({ _id: GROUP_ID_2, name: "Capstone Team", members: [M2] });
    const taskA = makeTask({ _id: "a1", status: "todo" });
    const taskB = makeTask({ _id: "b1", status: "done" });
    const rA = await runWhatIfSimulation(groupA, [], { baseData: baseData([taskA]) });
    const rB = await runWhatIfSimulation(groupB, [], { baseData: baseData([taskB]) });
    assert.notStrictEqual(rA.baseline.projectStatus === undefined, true);
    assert.notDeepStrictEqual(rA.baseline, rB.baseline);
  });

  await checkAsync("57 — workload redistribution changes projected workload byMember counts", async () => {
    const group = makeGroup();
    const t1 = makeTask({ _id: "t1", assignee: M1, status: "todo" });
    const t2 = makeTask({ _id: "t2", assignee: M1, status: "todo" });
    const r = await runWhatIfSimulation(
      group,
      [{ type: "WORKLOAD_REDISTRIBUTION", assignments: [{ taskId: "t2", memberId: M2 }] }],
      { baseData: baseData([t1, t2]) }
    );
    const projByM1 = r.projected.workloadBalance.byMember.find((m) => m.memberId === M1);
    assert.strictEqual(projByM1.taskCount, 1);
  });

  await checkAsync("58 — TASK_BLOCKER resolving a dependency reduces projected blocked task count", async () => {
    const group = makeGroup();
    const dep = makeTask({ _id: "dep1", status: "todo" });
    const t1 = makeTask({ _id: "t1", dependencies: ["dep1"] });
    const r = await runWhatIfSimulation(group, [{ type: "TASK_BLOCKER", taskId: "t1" }], { baseData: baseData([dep, t1]) });
    assert.strictEqual(r.baseline.blockedTaskCount, 1);
    assert.strictEqual(r.projected.blockedTaskCount, 0);
  });

  await checkAsync("59 — sprint risk is reused from sprintPlannerService.classifySprintRisk (valid level returned)", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [], { baseData: baseData([t1]) });
    assert.ok(["INSUFFICIENT_DATA", "LOW_RISK", "MODERATE_RISK", "HIGH_RISK", "CRITICAL_RISK"].includes(r.baseline.sprintRisk.level));
  });

  await checkAsync("60 — conflict impact is either simulated via runDetectors or explicitly marked not simulated (never fabricated)", async () => {
    const group = makeGroup();
    const t1 = makeTask();
    const r = await runWhatIfSimulation(group, [], { baseData: baseData([t1], []) });
    assert.ok(typeof r.baseline.conflictImpact.simulated === "boolean");
    if (!r.baseline.conflictImpact.simulated) {
      assert.ok(r.baseline.conflictImpact.reason);
    }
  });

  console.log(`\n${passed} what-if-simulator test(s) passed.`);
})();
