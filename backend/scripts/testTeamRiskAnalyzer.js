/**
 * Standalone tests for Step 15 — AI Team Risk & Early Warning System.
 * No DB / no server / no live AI engine needed — exercises the pure
 * scoring functions in services/teamRiskAnalyzer.js directly with hand-built
 * evidence objects, exactly like backend/scripts/testPlagiarismAnalyzer.js
 * does for its pure evaluate()/compareFingerprints() functions.
 *
 * Run: node backend/scripts/testTeamRiskAnalyzer.js
 */
const assert = require("assert");
const {
  computeTeamRisk,
  computeStudentRisk,
  buildWarnings,
  determineTrend,
} = require("../src/services/teamRiskAnalyzer");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-08-30T12:00:00Z");

/** Builds a minimal-but-complete evidence object; overrides are shallow-merged
 * per top-level key so each test only has to specify what it cares about. */
function baseEvidence(overrides = {}) {
  const evidence = {
    groupId: "g1",
    groupName: "Team Alpha",
    generatedAt: NOW,
    members: ["u1", "u2"],
    tasks: {
      total: 5,
      completed: 3,
      overdue: 0,
      dueSoonNoProgress: 0,
      stalled: 0,
      completionRatio: 0.6,
    },
    submissions: {
      awaitingReview: 0,
      changesRequestedTasks: 0,
      repeatedChangesTasks: 0,
      rejected: 0,
      wrongProjectOrUnreadable: 0,
    },
    collaboration: {
      messagesThisWeek: 20,
      messagesLastWeek: 20,
      daysSinceActivity: 1,
    },
    originality: {
      duplicateCount: 0,
      highSeverityCount: 0,
      possibleSeverityCount: 0,
      flaggedSubmissions: [],
    },
    perStudent: {
      u1: {
        assigned: 3,
        completed: 2,
        overdue: 0,
        inProgress: 1,
        stalled: 0,
        pendingSubmissionReview: 0,
        changesRequested: 0,
        rejected: 0,
      },
      u2: {
        assigned: 2,
        completed: 1,
        overdue: 0,
        inProgress: 1,
        stalled: 0,
        pendingSubmissionReview: 0,
        changesRequested: 0,
        rejected: 0,
      },
    },
    riskyTasks: [],
    history: [],
  };
  for (const [k, v] of Object.entries(overrides)) {
    evidence[k] = typeof v === "object" && !Array.isArray(v) ? { ...evidence[k], ...v } : v;
  }
  return evidence;
}

/* 1 — healthy team -> LOW */
check("healthy team scores LOW", () => {
  const result = computeTeamRisk(baseEvidence());
  assert.strictEqual(result.riskLevel, "LOW");
  assert.ok(result.riskScore < 25, `expected score < 25, got ${result.riskScore}`);
});

/* 2 — moderate warning signals -> MODERATE */
check("moderate signals score MODERATE", () => {
  const evidence = baseEvidence({
    tasks: { overdue: 3, stalled: 1 },
    submissions: { awaitingReview: 2 },
  });
  const result = computeTeamRisk(evidence);
  assert.strictEqual(result.riskLevel, "MODERATE");
});

/* 3 — multiple severe signals -> HIGH */
check("multiple severe signals score HIGH", () => {
  const evidence = baseEvidence({
    tasks: { overdue: 3, stalled: 2, completionRatio: 0.2, total: 6, completed: 1 },
    submissions: { changesRequestedTasks: 2, awaitingReview: 3 },
  });
  const result = computeTeamRisk(evidence);
  assert.strictEqual(result.riskLevel, "HIGH");
});

