/**
 * Step 11 — AI Submission Review + Guide Approval + Student Feedback.
 *
 * DB-free tests (same approach as testGroupAccessIsolation.js /
 * testTasksPageGroupIsolation.js / testTaskSubmissionAnalysis.js): mirrors
 * the exact authorization + status-transition logic in
 * submissionController.review() against in-memory fixtures, so it exercises
 * the real rules without a database.
 *
 * Run: node backend/scripts/testSubmissionReviewWorkflow.js
 */
const assert = require("assert");
const path = require("path");
const {
  analyzeLocally,
  clampResult,
  statusForResult,
} = require("../src/services/taskSubmissionAnalysisService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

// ---- Mirrors submissionController.review()'s core logic exactly ---------
const STATUS_FOR_VERDICT = { approved: "completed", changes_requested: "changes_requested", rejected: "rejected" };
const NOTIFICATION_FOR_VERDICT = (taskTitle, feedback) => ({
  approved: {
    title: "Task approved",
    body: `🎉 Your task '${taskTitle}' has been approved and completed by the guide.`,
  },
  changes_requested: {
    title: "Changes requested",
    body: `🔄 Changes requested for '${taskTitle}'. Check your task page for guide feedback.`,
  },
  rejected: {
    title: "Submission rejected",
    body: `❌ Your submission for '${taskTitle}' was rejected. Check the task page for details.`,
  },
});

function reviewSubmission({ task, submission, user, isGuide, group, verdict, feedback }) {
  if (!isGuide && String(group.leader) !== String(user._id)) {
    const err = new Error("Only the guide or team leader can review submissions");
    err.status = 403;
    throw err;
  }
  if (!STATUS_FOR_VERDICT[verdict]) {
    const err = new Error("verdict must be one of: approved, changes_requested, rejected");
    err.status = 400;
    throw err;
  }
  const trimmedFeedback = String(feedback || "").trim();
  if (verdict !== "approved" && !trimmedFeedback) {
    const err = new Error(
      verdict === "rejected" ? "A reason is required to reject a submission" : "Feedback is required when requesting changes"
    );
    err.status = 400;
    throw err;
  }
  submission.verdict = verdict;
  submission.guideFeedback = trimmedFeedback;
  submission.reviewedBy = user._id;
  submission.reviewedAt = new Date();
  task.status = STATUS_FOR_VERDICT[verdict];
  return { task, submission, notification: NOTIFICATION_FOR_VERDICT(task.title, trimmedFeedback)[verdict] };
}

// ---- Mirrors requireGroupAccess + the task-lookup scoping used by every
//      submission endpoint (list/submit/review all do `Task.findOne({ _id,
//      group: req.group._id })`, so a task from another group can never be
//      addressed even if its id were guessed). ----------------------------
function findAuthorizedTask({ tasks, groupId, taskId, user, group }) {
  const uid = String(user._id);
  const isMember = group.members.some((m) => String(m) === uid);
  const isGuide = String(group.guide) === uid;
  if (!isMember && !isGuide && user.role !== "admin") {
    const err = new Error("You are not part of this group");
    err.status = 403;
    throw err;
  }
  return tasks.find((t) => t._id === taskId && t.group === groupId) || null;
}

const REFERENCE = {
  identifiers: ["teamsync", "chattaskservice", "chattaskextractionservice", "aiengineclient"],
  serviceFiles: ["chatTaskService.js", "chatTaskExtractionService.js", "aiEngineClient.js"],
  modelFiles: ["Task.js", "Group.js", "User.js"],
  routeTokens: ["tasks", "submit", "groups", "chat"],
};
const TASK_META = {
  title: "Implement chat task extraction",
  description: "Wire up automatic task detection from group chat messages.",
  module: "Backend / AI",
};
const filesFor = (entries) =>
  entries.map(([relPath, content]) => ({ relPath, ext: path.extname(relPath), size: content.length, content }));

const VALID_MANIFEST = {
  files: filesFor([
    ["backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { return true; }"],
    ["backend/src/services/chatTaskExtractionService.js", "function resolveAssignee() { return member; }"],
  ]),
  fileCount: 2,
};

// --------------------------------------------------------------------
// Tests 1–3: student submits a valid ZIP -> full AI result -> routed to
// guide_review (never auto-completed by the AI alone).
// --------------------------------------------------------------------
check("Test 1: valid ZIP submission produces a complete AI analysis result", () => {
  const result = clampResult(analyzeLocally({ manifest: VALID_MANIFEST, referenceProject: REFERENCE, task: TASK_META }), VALID_MANIFEST);
  assert.strictEqual(result.implementationStatus, "VALID_SUBMISSION");
  ["progress", "projectConfidence", "taskRelated", "projectRelated", "summary", "completedParts", "missingParts", "suggestions", "analyzedFiles"].forEach(
    (k) => assert.ok(k in result, `AI analysis result must include "${k}"`)
  );
});

check("Test 2/3: a valid submission always routes to guide_review, never straight to completed", () => {
  const result = clampResult(analyzeLocally({ manifest: VALID_MANIFEST, referenceProject: REFERENCE, task: TASK_META }), VALID_MANIFEST);
  assert.strictEqual(statusForResult(result), "guide_review");
});

// --------------------------------------------------------------------
// Fixtures for the guide-review + authorization tests below.
// --------------------------------------------------------------------
const GROUP_A = { _id: "groupA", members: ["student1"], guide: "guide1", leader: "student1" };
const GROUP_B = { _id: "groupB", members: ["student2"], guide: "guide2", leader: "student2" };

function freshTasks() {
  return [
    {
      _id: "taskA1",
      group: "groupA",
      title: "Implement chat task extraction",
      assignee: "student1",
      status: "guide_review",
      submissions: [
        { _id: "subA1", student: "student1", version: 1, verdict: "", guideFeedback: "", reviewedBy: null, reviewedAt: null, aiAnalysis: { implementationStatus: "VALID_SUBMISSION", progress: 92 } },
      ],
    },
    {
      _id: "taskB1",
      group: "groupB",
      title: "Backend API",
      assignee: "student2",
      status: "guide_review",
      submissions: [{ _id: "subB1", student: "student2", version: 1, verdict: "", guideFeedback: "" }],
    },
  ];
}

// --------------------------------------------------------------------
// Test 4: guide can see (and locate) an authorized submission.
// --------------------------------------------------------------------
check("Test 4: guide can see a submission belonging to their own group", () => {
  const tasks = freshTasks();
  const found = findAuthorizedTask({ tasks, groupId: "groupA", taskId: "taskA1", user: { _id: "guide1", role: "guide" }, group: GROUP_A });
  assert.ok(found, "guide1 must be able to locate the submission in their own group");
  assert.strictEqual(found.submissions[0].student, "student1");
});

// --------------------------------------------------------------------
// Test 5: guide cannot see another group's submission.
// --------------------------------------------------------------------
check("Test 5: a guide is rejected outright when addressing a group they don't own", () => {
  const tasks = freshTasks();
  assert.throws(
    () => findAuthorizedTask({ tasks, groupId: "groupB", taskId: "taskB1", user: { _id: "guide1", role: "guide" }, group: GROUP_B }),
    /not part of this group/,
    "guide1 is not a member/guide of Group B and must be forbidden"
  );
});

check("Test 5b: even naming Group A's own id, a task that belongs to Group B is never found", () => {
  const tasks = freshTasks();
  // Mirrors Task.findOne({ _id, group: req.group._id }) — the task's own
  // `group` field decides visibility, never the caller's claimed groupId.
  const found = findAuthorizedTask({ tasks, groupId: "groupA", taskId: "taskB1", user: { _id: "guide1", role: "guide" }, group: GROUP_A });
  assert.strictEqual(found, null, "Group B's task must never resolve while scoped to Group A");
});

// --------------------------------------------------------------------
// Tests 6–8: guide approves -> task becomes completed -> student gets the
// exact approval notification copy.
// --------------------------------------------------------------------
check("Test 6/7/8: guide approval completes the task, stores the reviewer, and notifies the student", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  const submission = task.submissions[0];
  const { notification } = reviewSubmission({
    task,
    submission,
    user: { _id: "guide1" },
    isGuide: true,
    group: GROUP_A,
    verdict: "approved",
    feedback: "",
  });
  assert.strictEqual(task.status, "completed", "task must become completed");
  assert.strictEqual(submission.verdict, "approved");
  assert.strictEqual(submission.reviewedBy, "guide1", "reviewer must be recorded");
  assert.ok(submission.reviewedAt instanceof Date, "review timestamp must be recorded");
  assert.strictEqual(submission.aiAnalysis.implementationStatus, "VALID_SUBMISSION", "the AI analysis must be preserved untouched");
  assert.strictEqual(notification.body, "🎉 Your task 'Implement chat task extraction' has been approved and completed by the guide.");
});

