/**
 * STEP 33 — Task reassignment + submission ownership isolation.
 *
 * ROOT CAUSE this file fixes (see STEP33_TASK_SUBMISSION_ISOLATION_REPORT.md
 * for the full trace): `Task.status` and `Task.submissions` both live on the
 * single shared Task document, keyed by task, not by (task, student). As
 * long as a task keeps the same assignee for its whole life this is fine.
 * But the moment a task is REASSIGNED from one student to another:
 *
 *   - `task.status` still carries whatever workflow state the PREVIOUS
 *     assignee left it in (e.g. "guide_review", "completed",
 *     "changes_requested") — so the new assignee's task can appear to
 *     already be submitted/reviewed/completed before they ever touched it.
 *   - `task.submissions` (and the `latestSubmission` virtual, which just
 *     returns `submissions[submissions.length - 1]`) still holds the
 *     PREVIOUS assignee's note/files/AI feedback/guide feedback — which a
 *     naive "show `task.latestSubmission`" UI (or a naive "return the whole
 *     submissions array to whoever asks") would then display to the NEW
 *     assignee as if it were their own submission. That is both a
 *     correctness bug ("already submitted" when they haven't) and a
 *     privacy bug (the new assignee sees the previous assignee's private
 *     submission content).
 *
 * Both fixes below are purely additive: nothing is deleted, no new
 * submission/task system is introduced, and every existing single-assignee
 * (never-reassigned) task behaves EXACTLY as before.
 */

/** Task.status values that only make sense in the context of a specific
 * assignee's submission — inherited by a new assignee, these must reset. */
const SUBMISSION_WORKFLOW_STATUSES = new Set([
  "submitted",
  "ai_review",
  "guide_review",
  "changes_requested",
  "completed",
  "rejected",
]);

function idsEqual(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/**
 * Decide whether a task's status must reset to "pending" because its
 * assignee just changed. Called BEFORE the caller persists the new
 * assignee, with the task's state as of the incoming request.
 *
 *  - Never resets if the request body already sets an explicit status
 *    itself (the caller's explicit choice always wins — this never
 *    silently overrides a deliberate status change made in the same call).
 *  - Never resets on unassignment (nextAssigneeId falsy) — nothing to
 *    "start fresh" for.
 *  - Never resets if the assignee didn't actually change (same id, or a
 *    resave with no assignee change).
 *  - Only resets when the CURRENT status is one of the submission-workflow
 *    states above — a task still sitting in "todo"/"backlog"/etc. has
 *    nothing stale to clear.
 */
function shouldResetStatusOnReassignment({
  previousAssigneeId,
  nextAssigneeId,
  currentStatus,
  explicitStatusInBody,
}) {
  if (explicitStatusInBody !== undefined) return false;
  if (!nextAssigneeId) return false;
  if (idsEqual(previousAssigneeId, nextAssigneeId)) return false;
  return SUBMISSION_WORKFLOW_STATUSES.has(currentStatus);
}

/** Extracts the submission's student id whether `student` is populated
 * (`{ _id, name, ... }`) or a raw ObjectId/string. */
function submissionStudentId(submission) {
  const s = submission?.student;
  return (s && typeof s === "object" ? s._id : s) ?? null;
}

/** Filters a submissions array down to only the ones belonging to `studentId`. */
function studentOwnSubmissions(submissions, studentId) {
  return (submissions || []).filter((s) => idsEqual(submissionStudentId(s), studentId));
}

/**
 * Is this requester allowed to see the FULL submission history of any task
 * in `req.group` — i.e. guide, admin, or the group's team leader? Mirrors
 * the exact rule already used by taskController/submissionController for
 * "who may create/update/review tasks", so student-facing visibility here
 * is never stricter or looser than write-access already is.
 */
function isPrivilegedViewer(req) {
  if (req.isGuide) return true;
  return idsEqual(req.group?.leader, req.user?._id);
}

/**
 * Shapes a plain task object (already the result of `.toJSON()`/`.lean()`,
 * so `latestSubmission` — a schema virtual — is already computed from the
 * FULL submissions array) for the response actually sent back to
 * `req.user`.
 *
 * Guides/team leaders get the object back completely untouched — they are
 * the audience for full submission history/review (spec: "old submission
 * history remains available to authorized guide where appropriate").
 *
 * A student only ever receives THEIR OWN submissions in `submissions`, and
 * `latestSubmission` is recomputed from that filtered list rather than
 * trusting the virtual (which does not know about reassignment). This is
 * what makes reassignment safe even if some other code path forgets to
 * reset `status`: the new assignee's payload simply cannot contain the
 * previous assignee's submission content, because it was never sent to
 * them in the first place — defense in depth on top of the status reset.
 */
function shapeTaskForViewer(taskObj, req) {
  if (!taskObj) return taskObj;

  const projectContext = {
    title: req?.group?.project || taskObj.group?.project || "",
    description: req?.group?.description || taskObj.group?.description || "",
    groupName: req?.group?.name || taskObj.group?.name || "",
  };

  if (isPrivilegedViewer(req)) {
    return {
      ...taskObj,
      projectContext,
    };
  }

  const mine = studentOwnSubmissions(taskObj.submissions, req?.user?._id);
  return {
    ...taskObj,
    submissions: mine,
    latestSubmission: mine.length ? mine[mine.length - 1] : null,
    projectContext,
  };
}

module.exports = {
  SUBMISSION_WORKFLOW_STATUSES,
  idsEqual,
  submissionStudentId,
  studentOwnSubmissions,
  isPrivilegedViewer,
  shouldResetStatusOnReassignment,
  shapeTaskForViewer,
};
