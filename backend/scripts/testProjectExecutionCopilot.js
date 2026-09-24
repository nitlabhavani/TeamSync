/**
 * Standalone tests for STEP 21 — AI Project Execution Copilot.
 * No DB / no server / no live AI engine needed — exercises the pure
 * functions in services/projectExecutionCopilotService.js
 * (computeExecutionCopilot, determineExecutionTrend, buildActionCandidates,
 * buildDailyPlan, shouldNotifyExecutionIssue) directly with hand-built
 * evidence objects, exactly like backend/scripts/testProjectHealth.js and
 * testProjectForecast.js do for their own pure functions.
 *
 * Run: node backend/scripts/testProjectExecutionCopilot.js
 */
const assert = require("assert");
const {
  computeExecutionCopilot,
  determineExecutionTrend,
  buildActionCandidates,
  buildDailyPlan,
  toActionPriority,
  shouldNotifyExecutionIssue,
} = require("../src/services/projectExecutionCopilotService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-01T12:00:00Z");

/** Builds a minimal-but-complete "healthy, no issues" evidence bundle;
 * overrides are shallow-merged per top-level key so each test only
 * specifies what it cares about — mirrors testProjectHealth.js#baseEvidence. */
function baseEvidence(overrides = {}) {
  const evidence = {
    groupId: "g1",
    groupName: "Team Nimbus",
    generatedAt: NOW,
    teamRisk: {
      riskScore: 10,
      riskLevel: "LOW",
      riskTrend: "STABLE",
      trendMessage: "Risk is steady.",
      warnings: [],
      positiveSignals: [],
      earlyWarnings: [],
      collaborationRisks: [],
      affectedStudents: [],
    },
    forecast: {
      probability: 85,
      status: "ON_TRACK",
      trend: "STABLE",
      trendMessage: "Forecast is steady.",
      completedTasks: 8,
      totalTasks: 10,
      recommendations: [],
      evidence: { completionRate: 80, overdueTasks: 0, stalledTasks: 0, pendingReviews: 0 },
    },
    health: {
      health: "HEALTHY",
      healthScore: 88,
      disclaimer: "healthScore is an aggregated dashboard indicator, not a replacement for Team Risk.",
      topIssues: [],
      positiveSignals: [{ type: "TEAM_RISK", title: "Team risk is low", reason: "8 of 10 tasks completed with no overdue work" }],
    },
    overdueTasks: [],
    stalledTasks: [],
    pendingReviewTasks: [],
    largeUnstartedTasks: [],
    originality: { duplicateCount: 0, highSeverityCount: 0, possibleSeverityCount: 0, flaggedSubmissions: [] },
    submissions: { awaitingReview: 0 },
    criticalCodeIssues: 0,
    reassignmentSuggestions: [],
    history: [],
  };
  for (const key of Object.keys(overrides)) {
    evidence[key] =
      typeof evidence[key] === "object" && !Array.isArray(evidence[key]) && evidence[key] !== null
        ? { ...evidence[key], ...overrides[key] }
        : overrides[key];
  }
  return evidence;
}

/* 1 — healthy project: no issues -> HEALTHY, no critical actions, empty lists */
check("healthy project produces HEALTHY status with no critical actions", () => {
  const result = computeExecutionCopilot(baseEvidence());
  assert.strictEqual(result.overallStatus, "HEALTHY");
  assert.strictEqual(result.executionScore, 88);
  assert.deepStrictEqual(result.criticalActions, []);
  assert.deepStrictEqual(result.blockedTasks, []);
  assert.deepStrictEqual(result.atRiskTasks, []);
});

/* 2 — critical project: forecast CRITICAL + team risk CRITICAL produces critical actions */
check("critical project (forecast + team risk CRITICAL) produces critical actions", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: { riskLevel: "CRITICAL", riskScore: 90, reasons: ["Multiple overdue tasks and low collaboration."] },
      forecast: { status: "CRITICAL", probability: 12 },
      health: { health: "CRITICAL", healthScore: 15 },
    })
  );
  assert.strictEqual(result.overallStatus, "CRITICAL");
  assert.ok(result.criticalActions.length >= 2);
  assert.ok(result.criticalActions.some((a) => a.type === "FORECAST_CRITICAL"));
  assert.ok(result.criticalActions.some((a) => a.type === "TEAM_RISK_CRITICAL"));
});

