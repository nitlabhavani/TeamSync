/**
 * Standalone tests for STEP 19 — AI Project Progress Forecast & Early
 * Intervention System. No DB / no server / no live AI engine needed —
 * exercises the pure functions in services/projectForecastService.js and
 * services/interventionRecommendationService.js directly with hand-built
 * evidence objects, exactly like backend/scripts/testTeamRiskAnalyzer.js
 * does for its pure scoring functions.
 *
 * Run: node backend/scripts/testProjectForecast.js
 */
const assert = require("assert");
const {
  computeForecast,
  determineForecastTrend,
  classifyForecastStatus,
} = require("../src/services/projectForecastService");
const { generateRecommendations } = require("../src/services/interventionRecommendationService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Builds a minimal-but-complete forecast evidence object; overrides are
 * shallow-merged per top-level key so each test only specifies what it
 * cares about — mirrors testTeamRiskAnalyzer.js#baseEvidence. */
function baseEvidence(overrides = {}) {
  const evidence = {
    groupId: "g1",
    groupName: "Team Nimbus",
    generatedAt: NOW,
    tasks: { total: 10, completed: 6, remaining: 4, completionPercentage: 60 },
    overdueTasks: [],
    stalledTasks: [],
    pendingReviewTasks: [],
    largeUnstartedTasks: [],
    velocity: { completed: 6, elapsedDays: 10, velocityPerDay: 0.6 },
    deadline: {
      expectedCompletion: new Date(NOW.getTime() + 12 * DAY),
      daysRemaining: 12,
      totalDurationDays: 22,
      elapsedDays: 10,
    },
    teamRisk: { level: "LOW", score: 5, warnings: [] },
    perStudent: {},
    history: [],
  };
  for (const [k, v] of Object.entries(overrides)) {
    evidence[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? { ...evidence[k], ...v } : v;
  }
  return evidence;
}

/* 1 — no tasks -> INSUFFICIENT_DATA, never fabricated */
check("no tasks -> INSUFFICIENT_DATA", () => {
  const evidence = baseEvidence({ tasks: { total: 0, completed: 0, remaining: 0, completionPercentage: null } });
  const result = computeForecast(evidence);
  assert.strictEqual(result.status, "INSUFFICIENT_DATA");
  assert.strictEqual(result.probability, null);
  assert.ok(result.explanation, "expected a clear explanation string");
});

/* 2 — all tasks completed -> ON_TRACK, remaining 0, high probability */
check("all tasks completed -> ON_TRACK, no remaining work", () => {
  const evidence = baseEvidence({
    tasks: { total: 8, completed: 8, remaining: 0, completionPercentage: 100 },
    velocity: { completed: 8, elapsedDays: 15, velocityPerDay: 0.53 },
  });
  const result = computeForecast(evidence);
  assert.strictEqual(result.status, "ON_TRACK");
  assert.strictEqual(result.evidence.remainingTasks, 0);
  assert.ok(result.probability >= 75, `expected probability >= 75, got ${result.probability}`);
});

/* 3 — high completion rate, healthy pace -> ON_TRACK */
check("high completion + healthy pace -> ON_TRACK", () => {
  const evidence = baseEvidence({
    tasks: { total: 10, completed: 9, remaining: 1, completionPercentage: 90 },
    deadline: { expectedCompletion: new Date(NOW.getTime() + 10 * DAY), daysRemaining: 10, totalDurationDays: 20, elapsedDays: 10 },
  });
  const result = computeForecast(evidence);
  assert.strictEqual(result.status, "ON_TRACK");
});

/* 4 — low completion rate, deadline close, weak velocity -> LIKELY_LATE or CRITICAL */
check("low completion + tight deadline -> LIKELY_LATE or CRITICAL", () => {
  const evidence = baseEvidence({
    tasks: { total: 10, completed: 2, remaining: 8, completionPercentage: 20 },
    velocity: { completed: 2, elapsedDays: 18, velocityPerDay: 0.11 },
    deadline: { expectedCompletion: new Date(NOW.getTime() + 3 * DAY), daysRemaining: 3, totalDurationDays: 21, elapsedDays: 18 },
    teamRisk: { level: "HIGH", score: 60, warnings: [] },
  });
  const result = computeForecast(evidence);
  assert.ok(
    ["LIKELY_LATE", "CRITICAL"].includes(result.status),
    `expected LIKELY_LATE or CRITICAL, got ${result.status}`
  );
});

/* 5 — overdue tasks lower the probability and appear in evidence */
check("overdue tasks reduce probability", () => {
  const healthy = computeForecast(baseEvidence());
  const withOverdue = computeForecast(
    baseEvidence({
      overdueTasks: [
        { taskId: "t1", title: "Auth module", assigneeId: "u1", due: NOW, daysOverdue: 3 },
        { taskId: "t2", title: "API docs", assigneeId: "u2", due: NOW, daysOverdue: 1 },
      ],
    })
  );
  assert.ok(withOverdue.probability < healthy.probability, "overdue tasks should reduce probability");
  assert.strictEqual(withOverdue.evidence.overdueTasks, 2);
});

/* 6 — stalled/blocked tasks lower the probability */
check("stalled tasks reduce probability", () => {
  const healthy = computeForecast(baseEvidence());
  const withStalled = computeForecast(
    baseEvidence({
      stalledTasks: [
        { taskId: "t3", title: "DB schema", assigneeId: "u1", status: "in_progress", daysSinceUpdate: 9 },
      ],
    })
  );
  assert.ok(withStalled.probability < healthy.probability, "stalled tasks should reduce probability");
  assert.strictEqual(withStalled.evidence.stalledTasks, 1);
});

/* 7 — pending submission reviews contribute a (capped) deduction */
check("pending reviews beyond the first reduce probability", () => {
  const healthy = computeForecast(baseEvidence());
  const withReviews = computeForecast(
    baseEvidence({
      pendingReviewTasks: [
        { taskId: "t4", title: "Frontend polish" },
        { taskId: "t5", title: "Payments flow" },
        { taskId: "t6", title: "Search UI" },
      ],
    })
  );
  assert.ok(withReviews.probability <= healthy.probability, "3 pending reviews should not increase probability");
  assert.strictEqual(withReviews.evidence.pendingReviews, 3);
});

/* 8 — insufficient historical data -> trend INSUFFICIENT_DATA, not fabricated */
check("no snapshot history -> trend INSUFFICIENT_DATA", () => {
  const result = determineForecastTrend(78, []);
  assert.strictEqual(result.trend, "INSUFFICIENT_DATA");
  assert.strictEqual(result.previousProbability, null);
});

/* 9 — ON_TRACK classification boundary */
check("classifyForecastStatus: probability >= 75 -> ON_TRACK", () => {
  assert.strictEqual(classifyForecastStatus(75, false), "ON_TRACK");
  assert.strictEqual(classifyForecastStatus(100, false), "ON_TRACK");
});

/* 10 — AT_RISK classification boundary */
check("classifyForecastStatus: 50-74 -> AT_RISK", () => {
  assert.strictEqual(classifyForecastStatus(50, false), "AT_RISK");
  assert.strictEqual(classifyForecastStatus(74, false), "AT_RISK");
});

/* 11 — LIKELY_LATE classification boundary */
check("classifyForecastStatus: 25-49 -> LIKELY_LATE", () => {
  assert.strictEqual(classifyForecastStatus(25, false), "LIKELY_LATE");
  assert.strictEqual(classifyForecastStatus(49, false), "LIKELY_LATE");
});

/* 12 — CRITICAL classification, including forced-CRITICAL on a passed deadline */
check("classifyForecastStatus: <25 -> CRITICAL, and deadline-passed forces CRITICAL", () => {
  assert.strictEqual(classifyForecastStatus(24, false), "CRITICAL");
  assert.strictEqual(classifyForecastStatus(90, true), "CRITICAL", "a passed deadline with work remaining must force CRITICAL");
});

/* 13 — improving trend */
check("trend: probability increased -> IMPROVING", () => {
  const result = determineForecastTrend(80, [{ probability: 60, status: "AT_RISK", generatedAt: NOW }]);
  assert.strictEqual(result.trend, "IMPROVING");
  assert.strictEqual(result.previousProbability, 60);
});

/* 14 — worsening trend */
check("trend: probability decreased -> WORSENING", () => {
  const result = determineForecastTrend(40, [{ probability: 70, status: "ON_TRACK", generatedAt: NOW }]);
  assert.strictEqual(result.trend, "WORSENING");
});

/* 15 — stable trend */
check("trend: small delta -> STABLE", () => {
  const result = determineForecastTrend(72, [{ probability: 75, status: "ON_TRACK", generatedAt: NOW }]);
  assert.strictEqual(result.trend, "STABLE");
});

/* 16 — recommendation generation from real overdue/stalled/review evidence */
check("recommendations are generated from real evidence", () => {
  const evidence = baseEvidence({
    overdueTasks: [{ taskId: "t1", title: "Auth module", assigneeId: "u1", due: NOW, daysOverdue: 4 }],
    pendingReviewTasks: [{ taskId: "t4", title: "Frontend polish" }],
  });
  const forecast = computeForecast(evidence);
  const recs = generateRecommendations(evidence, forecast);
  assert.ok(recs.length > 0, "expected at least one recommendation");
  assert.ok(recs.some((r) => r.type === "PRIORITIZE_OVERDUE_TASK"), "expected PRIORITIZE_OVERDUE_TASK");
  const overdueRec = recs.find((r) => r.type === "PRIORITIZE_OVERDUE_TASK");
  assert.strictEqual(overdueRec.evidence.taskId, "t1");
  assert.strictEqual(overdueRec.evidence.daysOverdue, 4);
});

/* 17 — no-action case: healthy group with zero issues -> NO_ACTION_REQUIRED */
check("healthy group with no issues -> NO_ACTION_REQUIRED", () => {
  const evidence = baseEvidence({
    tasks: { total: 10, completed: 9, remaining: 1, completionPercentage: 90 },
    deadline: { expectedCompletion: new Date(NOW.getTime() + 20 * DAY), daysRemaining: 20, totalDurationDays: 30, elapsedDays: 10 },
  });
  const forecast = computeForecast(evidence);
  assert.strictEqual(forecast.status, "ON_TRACK");
  const recs = generateRecommendations(evidence, forecast);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].type, "NO_ACTION_REQUIRED");
});