/* 4 — critical combination -> CRITICAL */
check("critical combination scores CRITICAL", () => {
  const evidence = baseEvidence({
    tasks: { overdue: 5, stalled: 3, completionRatio: 0.1, total: 10, completed: 1 },
    submissions: { rejected: 3, repeatedChangesTasks: 2, changesRequestedTasks: 3, awaitingReview: 5 },
    collaboration: { daysSinceActivity: 12, messagesThisWeek: 0, messagesLastWeek: 20 },
    originality: { duplicateCount: 1 },
  });
  const result = computeTeamRisk(evidence);
  assert.strictEqual(result.riskLevel, "CRITICAL");
  assert.ok(result.criticalRisks.length > 0, "expected at least one CRITICAL-severity warning");
});

/* 5 — no tasks/activity -> INSUFFICIENT_DATA, never fabricated */
check("no tasks or activity -> INSUFFICIENT_DATA", () => {
  const evidence = baseEvidence({
    tasks: { total: 0, completed: 0, overdue: 0, dueSoonNoProgress: 0, stalled: 0, completionRatio: null },
    collaboration: { messagesThisWeek: 0, messagesLastWeek: 0, daysSinceActivity: null },
  });
  const result = computeTeamRisk(evidence);
  assert.strictEqual(result.riskLevel, "INSUFFICIENT_DATA");
  assert.strictEqual(result.riskScore, 0);
  assert.deepStrictEqual(result.warnings, []);
});

/* 6 — overdue tasks increase risk monotonically */
check("overdue tasks increase risk score", () => {
  const low = computeTeamRisk(baseEvidence({ tasks: { overdue: 0 } }));
  const high = computeTeamRisk(baseEvidence({ tasks: { overdue: 3 } }));
  assert.ok(high.riskScore > low.riskScore);
  assert.ok(high.reasons.some((r) => r.includes("overdue")));
});

/* 7 — pending submissions increase risk */
check("submissions awaiting review increase risk score", () => {
  const low = computeTeamRisk(baseEvidence({ submissions: { awaitingReview: 0 } }));
  const high = computeTeamRisk(baseEvidence({ submissions: { awaitingReview: 4 } }));
  assert.ok(high.riskScore > low.riskScore);
});

/* 8 — repeated changes requested increase risk beyond a single change */
check("repeated changes requested increase risk score", () => {
  const single = computeTeamRisk(baseEvidence({ submissions: { changesRequestedTasks: 1 } }));
  const repeated = computeTeamRisk(
    baseEvidence({ submissions: { changesRequestedTasks: 1, repeatedChangesTasks: 1 } })
  );
  assert.ok(repeated.riskScore > single.riskScore);
  const warnings = buildWarnings(baseEvidence({ submissions: { changesRequestedTasks: 1, repeatedChangesTasks: 1 } }));
  assert.ok(warnings.some((w) => w.type === "REPEATED_CHANGES_REQUESTED"));
});

/* 9 — low collaboration alone must not push risk to CRITICAL unfairly */
check("low collaboration alone does not create unfair CRITICAL risk", () => {
  const evidence = baseEvidence({
    collaboration: { messagesThisWeek: 2, messagesLastWeek: 20, daysSinceActivity: 2 },
  });
  const result = computeTeamRisk(evidence);
  assert.notStrictEqual(result.riskLevel, "CRITICAL");
  assert.ok(result.riskScore <= 15, `collaboration-only category must stay <= 15 pts, got ${result.riskScore}`);
});

/* 10 — new student with no assigned work is never marked high-risk (Feature 5) */
check("student with no assigned tasks is not marked high-risk", () => {
  const evidence = baseEvidence({ members: ["u1", "u2", "u3"] });
  // u3 deliberately has no entry in perStudent (never assigned anything)
  const result = computeStudentRisk(evidence, "u3");
  assert.strictEqual(result.riskLevel, "ON_TRACK");
  assert.strictEqual(result.riskScore, 0);
  assert.ok(result.reasons[0].toLowerCase().includes("no tasks"));
});

/* 11 — workload differences are respected (a lightly-loaded student with 1
 * on-time task is not penalized the same as a heavily-loaded one) */
