/**
 * Standalone tests for STEP 22 — AI Team Performance Insights.
 * No DB / no server needed — exercises the pure functions in
 * services/teamPerformanceService.js (computeMemberPerformance,
 * computeTeamPerformance, analyzeTeamPerformance, determinePerformanceTrend,
 * shouldNotifyPerformanceChange, shapeForStudent, and the individual
 * category scorers) directly with hand-built evidence objects, exactly
 * like backend/scripts/testProjectExecutionCopilot.js does for Step 21.
 *
 * Run: node backend/scripts/testTeamPerformance.js
 */
const assert = require("assert");
const {
  computeMemberPerformance,
  computeTeamPerformance,
  analyzeTeamPerformance,
  determinePerformanceTrend,
  shouldNotifyPerformanceChange,
  shapeForStudent,
  classifyPerformanceLevel,
  scoreTaskExecution,
  scoreDeadlineReliability,
  scoreSubmissionQuality,
  scoreCodeQuality,
  scoreCollaboration,
  detectStrengths,
  detectImprovementAreas,
} = require("../src/services/teamPerformanceService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

/** Minimal-but-complete "student with solid, average evidence" record.
 * Overrides are shallow-merged so each test only specifies what it cares
 * about — mirrors testProjectExecutionCopilot.js#baseEvidence. */
function baseStudent(overrides = {}) {
  return {
    studentId: "s1",
    studentName: "Alex",
    assigned: 5,
    completed: 4,
    overdue: 0,
    stalled: 0,
    pendingSubmissionReview: 0,
    avgCompletionDays: 2,
    dueCompletedCount: 4,
    onTimeCount: 4,
    reviewedApproved: 4,
    reviewedRejected: 0,
    reviewedChangesRequested: 0,
    avgCodeReviewScore: 90,
    plagiarismFlagCount: 0,
    collaboration: { riskScore: 10, riskLevel: "LOW", flags: [], hasHistory: true },
    earlyWarningCount: 0,
    riskStatus: { riskLevel: "LOW", riskScore: 5 },
    ...overrides,
  };
}

/* 1 — empty evidence (zero members) never throws */
check("computeTeamPerformance handles zero members without throwing", () => {
  const result = computeTeamPerformance({ groupId: "g1", groupName: "G", generatedAt: new Date(), members: [], perStudent: {} });
  assert.deepStrictEqual(result.members, []);
});

/* 2 — a member with zero assigned tasks is INSUFFICIENT_DATA, never penalized */
check("zero assigned tasks -> INSUFFICIENT_DATA, score null (never a penalty)", () => {
  const result = computeMemberPerformance(baseStudent({ assigned: 0, completed: 0, dueCompletedCount: 0, onTimeCount: 0 }));
  assert.strictEqual(result.performanceLevel, "INSUFFICIENT_DATA");
  assert.strictEqual(result.performanceScore, null);
});

/* 3 — one member, solid evidence -> a real score in a sane range */
check("one member with solid evidence produces a score between 70 and 100", () => {
  const result = computeMemberPerformance(baseStudent());
  assert.ok(result.performanceScore >= 70 && result.performanceScore <= 100, `got ${result.performanceScore}`);
});

/* 4 — multiple members: computeTeamPerformance produces one result per member */
check("multiple members each get their own performance result", () => {
  const evidence = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: ["s1", "s2"],
    perStudent: { s1: baseStudent({ studentId: "s1" }), s2: baseStudent({ studentId: "s2", assigned: 2, completed: 1 }) },
  };
  const result = computeTeamPerformance(evidence);
  assert.strictEqual(result.members.length, 2);
  assert.strictEqual(result.members[0].studentId, "s1");
  assert.strictEqual(result.members[1].studentId, "s2");
});

/* 5 — task completion: full completion earns the full 30-point category */
check("100% task completion earns the full 30-point Task Execution category", () => {
  const score = scoreTaskExecution(baseStudent({ assigned: 4, completed: 4 }));
  assert.strictEqual(score, 30);
});

