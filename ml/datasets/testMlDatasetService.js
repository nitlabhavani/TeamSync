/**
 * Standalone unit tests for mlFeatureService + mlDatasetService (no DB / no
 * server needed). These use small hand-written FIXTURE objects to exercise
 * the logic paths — they are test fixtures for validating code behavior,
 * never training data, and are never written to backend/data/ml/.
 *
 * Run: node backend/scripts/testMlDatasetService.js
 */
const assert = require("assert");
const { isMeaningfulMessage, computeStudentFeatures, computeProjectFeatures } = require("../src/services/mlFeatureService");
const {
  deriveStudentLabel,
  deriveProjectLabel,
  handleMissingValues,
  dedupeRecords,
  splitDataset,
  assessSufficiency,
} = require("../src/services/mlDatasetService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

// --- isMeaningfulMessage (ported chatAnalyzer.py heuristic) -------------
check("isMeaningfulMessage drops small talk", () => {
  assert.strictEqual(isMeaningfulMessage("hi"), false);
  assert.strictEqual(isMeaningfulMessage("ok thanks!"), false);
  assert.strictEqual(isMeaningfulMessage(""), false);
});
check("isMeaningfulMessage keeps real project discussion", () => {
  assert.strictEqual(isMeaningfulMessage("frontend dashboard completed"), true);
  assert.strictEqual(isMeaningfulMessage("blocked"), true); // short but a blocker hint
});

// --- computeStudentFeatures ----------------------------------------------
check("computeStudentFeatures: all-null on zero evidence, not zero-fabricated", () => {
  const f = computeStudentFeatures({ tasks: [], messages: [], files: [], activityLogs: [] });
  assert.strictEqual(f.taskCompletionRatio, null);
  assert.strictEqual(f.onTimeCompletionRate, null);
  assert.strictEqual(f.totalTasksAssigned, 0);
  assert.strictEqual(f.activityConsistency, null);
});
check("computeStudentFeatures: computes ratios from real task set", () => {
  const now = new Date("2026-08-20T00:00:00Z");
  const tasks = [
    { status: "done", estimate: 4, due: "2026-08-10", completedAt: "2026-08-09" }, // on time
    { status: "done", estimate: 2, due: "2026-08-05", completedAt: "2026-08-09" }, // late
    { status: "in_progress", estimate: 3, due: "2026-08-25" }, // upcoming
    { status: "todo", estimate: 1, due: "2026-08-01" }, // overdue
  ];
  const f = computeStudentFeatures({ tasks, referenceDate: now });
  assert.strictEqual(f.taskCompletionRatio, 0.5);
  assert.strictEqual(f.onTimeCompletionRate, 0.5);
  assert.strictEqual(f.overdueTaskCount, 1);
  assert.strictEqual(f.remainingTaskCount, 1);
  assert.strictEqual(f.inProgressTaskCount, 1);
  assert.strictEqual(f.estimatedEffortAssignedHours, 10);
  assert.strictEqual(f.completedEffortPlannedHours, 6);
});
check("computeStudentFeatures: chat-derived counts use the ported heuristics", () => {
  const messages = [
    { text: "hi" },
    { text: "I finished the login API and pushed the code" },
    { text: "I am blocked on the deploy step, cannot proceed" },
  ];
  const f = computeStudentFeatures({ messages });
  assert.strictEqual(f.meaningfulChatMessageCount, 2);
  assert.strictEqual(f.blockerMentionCount, 1);
  assert.strictEqual(f.progressUpdateMentionCount, 1);
});

// --- computeProjectFeatures -----------------------------------------------
check("computeProjectFeatures: team ratios from real tasks", () => {
  const now = new Date("2026-08-20T00:00:00Z");
  const tasks = [
    { status: "done", estimate: 5, assignee: "u1" },
    { status: "todo", estimate: 3, assignee: "u1", due: "2026-08-01" }, // overdue
    { status: "todo", estimate: 2, assignee: "u2", due: "2026-09-01" }, // remaining
  ];
  const f = computeProjectFeatures({ tasks, group: { expectedCompletion: "2026-09-15" }, referenceDate: now });
  assert.strictEqual(f.teamCompletionRatio, 1 / 3);
  assert.strictEqual(f.overdueTaskCountTeamWide, 1);
  assert.strictEqual(f.remainingProjectEffortHours, 5);
  assert.strictEqual(f.workloadImbalance, 1); // u1 has 2 tasks, u2 has 1
  assert.ok(f.daysToExpectedCompletion > 25 && f.daysToExpectedCompletion < 27);
});

// --- deriveStudentLabel ----------------------------------------------------
check("deriveStudentLabel prefers PeerReview over submission verdicts", () => {
  const label = deriveStudentLabel({
    peerReviews: [{ scores: { contribution: 4, communication: 5, reliability: 4, helpfulness: 5 } }],
    submissions: [{ verdict: "rejected" }],
  });
  assert.strictEqual(label.source, "PeerReview.scores");
  assert.strictEqual(label.value, 4.5);
});
check("deriveStudentLabel falls back to submission verdicts when no PeerReview exists", () => {
  const label = deriveStudentLabel({ peerReviews: [], submissions: [{ verdict: "approved" }, { verdict: "rejected" }] });
  assert.strictEqual(label.source, "Task.submissions[].verdict");
  assert.strictEqual(label.value, 0.5);
});
check("deriveStudentLabel returns null (unlabeled) when neither source has data", () => {
  assert.strictEqual(deriveStudentLabel({ peerReviews: [], submissions: [] }), null);
  assert.strictEqual(deriveStudentLabel({ peerReviews: [], submissions: [{ verdict: "" }] }), null);
});

// --- deriveProjectLabel ------------------------------------------------
check("deriveProjectLabel refuses to label an active (unfinished) project", () => {
  assert.strictEqual(deriveProjectLabel({ group: { status: "active" }, teamCompletionRatio: 0.9 }), null);
});
check("deriveProjectLabel labels an archived project from its real completion ratio", () => {
  const label = deriveProjectLabel({ group: { status: "archived" }, teamCompletionRatio: 0.8 });
  assert.strictEqual(label.value, 0.8);
  assert.strictEqual(label.source, "Group.status=archived + Task completion ratio");
});

// --- handleMissingValues -------------------------------------------------
check("handleMissingValues flags rather than silently imputing", () => {
  const records = [
    { id: "a", features: { x: 1, y: null } },
    { id: "b", features: { x: null, y: null } }, // 100% missing -> dropped at 50% threshold
  ];
  const { kept, dropped } = handleMissingValues(records, ["x", "y"], { maxMissingRatio: 0.5 });
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].features.y_missing, true);
  assert.strictEqual(kept[0].features.x_missing, false);
  assert.strictEqual(dropped.length, 1);
  assert.strictEqual(dropped[0].id, "b");
});