check("workload differences are respected in student risk", () => {
  const evidence = baseEvidence({
    perStudent: {
      light: { assigned: 1, completed: 1, overdue: 0, inProgress: 0, stalled: 0, pendingSubmissionReview: 0, changesRequested: 0, rejected: 0 },
      heavy: { assigned: 6, completed: 1, overdue: 3, inProgress: 2, stalled: 1, pendingSubmissionReview: 0, changesRequested: 1, rejected: 0 },
    },
  });
  const light = computeStudentRisk(evidence, "light");
  const heavy = computeStudentRisk(evidence, "heavy");
  assert.strictEqual(light.riskLevel, "ON_TRACK");
  assert.ok(heavy.riskScore > light.riskScore);
  assert.notStrictEqual(heavy.riskLevel, "ON_TRACK");
});

/* 12 — a duplicate/plagiarism warning only ever contributes as a review
 * signal (recommendation says "review", never an accusation) */
check("duplicate warning contributes only as a review signal", () => {
  const evidence = baseEvidence({ originality: { duplicateCount: 1 } });
  const warnings = buildWarnings(evidence);
  const w = warnings.find((x) => x.type === "DUPLICATE_SUBMISSION_RISK");
  assert.ok(w, "expected a DUPLICATE_SUBMISSION_RISK warning");
  assert.ok(/review/i.test(w.recommendation));
  assert.ok(/not proof of misconduct|not automatic misconduct/i.test(w.description), "must explicitly disclaim misconduct, not assert it");
});

/* 13 — risk trend improving */
check("risk trend reports IMPROVING when score dropped", () => {
  const trend = determineTrend(40, [{ score: 68, level: "HIGH", generatedAt: NOW }]);
  assert.strictEqual(trend.trend, "IMPROVING");
  assert.strictEqual(trend.previousScore, 68);
});

/* 14 — risk trend worsening */
check("risk trend reports WORSENING when score rose", () => {
  const trend = determineTrend(70, [{ score: 40, level: "MODERATE", generatedAt: NOW }]);
  assert.strictEqual(trend.trend, "WORSENING");
});

/* 15 — insufficient historical data never fabricates a trend */
check("risk trend reports INSUFFICIENT_DATA with no history", () => {
  const trend = determineTrend(55, []);
  assert.strictEqual(trend.trend, "INSUFFICIENT_DATA");
  assert.strictEqual(trend.previousScore, null);
});

/* 16 — cross-group isolation: evidence for one group never leaks into
 * another group's computation (pure functions only ever see what's passed) */
check("cross-group isolation — each group's evidence is independent", () => {
  const groupA = baseEvidence({ groupId: "gA", tasks: { overdue: 5, stalled: 2 } });
  const groupB = baseEvidence({ groupId: "gB", tasks: { overdue: 0 } });
  const resultA = computeTeamRisk(groupA);
  const resultB = computeTeamRisk(groupB);
  assert.notStrictEqual(resultA.riskLevel, resultB.riskLevel);
  assert.strictEqual(groupB.tasks.overdue, 0, "groupB evidence must be untouched by groupA's computation");
});

/* 17 — missing optional metrics degrade gracefully instead of throwing */
check("missing optional metrics do not throw", () => {
  const evidence = baseEvidence();
  delete evidence.originality.flaggedSubmissions;
  delete evidence.riskyTasks;
  assert.doesNotThrow(() => computeTeamRisk(evidence));
});

/* 18 — deterministic: same input always produces the same output */
check("same evidence produces deterministic output", () => {
  const evidence = baseEvidence({ tasks: { overdue: 2, stalled: 1 }, submissions: { rejected: 1 } });
  const r1 = computeTeamRisk(JSON.parse(JSON.stringify(evidence)));
  const r2 = computeTeamRisk(JSON.parse(JSON.stringify(evidence)));
  assert.deepStrictEqual(r1, r2);
});

console.log(`\n${passed} passed`);