/* 5b — task completion: zero completion earns 0 in that category */
check("0% task completion earns 0 in Task Execution category", () => {
  const score = scoreTaskExecution(baseStudent({ assigned: 4, completed: 0 }));
  assert.strictEqual(score, 0);
});

/* 6 — deadline reliability: perfect on-time record earns the full 20 */
check("100% on-time completion earns the full 20-point Deadline Reliability category", () => {
  const score = scoreDeadlineReliability(baseStudent({ dueCompletedCount: 3, onTimeCount: 3, overdue: 0 }));
  assert.strictEqual(score, 20);
});

/* 6b — deadline reliability: currently-overdue tasks deduct, capped at -12 */
check("overdue tasks deduct from Deadline Reliability, capped at -12", () => {
  const light = scoreDeadlineReliability(baseStudent({ dueCompletedCount: 0, onTimeCount: 0, overdue: 1 }));
  const heavy = scoreDeadlineReliability(baseStudent({ dueCompletedCount: 0, onTimeCount: 0, overdue: 10 }));
  assert.strictEqual(light, 16); // 20 - 4
  assert.strictEqual(heavy, 8); // 20 - 12 (capped), never below 0-20 range issues
});

/* 7 — blocked tasks: stalled count alone must not reduce Task Execution or Deadline categories */
check("blocked/stalled tasks (not overdue) do not reduce Task Execution or Deadline scores", () => {
  const student = baseStudent({ assigned: 4, completed: 2, stalled: 2, overdue: 0, dueCompletedCount: 2, onTimeCount: 2 });
  const taskExec = scoreTaskExecution(student);
  const deadline = scoreDeadlineReliability(student);
  assert.strictEqual(taskExec, 15); // 30 * 2/4, unaffected by "stalled"
  assert.strictEqual(deadline, 20); // no overdue -> no deduction
});

/* 8 — pending reviews (awaiting a guide) are excluded from the denominator, never penalized */
check("submissions still awaiting review do not lower Submission Quality (excluded, not penalized)", () => {
  const score = scoreSubmissionQuality(baseStudent({ reviewedApproved: 0, reviewedRejected: 0, reviewedChangesRequested: 0, pendingSubmissionReview: 5 }));
  assert.strictEqual(score, 20); // full baseline — nothing reviewed yet
});

/* 9 — rejected submissions lower Submission Quality */
check("rejected submissions lower the Submission Quality score", () => {
  const clean = scoreSubmissionQuality(baseStudent({ reviewedApproved: 4, reviewedRejected: 0, reviewedChangesRequested: 0 }));
  const withRejections = scoreSubmissionQuality(baseStudent({ reviewedApproved: 2, reviewedRejected: 2, reviewedChangesRequested: 0 }));
  assert.ok(withRejections < clean);
});

/* 9b — changes-requested gets half credit, not zero (it's iterative feedback, not failure) */
check("changes-requested submissions get half credit, better than a rejection but below approval", () => {
  const approved = scoreSubmissionQuality(baseStudent({ reviewedApproved: 2, reviewedRejected: 0, reviewedChangesRequested: 0 }));
  const changesRequested = scoreSubmissionQuality(baseStudent({ reviewedApproved: 0, reviewedRejected: 0, reviewedChangesRequested: 2 }));
  const rejected = scoreSubmissionQuality(baseStudent({ reviewedApproved: 0, reviewedRejected: 2, reviewedChangesRequested: 0 }));
  assert.ok(rejected < changesRequested);
  assert.ok(changesRequested < approved);
});