/* 3 — no tasks at all: INSUFFICIENT_DATA */
check("no tasks / no activity produces INSUFFICIENT_DATA", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: { riskLevel: "INSUFFICIENT_DATA" },
      forecast: { status: "INSUFFICIENT_DATA" },
    })
  );
  assert.strictEqual(result.overallStatus, "INSUFFICIENT_DATA");
  assert.strictEqual(result.executionScore, null);
  assert.deepStrictEqual(result.todayActions, []);
  assert.deepStrictEqual(result.thisWeekActions, []);
});

/* 4 — overdue tasks produce OVERDUE_TASK actions, ranked by days overdue */
check("overdue tasks generate OVERDUE_TASK actions sorted by most overdue first", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      overdueTasks: [
        { taskId: "t1", title: "API integration", assigneeId: "s1", daysOverdue: 1 },
        { taskId: "t2", title: "Database schema", assigneeId: "s2", daysOverdue: 5 },
      ],
    })
  );
  const overdueActions = result.deadlineActions.filter((a) => a.type === "OVERDUE_TASK");
  assert.strictEqual(overdueActions.length, 2);
  assert.strictEqual(overdueActions[0].taskId, "t2");
  assert.strictEqual(overdueActions[0].priority, "CRITICAL");
});

/* 5 — stalled tasks appear as blockedTasks and BLOCKED_TASK actions */
check("stalled tasks appear in blockedTasks and generate BLOCKED_TASK actions", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      stalledTasks: [{ taskId: "t3", title: "Deploy pipeline", assigneeId: "s3", status: "in_progress", daysSinceUpdate: 9 }],
    })
  );
  assert.strictEqual(result.blockedTasks.length, 1);
  assert.strictEqual(result.blockedTasks[0].taskId, "t3");
  assert.ok(result.deadlineActions.some((a) => a.type === "BLOCKED_TASK" && a.taskId === "t3"));
});

/* 6 — blocked tasks (long-stalled, >=14 days) are HIGH priority */
check("long-stalled (>=14 day) tasks are HIGH priority, shorter stalls are MEDIUM", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      stalledTasks: [
        { taskId: "t4", title: "Old task", assigneeId: "s1", status: "in_progress", daysSinceUpdate: 20 },
        { taskId: "t5", title: "Recent stall", assigneeId: "s2", status: "in_progress", daysSinceUpdate: 8 },
      ],
    })
  );
  const long = result.deadlineActions.find((a) => a.taskId === "t4");
  const short = result.deadlineActions.find((a) => a.taskId === "t5");
  assert.strictEqual(long.priority, "HIGH");
  assert.strictEqual(short.priority, "MEDIUM");
});

/* 7 — submission backlog warning surfaces as a SUBMISSION action */
check("submission review backlog warning surfaces as a submission action", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: {
        warnings: [
          {
            type: "SUBMISSION_REVIEW_BACKLOG",
            severity: "HIGH",
            title: "Submission review backlog",
            description: "6 submissions awaiting review.",
            recommendation: "Review pending submissions this week.",
          },
        ],
      },
    })
  );
  assert.strictEqual(result.submissionActions.length, 1);
  assert.strictEqual(result.submissionActions[0].type, "SUBMISSION_REVIEW_BACKLOG");
  assert.strictEqual(result.submissionActions[0].priority, "HIGH");
});

/* 8 — repeated changes requested warning surfaces as a submission action */
check("repeated changes-requested warning surfaces as a submission action", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: {
        warnings: [
          {
            type: "REPEATED_CHANGES_REQUESTED",
            severity: "MEDIUM",
            title: "Repeated changes requested",
            description: "A task has had changes requested 3 times.",
            recommendation: "Pair with the student to clarify requirements.",
          },
        ],
      },
    })
  );
  assert.strictEqual(result.submissionActions.length, 1);
  assert.strictEqual(result.submissionActions[0].type, "REPEATED_CHANGES_REQUESTED");
});

/* 9 — collaboration risk warning surfaces as a collaboration action */
check("low collaboration warning surfaces as a collaboration action", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: {
        warnings: [
          {
            type: "LOW_COLLABORATION",
            severity: "MEDIUM",
            title: "Low collaboration detected",
            description: "Team chat activity has dropped.",
            recommendation: "Encourage more frequent check-ins.",
          },
        ],
      },
    })
  );
  assert.strictEqual(result.collaborationActions.length, 1);
  assert.strictEqual(result.collaborationActions[0].type, "LOW_COLLABORATION");
});

