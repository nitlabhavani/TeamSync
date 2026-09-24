const asyncHandler = require("../utils/asyncHandler");
const CallLog = require("../models/CallLog");

/**
 * GET /api/calls/history/:userId — recent private call history between the
 * authenticated user and :userId. Metadata only (see models/CallLog.js) —
 * never audio/video/transcripts. Scoped to the two participants only, same
 * pattern as chatController.directMessages.
 */
exports.privateCallHistory = asyncHandler(async (req, res) => {
  const me = String(req.user._id);
  const other = String(req.params.userId);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const calls = await CallLog.find({
    $or: [
      { caller: me, receiver: other },
      { caller: other, receiver: me },
    ],
  })
    .sort("-createdAt")
    .limit(limit)
    .lean();

  res.json({ success: true, data: calls });
});

/**
 * GET /api/calls/history — all recent call logs for the authenticated user.
 * Populates caller and receiver details for WhatsApp-style Calls history tab.
 */
exports.myCallHistory = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const limit = Math.min(Number(req.query.limit) || 100, 200);

  const calls = await CallLog.find({
    $or: [{ caller: me }, { receiver: me }],
  })
    .populate("caller receiver", "name color avatar role dept")
    .sort("-createdAt")
    .limit(limit)
    .lean();

  res.json({ success: true, data: calls });
});