/* 10 — code quality: score scales linearly with avgCodeReviewScore/100 */
check("code quality score scales with avgCodeReviewScore", () => {
  const perfect = scoreCodeQuality(baseStudent({ avgCodeReviewScore: 100 }));
  const poor = scoreCodeQuality(baseStudent({ avgCodeReviewScore: 40 }));
  assert.strictEqual(perfect, 15);
  assert.strictEqual(poor, 6); // 15 * 0.4
});

/* 10b — code quality: no code-review data yet -> full baseline, never penalized */
check("missing code-review data defaults to the full 15-point Code Quality baseline", () => {
  const score = scoreCodeQuality(baseStudent({ avgCodeReviewScore: null }));
  assert.strictEqual(score, 15);
});

/* 11 — collaboration: low collaboration risk earns close to the full 15 */
check("low collaboration risk score earns close to the full Collaboration category", () => {
  const score = scoreCollaboration(baseStudent({ collaboration: { riskScore: 0, riskLevel: "LOW", hasHistory: true } }));
  assert.strictEqual(score, 15);
});

/* 11b — collaboration: no message history yet -> full baseline, never penalized */
check("no message history yet defaults to the full 15-point Collaboration baseline", () => {
  const score = scoreCollaboration(baseStudent({ collaboration: { riskScore: 80, riskLevel: "HIGH", hasHistory: false } }));
  assert.strictEqual(score, 15);
});

/* 12 — normalization / fairness: fewer assigned tasks is not automatically penalized */
check("a member with fewer assigned tasks is not penalized relative to a member with more, given equal completion rate", () => {
  const fewer = computeMemberPerformance(baseStudent({ studentId: "s1", assigned: 2, completed: 2, dueCompletedCount: 2, onTimeCount: 2 }));
  const more = computeMemberPerformance(baseStudent({ studentId: "s2", assigned: 8, completed: 8, dueCompletedCount: 8, onTimeCount: 8 }));
  assert.strictEqual(fewer.performanceScore, more.performanceScore);
});

/* 13 — score caps: performanceScore never exceeds 100 even with extreme positive evidence */
check("performanceScore never exceeds 100 even with maximal evidence", () => {
  const result = computeMemberPerformance(
    baseStudent({ assigned: 10, completed: 10, dueCompletedCount: 10, onTimeCount: 10, overdue: 0, avgCodeReviewScore: 100, collaboration: { riskScore: 0, riskLevel: "LOW", hasHistory: true } })
  );
  assert.ok(result.performanceScore <= 100);
});

/* 13b — score caps: performanceScore never goes below 0 even with extreme negative evidence */
check("performanceScore never goes below 0 even with maximal negative evidence", () => {
  const result = computeMemberPerformance(
    baseStudent({
      assigned: 10,
      completed: 0,
      dueCompletedCount: 10,
      onTimeCount: 0,
      overdue: 10,
      reviewedApproved: 0,
      reviewedRejected: 10,
      reviewedChangesRequested: 0,
      avgCodeReviewScore: 0,
      collaboration: { riskScore: 100, riskLevel: "CRITICAL", hasHistory: true },
    })
  );
  assert.ok(result.performanceScore >= 0);
});

/* 14 — thresholds: classifyPerformanceLevel boundaries are exact and documented */
check("classifyPerformanceLevel boundaries match the documented thresholds", () => {
  assert.strictEqual(classifyPerformanceLevel(85), "EXCEPTIONAL");
  assert.strictEqual(classifyPerformanceLevel(84), "STRONG");
  assert.strictEqual(classifyPerformanceLevel(70), "STRONG");
  assert.strictEqual(classifyPerformanceLevel(69), "ON_TRACK");
  assert.strictEqual(classifyPerformanceLevel(50), "ON_TRACK");
  assert.strictEqual(classifyPerformanceLevel(49), "NEEDS_IMPROVEMENT");
  assert.strictEqual(classifyPerformanceLevel(0), "NEEDS_IMPROVEMENT");
});