/* 10 — student overload flagged as WORKLOAD-category action via affectedStudents */
check("at-risk/overloaded student surfaces in teamAttention", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: {
        affectedStudents: [{ studentId: "s9", riskLevel: "AT_RISK", riskScore: 60, reasons: ["Assigned 5 open tasks, well above team average."] }],
      },
    })
  );
  assert.strictEqual(result.teamAttention.length, 1);
  assert.strictEqual(result.teamAttention[0].studentId, "s9");
  assert.strictEqual(result.teamAttention[0].reasons[0], "Assigned 5 open tasks, well above team average.");
});

/* 11 — plagiarism/originality warning surfaces as an ORIGINALITY action */
check("flagged submission (originality) surfaces as an action", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      originality: {
        duplicateCount: 1,
        highSeverityCount: 0,
        possibleSeverityCount: 0,
        flaggedSubmissions: [{ taskId: "t7", taskTitle: "Report writeup", studentId: "s4", severity: "DUPLICATE" }],
      },
    })
  );
  const flag = [...result.thisWeekActions, ...result.todayActions, ...result.criticalActions].find((a) => a.type === "ORIGINALITY_FLAG");
  assert.ok(flag, "expected an ORIGINALITY_FLAG action");
  assert.strictEqual(flag.taskId, "t7");
});

/* 12 — critical code-review issues surface as a CODE_QUALITY action */
check("critical code review issues surface as a code-quality action", () => {
  const result = computeExecutionCopilot(baseEvidence({ criticalCodeIssues: 4 }));
  const flag = [...result.todayActions, ...result.thisWeekActions].find((a) => a.type === "CODE_QUALITY");
  assert.ok(flag, "expected a CODE_QUALITY action");
  assert.strictEqual(flag.priority, "HIGH");
});

/* 13 — forecast CRITICAL alone (team risk fine) still yields a critical action */
check("forecast CRITICAL alone still produces a critical action", () => {
  const result = computeExecutionCopilot(baseEvidence({ forecast: { status: "CRITICAL", probability: 10 } }));
  assert.ok(result.criticalActions.some((a) => a.type === "FORECAST_CRITICAL"));
});

/* 14 — project health CRITICAL is reflected as overallStatus (reused, not recomputed) */
check("overallStatus/executionScore are reused directly from Project Health", () => {
  const result = computeExecutionCopilot(baseEvidence({ health: { health: "CRITICAL", healthScore: 22 } }));
  assert.strictEqual(result.overallStatus, "CRITICAL");
  assert.strictEqual(result.executionScore, 22);
});

/* 15 — mixed evidence produces a properly ranked, multi-category action list */
check("mixed evidence (overdue + stalled + submission + collaboration) ranks by category", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      overdueTasks: [{ taskId: "t10", title: "Overdue task", assigneeId: "s1", daysOverdue: 4 }],
      stalledTasks: [{ taskId: "t11", title: "Stalled task", assigneeId: "s2", status: "in_progress", daysSinceUpdate: 10 }],
      teamRisk: {
        warnings: [
          { type: "SUBMISSION_REVIEW_BACKLOG", severity: "MEDIUM", title: "Backlog", description: "d", recommendation: "r" },
          { type: "LOW_COLLABORATION", severity: "LOW", title: "Low collab", description: "d", recommendation: "r" },
        ],
      },
    })
  );
  const allActions = [...result.criticalActions, ...result.todayActions, ...result.thisWeekActions];
  const overdueIdx = allActions.findIndex((a) => a.type === "OVERDUE_TASK");
  const stalledIdx = allActions.findIndex((a) => a.type === "BLOCKED_TASK");
  const submissionIdx = allActions.findIndex((a) => a.type === "SUBMISSION_REVIEW_BACKLOG");
  const collabIdx = allActions.findIndex((a) => a.type === "LOW_COLLABORATION");
  assert.ok(overdueIdx < stalledIdx);
  assert.ok(stalledIdx < submissionIdx);
  assert.ok(submissionIdx < collabIdx);
});

