/**
 * STEP 20 — AI Project Health Command Center endpoints.
 *
 * Additive: does not touch teamRiskController.js or projectForecastController.js.
 * requireGroupAccess has already verified the caller is a member/guide/
 * admin of req.group before any of these run (see routes/index.js +
 * middleware/auth.js).
 *
 * Guide/Team Leader get the full aggregated Command Center. Students only
 * ever see their own progress via the existing, already-privacy-safe
 * GET /groups/:groupId/project-forecast student response (buildStudentProgress)
 * — this file intentionally does NOT duplicate that endpoint (Feature 7).
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { getProjectHealth, getProjectHealthHistory } = require("../services/projectHealthService");

// STEP 31 — consolidated into the single shared implementation (was a
// verbatim copy across 4 controllers; see utils/authz.js for details).
const { isGuideOrLeader } = require("../utils/authz");

/** GET /groups/:groupId/project-health — guide/leader only. */
exports.getHealth = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view the Project Health Command Center");
  }
  const result = await getProjectHealth(req.group, { persist: true });
  res.json({ success: true, data: result });
});

/** GET /groups/:groupId/project-health/history — guide/leader only. */
exports.getHealthHistory = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view project health history");
  }
  const items = await getProjectHealthHistory(req.group._id, 30);
  res.json({ success: true, data: items });
});