/* 15 — strengths: CONSISTENT_TASK_COMPLETION only fires with enough samples */
check("CONSISTENT_TASK_COMPLETION requires both a high rate and a minimum sample size", () => {
  const tooFew = detectStrengths(baseStudent({ assigned: 2, completed: 2 }));
  const enough = detectStrengths(baseStudent({ assigned: 4, completed: 4 }));
  assert.ok(!tooFew.includes("CONSISTENT_TASK_COMPLETION"));
  assert.ok(enough.includes("CONSISTENT_TASK_COMPLETION"));
});

/* 15b — strengths: only returned when evidence genuinely supports them */
check("strengths are only returned when supported by evidence (no code-review data -> no STRONG_CODE_QUALITY)", () => {
  const strengths = detectStrengths(baseStudent({ avgCodeReviewScore: null }));
  assert.ok(!strengths.includes("STRONG_CODE_QUALITY"));
});

/* 16 — improvement areas: neutral, evidence-based, never fires without a real signal */
check("improvement areas are empty for a clean, solid record", () => {
  const areas = detectImprovementAreas(baseStudent());
  assert.deepStrictEqual(areas, []);
});

/* 16b — improvement areas: DEADLINE_CONSISTENCY fires on repeated overdue tasks */
check("DEADLINE_CONSISTENCY fires when a member has 2+ currently-overdue tasks", () => {
  const areas = detectImprovementAreas(baseStudent({ overdue: 2 }));
  assert.ok(areas.includes("DEADLINE_CONSISTENCY"));
});

/* 16c — improvement area labels are never insulting/psychological (spot check against a fixed allow-list) */
check("improvement area labels stay within the documented neutral vocabulary", () => {
  const allowed = new Set(["DEADLINE_CONSISTENCY", "TASK_COMPLETION", "CODE_QUALITY", "REVIEW_QUALITY", "COLLABORATION", "TASK_ESTIMATION"]);
  const areas = detectImprovementAreas(
    baseStudent({ assigned: 5, completed: 1, overdue: 3, avgCodeReviewScore: 30, reviewedApproved: 0, reviewedRejected: 3, reviewedChangesRequested: 0, stalled: 3, collaboration: { riskScore: 90, riskLevel: "CRITICAL", hasHistory: true } })
  );
  for (const a of areas) assert.ok(allowed.has(a), `unexpected area label: ${a}`);
});

/* 17 — recommendations: deterministic — same evidence always yields the same recommendedAction */
check("recommendedAction is deterministic for identical evidence", () => {
  const s = baseStudent({ overdue: 3 });
  const r1 = computeMemberPerformance(s).recommendedAction;
  const r2 = computeMemberPerformance(s).recommendedAction;
  assert.strictEqual(r1, r2);
});

/* 17b — recommendations: a strong performer with no issues is nudged toward more challenge */
check("a STRONG/EXCEPTIONAL performer with no improvement areas gets a 'take a harder task' nudge", () => {
  const result = computeMemberPerformance(baseStudent());
  assert.ok(result.performanceLevel === "STRONG" || result.performanceLevel === "EXCEPTIONAL");
  assert.match(result.recommendedAction, /challenging task/);
});

/* 18 — trend: IMPROVING when score rises 5+ since the last snapshot */
check("trend is IMPROVING when overall score rises by 5+", () => {
  const { trend } = determinePerformanceTrend(85, [{ overallPerformanceScore: 75 }]);
  assert.strictEqual(trend, "IMPROVING");
});

/* 18b — trend: DECLINING when score drops 5+ */
check("trend is DECLINING when overall score drops by 5+", () => {
  const { trend } = determinePerformanceTrend(65, [{ overallPerformanceScore: 78 }]);
  assert.strictEqual(trend, "DECLINING");
});

/* 18c — trend: STABLE within tolerance, INSUFFICIENT_DATA with no history */
check("trend is STABLE within +-5 tolerance and INSUFFICIENT_DATA with no history", () => {
  assert.strictEqual(determinePerformanceTrend(80, [{ overallPerformanceScore: 78 }]).trend, "STABLE");
  assert.strictEqual(determinePerformanceTrend(80, []).trend, "INSUFFICIENT_DATA");
});

