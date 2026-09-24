/**
 * STEP 26 — AI Meeting Intelligence endpoints.
 *
 * Additive: does not touch meetingController.js (Step 16's per-meeting
 * summary/convert-actions flow and ad-hoc meeting-action-items extraction
 * both keep working exactly as before). requireGroupAccess (routes/index.js)
 * has already confirmed the caller is a member/guide/admin of req.group
 * before any of these run — every query below is additionally scoped to
 * `req.group._id`, so cross-group access (including same-name groups) is
 * impossible.
 *
 * Authorization mirrors conflictController.js / projectWhatIfController.js
 * exactly: full analysis is guide/team-leader only (this reads
 * cross-member ownership/blocker/conflict information, the same class of
 * management data those endpoints already gate this way). A normal student
 * gets a 403, matching the existing convention — there is no separate
 * "safe student view" precedent for full meeting analysis to reuse (spec
 * Phase 24: do not invent a new authorization system).
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const User = require("../models/User");
const MeetingIntelligenceSnapshot = require("../models/MeetingIntelligenceSnapshot");
const { canRequestRecommendation } = require("../services/smartTaskAssignmentService");
const { analyzeMeetingIntelligence } = require("../services/meetingIntelligenceService");

function requireGuideOrLeader(req) {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id })) {
    throw ApiError.forbidden("Only the guide or team leader can use AI Meeting Intelligence");
  }
}

const ERROR_MAP = {
  MEETING_NOT_FOUND: () => ApiError.notFound("Meeting not found"),
  WINDOW_REQUIRED: () => ApiError.badRequest("Provide startTime/endTime, or a meetingId"),
  INVALID_WINDOW: () => ApiError.badRequest("startTime/endTime must be valid dates"),
  START_AFTER_END: () => ApiError.badRequest("startTime must be before endTime"),
  WINDOW_TOO_LARGE: () => ApiError.badRequest("Time window is too large (30 day limit)"),
};

/** POST /groups/:groupId/meeting-intelligence/analyze
 * Body: { meetingId? , startTime?, endTime?, persist? } */
exports.analyze = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);

  const { meetingId, startTime, endTime } = req.body || {};
  const persist = req.body?.persist !== false;

  const members = await User.find({ _id: { $in: req.group.members } }).select("name").lean();

  const result = await analyzeMeetingIntelligence(req.group, members, {
    meetingId,
    startTime,
    endTime,
    persist,
    userId: req.user._id,
  });

  if (result?.error) {
    const build = ERROR_MAP[result.error];
    throw build ? build() : ApiError.badRequest("Could not analyze this meeting");
  }

  res.status(persist ? 201 : 200).json({ success: true, data: result });
});

/** GET /groups/:groupId/meeting-intelligence — recent analysis history for this group. */
exports.list = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const snapshots = await MeetingIntelligenceSnapshot.find({ group: req.group._id }).sort("-createdAt").limit(50);
  res.json({ success: true, data: snapshots });
});

/** GET /groups/:groupId/meeting-intelligence/:id */
exports.getOne = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const snapshot = await MeetingIntelligenceSnapshot.findOne({ _id: req.params.id, group: req.group._id });
  if (!snapshot) throw ApiError.notFound("Meeting intelligence snapshot not found");
  res.json({ success: true, data: snapshot });
});
