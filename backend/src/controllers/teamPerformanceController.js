/**
 * STEP 22 — AI Team Performance Insights endpoints.
 *
 * Additive: does not touch teamRiskController.js, projectHealthController.js,
 * or projectExecutionCopilotController.js. requireGroupAccess has already
 * verified the caller is a member/guide/admin of req.group before any of
 * these run (see routes/index.js + middleware/auth.js).
 *
 * Guide/Team Leader get the full team performance payload. A normal
 * student gets ONLY their own performance (Feature 10 — Privacy), via
 * teamPerformanceService.shapeForStudent — the exact same discipline as
 * teamRiskController.js#shapeForStudent for Step 15.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { getTeamPerformance, getTeamPerformanceHistory, shapeForStudent } = require("../services/teamPerformanceService");

// STEP 31 — consolidated into the single shared implementation (was a
// verbatim copy across 4 controllers; see utils/authz.js for details).
const { isGuideOrLeader } = require("../utils/authz");

/** GET /groups/:groupId/team-performance */
exports.getTeamPerformance = asyncHandler(async (req, res) => {
  const result = await getTeamPerformance(req.group, { persist: true });

  if (!isGuideOrLeader(req)) {
    return res.json({ success: true, data: shapeForStudent(result, req.user._id) });
  }

  // Guide/leader — full picture, including per-member detail (`members`)
  // for the Detail Panel's member cards.
  res.json({ success: true, data: result });
});

/** GET /groups/:groupId/team-performance/history — guide/leader only. */
exports.getTeamPerformanceHistory = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view Team Performance history");
  }
  const items = await getTeamPerformanceHistory(req.group._id, 30);
  res.json({ success: true, data: items });
});
