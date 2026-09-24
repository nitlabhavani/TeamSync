const asyncHandler = require("../utils/asyncHandler");
const Notification = require("../models/Notification");

exports.list = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.unread === "true") filter.read = false;
  const items = await Notification.find(filter).sort("-createdAt").limit(100);
  const unread = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ success: true, data: { items, unread } });
});

exports.markRead = asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
  res.json({ success: true });
});

exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ success: true });
});

exports.remove = asyncHandler(async (req, res) => {
  await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ success: true });
});
