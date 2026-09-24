/**
 * STEP 28 — AI Project Memory Assistant / Contextual Project Q&A endpoint.
 *
 * Additive: does not touch projectKnowledgeController.js,
 * meetingIntelligenceController.js, conflictController.js, or any other
 * existing route. requireGroupAccess (routes/index.js) has already
 * confirmed the caller is a member/guide/admin of req.group before this
 * runs — every retrieval inside projectMemoryAssistantService is
 * additionally scoped to `req.group._id`, so cross-group access (including
 * same-name groups) is impossible, and `groupId` is only ever taken from
 * the authorized `req.group`, never trusted from the request body.
 *
 * Authorization for the "which guide-only data this question is allowed to
 * touch" decision mirrors every other AI controller in this codebase
 * (projectKnowledgeController.js, conflictController.js): guide/admin OR
 * the group's Team Leader get the full picture; a plain student gets the
 * existing student-safe shaping (see projectMemoryAssistantService —
 * reuses projectKnowledgeService.shapeForStudent / conflictDetectionService.
 * shapeForStudent unchanged) or, for data that has no student-safe shape at
 * all in this codebase (full Meeting Intelligence, Project Health,
 * Forecast, Team Risk, Sprint planning), a plain "guide/leader only"
 * message — never a 500, never guide-only data.
 *
 * Ephemeral by design (spec §14/33): a question is answered and returned;
 * nothing about the question or answer is persisted here.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
// STEP 31 — consolidated into the single shared implementation (was a
// canRequestRecommendation(...) wrapper; see utils/authz.js for details).
const { isGuideOrLeader } = require("../utils/authz");
const { askProjectMemory } = require("../services/projectMemoryAssistantService");



/** POST /groups/:groupId/ai/project-memory/ask
 * Body: { question } */
exports.ask = asyncHandler(async (req, res) => {
  const question = req.body?.question;
  if (!question || typeof question !== "string" || !question.trim()) {
    throw ApiError.badRequest("question is required");
  }
  if (question.length > 1000) {
    throw ApiError.badRequest("question is too long (max 1000 characters)");
  }

  const result = await askProjectMemory({
    group: req.group,
    userId: req.user._id,
    isGuideOrLeader: isGuideOrLeader(req),
    question,
  });

  res.json(result);
});
