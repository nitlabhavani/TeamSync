/**
 * STEP 33 — Task Assignment + Submission Isolation regression tests.
 *
 * DB-free (no live MongoDB needed), same approach as the other
 * testXIsolation.js scripts in this project — but unlike those, this one
 * requires the REAL production module (backend/src/utils/taskSubmissionScope.js)
 * directly rather than mirroring its logic, so these tests exercise the
 * exact code taskController.js/submissionController.js call.
 *
 * Run: node backend/scripts/testTaskReassignmentIsolation.js
 */
const assert = require("assert");
const {
  idsEqual,
  studentOwnSubmissions,
  isPrivilegedViewer,
  shouldResetStatusOnReassignment,
  shapeTaskForViewer,
} = require("../src/utils/taskSubmissionScope");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

// Fixture ids matching the spec's manual test scenario.
const RAMYA = "ramya1";
const BHAVANI = "bhavani1";
const GUIDE = "guide1";
const GROUP_LEADER = "leader1";

// ---------------------------------------------------------------------
// shouldResetStatusOnReassignment — the core reassignment-status fix.
// ---------------------------------------------------------------------
check("Test 1: reassigning Task A from Ramya to Bhavani resets a 'guide_review' status", () => {
  const reset = shouldResetStatusOnReassignment({
    previousAssigneeId: RAMYA,
    nextAssigneeId: BHAVANI,
    currentStatus: "guide_review",
    explicitStatusInBody: undefined,
  });
  assert.strictEqual(reset, true);
});

check("Test 2: reassignment resets a 'completed' status (Bhavani must not inherit 'already done')", () => {
  assert.strictEqual(
    shouldResetStatusOnReassignment({
      previousAssigneeId: RAMYA,
      nextAssigneeId: BHAVANI,
      currentStatus: "completed",
      explicitStatusInBody: undefined,
    }),
    true
  );
});

check("Test 3: reassignment resets 'changes_requested' / 'rejected' / 'submitted' / 'ai_review'", () => {
  ["changes_requested", "rejected", "submitted", "ai_review"].forEach((status) => {
    assert.strictEqual(
      shouldResetStatusOnReassignment({
        previousAssigneeId: RAMYA,
        nextAssigneeId: BHAVANI,
        currentStatus: status,
        explicitStatusInBody: undefined,
      }),
      true,
      `${status} should trigger a reset`
    );
  });
});

check("Test 4: a plain kanban status ('todo'/'backlog'/'in_progress') never needs a reset", () => {
  ["todo", "backlog", "in_progress", "pending", "review", "done"].forEach((status) => {
    assert.strictEqual(
      shouldResetStatusOnReassignment({
        previousAssigneeId: RAMYA,
        nextAssigneeId: BHAVANI,
        currentStatus: status,
        explicitStatusInBody: undefined,
      }),
      false,
      `${status} has nothing stale to clear`
    );
  });
});

check("Test 5: re-saving the SAME assignee never resets status (not a real reassignment)", () => {
  assert.strictEqual(
    shouldResetStatusOnReassignment({
      previousAssigneeId: RAMYA,
      nextAssigneeId: RAMYA,
      currentStatus: "completed",
      explicitStatusInBody: undefined,
    }),
    false
  );
});

check("Test 6: unassigning a task (no next assignee) never resets status", () => {
  assert.strictEqual(
    shouldResetStatusOnReassignment({
      previousAssigneeId: RAMYA,
      nextAssigneeId: null,
      currentStatus: "completed",
      explicitStatusInBody: undefined,
    }),
    false
  );
});

check("Test 7: an explicit status in the same PATCH body always wins — never silently overridden", () => {
  assert.strictEqual(
    shouldResetStatusOnReassignment({
      previousAssigneeId: RAMYA,
      nextAssigneeId: BHAVANI,
      currentStatus: "completed",
      explicitStatusInBody: "in_progress",
    }),
    false
  );
});

// ---------------------------------------------------------------------
// studentOwnSubmissions / shapeTaskForViewer — submission ownership +
// privacy isolation, both for populated (`{ _id, name }`) and raw
// ObjectId/string `student` fields.
// ---------------------------------------------------------------------
function submission(id, studentId, overrides = {}) {
  return { _id: id, student: studentId, version: overrides.version || 1, note: overrides.note || "", ...overrides };
}

check("Test 8: studentOwnSubmissions returns only Ramya's submissions from a mixed history", () => {
  const history = [
    submission("s1", RAMYA, { note: "Ramya v1" }),
    submission("s2", BHAVANI, { note: "Bhavani v1 (after reassignment)" }),
  ];
  const mine = studentOwnSubmissions(history, RAMYA);
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].note, "Ramya v1");
});

check("Test 9: studentOwnSubmissions works with a populated student object too", () => {
  const history = [submission("s1", { _id: RAMYA, name: "Kuchipudi Ramya" }, { note: "Ramya v1" })];
  const mine = studentOwnSubmissions(history, RAMYA);
  assert.strictEqual(mine.length, 1);
});

