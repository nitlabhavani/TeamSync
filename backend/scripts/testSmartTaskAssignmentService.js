/**
 * Standalone tests for STEP 17 — Feature 1: Smart Task Auto-Assignment.
 * No DB / no server needed — exercises the pure scoring functions in
 * services/smartTaskAssignmentService.js directly with hand-built evidence
 * objects, exactly like backend/scripts/testTeamRiskAnalyzer.js does.
 *
 * Run: node backend/scripts/testSmartTaskAssignmentService.js
 */
const assert = require("assert");
const {
  recommendAssignee,
  scoreTaskSimilarity,
  tokenize,
  canRequestRecommendation,
} = require("../src/services/smartTaskAssignmentService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

/** perStudent record with sane defaults, only overriding what a test cares about. */
function student(overrides = {}) {
  return {
    assigned: 0, completed: 0, overdue: 0, inProgress: 0, stalled: 0,
    pendingSubmissionReview: 0, changesRequested: 0, rejected: 0, lastActivityAt: null,
    ...overrides,
  };
}

/** Builds a { evidence, riskByStudent, titlesByStudent } context for N members. */
function context({ perStudent = {}, riskByStudent = {}, titlesByStudent = {} } = {}) {
  const members = Object.keys(perStudent);
  const evidence = { members, perStudent };
  members.forEach((id) => {
    if (!riskByStudent[id]) riskByStudent[id] = { studentId: id, riskLevel: "ON_TRACK" };
    if (!titlesByStudent[id]) titlesByStudent[id] = { completed: [], active: [] };
  });
  return { evidence, riskByStudent, titlesByStudent };
}

const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * 86400000);

/* 1 — lowest workload recommendation */
check("recommends the member with the lowest active workload", () => {
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 5, completed: 1 }), // 4 open
      u2: student({ assigned: 2, completed: 2 }), // 0 open
    },
  });
  const result = recommendAssignee(ctx, { title: "Build settings page" }, [
    { id: "u1", name: "Alex" },
    { id: "u2", name: "Bina" },
  ]);
  assert.strictEqual(result.recommendedStudent.id, "u2");
  assert.ok(result.reasons.some((r) => r.includes("Lowest active workload")));
});

/* 2 — high completion performer scores better than a low performer at equal workload */
check("high completion-rate member outscores a low performer at equal workload", () => {
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 4, completed: 4 }), // 100% completion, 0 open
      u2: student({ assigned: 4, completed: 1, rejected: 1 }), // 25% completion, 0 open... but rejected
    },
  });
  const result = recommendAssignee(ctx, { title: "Write API docs" }, [
    { id: "u1", name: "Alex" },
    { id: "u2", name: "Bina" },
  ]);
  assert.strictEqual(result.recommendedStudent.id, "u1");
});

/* 3 — task similarity: prior matching task titles raise the score */
check("task similarity: matching prior task titles raise the similarity score", () => {
  const match = scoreTaskSimilarity(tokenize("Build login page"), ["Implement login form validation"]);
  const noMatch = scoreTaskSimilarity(tokenize("Build login page"), ["Configure CI pipeline"]);
  assert.ok(match.score > 0, "expected a positive similarity score for overlapping titles");
  assert.strictEqual(noMatch.score, 0);
  assert.ok(match.score > noMatch.score);
});

check("task similarity influences the final recommendation", () => {
  const ctx = context({
    perStudent: { u1: student({ assigned: 2, completed: 2 }), u2: student({ assigned: 2, completed: 2 }) },
    titlesByStudent: {
      u1: { completed: ["Build login page UI", "Login form validation"], active: [] },
      u2: { completed: ["Configure CI pipeline", "Set up Docker"], active: [] },
    },
  });
  const result = recommendAssignee(ctx, { title: "Login authentication API" }, [
    { id: "u1", name: "Alex" },
    { id: "u2", name: "Bina" },
  ]);
  assert.strictEqual(result.recommendedStudent.id, "u1");
  assert.ok(result.reasons.some((r) => r.includes("overlaps")));
});

/* 4 — overloaded student penalty */
check("an overloaded member is penalized relative to a lightly loaded one", () => {
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 10, completed: 1, overdue: 3 }), // heavily overloaded + overdue
      u2: student({ assigned: 1, completed: 0 }),
    },
  });
  const result = recommendAssignee(ctx, { title: "New feature" }, [
    { id: "u1", name: "Alex" },
    { id: "u2", name: "Bina" },
  ]);
  assert.strictEqual(result.recommendedStudent.id, "u2");
  const alexRow = [result.recommendedStudent, ...result.alternatives].find((r) => r.studentId === "u1" || r.id === "u1");
  // Alex is the lower-scored alternative
  assert.strictEqual(result.alternatives[0].studentId, "u1");
  assert.ok(result.score > result.alternatives[0].score);
});

/* 5 — high-risk student penalty */
check("a CRITICAL-risk member scores lower than an ON_TRACK member with identical workload", () => {
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 2, completed: 2 }),
      u2: student({ assigned: 2, completed: 2 }),
    },
    riskByStudent: {
      u1: { studentId: "u1", riskLevel: "ON_TRACK" },
      u2: { studentId: "u2", riskLevel: "CRITICAL" },
    },
  });
  const result = recommendAssignee(ctx, { title: "New feature" }, [
    { id: "u1", name: "Alex" },
    { id: "u2", name: "Bina" },
  ]);
  assert.strictEqual(result.recommendedStudent.id, "u1");
  assert.strictEqual(result.alternatives[0].studentId, "u2");
  assert.ok(result.score > result.alternatives[0].score);
});

