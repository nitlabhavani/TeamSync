/**
 * STEP 29 — AI Actionable Project Insights & Recommendation Engine endpoint.
 *
 * Additive: does not touch teamRiskController.js, projectForecastController.js,
 * projectHealthController.js, projectExecutionCopilotController.js,
 * sprintPlannerController.js, conflictController.js,
 * meetingIntelligenceController.js, or projectKnowledgeController.js.
 * requireGroupAccess (routes/index.js) has already confirmed the caller is
 * a member/guide/admin of req.group before this runs — groupId is only
 * ever taken from the authorized req.group, never trusted from the
 * request body.
 *
 * Authorization mirrors every other AI orchestration controller in this
 * codebase (projectMemoryAssistantController.js, sprintPlannerController.js,
 * conflictController.js): guide/admin OR the group's Team Leader get the
 * full, guide-level insight set; a plain student gets the narrow,
 * student-safe subset (their own overdue/blocked tasks + conflicts that
 * involve them) — see actionableInsightsService.js for exactly what that
 * excludes.
 *
 * Read-only (spec §19): this endpoint never persists a new snapshot and
 * never mutates a Task/Conflict/ProjectKnowledge/Meeting/SprintPlan/
 * Health/Forecast/Risk document. Every downstream service call uses
 * {persist:false} where supported.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
// STEP 31 — consolidated into the single shared implementation (was a
// canRequestRecommendation(...) wrapper; see utils/authz.js for details).
const { isGuideOrLeader } = require("../utils/authz");
const { generateActionableInsights, CATEGORIES } = require("../services/actionableInsightsService");

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];



/** Safe integer parse for the optional `limit` filter — malformed input
 * (spec §32) is ignored rather than thrown, since this is a read-only,
 * best-effort filter, not a required parameter. */
function parseLimit(raw) {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(50, Math.floor(n));
}

/** POST /groups/:groupId/ai/actionable-insights
 * Body (all optional): { limit, priority, category } */
exports.getActionableInsights = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  const limit = parseLimit(body.limit);

  let priority;
  if (body.priority !== undefined) {
    const p = String(body.priority).toUpperCase();
    if (!PRIORITIES.includes(p)) throw ApiError.badRequest(`priority must be one of ${PRIORITIES.join(", ")}`);
    priority = p;
  }

  let category;
  if (body.category !== undefined) {
    const c = String(body.category).toUpperCase();
    if (!CATEGORIES.includes(c)) throw ApiError.badRequest(`category must be one of ${CATEGORIES.join(", ")}`);
    category = c;
  }

  const result = await generateActionableInsights(req.group, {
    isGuideOrLeader: isGuideOrLeader(req),
    userId: req.user._id,
    limit,
    priority,
    category,
  });

  res.json(result);
});