/* 19 — team aggregation: overall score is the average of scored members only */
check("team aggregation averages only members with a real score, ignoring INSUFFICIENT_DATA members", () => {
  const teamResult = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: [
      computeMemberPerformance(baseStudent({ studentId: "s1", assigned: 4, completed: 4, dueCompletedCount: 4, onTimeCount: 4, avgCodeReviewScore: 100, collaboration: { riskScore: 0, riskLevel: "LOW", hasHistory: true } })),
      computeMemberPerformance(baseStudent({ studentId: "s2", assigned: 0, completed: 0 })),
    ],
  };
  const result = analyzeTeamPerformance(teamResult, []);
  assert.strictEqual(result.overallPerformanceScore, teamResult.members[0].performanceScore);
});

/* 19b — team aggregation: no scored members at all -> team-level INSUFFICIENT_DATA */
check("team-level INSUFFICIENT_DATA when no member has a score yet", () => {
  const teamResult = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: [computeMemberPerformance(baseStudent({ studentId: "s1", assigned: 0 }))],
  };
  const result = analyzeTeamPerformance(teamResult, []);
  assert.strictEqual(result.performanceLevel, "INSUFFICIENT_DATA");
  assert.strictEqual(result.overallPerformanceScore, null);
});

/* 20 — student privacy shaping: shapeForStudent returns only the caller's own record */
check("shapeForStudent returns only the requesting student's own performance", () => {
  const teamResult = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: [computeMemberPerformance(baseStudent({ studentId: "s1" })), computeMemberPerformance(baseStudent({ studentId: "s2", assigned: 1, completed: 0 }))],
  };
  const result = analyzeTeamPerformance(teamResult, []);
  const shaped = shapeForStudent(result, "s1");
  const serialized = JSON.stringify(shaped);
  assert.ok(shaped.myPerformance);
  assert.ok(!/"s2"/.test(serialized));
  assert.strictEqual(Object.keys(shaped).length, 1); // only `myPerformance` — no `members`/`memberSummaries` leak
});

/* 20b — student privacy shaping: a student with no record gets a safe INSUFFICIENT_DATA shape, never an error */
check("shapeForStudent degrades gracefully for a student with no performance record yet", () => {
  const teamResult = { groupId: "g1", groupName: "G", generatedAt: new Date(), members: [computeMemberPerformance(baseStudent({ studentId: "s1" }))] };
  const result = analyzeTeamPerformance(teamResult, []);
  const shaped = shapeForStudent(result, "s999");
  assert.strictEqual(shaped.myPerformance.performanceLevel, "INSUFFICIENT_DATA");
});

/* 21 — deterministic output: identical evidence always yields an identical result */
check("computeMemberPerformance output is deterministic for identical evidence", () => {
  const s = baseStudent({ overdue: 1, avgCodeReviewScore: 72 });
  const r1 = computeMemberPerformance(JSON.parse(JSON.stringify(s)));
  const r2 = computeMemberPerformance(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(r1, r2);
});

/* 22 — missing fields: sparse evidence does not throw */
check("missing optional fields do not throw", () => {
  assert.doesNotThrow(() => computeMemberPerformance({ studentId: "s1", assigned: 3, completed: 2 }));
});

/* 23 — zero assigned tasks across the whole team never crashes team analysis */
check("a team where every member has zero assigned tasks does not throw", () => {
  const teamResult = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: [computeMemberPerformance(baseStudent({ studentId: "s1", assigned: 0 })), computeMemberPerformance(baseStudent({ studentId: "s2", assigned: 0 }))],
  };
  assert.doesNotThrow(() => analyzeTeamPerformance(teamResult, []));
});