/* 16 — action ranking: CRITICAL_RISK category always ranked ahead of OPTIMIZATION */
check("action ranking: category priority order is respected", () => {
  const evidence = baseEvidence({
    overdueTasks: [{ taskId: "tA", title: "A", assigneeId: "s1", daysOverdue: 2 }],
    forecast: {
      recommendations: [
        { type: "BREAK_DOWN_LARGE_TASK", priority: "LOW", title: "Break down task B", reason: "Task B is large.", suggestedAction: "Split into subtasks." },
      ],
    },
  });
  const actions = buildActionCandidates(evidence);
  const overdue = actions.findIndex((a) => a.type === "OVERDUE_TASK");
  const optimization = actions.findIndex((a) => a.type === "BREAK_DOWN_LARGE_TASK");
  assert.ok(overdue < optimization);
});

/* 17 — max 5 actions in today's plan even with many candidates */
check("today's plan never exceeds 5 actions", () => {
  const overdueTasks = Array.from({ length: 10 }, (_, i) => ({ taskId: `o${i}`, title: `Task ${i}`, assigneeId: "s1", daysOverdue: i + 1 }));
  const result = computeExecutionCopilot(baseEvidence({ overdueTasks }));
  assert.ok(result.todayActions.length <= 5);
});

/* 18 — max 8 actions in this week's plan */
check("this week's plan never exceeds 8 actions", () => {
  const stalledTasks = Array.from({ length: 5 }, (_, i) => ({ taskId: `s${i}`, title: `Stalled ${i}`, assigneeId: "s1", status: "in_progress", daysSinceUpdate: 10 + i }));
  const warnings = Array.from({ length: 10 }, (_, i) => ({
    type: "LOW_PROGRESS",
    severity: "LOW",
    title: `Warning ${i}`,
    description: "d",
    recommendation: "r",
  }));
  const result = computeExecutionCopilot(baseEvidence({ stalledTasks, teamRisk: { warnings } }));
  assert.ok(result.thisWeekActions.length <= 8);
});

/* 19 — duplicate action prevention: identical type+task never appears twice */
check("duplicate action prevention: same type/task never repeats", () => {
  const evidence = baseEvidence({
    overdueTasks: [{ taskId: "dup1", title: "Dup task", assigneeId: "s1", daysOverdue: 2 }],
    teamRisk: {
      earlyWarnings: [{ taskId: "dup1", title: "Dup task", level: "AT_RISK", severity: "HIGH", reason: "Overdue", assignee: { id: "s1", name: "Alice" }, recommendedAction: "Follow up" }],
    },
  });
  const actions = buildActionCandidates(evidence);
  // dup1's early warning is suppressed because it's already represented by
  // the OVERDUE_TASK action for the same taskId.
  const dupActions = actions.filter((a) => a.taskId === "dup1");
  const types = dupActions.map((a) => a.type);
  assert.strictEqual(new Set(types).size, types.length);
});

/* 20 — missing optional fields (no recommendations/warnings arrays) don't throw */
check("missing optional fields do not throw and produce a valid result", () => {
  const evidence = baseEvidence();
  delete evidence.forecast.recommendations;
  delete evidence.teamRisk.warnings;
  delete evidence.teamRisk.earlyWarnings;
  delete evidence.teamRisk.collaborationRisks;
  assert.doesNotThrow(() => computeExecutionCopilot(evidence));
});

/* 21 — malformed input (null-ish nested fields) is handled gracefully */
check("malformed/sparse input does not throw", () => {
  const evidence = baseEvidence({
    teamRisk: { warnings: null, earlyWarnings: null, collaborationRisks: null, affectedStudents: null },
    originality: null,
  });
  assert.doesNotThrow(() => computeExecutionCopilot(evidence));
});

/* 22 — trend IMPROVING when score rose by >= 5 since last snapshot */
check("trend is IMPROVING when score rises by 5+", () => {
  const { trend } = determineExecutionTrend(90, [{ executionScore: 80 }]);
  assert.strictEqual(trend, "IMPROVING");
});

/* 23 — trend STABLE when score change is within tolerance */
check("trend is STABLE when score change is within +-5", () => {
  const { trend } = determineExecutionTrend(82, [{ executionScore: 80 }]);
  assert.strictEqual(trend, "STABLE");
});

/* 24 — trend WORSENING when score drops by >= 5 */
check("trend is WORSENING when score drops by 5+", () => {
  const { trend } = determineExecutionTrend(70, [{ executionScore: 80 }]);
  assert.strictEqual(trend, "WORSENING");
});