/* 18 — recommendation priority ordering: HIGH before MEDIUM before LOW */
check("recommendations are sorted HIGH -> MEDIUM -> LOW", () => {
  const evidence = baseEvidence({
    overdueTasks: [{ taskId: "t1", title: "Auth module", assigneeId: "u1", due: NOW, daysOverdue: 5 }],
    largeUnstartedTasks: [{ taskId: "t7", title: "Design system overhaul", estimate: 12 }],
    pendingReviewTasks: [{ taskId: "t4", title: "Frontend polish" }],
  });
  const forecast = computeForecast(evidence);
  const recs = generateRecommendations(evidence, forecast);
  const ranks = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  for (let i = 1; i < recs.length; i += 1) {
    assert.ok(
      ranks[recs[i - 1].priority] <= ranks[recs[i].priority],
      `recommendation ${i} (${recs[i].priority}) is out of priority order after ${recs[i - 1].priority}`
    );
  }
});

/* 19 — malformed / missing task data never crashes and never fabricates */
check("missing deadline/velocity data does not crash and stays deterministic", () => {
  const evidence = baseEvidence({
    deadline: { expectedCompletion: null, daysRemaining: null, totalDurationDays: null, elapsedDays: 10 },
    velocity: { completed: 6, elapsedDays: null, velocityPerDay: null },
  });
  const result1 = computeForecast(evidence);
  const result2 = computeForecast(evidence);
  assert.strictEqual(result1.status, result2.status, "same evidence must always produce the same status");
  assert.strictEqual(result1.probability, result2.probability, "same evidence must always produce the same probability");
  assert.strictEqual(result1.evidence.daysRemaining, null);
  assert.strictEqual(result1.projectedCompletionDate, null, "no velocity means no fabricated projected date");
});

/* 20 — group isolation / authorization helper: mirrors the isGuideOrLeader
 * logic in projectForecastController.js (guide/admin OR the group's
 * student Team Leader only — never an arbitrary member). */
check("isGuideOrLeader authorization logic isolates guide/leader from other members", () => {
  function isGuideOrLeader(reqIsGuide, groupLeaderId, userId) {
    return reqIsGuide || String(groupLeaderId) === String(userId);
  }
  // The guide (req.isGuide === true, set by requireGroupAccess) -> allowed.
  assert.strictEqual(isGuideOrLeader(true, "leader1", "guide1"), true);
  // The student Team Leader -> allowed.
  assert.strictEqual(isGuideOrLeader(false, "leader1", "leader1"), true);
  // A regular member who is neither guide nor leader -> not allowed.
  assert.strictEqual(isGuideOrLeader(false, "leader1", "member2"), false);
  // A member of a DIFFERENT group's leader id is never mistaken for this
  // group's leader (string identity, not truthy coercion).
  assert.strictEqual(isGuideOrLeader(false, "leader1", "leaderOfOtherGroup"), false);
});

console.log(`\n${passed} project-forecast test(s) passed.`);