/* 24 — unequal workloads: a member with 2 tasks (both done) can outscore one with 10 tasks (half done) */
check("unequal workloads: completion RATE drives the score, not raw task count", () => {
  const small = computeMemberPerformance(baseStudent({ studentId: "s1", assigned: 2, completed: 2, dueCompletedCount: 2, onTimeCount: 2 }));
  const large = computeMemberPerformance(baseStudent({ studentId: "s2", assigned: 10, completed: 5, dueCompletedCount: 5, onTimeCount: 5 }));
  assert.ok(small.performanceScore > large.performanceScore);
});

/* 25 — regression: notification fires on a genuine first NEEDS_IMPROVEMENT appearance */
check("notification fires on first-ever escalation into NEEDS_IMPROVEMENT", () => {
  const result = { performanceLevel: "NEEDS_IMPROVEMENT", membersNeedingAttention: [{ studentId: "s1" }] };
  const previous = { lastNotifiedLevel: null, membersNeedingAttentionCount: 0 };
  assert.strictEqual(shouldNotifyPerformanceChange(result, previous), true);
});

/* 25b — regression: no repeat notification when nothing changed */
check("notification does not repeat when level/attention count are unchanged", () => {
  const result = { performanceLevel: "NEEDS_IMPROVEMENT", membersNeedingAttention: [{ studentId: "s1" }] };
  const previous = { lastNotifiedLevel: "NEEDS_IMPROVEMENT", membersNeedingAttentionCount: 1 };
  assert.strictEqual(shouldNotifyPerformanceChange(result, previous), false);
});

/* 25c — regression: escalation from STRONG to NEEDS_IMPROVEMENT fires */
check("notification fires on STRONG -> NEEDS_IMPROVEMENT escalation", () => {
  const result = { performanceLevel: "NEEDS_IMPROVEMENT", membersNeedingAttention: [] };
  const previous = { lastNotifiedLevel: "STRONG", membersNeedingAttentionCount: 0 };
  assert.strictEqual(shouldNotifyPerformanceChange(result, previous), true);
});

/* 25d — regression: a newly-appeared attention case fires even without a level escalation */
check("notification fires when a new member-needing-attention appears, even if team level is unchanged", () => {
  const result = { performanceLevel: "ON_TRACK", membersNeedingAttention: [{ studentId: "s1" }] };
  const previous = { lastNotifiedLevel: "ON_TRACK", membersNeedingAttentionCount: 0 };
  assert.strictEqual(shouldNotifyPerformanceChange(result, previous), true);
});

/* 26 — plagiarism/originality signal is carried through to metrics without affecting the score directly */
check("plagiarismFlagCount is surfaced in metrics for guide review, without silently zeroing the score", () => {
  const result = computeMemberPerformance(baseStudent({ plagiarismFlagCount: 2 }));
  assert.strictEqual(result.metrics.plagiarismFlagCount, 2);
  assert.ok(result.performanceScore > 0);
});

/* 27 — early-warning count and risk status pass through to metrics untouched */
check("earlyWarningCount and riskStatus are passed through to metrics as-is", () => {
  const result = computeMemberPerformance(baseStudent({ earlyWarningCount: 3, riskStatus: { riskLevel: "AT_RISK", riskScore: 55 } }));
  assert.strictEqual(result.metrics.earlyWarningCount, 3);
  assert.strictEqual(result.metrics.riskStatus, "AT_RISK");
});