// --- dedupeRecords ---------------------------------------------------------
check("dedupeRecords drops exact-key duplicates", () => {
  const records = [{ id: "1", k: "s1:g1" }, { id: "2", k: "s1:g1" }, { id: "3", k: "s2:g1" }];
  const { kept, dropped } = dedupeRecords(records, (r) => r.k);
  assert.strictEqual(kept.length, 2);
  assert.strictEqual(dropped.length, 1);
  assert.strictEqual(dropped[0].id, "2");
});

// --- splitDataset ------------------------------------------------------
check("splitDataset keeps all records for the same key in the same split", () => {
  const records = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, studentId: `s${i % 8}` }));
  const buckets = splitDataset(records, (r) => r.studentId);
  const splitOf = new Map();
  for (const [split, recs] of Object.entries(buckets)) {
    for (const r of recs) splitOf.set(r.studentId, splitOf.get(r.studentId) || split);
  }
  for (const [split, recs] of Object.entries(buckets)) {
    for (const r of recs) assert.strictEqual(splitOf.get(r.studentId), split);
  }
  assert.strictEqual(buckets.train.length + buckets.val.length + buckets.test.length, 40);
});
check("splitDataset is deterministic across repeated runs", () => {
  const records = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, k: `k${i}` }));
  const a = splitDataset(records, (r) => r.k);
  const b = splitDataset(records, (r) => r.k);
  assert.deepStrictEqual(a.train.map((r) => r.id), b.train.map((r) => r.id));
});

// --- assessSufficiency ---------------------------------------------------
check("assessSufficiency applies the documented threshold, doesn't guess", () => {
  assert.strictEqual(assessSufficiency(10).sufficient, false);
  assert.strictEqual(assessSufficiency(50).sufficient, true);
  assert.strictEqual(assessSufficiency(10, { minLabeled: 5 }).sufficient, true);
});

console.log(`\n${passed} passed, 0 failed`);
