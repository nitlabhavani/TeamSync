/**
 * STEP 24 — AI Conflict Detection & Resolution endpoints.
 *
 * Additive: does not touch chatController.js, taskController.js, or any
 * risk/performance controller. requireGroupAccess (routes/index.js) has
 * already confirmed the caller is a member/guide/admin of req.group before
 * any of these run — a student can never reach another group's conflicts
 * by guessing an id, since every query below is additionally scoped by
 * `group: req.group._id`.
 *
 * Authorization mirrors sprintPlannerController.js exactly: only the
 * Guide or Team Leader may see the full conflict list/detail or change its
 * lifecycle. Ordinary students only ever see the student-safe shape of a
 * conflict that actually involves them (see conflictDetectionService.
 * shapeForStudent) — never another member's conflicts, never guide-only
 * reasoning, and never private chat (nothing here ever reads `conversation`
 * -scoped messages).
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const ConflictSnapshot = require("../models/ConflictSnapshot");
// STEP 31 — consolidated into the single shared implementation (was a
// canRequestRecommendation(...) call repeated 3x; see utils/authz.js for details).
const { isGuideOrLeader: computeIsGuideOrLeader } = require("../utils/authz");
const { shapeForStudent, applyLifecycleTransition, sanitizeResolutionNote } = require("../services/conflictDetectionService");

function requireGuideOrLeader(req) {
  if (!computeIsGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view team conflict details");
  }
}

/** GET /groups/:groupId/conflicts — guide/leader see everything; a student
 * sees only the (safely-shaped) conflicts that involve them. */
exports.list = asyncHandler(async (req, res) => {
  const isGuideOrLeader = computeIsGuideOrLeader(req);

  const query = { group: req.group._id };
  if (!isGuideOrLeader) query.involvedUserIds = req.user._id;

  const conflicts = await ConflictSnapshot.find(query).sort("-createdAt").limit(100);

  if (isGuideOrLeader) {
    return res.json({ success: true, data: conflicts });
  }
  const shaped = conflicts.map((c) => shapeForStudent(c, req.user._id)).filter(Boolean);
  res.json({ success: true, data: shaped });
});

/** GET /groups/:groupId/conflicts/:conflictId */
exports.getOne = asyncHandler(async (req, res) => {
  const conflict = await ConflictSnapshot.findOne({ _id: req.params.conflictId, group: req.group._id });
  if (!conflict) throw ApiError.notFound("Conflict not found");

  const isGuideOrLeader = computeIsGuideOrLeader(req);
  if (isGuideOrLeader) return res.json({ success: true, data: conflict });

  const shaped = shapeForStudent(conflict, req.user._id);
  if (!shaped) throw ApiError.forbidden("You do not have access to this conflict");
  res.json({ success: true, data: shaped });
});

/** POST /groups/:groupId/conflicts/:conflictId/acknowledge — guide/leader only. */
exports.acknowledge = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const conflict = await ConflictSnapshot.findOne({ _id: req.params.conflictId, group: req.group._id });
  if (!conflict) throw ApiError.notFound("Conflict not found");
  const transition = applyLifecycleTransition(conflict.status, "acknowledge");
  if (!transition.ok) throw ApiError.badRequest(transition.reason);
  conflict.status = transition.status;
  conflict.acknowledgedAt = new Date();
  conflict.acknowledgedBy = req.user._id;
  await conflict.save();
  res.json({ success: true, data: conflict });
});

/** POST /groups/:groupId/conflicts/:conflictId/resolve — guide/leader only.
 * Never deletes the record — historical evidence stays available (spec §12). */
exports.resolve = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const conflict = await ConflictSnapshot.findOne({ _id: req.params.conflictId, group: req.group._id });
  if (!conflict) throw ApiError.notFound("Conflict not found");
  const transition = applyLifecycleTransition(conflict.status, "resolve");
  if (!transition.ok) throw ApiError.badRequest(transition.reason);
  conflict.status = transition.status;
  conflict.resolvedAt = new Date();
  conflict.resolvedBy = req.user._id;
  conflict.resolutionNote = sanitizeResolutionNote(req.body?.resolutionNote);
  await conflict.save();
  res.json({ success: true, data: conflict });
});

/** POST /groups/:groupId/conflicts/:conflictId/dismiss — guide/leader only. */
exports.dismiss = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const conflict = await ConflictSnapshot.findOne({ _id: req.params.conflictId, group: req.group._id });
  if (!conflict) throw ApiError.notFound("Conflict not found");
  const transition = applyLifecycleTransition(conflict.status, "dismiss");
  if (!transition.ok) throw ApiError.badRequest(transition.reason);
  conflict.status = transition.status;
  conflict.resolvedAt = new Date();
  conflict.resolvedBy = req.user._id;
  conflict.resolutionNote = sanitizeResolutionNote(req.body?.resolutionNote);
  await conflict.save();
  res.json({ success: true, data: conflict });
});