/* 28 — team-level topStrengths/topImprovementAreas are tallied, most-common-first */
check("topStrengths tallies the most common strength across members first", () => {
  const teamResult = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: [
      computeMemberPerformance(baseStudent({ studentId: "s1" })),
      computeMemberPerformance(baseStudent({ studentId: "s2" })),
      computeMemberPerformance(baseStudent({ studentId: "s3", assigned: 1, completed: 1, dueCompletedCount: 0, onTimeCount: 0, avgCodeReviewScore: null })),
    ],
  };
  const result = analyzeTeamPerformance(teamResult, []);
  assert.strictEqual(result.topStrengths.length, 3);
  // s1 and s2 are identical strong records; s3 is a partial record that
  // still qualifies for HIGH_REVIEW_SUCCESS/GOOD_COLLABORATION/
  // TASK_OWNERSHIP/QUICK_TURNAROUND (3 votes each) but not
  // CONSISTENT_TASK_COMPLETION/DEADLINE_RELIABILITY/STRONG_CODE_QUALITY
  // (2 votes each, since those need thresholds s3 doesn't meet) — so the
  // most-common strength is deterministically one of the 3-vote group.
  assert.ok(result.topStrengths.includes("HIGH_REVIEW_SUCCESS"));
});

/* 29 — recommendedTeamActions only include actions for areas actually present */
check("recommendedTeamActions only reference improvement areas actually detected in the team", () => {
  const teamResult = {
    groupId: "g1",
    groupName: "G",
    generatedAt: new Date(),
    members: [computeMemberPerformance(baseStudent({ studentId: "s1" }))],
  };
  const result = analyzeTeamPerformance(teamResult, []);
  assert.deepStrictEqual(result.recommendedTeamActions, []); // clean record -> no team actions invented
});

/* 30 — membersNeedingAttention is capped and sorted by ascending score (worst first) */
check("membersNeedingAttention is sorted worst-score-first and capped at 5", () => {
  const members = [];
  for (let i = 0; i < 7; i += 1) {
    members.push(
      computeMemberPerformance(
        baseStudent({ studentId: `low${i}`, assigned: 5, completed: 1, dueCompletedCount: 5, onTimeCount: 0, overdue: 5, avgCodeReviewScore: 20, reviewedApproved: 0, reviewedRejected: 5, collaboration: { riskScore: 90, riskLevel: "CRITICAL", hasHistory: true } })
      )
    );
  }
  const teamResult = { groupId: "g1", groupName: "G", generatedAt: new Date(), members };
  const result = analyzeTeamPerformance(teamResult, []);
  assert.ok(result.membersNeedingAttention.length <= 5);
  for (let i = 1; i < result.membersNeedingAttention.length; i += 1) {
    assert.ok(result.membersNeedingAttention[i].performanceScore >= result.membersNeedingAttention[i - 1].performanceScore);
  }
});

/* 31 — strongestContributors is capped at 3 and sorted descending */
check("strongestContributors is sorted best-score-first and capped at 3", () => {
  const members = [];
  for (let i = 0; i < 5; i += 1) {
    members.push(computeMemberPerformance(baseStudent({ studentId: `top${i}`, assigned: 4, completed: 4, dueCompletedCount: 4, onTimeCount: 4 - i, avgCodeReviewScore: 100 - i * 5 })));
  }
  const teamResult = { groupId: "g1", groupName: "G", generatedAt: new Date(), members };
  const result = analyzeTeamPerformance(teamResult, []);
  assert.strictEqual(result.strongestContributors.length, 3);
  for (let i = 1; i < result.strongestContributors.length; i += 1) {
    assert.ok(result.strongestContributors[i].performanceScore <= result.strongestContributors[i - 1].performanceScore);
  }
});

/* 32 — Team Risk's own formula/exports are never touched by requiring this module (regression safety net) */
check("requiring teamPerformanceService does not alter teamRiskAnalyzer's exports", () => {
  const before = require("../src/services/teamRiskAnalyzer");
  const beforeKeys = Object.keys(before).sort();
  delete require.cache[require.resolve("../src/services/teamPerformanceService")];
  require("../src/services/teamPerformanceService");
  const after = require("../src/services/teamRiskAnalyzer");
  assert.deepStrictEqual(Object.keys(after).sort(), beforeKeys);
});

console.log(`\n${passed} passed`);
