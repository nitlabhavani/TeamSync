/**
 * STEP 27 — AI Project Knowledge & Decision Memory endpoints.
 *
 * Additive: does not touch meetingController.js, meetingIntelligenceController.js,
 * or conflictController.js. requireGroupAccess (routes/index.js) has already
 * confirmed the caller is a member/guide/admin of req.group before any of
 * these run — every query below is additionally scoped to `req.group._id`,
 * so cross-group access (including same-name groups) is impossible.
 *
 * Authorization mirrors conflictController.js / meetingIntelligenceController.js:
 * extraction, confirmation, archival and supersession are guide/team-leader
 * only (spec Phase 17/31). Reading approved project knowledge is available
 * to any group member — students get the safe shape (see
 * projectKnowledgeService.shapeForStudent), never CANDIDATE items, internal
 * confidence reasoning, or conflict-review detail (spec Phase 27).
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const ProjectKnowledge = require("../models/ProjectKnowledge");
const MeetingIntelligenceSnapshot = require("../models/MeetingIntelligenceSnapshot");
// STEP 31 — consolidated into the single shared implementation (was a
// canRequestRecommendation(...) wrapper; see utils/authz.js for details).
const { isGuideOrLeader } = require("../utils/authz");
const {
  gatherKnowledgeEvidence,
  extractKnowledgeFromMessage,
  extractKnowledgeFromMeeting,
  persistKnowledgeCandidates,
  confirmKnowledgeItem,
  archiveKnowledgeItem,
  markSupersededManually,
  createManualKnowledge,
  listGroupKnowledge,
  shapeForStudent,
} = require("../services/projectKnowledgeService");

function requireGuideOrLeader(req) {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can manage AI Project Knowledge");
  }
}

/** GET /groups/:groupId/knowledge?q=&type=&status=&page=&limit=
 * Guide/leader see every status; a student only ever sees ACTIVE/SUPERSEDED
 * knowledge in the student-safe shape (spec Phase 15/27). */
exports.list = asyncHandler(async (req, res) => {
  const guideOrLeader = isGuideOrLeader(req);
  const { q, type, page, limit } = req.query;
  const status = guideOrLeader ? req.query.status : "ACTIVE";

  const result = await listGroupKnowledge(req.group._id, { q, type, status, page, limit });

  if (guideOrLeader) {
    return res.json({ success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } });
  }
  const shaped = result.items.map(shapeForStudent).filter(Boolean);
  res.json({ success: true, data: shaped, meta: { total: result.total, page: result.page, limit: result.limit } });
});

/** GET /groups/:groupId/knowledge/:knowledgeId */
exports.getOne = asyncHandler(async (req, res) => {
  const item = await ProjectKnowledge.findOne({ _id: req.params.knowledgeId, group: req.group._id });
  if (!item) throw ApiError.notFound("Knowledge item not found");

  if (isGuideOrLeader(req)) return res.json({ success: true, data: item });

  const shaped = shapeForStudent(item);
  if (!shaped) throw ApiError.forbidden("You do not have access to this knowledge item");
  res.json({ success: true, data: shaped });
});

/** POST /groups/:groupId/knowledge/extract — guide/leader only, explicitly
 * user-triggered (spec Phase 33: never polled, never on every dashboard
 * load). Scans recent GROUP messages only (bounded — see
 * projectKnowledgeService.MAX_EXTRACTION_MESSAGES) and persists any valid
 * candidates as CANDIDATE records (never auto-confirmed). */
exports.extractFromMessages = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const sinceDate = req.body?.sinceDate ? new Date(req.body.sinceDate) : null;
  if (req.body?.sinceDate && Number.isNaN(sinceDate?.getTime())) {
    throw ApiError.badRequest("sinceDate must be a valid date");
  }

  const messages = await gatherKnowledgeEvidence(req.group._id, { sinceDate });
  const candidates = messages.map(extractKnowledgeFromMessage).filter(Boolean);

  const { created, updated, rejected } = await persistKnowledgeCandidates(req.group._id, candidates, {
    userId: req.user._id,
  });

  res.status(201).json({
    success: true,
    data: {
      scannedMessages: messages.length,
      created,
      updated,
      insufficientEvidenceCount: rejected.length,
    },
  });
});

/** POST /groups/:groupId/knowledge/from-meeting-intelligence/:snapshotId
 * — guide/leader only. Reuses an ALREADY-PERSISTED Step 26 analysis;
 * never re-runs meeting analysis (spec Phase 10). */
exports.extractFromMeetingIntelligence = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const snapshot = await MeetingIntelligenceSnapshot.findOne({ _id: req.params.snapshotId, group: req.group._id });
  if (!snapshot) throw ApiError.notFound("Meeting Intelligence analysis not found");

  const candidates = extractKnowledgeFromMeeting(snapshot);
  const { created, updated, rejected } = await persistKnowledgeCandidates(req.group._id, candidates, {
    userId: req.user._id,
  });

  res.status(201).json({
    success: true,
    data: { created, updated, insufficientEvidenceCount: rejected.length },
  });
});

/** POST /groups/:groupId/knowledge — guide/leader only manual entry
 * (spec Phase 17). Body: { type, title?, content, tags? } */
exports.createManual = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const { type, title, content, tags } = req.body || {};
  const result = await createManualKnowledge(req.group._id, { type, title, content, tags }, req.user._id);

  if (result.error === "INSUFFICIENT_EVIDENCE") {
    throw ApiError.badRequest("Provide a valid knowledge type and meaningful content");
  }
  if (result.error === "DUPLICATE") {
    return res.status(200).json({ success: true, data: result.doc, meta: { duplicate: true } });
  }
  res.status(201).json({ success: true, data: result.doc });
});

/** POST /groups/:groupId/knowledge/:knowledgeId/confirm — guide/leader only. */
exports.confirm = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const result = await confirmKnowledgeItem(req.group._id, req.params.knowledgeId, req.user._id);
  if (result.error === "NOT_FOUND") throw ApiError.notFound("Knowledge item not found");
  res.json({ success: true, data: result.doc });
});

/** POST /groups/:groupId/knowledge/:knowledgeId/archive — guide/leader only.
 * Never deletes (spec Phase 18). */
exports.archive = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const result = await archiveKnowledgeItem(req.group._id, req.params.knowledgeId, req.user._id);
  if (result.error === "NOT_FOUND") throw ApiError.notFound("Knowledge item not found");
  res.json({ success: true, data: result.doc });
});

/** POST /groups/:groupId/knowledge/:knowledgeId/mark-superseded
 * — guide/leader only manual override. Body: { supersededByKnowledgeId } */
exports.markSuperseded = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const { supersededByKnowledgeId } = req.body || {};
  if (!supersededByKnowledgeId) throw ApiError.badRequest("supersededByKnowledgeId is required");

  const result = await markSupersededManually(req.group._id, req.params.knowledgeId, supersededByKnowledgeId, req.user._id);
  if (result.error === "NOT_FOUND") throw ApiError.notFound("One or both knowledge items were not found in this group");
  res.json({ success: true, data: { old: result.oldDoc, new: result.newDoc } });
});