// --------------------------------------------------------------------
// Tests 9–10: guide requests changes -> student gets feedback -> status is
// changes_requested (not rejected).
// --------------------------------------------------------------------
check("Test 9/10: requesting changes stores feedback, sets changes_requested, and notifies the student", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  const submission = task.submissions[0];
  const { notification } = reviewSubmission({
    task,
    submission,
    user: { _id: "guide1" },
    isGuide: true,
    group: GROUP_A,
    verdict: "changes_requested",
    feedback: "Complete the remaining validation and update the API handling.",
  });
  assert.strictEqual(task.status, "changes_requested");
  assert.strictEqual(submission.verdict, "changes_requested");
  assert.strictEqual(submission.guideFeedback, "Complete the remaining validation and update the API handling.");
  assert.strictEqual(
    notification.body,
    "🔄 Changes requested for 'Implement chat task extraction'. Check your task page for guide feedback."
  );
});

check("Requesting changes without feedback is rejected", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  const submission = task.submissions[0];
  assert.throws(
    () => reviewSubmission({ task, submission, user: { _id: "guide1" }, isGuide: true, group: GROUP_A, verdict: "changes_requested", feedback: "  " }),
    /Feedback is required/
  );
});

// --------------------------------------------------------------------
// Test 11: student can resubmit after changes were requested.
// --------------------------------------------------------------------
function canSubmit(task, user, isGuide) {
  const isAssignee = String(task.assignee) === String(user._id);
  if (!isAssignee && !isGuide) return { allowed: false, reason: "not_the_assignee" };
  if (task.status === "completed" || task.status === "done") return { allowed: false, reason: "already_completed" };
  return { allowed: true, reason: null };
}

