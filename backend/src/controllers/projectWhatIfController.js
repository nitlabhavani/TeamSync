/**
 * STEP 25 — AI Project What-If Simulator endpoints.
 *
 * Additive: does not touch taskController.js, teamRiskController.js,
 * projectForecastController.js, projectHealthController.js,
 * projectExecutionCopilotController.js, teamPerformanceController.js,
 * sprintPlannerController.js, or conflictController.js.
 * requireGroupAccess (routes/index.js) has already confirmed the caller is
 * a member/guide/admin of req.group before any of these run — every read
 * below is additionally scoped to `req.group`, so cross-group access is
 * impossible.
 *
 * Authorization mirrors sprintPlannerController.js / conflictController.js
 * exactly: the SAME canRequestRecommendation({ isGuide, groupLeaderId,
 * userId }) helper already used for AI task plans / Sprint Planner /
 * Conflict details — guide or team leader only. Normal students never see
 * the full what-if simulator (spec §"STUDENT-SAFE OUTPUT").
 *
 * READ-ONLY: nothing in this file (or the service it calls) ever mutates a
 * Task/Group/Message/Submission/User document, sends a notification, or
 * persists a snapshot. See projectWhatIfSimulatorService.js's own header
 * comment for the full safety rationale.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { canRequestRecommendation } = require("../services/smartTaskAssignmentService");
const {
  getCapabilities,
  runWhatIfSimulation,
  compareScenarios,
} = require("../services/projectWhatIfSimulatorService");

function requireGuideOrLeader(req) {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id })) {
    throw ApiError.forbidden("Only the guide or team leader can use the AI What-If Simulator");
  }
}

/** GET /groups/:groupId/what-if/capabilities — safe for any group member to
 * read (it reveals no project data, only which change types this project's
 * current data model supports), but kept behind the same guard as the rest
 * of the feature for consistency with the other guide/leader-only AI tools. */
exports.capabilities = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  res.json({ success: true, data: getCapabilities() });
});

/** POST /groups/:groupId/what-if/simulate — body: { changes: [...] }.
 * Never mutates project data; see service header. */
exports.simulate = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);

  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  if (changes.length > 25) {
    throw ApiError.badRequest("A single simulation supports at most 25 changes.");
  }

  const result = await runWhatIfSimulation(req.group, changes);
  res.json({ success: true, data: result });
});

/** POST /groups/:groupId/what-if/compare — body: { scenarios: [{ id?, label?, changes: [...] }, ...] }.
 * Always includes the real current state as the "baseline" scenario.
 * Never mutates project data. */
exports.compare = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);

  const scenarios = Array.isArray(req.body?.scenarios) ? req.body.scenarios : [];
  if (scenarios.length > 6) {
    throw ApiError.badRequest("At most 6 additional scenarios can be compared at once.");
  }

  const result = await compareScenarios(req.group, scenarios);
  res.json({ success: true, data: result });
});