/* 25 — trend INSUFFICIENT_DATA with no history */
check("trend is INSUFFICIENT_DATA with no prior snapshot", () => {
  const { trend } = determineExecutionTrend(80, []);
  assert.strictEqual(trend, "INSUFFICIENT_DATA");
});

/* 26 — INSUFFICIENT_DATA also when currentScore is null (health had no score) */
check("trend is INSUFFICIENT_DATA when current score is null", () => {
  const { trend } = determineExecutionTrend(null, [{ executionScore: 80 }]);
  assert.strictEqual(trend, "INSUFFICIENT_DATA");
});

/* 27 — privacy-safe output: no fabricated student names, only IDs, in teamAttention/actions */
check("output is privacy-safe: never includes a student `name` field", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: { affectedStudents: [{ studentId: "s9", riskLevel: "CRITICAL", riskScore: 90, reasons: ["Multiple overdue tasks."] }] },
      overdueTasks: [{ taskId: "t20", title: "Task", assigneeId: "s9", daysOverdue: 3 }],
    })
  );
  const serialized = JSON.stringify(result);
  assert.ok(!/"studentName"/.test(serialized));
  assert.ok(!/"name":"[A-Za-z]+ [A-Za-z]+"/.test(serialized));
});

/* 28 — deterministic output: same evidence always produces the same result */
check("output is deterministic for identical evidence", () => {
  const evidence = baseEvidence({
    overdueTasks: [{ taskId: "t30", title: "Task", assigneeId: "s1", daysOverdue: 2 }],
    stalledTasks: [{ taskId: "t31", title: "Task 2", assigneeId: "s2", status: "in_progress", daysSinceUpdate: 8 }],
  });
  const r1 = computeExecutionCopilot(JSON.parse(JSON.stringify(evidence)));
  const r2 = computeExecutionCopilot(JSON.parse(JSON.stringify(evidence)));
  assert.deepStrictEqual(r1, r2);
});

/* 29 — notification threshold: new critical action after none previously fires */
check("notification fires when a new critical action first appears", () => {
  const result = { overallStatus: "AT_RISK", criticalActions: [{ type: "OVERDUE_TASK" }], forecast: { status: "ON_TRACK" }, summary: { overdueTasks: 1 } };
  const previous = { lastNotifiedStatus: null, criticalActionCount: 0, forecastStatus: "ON_TRACK", overdueTaskCount: 1 };
  assert.strictEqual(shouldNotifyExecutionIssue(result, previous), true);
});

/* 30 — notification threshold: no repeat notification when nothing changed */
check("notification does not repeat when status/criticals/overdue are unchanged", () => {
  const result = { overallStatus: "AT_RISK", criticalActions: [{ type: "OVERDUE_TASK" }], forecast: { status: "ON_TRACK" }, summary: { overdueTasks: 1 } };
  const previous = { lastNotifiedStatus: "AT_RISK", criticalActionCount: 1, forecastStatus: "ON_TRACK", overdueTaskCount: 1 };
  assert.strictEqual(shouldNotifyExecutionIssue(result, previous), false);
});

/* 31 — notification threshold: forecast becoming CRITICAL fires even with same status */
check("notification fires when forecast newly becomes CRITICAL", () => {
  const result = { overallStatus: "STABLE", criticalActions: [], forecast: { status: "CRITICAL" }, summary: { overdueTasks: 0 } };
  const previous = { lastNotifiedStatus: "STABLE", criticalActionCount: 0, forecastStatus: "ON_TRACK", overdueTaskCount: 0 };
  assert.strictEqual(shouldNotifyExecutionIssue(result, previous), true);
});

/* 32 — notification threshold: multiple new overdue tasks (>=3, was <3) fires */
check("notification fires when overdue tasks newly reach 3+", () => {
  const result = { overallStatus: "STABLE", criticalActions: [], forecast: { status: "ON_TRACK" }, summary: { overdueTasks: 3 } };
  const previous = { lastNotifiedStatus: "STABLE", criticalActionCount: 0, forecastStatus: "ON_TRACK", overdueTaskCount: 1 };
  assert.strictEqual(shouldNotifyExecutionIssue(result, previous), true);
});

