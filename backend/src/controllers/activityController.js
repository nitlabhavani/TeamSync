const asyncHandler = require("../utils/asyncHandler");
const ActivityLog = require("../models/ActivityLog");
const Group = require("../models/Group");

/** GET /api/groups/:groupId/activity — who did what and when. */
exports.groupActivity = asyncHandler(async (req, res) => {
  const logs = await ActivityLog.find({ group: req.group._id })
    .populate("actor", "name email avatar")
    .sort("-createdAt")
    .limit(Number(req.query.limit || 100))
    .lean();
  res.json({ success: true, data: logs });
});

/** GET /api/activity/audit — guide-only audit trail across their groups. */
exports.auditTrail = asyncHandler(async (req, res) => {
  const groups = await Group.find({ guide: req.user._id }).select("_id").lean();
  const logs = await ActivityLog.find({
    $or: [{ group: { $in: groups.map((g) => g._id) } }, { actor: req.user._id }],
    ...(req.query.auditOnly === "true" ? { audit: true } : {}),
  })
    .populate("actor", "name email avatar")
    .populate("group", "name")
    .sort("-createdAt")
    .limit(Number(req.query.limit || 200))
    .lean();
  res.json({ success: true, data: logs });
});
