/**
 * STEP 31 — shared authorization helpers.
 *
 * `isGuideOrLeader` was previously copy-pasted (verbatim, per Step 30's audit)
 * into 7 controllers, in two behaviorally-identical forms:
 *
 *   1. `req.isGuide || String(req.group.leader) === String(req.user._id)`
 *      (projectExecutionCopilotController, teamPerformanceController,
 *      projectHealthController, projectForecastController)
 *
 *   2. `canRequestRecommendation({ isGuide, groupLeaderId, userId })` from
 *      services/smartTaskAssignmentService.js, which adds a null-guard
 *      before comparing (projectMemoryAssistantController,
 *      actionableInsightsController, projectKnowledgeController,
 *      conflictController — the last one inline, with no local wrapper).
 *
 * Both forms return the same result for any real request that has already
 * passed `protect` + `requireGroupAccess` (req.group / req.user are always
 * populated by then), so consolidating them does not change behavior for
 * any existing caller. This module is the single source of truth going
 * forward; `canRequestRecommendation` in smartTaskAssignmentService.js now
 * delegates to it (see that file) rather than re-implementing the check, so
 * there remains exactly one authoritative implementation.
 *
 * requireGroupAccess (middleware/auth.js) already sets `req.isGuide` to
 * true for `role === "admin"` as well as an actual group guide, so guide,
 * team-leader, and admin access are all covered by this single check —
 * matching every duplicated copy's existing semantics exactly.
 */

function isGuideOrLeader(req) {
  const isGuide = Boolean(req?.isGuide);
  if (isGuide) return true;
  const groupLeaderId = req?.group?.leader;
  const userId = req?.user?._id;
  if (!groupLeaderId || !userId) return false;
  return String(groupLeaderId) === String(userId);
}

const canAssignOrModifyTask = isGuideOrLeader;
const canCreateTask = isGuideOrLeader;

module.exports = { isGuideOrLeader, canAssignOrModifyTask, canCreateTask };