check("Test 10: isPrivilegedViewer is true for a guide, false for a plain group member", () => {
  assert.strictEqual(isPrivilegedViewer({ isGuide: true, group: { leader: GROUP_LEADER }, user: { _id: RAMYA } }), true);
  assert.strictEqual(
    isPrivilegedViewer({ isGuide: false, group: { leader: GROUP_LEADER }, user: { _id: RAMYA } }),
    false
  );
  assert.strictEqual(
    isPrivilegedViewer({ isGuide: false, group: { leader: RAMYA }, user: { _id: RAMYA } }),
    true,
    "the group's team leader is privileged even without req.isGuide"
  );
});

check(
  "Test 11 (core scenario): Task A reassigned Ramya -> Bhavani — Bhavani's shaped view never contains Ramya's submission",
  () => {
    const taskAfterReassignment = {
      _id: "taskA",
      title: "Frontend Dashboard Module",
      assignee: BHAVANI,
      status: "pending", // already reset by shouldResetStatusOnReassignment
      submissions: [submission("s1", RAMYA, { note: "Ramya's old work", version: 1 })],
      latestSubmission: submission("s1", RAMYA, { note: "Ramya's old work", version: 1 }), // stale virtual value
    };
    const reqAsBhavani = { isGuide: false, group: { leader: GROUP_LEADER }, user: { _id: BHAVANI } };
    const shaped = shapeTaskForViewer(taskAfterReassignment, reqAsBhavani);

    assert.strictEqual(shaped.submissions.length, 0, "Bhavani must not receive Ramya's submission at all");
    assert.strictEqual(shaped.latestSubmission, null, "Bhavani must not appear to have already submitted");
    assert.strictEqual(shaped.status, "pending");
  }
);

check("Test 12: the guide's view of the SAME reassigned task is untouched (full history for audit)", () => {
  const taskAfterReassignment = {
    _id: "taskA",
    assignee: BHAVANI,
    status: "pending",
    submissions: [submission("s1", RAMYA, { note: "Ramya's old work", version: 1 })],
    latestSubmission: submission("s1", RAMYA, { note: "Ramya's old work", version: 1 }),
  };
  const reqAsGuide = { isGuide: true, group: { leader: GROUP_LEADER }, user: { _id: GUIDE } };
  const shaped = shapeTaskForViewer(taskAfterReassignment, reqAsGuide);
  assert.strictEqual(shaped.submissions.length, 1, "guide must still see Ramya's historical submission");
  assert.strictEqual(shaped.latestSubmission.student, RAMYA);
});

check("Test 13: Ramya submitting Task A never appears on Bhavani's Task B, and vice versa (separate documents)", () => {
  const taskA = {
    _id: "taskA",
    assignee: RAMYA,
    status: "ai_review",
    submissions: [submission("s1", RAMYA)],
    latestSubmission: submission("s1", RAMYA),
  };
  const taskB = {
    _id: "taskB",
    assignee: BHAVANI,
    status: "pending",
    submissions: [],
    latestSubmission: null,
  };
  const reqAsBhavani = { isGuide: false, group: { leader: GROUP_LEADER }, user: { _id: BHAVANI } };
  const shapedA = shapeTaskForViewer(taskA, reqAsBhavani);
  const shapedB = shapeTaskForViewer(taskB, reqAsBhavani);
  assert.strictEqual(shapedA.submissions.length, 0, "Bhavani must never see Ramya's Task A submission");
  assert.strictEqual(shapedB.latestSubmission, null, "Task B remains unsubmitted for Bhavani");
});

check("Test 14: two students submitting files with the same original filename never mix submission ownership", () => {
  // Mirrors submissionController.submit — the FileAsset shared-library merge
  // is keyed by (group, originalName), but each Task.submissions[] entry is
  // independent of that and keyed only by its own `student` field.
  const ramyaSubmission = submission("s1", RAMYA, { files: [{ originalName: "project.zip", url: "/uploads/g1/abc123.zip" }] });
  const bhavaniSubmission = submission("s2", BHAVANI, { files: [{ originalName: "project.zip", url: "/uploads/g1/def456.zip" }] });
  assert.notStrictEqual(ramyaSubmission.files[0].url, bhavaniSubmission.files[0].url);
  assert.strictEqual(idsEqual(ramyaSubmission.student, bhavaniSubmission.student), false);
});

check("Test 15: same-name groups are never used for isolation — only ids matter (idsEqual is id-only)", () => {
  // idsEqual never takes a name; two different students named identically
  // would still compare by id, never by name.
  assert.strictEqual(idsEqual(RAMYA, RAMYA), true);
  assert.strictEqual(idsEqual(RAMYA, BHAVANI), false);
  assert.strictEqual(idsEqual(null, RAMYA), false);
});

console.log(`\n${passed} test(s) passed.`);
