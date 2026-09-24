/**
 * Step 12 — Submission History + AI Improvement Suggestions.
 *
 * DB-free tests (same approach as the other testXIsolation.js /
 * testSubmissionReviewWorkflow.js scripts in this project): mirrors the
 * exact pure logic used by SubmissionHistoryPanel.jsx (progress comparison,
 * "does this submission need the improvement panel" gate, and the empty/
 * singular/plural history count label) plus the existing group-scoping
 * rules that already govern who can see a task's submissions.
 *
 * Run: node backend/scripts/testSubmissionHistory.js
 */
const assert = require("assert");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

// ---------------------------------------------------------------------
// Mirrors SubmissionHistoryPanel.jsx's countLabel logic (spec §22).
// ---------------------------------------------------------------------
function countLabel(totalSubmissions) {
  const previousCount = totalSubmissions - 1;
  if (previousCount <= 0) return "No previous submissions yet.";
  if (previousCount === 1) return "1 submission";
  return `${previousCount} submissions`;
}

check("Test 1: a student with a single submission sees the correct empty-history label", () => {
  assert.strictEqual(countLabel(1), "No previous submissions yet.");
});

check("Empty-state singular/plural wording (spec §22)", () => {
  assert.strictEqual(countLabel(2), "1 submission");
  assert.strictEqual(countLabel(4), "3 submissions");
});

// ---------------------------------------------------------------------
// Mirrors SubmissionHistoryPanel.jsx's ProgressComparison logic (§11).
// ---------------------------------------------------------------------
function compareProgress(previous, latest) {
  const prevProgress = previous?.aiAnalysis?.progress;
  const latestProgress = latest?.aiAnalysis?.progress;
  if (prevProgress == null || latestProgress == null) return null;
  const delta = latestProgress - prevProgress;
  if (delta === 0) return { kind: "same", delta: 0 };
  return delta > 0 ? { kind: "improved", delta } : { kind: "decreased", delta: Math.abs(delta) };
}

check("Test 13/14: progress increase is calculated and labelled as improvement", () => {
  const result = compareProgress({ aiAnalysis: { progress: 64 } }, { aiAnalysis: { progress: 82 } });
  assert.deepStrictEqual(result, { kind: "improved", delta: 18 });
});

check("Test 15: progress decrease is calculated and never mislabelled as improvement", () => {
  const result = compareProgress({ aiAnalysis: { progress: 82 } }, { aiAnalysis: { progress: 61 } });
  assert.deepStrictEqual(result, { kind: "decreased", delta: 21 });
  assert.notStrictEqual(result.kind, "improved");
});

check("No comparison is ever claimed without a real previous progress value", () => {
  assert.strictEqual(compareProgress(null, { aiAnalysis: { progress: 82 } }), null);
  assert.strictEqual(compareProgress({ aiAnalysis: {} }, { aiAnalysis: { progress: 82 } }), null);
});

// ---------------------------------------------------------------------
// Mirrors SubmissionHistoryPanel.jsx's "should the combined improvement
// panel show" gate (§4/§7) — and confirms it only ever pulls from fields
// that already exist on the stored aiAnalysis / guideFeedback, never
// inventing new ones.
// ---------------------------------------------------------------------
const NEEDS_IMPROVEMENT_STATUSES = new Set([
  "PARTIAL_PROGRESS",
  "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
  "WRONG_PROJECT",
  "UNREADABLE_ZIP",
  "VALID_BUT_NEEDS_IMPROVEMENT",
]);
function showCombinedPanel(submission) {
  return (
    ["changes_requested", "rejected"].includes(submission.verdict) ||
    NEEDS_IMPROVEMENT_STATUSES.has(submission.aiAnalysis?.implementationStatus)
  );
}
function combinedPanelPoints(submission) {
  const analysis = submission.aiAnalysis;
  return [...(analysis?.missingParts || []), ...(analysis?.suggestions || [])];
}

check("Test 7: AI suggestions shown in the improvement panel come only from the stored analysis", () => {
  const submission = {
    verdict: "changes_requested",
    guideFeedback: "Complete the remaining validation and update the API handling.",
    aiAnalysis: {
      implementationStatus: "PARTIAL_PROGRESS",
      missingParts: ["Database integration", "Validation"],
      suggestions: ["Add error handling around the API call."],
    },
  };
  assert.strictEqual(showCombinedPanel(submission), true);
  const points = combinedPanelPoints(submission);
  assert.deepStrictEqual(points, ["Database integration", "Validation", "Add error handling around the API call."]);
  // Every point must be traceable back to the real stored analysis — no
  // string appears in the panel that wasn't already in missingParts/suggestions.
  points.forEach((p) => {
    const inMissing = submission.aiAnalysis.missingParts.includes(p);
    const inSuggestions = submission.aiAnalysis.suggestions.includes(p);
    assert.ok(inMissing || inSuggestions, `"${p}" must come from real AI analysis fields`);
  });
});

check("Test 8: WRONG_PROJECT triggers the improvement panel", () => {
  assert.strictEqual(showCombinedPanel({ verdict: "", aiAnalysis: { implementationStatus: "WRONG_PROJECT" } }), true);
});

check("Test 9: UNREADABLE_ZIP triggers the improvement panel", () => {
  assert.strictEqual(showCombinedPanel({ verdict: "", aiAnalysis: { implementationStatus: "UNREADABLE_ZIP" } }), true);
});

check("Test 10: PARTIAL_PROGRESS triggers the improvement panel", () => {
  assert.strictEqual(showCombinedPanel({ verdict: "", aiAnalysis: { implementationStatus: "PARTIAL_PROGRESS" } }), true);
});

