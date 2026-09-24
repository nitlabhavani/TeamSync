/**
 * Standalone tests for STEP 20 — AI Project Health Command Center.
 * No DB / no server / no live AI engine needed — exercises the pure
 * aggregation function computeProjectHealth() in
 * services/projectHealthService.js directly with hand-built evidence
 * objects (already-computed Team Risk / Forecast outputs), exactly like
 * backend/scripts/testProjectForecast.js and testTeamRiskAnalyzer.js do
 * for their own pure functions.
 *
 * Run: node backend/scripts/testProjectHealth.js
 */
const assert = require("assert");
const {
  computeProjectHealth,
  classifyHealth,
  determineHealthTrend,
  buildTopIssues,
  buildPositiveSignals,
} = require("../src/services/projectHealthService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-01T12:00:00Z");

/** Builds a minimal-but-complete "healthy" evidence bundle; overrides are
 * shallow-merged per top-level key so each test only specifies what it
 * cares about — mirrors testProjectForecast.js#baseEvidence. */
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
      positiveSignals: ["8 of 10 tasks completed with no overdue work"],
      earlyWarnings: [],
      collaborationRisks: [],
    },
    forecast: {
      probability: 85,
      status: "ON_TRACK",
      trend: "STABLE",
      trendMessage: "Forecast is steady.",
      projectedCompletionDate: null,
      completedTasks: 8,
      totalTasks: 10,
      evidence: {
        completionRate: 80,
        velocityPerDay: 0.6,
        remainingTasks: 2,
        daysRemaining: 10,
        overdueTasks: 0,
        stalledTasks: 0,
        pendingReviews: 0,
        teamRisk: "LOW",
      },
      recommendations: [],
    },
    originality: { duplicateCount: 0, highSeverityCount: 0, possibleSeverityCount: 0 },
    submissions: { awaitingReview: 0, changesRequestedTasks: 0, repeatedChangesTasks: 0, rejected: 0, wrongProjectOrUnreadable: 0 },
    criticalCodeIssues: 0,
    history: [],
  };
  for (const [k, v] of Object.entries(overrides)) {
    evidence[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? { ...evidence[k], ...v } : v;
  }
  return evidence;
}