check("spec rule: avoid recommending AT_RISK/CRITICAL unless every alternative is worse", () => {
  // u1 is CRITICAL but massively better on every other signal than u2.
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 4, completed: 4 }),
      u2: student({ assigned: 4, completed: 0, overdue: 4, rejected: 2 }),
    },
    riskByStudent: {
      u1: { studentId: "u1", riskLevel: "CRITICAL" },
      u2: { studentId: "u2", riskLevel: "CRITICAL" },
    },
  });
  const result = recommendAssignee(ctx, { title: "New feature" }, [
    { id: "u1", name: "Alex" },
    { id: "u2", name: "Bina" },
  ]);
  // Both are CRITICAL (all alternatives are equally risky) — the better
  // performer on every other axis should still win.
  assert.strictEqual(result.recommendedStudent.id, "u1");
});

/* 6 — alternative recommendations are returned, sorted, and exclude the top pick */
check("returns ranked alternatives excluding the top recommendation", () => {
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 1, completed: 1 }),
      u2: student({ assigned: 3, completed: 1 }),
      u3: student({ assigned: 5, completed: 1 }),
    },
  });
  const result = recommendAssignee(ctx, { title: "New feature" }, [
    { id: "u1", name: "Alex" }, { id: "u2", name: "Bina" }, { id: "u3", name: "Cy" },
  ]);
  assert.strictEqual(result.alternatives.length, 2);
  assert.ok(!result.alternatives.some((a) => a.studentId === result.recommendedStudent.id));
  assert.ok(result.alternatives[0].score >= result.alternatives[1].score, "alternatives must be sorted desc");
});

/* 7 — deterministic scoring: same input -> same output, every time */
check("scoring is deterministic for identical input", () => {
  const ctx = context({
    perStudent: {
      u1: student({ assigned: 3, completed: 2, overdue: 1, lastActivityAt: daysAgo(1) }),
      u2: student({ assigned: 2, completed: 2, lastActivityAt: daysAgo(10) }),
    },
  });
  const task = { title: "Payment integration", description: "Stripe checkout" };
  const members = [{ id: "u1", name: "Alex" }, { id: "u2", name: "Bina" }];
  const r1 = recommendAssignee(ctx, task, members);
  const r2 = recommendAssignee(ctx, task, members);
  assert.deepStrictEqual(r1, r2);
});

/* 8 — no group members */
check("no group members -> graceful empty result, never crashes", () => {
  const ctx = context({ perStudent: {} });
  const result = recommendAssignee(ctx, { title: "New feature" }, []);
  assert.strictEqual(result.recommendedStudent, null);
  assert.strictEqual(result.score, null);
  assert.deepStrictEqual(result.alternatives, []);
  assert.ok(result.reasons.length > 0);
});

/* 9 — group isolation: a context built for one group never surfaces another
 * group's members, regardless of what member list is passed in. This is
 * the pure-function half of isolation; the HTTP half (a request for group A
 * cannot even reach group B's data) is enforced unchanged by the existing
 * requireGroupAccess middleware, which this feature does not modify. */
check("group isolation: scoring never reaches into evidence for members outside the given list", () => {
  const ctxGroupA = context({
    perStudent: {
      a1: student({ assigned: 1, completed: 1 }),
      a2: student({ assigned: 1, completed: 1 }),
    },
  });
  // Only pass group A's members, even though evidence could in principle
  // contain more — recommendAssignee must never invent a candidate that
  // wasn't in the members list.
  const result = recommendAssignee(ctxGroupA, { title: "Task" }, [{ id: "a1", name: "A1" }]);
  assert.strictEqual(result.recommendedStudent.id, "a1");
  assert.strictEqual(result.alternatives.length, 0);
  const allIds = [result.recommendedStudent.id, ...result.alternatives.map((a) => a.studentId)];
  assert.ok(!allIds.includes("a2"), "must never surface a member that wasn't passed in");
});

/* 10 — unauthorized access: only guide or team leader may request a recommendation */
check("unauthorized access: ordinary member (not guide, not leader) is rejected", () => {
  assert.strictEqual(
    canRequestRecommendation({ isGuide: false, groupLeaderId: "leader1", userId: "student1" }),
    false
  );
});
check("authorized access: guide is allowed", () => {
  assert.strictEqual(canRequestRecommendation({ isGuide: true, groupLeaderId: "leader1", userId: "u9" }), true);
});
check("authorized access: team leader is allowed", () => {
  assert.strictEqual(
    canRequestRecommendation({ isGuide: false, groupLeaderId: "leader1", userId: "leader1" }),
    true
  );
});
check("unauthorized access: group with no leader set never authorizes a non-guide", () => {
  assert.strictEqual(canRequestRecommendation({ isGuide: false, groupLeaderId: null, userId: "u1" }), false);
});

/* extra — never fabricates a similarity reason when there is no history */
check("does not fabricate a skill/similarity reason when a member has no task history", () => {
  const ctx = context({
    perStudent: { u1: student({ assigned: 0, completed: 0 }) },
  });
  const result = recommendAssignee(ctx, { title: "Payment integration" }, [{ id: "u1", name: "Alex" }]);
  assert.ok(
    !result.reasons.some((r) => r.toLowerCase().includes("overlap")),
    "must not claim task-similarity evidence that does not exist"
  );
});

console.log(`\n${passed} passed`);