/* 33 — notification threshold: status escalation from healthy to at-risk fires */
check("notification fires on healthy -> at-risk escalation", () => {
  const result = { overallStatus: "AT_RISK", criticalActions: [], forecast: { status: "ON_TRACK" }, summary: { overdueTasks: 0 } };
  const previous = { lastNotifiedStatus: "HEALTHY", criticalActionCount: 0, forecastStatus: "ON_TRACK", overdueTaskCount: 0 };
  assert.strictEqual(shouldNotifyExecutionIssue(result, previous), true);
});

/* 34 — scheduler failure isolation: computeExecutionCopilot never throws on a broken evidence shape (mirrors try/catch in scanAllGroupsExecutionCopilot) */
check("computeExecutionCopilot degrades gracefully instead of throwing on broken evidence", () => {
  assert.doesNotThrow(() => computeExecutionCopilot(baseEvidence({ forecast: {}, teamRisk: {} })));
});

/* 35 — regression compatibility: buildDailyPlan splits without overlap */
check("buildDailyPlan splits today/this-week without overlap", () => {
  const actions = Array.from({ length: 12 }, (_, i) => ({ type: `T${i}`, priority: "MEDIUM", title: `Action ${i}` }));
  const { today, thisWeek } = buildDailyPlan(actions);
  assert.strictEqual(today.length, 5);
  assert.strictEqual(thisWeek.length, 7);
  const overlap = today.filter((a) => thisWeek.includes(a));
  assert.strictEqual(overlap.length, 0);
});

/* 36 — toActionPriority maps severities correctly, defaults to MEDIUM */
check("toActionPriority maps known severities and defaults unknown to MEDIUM", () => {
  assert.strictEqual(toActionPriority("critical"), "CRITICAL");
  assert.strictEqual(toActionPriority("HIGH"), "HIGH");
  assert.strictEqual(toActionPriority("Moderate"), "MEDIUM");
  assert.strictEqual(toActionPriority("low"), "LOW");
  assert.strictEqual(toActionPriority(undefined), "MEDIUM");
  assert.strictEqual(toActionPriority("nonsense"), "MEDIUM");
});

/* 37 — atRiskTasks only includes AT_RISK level early warnings, not ON_TRACK/DEADLINE_APPROACHING */
check("atRiskTasks only includes AT_RISK level early warnings", () => {
  const result = computeExecutionCopilot(
    baseEvidence({
      teamRisk: {
        earlyWarnings: [
          { taskId: "e1", title: "Task E1", level: "AT_RISK", severity: "HIGH", reason: "Overdue soon", assignee: { id: "s1", name: "A" }, daysLeft: 1 },
          { taskId: "e2", title: "Task E2", level: "DEADLINE_APPROACHING", severity: "LOW", reason: "Due soon", assignee: { id: "s2", name: "B" }, daysLeft: 4 },
          { taskId: "e3", title: "Task E3", level: "ON_TRACK", severity: "LOW", reason: "On track", assignee: null, daysLeft: 10 },
        ],
      },
    })
  );
  assert.strictEqual(result.atRiskTasks.length, 1);
  assert.strictEqual(result.atRiskTasks[0].taskId, "e1");
});

/* 38 — recommendedReassignments pass through evidence untouched */
check("recommendedReassignments in output match the precomputed evidence list", () => {
  const suggestions = [{ taskId: "r1", taskTitle: "Task R1", fromStudentId: "s1", toStudentId: "s2", toStudentName: "Bob", reason: "Workload balance", suggestedAction: "Reassign to Bob." }];
  const result = computeExecutionCopilot(baseEvidence({ reassignmentSuggestions: suggestions }));
  assert.deepStrictEqual(result.recommendedReassignments, suggestions);
});

/* 39 — positive signals are reused verbatim from Project Health */
check("positiveSignals are reused verbatim from Project Health, not recomputed", () => {
  const signals = [{ type: "TEAM_RISK", title: "Custom signal", reason: "custom reason" }];
  const result = computeExecutionCopilot(baseEvidence({ health: { positiveSignals: signals } }));
  assert.deepStrictEqual(result.positiveSignals, signals);
});

/* 40 — reasoning array always has at least one entry and never throws when everything is empty */
check("reasoning always has at least one entry, even for a clean project", () => {
  const result = computeExecutionCopilot(
    baseEvidence({ health: { disclaimer: undefined, topIssues: [] }, forecast: { trendMessage: undefined }, teamRisk: { trendMessage: undefined } })
  );
  assert.ok(result.reasoning.length >= 1);
});

console.log(`\n${passed} passed`);