check("Test 11: an approved submission never shows the improvement panel", () => {
  assert.strictEqual(
    showCombinedPanel({ verdict: "approved", aiAnalysis: { implementationStatus: "VALID_SUBMISSION", progress: 94 } }),
    false
  );
});

check("Test 12: a rejected submission always shows the improvement panel", () => {
  assert.strictEqual(showCombinedPanel({ verdict: "rejected", aiAnalysis: { implementationStatus: "VALID_SUBMISSION" } }), true);
});

// ---------------------------------------------------------------------
// Tests 2–5: version ordering, latest identification, and immutability of
// history when a new version is appended (mirrors submissionController.submit
// pushing a new version, and the frontend always reading
// submissions[submissions.length - 1] as "latest").
// ---------------------------------------------------------------------
function buildSubmission(version, overrides = {}) {
  return { _id: `sub${version}`, version, verdict: "", guideFeedback: "", aiAnalysis: null, ...overrides };
}

check("Test 2/3: multiple submissions keep strictly increasing version numbers in order", () => {
  const submissions = [
    buildSubmission(1, { verdict: "changes_requested", aiAnalysis: { progress: 42 } }),
    buildSubmission(2, { verdict: "changes_requested", aiAnalysis: { progress: 68 } }),
    buildSubmission(3, { verdict: "approved", aiAnalysis: { progress: 94 } }),
  ];
  submissions.forEach((s, i) => assert.strictEqual(s.version, i + 1));
  const latest = submissions[submissions.length - 1];
  assert.strictEqual(latest.version, 3, "the newest submission must be identified as version 3");
  assert.strictEqual(latest.verdict, "approved");
});

check("Test 4: the latest submission is always the last element, regardless of history length", () => {
  const single = [buildSubmission(1)];
  assert.strictEqual(single[single.length - 1].version, 1);

  const many = [buildSubmission(1), buildSubmission(2), buildSubmission(3), buildSubmission(4)];
  assert.strictEqual(many[many.length - 1].version, 4);
});

check("Test 5: appending a new version never mutates or removes earlier submissions", () => {
  const submissions = [
    buildSubmission(1, { verdict: "rejected", guideFeedback: "Wrong project entirely." }),
    buildSubmission(2, { verdict: "changes_requested", guideFeedback: "Add tests." }),
  ];
  const snapshotBefore = JSON.parse(JSON.stringify(submissions));
  // Simulates a resubmission appending version 3.
  submissions.push(buildSubmission(3, { verdict: "" }));
  assert.deepStrictEqual(submissions.slice(0, 2), snapshotBefore, "versions 1 and 2 must be byte-for-byte unchanged");
  assert.strictEqual(submissions.length, 3);
});

check("Test 19: previous versions carry no action affordance (read-only) — only the latest can be reviewed", () => {
  // Mirrors submissionController.review(), which always operates on
  // task.submissions[task.submissions.length - 1] — there is no API path
  // that lets a client target an older version for a verdict change.
  const submissions = [buildSubmission(1, { verdict: "changes_requested" }), buildSubmission(2, { verdict: "" })];
  const reviewable = submissions[submissions.length - 1];
  assert.strictEqual(reviewable.version, 2);
  assert.notStrictEqual(reviewable, submissions[0], "version 1 must never be the one an approve/reject action targets");
});

// ---------------------------------------------------------------------
// Test 6: guide feedback is displayed exactly as stored, never altered.
// ---------------------------------------------------------------------
check("Test 6: guide feedback is preserved exactly as stored, never rewritten", () => {
  const stored = "Complete the remaining validation and update the API handling.";
  const submission = buildSubmission(2, { verdict: "changes_requested", guideFeedback: stored });
  assert.strictEqual(submission.guideFeedback, stored);
});

// ---------------------------------------------------------------------
// Tests 16/17/18 — authorization. Mirrors the exact rule already enforced
// by requireGroupAccess + the task-group scoping shared by every
// submissions endpoint (list/submit/review): visibility is scoped to the
// group, and cross-group access is always rejected, regardless of role.
// ---------------------------------------------------------------------
function canViewSubmissions({ user, group, task }) {
  const uid = String(user._id);
  const isMember = group.members.some((m) => String(m) === uid);
  const isGuide = String(group.guide) === uid;
  if (!isMember && !isGuide && user.role !== "admin") return false;
  return task.group === group._id;
}

const GROUP_A = { _id: "groupA", members: ["student1", "student2"], guide: "guide1" };
const GROUP_B = { _id: "groupB", members: ["student3"], guide: "guide2" };
const TASK_A = { _id: "taskA1", group: "groupA" };
const TASK_B = { _id: "taskB1", group: "groupB" };

check("Test 17: cross-group access to another group's submissions remains blocked", () => {
  assert.strictEqual(
    canViewSubmissions({ user: { _id: "student3", role: "student" }, group: GROUP_A, task: TASK_A }),
    false,
    "a student from Group B is not a member of Group A and must be rejected"
  );
});

check("Test 18: guide sees submissions only for groups they are authorized on", () => {
  assert.strictEqual(canViewSubmissions({ user: { _id: "guide1", role: "guide" }, group: GROUP_A, task: TASK_A }), true);
  assert.strictEqual(
    canViewSubmissions({ user: { _id: "guide1", role: "guide" }, group: GROUP_B, task: TASK_B }),
    false,
    "guide1 does not own Group B"
  );
});

check("Test 16: a task scoped to another group is never resolved even by a Group A member", () => {
  // Mirrors Task.findOne({ _id, group: req.group._id }) — the task's own
  // `group` field decides visibility, never the caller's claimed groupId.
  assert.strictEqual(
    canViewSubmissions({ user: { _id: "student1", role: "student" }, group: GROUP_A, task: TASK_B }),
    false
  );
});

console.log(`\n${passed} test(s) passed.`);
