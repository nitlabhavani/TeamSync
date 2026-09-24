/**
 * STEP 21 — AI Project Execution Copilot endpoints.
 *
 * Additive: does not touch teamRiskController.js, projectForecastController.js,
 * or projectHealthController.js. requireGroupAccess has already verified the
 * caller is a member/guide/admin of req.group before any of these run (see
 * routes/index.js + middleware/auth.js).
 *
 * Guide/Team Leader get the full Execution Copilot plan. Normal students are
 * forbidden — there is no student-facing Copilot endpoint (see Feature 12 —
 * Privacy — students continue to use the existing, already-privacy-safe
 * student-facing endpoints elsewhere).
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { getExecutionCopilot, getExecutionCopilotHistory } = require("../services/projectExecutionCopilotService");

// STEP 31 — consolidated into the single shared implementation (was a
// verbatim copy across 4 controllers; see utils/authz.js for details).
const { isGuideOrLeader } = require("../utils/authz");

/** GET /groups/:groupId/execution-copilot — guide/leader only. */
exports.getCopilot = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view the AI Execution Copilot");
  }
  const result = await getExecutionCopilot(req.group, { persist: true });
  res.json({ success: true, data: result });
});

/** GET /groups/:groupId/execution-copilot/history — guide/leader only. */
exports.getCopilotHistory = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view Execution Copilot history");
  }
  const items = await getExecutionCopilotHistory(req.group._id, 30);
  res.json({ success: true, data: items });
});