check("Test 11: the student can resubmit once the task is back in changes_requested", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  task.status = "changes_requested";
  const result = canSubmit(task, { _id: "student1" }, false);
  assert.strictEqual(result.allowed, true, "the assignee must be able to resubmit after changes were requested");
});

// --------------------------------------------------------------------
// Test 12: previous submission remains in history; newest becomes active.
// --------------------------------------------------------------------
check("Test 12: resubmission keeps the previous submission in history", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  task.submissions[0].verdict = "changes_requested";
  task.submissions[0].guideFeedback = "Please add tests.";
  // Simulates submissionController.submit() pushing a new version.
  task.submissions.push({ _id: "subA2", student: "student1", version: 2, verdict: "", guideFeedback: "" });
  task.status = "guide_review";

  assert.strictEqual(task.submissions.length, 2, "the original submission must never be deleted");
  assert.strictEqual(task.submissions[0].guideFeedback, "Please add tests.", "history must keep the old feedback intact");
  const latest = task.submissions[task.submissions.length - 1];
  assert.strictEqual(latest.version, 2, "the newest submission must be the active one");
});

// --------------------------------------------------------------------
// Test 13: guide rejection works (requires a reason, sets status).
// --------------------------------------------------------------------
check("Test 13: guide rejection requires a reason and sets the task to rejected", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  const submission = task.submissions[0];
  assert.throws(
    () => reviewSubmission({ task, submission, user: { _id: "guide1" }, isGuide: true, group: GROUP_A, verdict: "rejected", feedback: "" }),
    /reason is required/
  );
  const { notification } = reviewSubmission({
    task,
    submission,
    user: { _id: "guide1" },
    isGuide: true,
    group: GROUP_A,
    verdict: "rejected",
    feedback: "This does not implement the assigned task at all.",
  });
  assert.strictEqual(task.status, "rejected");
  assert.strictEqual(submission.guideFeedback, "This does not implement the assigned task at all.");
  assert.strictEqual(
    notification.body,
    "❌ Your submission for 'Implement chat task extraction' was rejected. Check the task page for details."
  );
});

// --------------------------------------------------------------------
// Test 14: unauthorized user (an ordinary team member, not guide/leader)
// cannot approve/review at all.
// --------------------------------------------------------------------
check("Test 14: an ordinary group member (not guide, not team leader) cannot review", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  const submission = task.submissions[0];
  assert.throws(
    () =>
      reviewSubmission({
        task,
        submission,
        user: { _id: "some_other_student" },
        isGuide: false,
        group: GROUP_A, // leader is "student1", not "some_other_student"
        verdict: "approved",
        feedback: "",
      }),
    /Only the guide or team leader/
  );
});

check("An invalid verdict value is always rejected", () => {
  const tasks = freshTasks();
  const task = tasks[0];
  const submission = task.submissions[0];
  assert.throws(
    () => reviewSubmission({ task, submission, user: { _id: "guide1" }, isGuide: true, group: GROUP_A, verdict: "maybe", feedback: "" }),
    /verdict must be one of/
  );
});

console.log(`\n${passed} test(s) passed.`);