/* 1 — no data at all -> INSUFFICIENT_DATA */
check("no data -> INSUFFICIENT_DATA", () => {
  const evidence = baseEvidence({
    teamRisk: { riskLevel: "INSUFFICIENT_DATA", riskScore: 0, warnings: [], positiveSignals: [], earlyWarnings: [], collaborationRisks: [] },
    forecast: { status: "INSUFFICIENT_DATA", probability: null, completedTasks: 0, totalTasks: 0, evidence: {}, recommendations: [] },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.health, "INSUFFICIENT_DATA");
  assert.strictEqual(result.healthScore, null);
  assert.deepStrictEqual(result.topIssues, []);
  assert.deepStrictEqual(result.positiveSignals, []);
  assert.deepStrictEqual(result.recommendedActions, []);
});

/* 2 — insufficient forecast data but real team-risk activity -> still computes */
check("insufficient forecast data with team activity -> not INSUFFICIENT_DATA", () => {
  const evidence = baseEvidence({
    forecast: { status: "INSUFFICIENT_DATA", probability: null, completedTasks: 0, totalTasks: 0, evidence: {}, recommendations: [] },
  });
  const result = computeProjectHealth(evidence);
  assert.notStrictEqual(result.health, "INSUFFICIENT_DATA");
  assert.strictEqual(typeof result.healthScore, "number");
});

/* 3 — healthy project -> HEALTHY */
check("healthy project -> HEALTHY", () => {
  const result = computeProjectHealth(baseEvidence());
  assert.strictEqual(result.health, "HEALTHY");
  assert.ok(result.healthScore >= 85);
});

/* 4 — stable project -> STABLE */
check("stable project -> STABLE", () => {
  const evidence = baseEvidence({
    teamRisk: { riskScore: 30 },
    forecast: { probability: 70, evidence: { completionRate: 70, overdueTasks: 0, stalledTasks: 0, pendingReviews: 0 } },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.health, "STABLE");
});

/* 5 — needs attention -> NEEDS_ATTENTION */
check("moderate issues -> NEEDS_ATTENTION", () => {
  const evidence = baseEvidence({
    teamRisk: { riskScore: 45 },
    forecast: { probability: 55, evidence: { completionRate: 55, overdueTasks: 1, stalledTasks: 0, pendingReviews: 1 } },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.health, "NEEDS_ATTENTION");
});

/* 6 — at risk -> AT_RISK */
check("significant issues -> AT_RISK", () => {
  const evidence = baseEvidence({
    teamRisk: { riskScore: 65 },
    forecast: { probability: 35, status: "LIKELY_LATE", evidence: { completionRate: 35, overdueTasks: 3, stalledTasks: 1, pendingReviews: 2 } },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.health, "AT_RISK");
});

/* 7 — critical -> CRITICAL */
check("severe issues -> CRITICAL", () => {
  const evidence = baseEvidence({
    teamRisk: { riskScore: 90, riskLevel: "CRITICAL" },
    forecast: { probability: 10, status: "CRITICAL", evidence: { completionRate: 10, overdueTasks: 6, stalledTasks: 4, pendingReviews: 3 } },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.health, "CRITICAL");
});

/* 7b — a CRITICAL underlying signal is never averaged away into a healthy score */
check("CRITICAL team risk floors health at AT_RISK or worse even with a good forecast", () => {
  const evidence = baseEvidence({
    teamRisk: { riskScore: 5, riskLevel: "CRITICAL" },
    forecast: { probability: 95, evidence: { completionRate: 95, overdueTasks: 0, stalledTasks: 0, pendingReviews: 0 } },
  });
  const result = computeProjectHealth(evidence);
  assert.ok(["AT_RISK", "CRITICAL"].includes(result.health));
});

/* 8 — high completion contributes a positive signal and a higher score */
check("high completion rate -> positive signal + high score", () => {
  const evidence = baseEvidence({ forecast: { evidence: { completionRate: 90 } } });
  const result = computeProjectHealth(evidence);
  assert.ok(result.positiveSignals.some((p) => p.type === "PROGRESS"));
});

/* 9 — low completion -> lower score, no completion positive signal */
check("low completion rate -> no completion positive signal", () => {
  const evidence = baseEvidence({ forecast: { probability: 40, evidence: { completionRate: 20 } } });
  const result = computeProjectHealth(evidence);
  assert.ok(!result.positiveSignals.some((p) => p.type === "PROGRESS"));
});

/* 10 — overdue tasks flow into summary */
check("overdue tasks reflected in summary", () => {
  const evidence = baseEvidence({ forecast: { evidence: { overdueTasks: 3 } } });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.summary.overdueTasks, 3);
});

/* 11 — early warnings produce DEADLINE top issues with a real taskId */
check("early warnings -> DEADLINE top issue with taskId", () => {
  const evidence = baseEvidence({
    teamRisk: {
      earlyWarnings: [
        { taskId: "t1", title: "Authentication task", level: "AT_RISK", severity: "HIGH", reason: "Only 20% progress with 1 day remaining." },
      ],
    },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.summary.earlyWarnings, 1);
  const issue = result.topIssues.find((i) => i.type === "DEADLINE" && i.taskId === "t1");
  assert.ok(issue, "expected a DEADLINE issue referencing task t1");
  assert.strictEqual(issue.reason, "Only 20% progress with 1 day remaining.");
});

/* 12 — collaboration alerts flow into summary */
check("collaboration risks reflected in summary", () => {
  const evidence = baseEvidence({
    teamRisk: { collaborationRisks: [{ studentId: "u1", riskLevel: "HIGH", flags: [], recommendation: "" }] },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.summary.collaborationAlerts, 1);
});

/* 13 — pending reviews flow into summary */
check("pending reviews reflected in summary", () => {
  const evidence = baseEvidence({ forecast: { evidence: { pendingReviews: 4 } } });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.summary.pendingReviews, 4);
});

/* 14 — originality alerts flow into summary and reduce healthScore */
check("originality alerts reduce health score and appear in summary", () => {
  const clean = computeProjectHealth(baseEvidence());
  const flagged = computeProjectHealth(baseEvidence({ originality: { duplicateCount: 1, highSeverityCount: 0, possibleSeverityCount: 0 } }));
  assert.strictEqual(flagged.summary.originalityAlerts, 1);
  assert.ok(flagged.healthScore < clean.healthScore);
  assert.ok(!flagged.positiveSignals.some((p) => p.type === "ORIGINALITY"));
});

/* 15 — code review critical issues produce a CODE_QUALITY issue and deduction */
check("critical code issues -> CODE_QUALITY top issue + score deduction", () => {
  const clean = computeProjectHealth(baseEvidence());
  const withIssues = computeProjectHealth(baseEvidence({ criticalCodeIssues: 2 }));
  assert.strictEqual(withIssues.summary.criticalCodeIssues, 2);
  assert.ok(withIssues.topIssues.some((i) => i.type === "CODE_QUALITY"));
  assert.ok(withIssues.healthScore < clean.healthScore);
});

/* 16 — forecast fields pass through unchanged (never recomputed) */
check("forecast integration — probability/status pass through as-is", () => {
  const evidence = baseEvidence({ forecast: { probability: 63, status: "AT_RISK" } });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.forecast.probability, 63);
  assert.strictEqual(result.forecast.status, "AT_RISK");
});

/* 17 — team risk fields pass through unchanged (never recomputed) */
check("team risk integration — level/trend pass through as-is", () => {
  const evidence = baseEvidence({ teamRisk: { riskLevel: "MODERATE", riskTrend: "WORSENING" } });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.teamRisk.level, "MODERATE");
  assert.strictEqual(result.teamRisk.trend, "WORSENING");
});

/* 18 — trend: IMPROVING vs prior snapshot */
check("trend improving vs previous snapshot", () => {
  const { trend } = determineHealthTrend(80, [{ healthScore: 60 }]);
  assert.strictEqual(trend, "IMPROVING");
});

/* 19 — trend: STABLE (small delta) */
check("trend stable vs previous snapshot", () => {
  const { trend } = determineHealthTrend(80, [{ healthScore: 78 }]);
  assert.strictEqual(trend, "STABLE");
});

/* 20 — trend: WORSENING */
check("trend worsening vs previous snapshot", () => {
  const { trend } = determineHealthTrend(50, [{ healthScore: 70 }]);
  assert.strictEqual(trend, "WORSENING");
});

/* 20b — trend: no history -> INSUFFICIENT_DATA, never fabricated */
check("trend with no history -> INSUFFICIENT_DATA", () => {
  const { trend } = determineHealthTrend(80, []);
  assert.strictEqual(trend, "INSUFFICIENT_DATA");
});

/* 21 — top issue ordering is deterministic: severity first, then type priority */
check("top issues ordered by severity then type, deterministically", () => {
  const evidence = baseEvidence({
    teamRisk: {
      warnings: [
        { type: "STUDENT_OVERLOAD", severity: "MEDIUM", title: "Uneven workload", description: "x" },
        { type: "DEADLINE_RISK", severity: "CRITICAL", title: "Overdue tasks", description: "y" },
        { type: "SUBMISSION_REVIEW_BACKLOG", severity: "HIGH", title: "Review backlog", description: "z" },
      ],
    },
  });
  const issues = buildTopIssues(evidence);
  assert.strictEqual(issues[0].title, "Overdue tasks"); // CRITICAL first
  assert.strictEqual(issues[1].title, "Review backlog"); // HIGH next
  assert.strictEqual(issues[2].title, "Uneven workload"); // MEDIUM last

  // Re-running with the same input produces the exact same order.
  const issuesAgain = buildTopIssues(evidence);
  assert.deepStrictEqual(issues, issuesAgain);
});

/* 22 — maximum 5 top issues, even with many candidates */
check("top issues capped at 5", () => {
  const evidence = baseEvidence({
    teamRisk: {
      warnings: [
        { type: "DEADLINE_RISK", severity: "HIGH", title: "A", description: "a" },
        { type: "TASK_STALL", severity: "HIGH", title: "B", description: "b" },
        { type: "SUBMISSION_REVIEW_BACKLOG", severity: "HIGH", title: "C", description: "c" },
        { type: "REPEATED_REJECTION", severity: "HIGH", title: "D", description: "d" },
        { type: "TEAM_IDLE", severity: "HIGH", title: "E", description: "e" },
        { type: "DUPLICATE_SUBMISSION_RISK", severity: "HIGH", title: "F", description: "f" },
        { type: "STUDENT_OVERLOAD", severity: "HIGH", title: "G", description: "g" },
      ],
    },
    criticalCodeIssues: 1,
  });
  const result = computeProjectHealth(evidence);
  assert.ok(result.topIssues.length <= 5);
});

/* 23 — maximum 3 recommended actions, even if the forecast produced more */
check("recommended actions capped at 3 (reuses interventionRecommendationService output)", () => {
  const evidence = baseEvidence({
    forecast: {
      recommendations: [
        { type: "PRIORITIZE_OVERDUE_TASK", priority: "HIGH", title: "R1", reason: "r1", evidence: {}, suggestedAction: "a1" },
        { type: "REVIEW_PENDING_SUBMISSION", priority: "HIGH", title: "R2", reason: "r2", evidence: {}, suggestedAction: "a2" },
        { type: "FOLLOW_UP_WITH_INACTIVE_MEMBER", priority: "MEDIUM", title: "R3", reason: "r3", evidence: {}, suggestedAction: "a3" },
        { type: "MONITOR_PROGRESS", priority: "LOW", title: "R4", reason: "r4", evidence: {}, suggestedAction: "a4" },
      ],
    },
  });
  const result = computeProjectHealth(evidence);
  assert.strictEqual(result.recommendedActions.length, 3);
  assert.deepStrictEqual(
    result.recommendedActions.map((r) => r.title),
    ["R1", "R2", "R3"]
  );
});

/* 24 — positive signals: built only from real conditions, capped at 5 */
check("positive signals reflect only real, true conditions and are capped at 5", () => {
  const evidence = baseEvidence({
    teamRisk: {
      positiveSignals: ["8 of 10 tasks completed with no overdue work"],
      riskTrend: "IMPROVING",
      trendMessage: "Risk dropped since last week.",
    },
    forecast: { trend: "IMPROVING", trendMessage: "Forecast improved since last week.", evidence: { completionRate: 80 } },
  });
  const signals = buildPositiveSignals(evidence);
  assert.ok(signals.length <= 5);
  assert.ok(signals.some((s) => s.type === "FORECAST"));
  assert.ok(signals.some((s) => s.type === "RISK"));
  assert.ok(signals.some((s) => s.type === "ORIGINALITY"));
  assert.ok(signals.some((s) => s.type === "PROGRESS"));
});

/* 24b — no positive signal is invented when nothing positive is true */
check("no positive signals fabricated when nothing is actually positive", () => {
  const evidence = baseEvidence({
    teamRisk: { positiveSignals: [], riskTrend: "WORSENING" },
    forecast: { trend: "WORSENING", evidence: { completionRate: 20 } },
    originality: { duplicateCount: 1, highSeverityCount: 0, possibleSeverityCount: 0 },
  });
  const signals = buildPositiveSignals(evidence);
  assert.deepStrictEqual(signals, []);
});

/* 25 — authorization/privacy: the aggregated payload never leaks
 * per-student identifiers, raw evidence, or any field outside the
 * documented guide-facing shape (Feature 17 — Privacy). */
check("aggregated payload only exposes the documented, privacy-safe fields", () => {
  const evidence = baseEvidence({
    teamRisk: {
      collaborationRisks: [{ studentId: "student-123", riskLevel: "HIGH", flags: [{ type: "X", severity: "HIGH", reason: "r" }] }],
      earlyWarnings: [{ taskId: "t1", title: "Task A", assignee: { id: "u1", name: "Alex" }, level: "AT_RISK", severity: "HIGH", reason: "r" }],
    },
  });
  const result = computeProjectHealth(evidence);
  const allowedTopKeys = new Set([
    "groupId",
    "groupName",
    "health",
    "healthScore",
    "trend",
    "forecast",
    "teamRisk",
    "summary",
    "topIssues",
    "positiveSignals",
    "recommendedActions",
    "disclaimer",
    "generatedAt",
  ]);
  for (const key of Object.keys(result)) {
    assert.ok(allowedTopKeys.has(key), `unexpected top-level key leaked: ${key}`);
  }
  // No per-student identifiers (names, ids) anywhere in the serialized output.
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("student-123"), "student id must not leak into the aggregated payload");
  assert.ok(!serialized.includes("Alex"), "student name must not leak into the aggregated payload");
  // The summary is counts only — no nested per-student breakdown.
  const summaryKeys = Object.keys(result.summary);
  assert.deepStrictEqual(
    summaryKeys.sort(),
    ["collaborationAlerts", "completedTasks", "criticalCodeIssues", "earlyWarnings", "originalityAlerts", "overdueTasks", "pendingReviews", "totalTasks"].sort()
  );
});

/* 26 — classifyHealth threshold boundaries, in isolation */
check("classifyHealth threshold boundaries", () => {
  const ctx = { teamRiskLevel: "LOW", forecastStatus: "ON_TRACK" };
  assert.strictEqual(classifyHealth(85, ctx), "HEALTHY");
  assert.strictEqual(classifyHealth(84, ctx), "STABLE");
  assert.strictEqual(classifyHealth(70, ctx), "STABLE");
  assert.strictEqual(classifyHealth(69, ctx), "NEEDS_ATTENTION");
  assert.strictEqual(classifyHealth(50, ctx), "NEEDS_ATTENTION");
  assert.strictEqual(classifyHealth(49, ctx), "AT_RISK");
  assert.strictEqual(classifyHealth(30, ctx), "AT_RISK");
  assert.strictEqual(classifyHealth(29, ctx), "CRITICAL");
});

/* 27 — determinism: same evidence in -> byte-identical result out */
check("computeProjectHealth is deterministic for identical evidence", () => {
  const evidence = baseEvidence({ criticalCodeIssues: 1, teamRisk: { riskScore: 40 } });
  const r1 = computeProjectHealth(evidence);
  const r2 = computeProjectHealth(evidence);
  assert.deepStrictEqual(r1, r2);
});

/* 28 — healthScore always clamped to [0, 100] even under extreme inputs */
check("healthScore is always clamped to [0, 100]", () => {
  const worst = computeProjectHealth(
    baseEvidence({
      teamRisk: { riskScore: 100, riskLevel: "CRITICAL" },
      forecast: { probability: 0, status: "CRITICAL", evidence: { completionRate: 0, overdueTasks: 10, stalledTasks: 10, pendingReviews: 10 } },
      originality: { duplicateCount: 5, highSeverityCount: 5, possibleSeverityCount: 5 },
      criticalCodeIssues: 20,
    })
  );
  assert.ok(worst.healthScore >= 0 && worst.healthScore <= 100);

  const best = computeProjectHealth(baseEvidence({ teamRisk: { riskScore: 0 }, forecast: { probability: 100, evidence: { completionRate: 100 } } }));
  assert.ok(best.healthScore >= 0 && best.healthScore <= 100);
});

console.log(`\n${passed} passed`);
