/**
 * AI insight endpoints that analyse *group chat* specifically:
 * conversation themes, sentiment, alerts and a chat-derived collaboration score.
 */
const asyncHandler = require("../utils/asyncHandler");
const Message = require("../models/Message");
const Task = require("../models/Task");
const { summarizeConversation, chatAlerts, collaborationFromChat } = require("../services/aiService");

/** GET /api/groups/:groupId/ai/insights?limit=200 */
exports.groupInsights = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const [raw, tasks] = await Promise.all([
    Message.find({ group: req.group._id, deleted: { $ne: true } })
      .populate("sender", "name color")
      .sort("-createdAt")
      .limit(limit)
      .lean(),
    Task.find({ group: req.group._id }).lean(),
  ]);

  const messages = raw.reverse().map((m) => ({
    id: String(m._id),
    text: m.text,
    senderId: String(m.sender?._id || m.sender),
    senderName: m.sender?.name || "Member",
    createdAt: m.createdAt,
  }));

  const summary = summarizeConversation(messages);
  const alerts = chatAlerts(messages, {
    memberCount: (req.group.members || []).length,
    tasks,
  });
  const collaboration = collaborationFromChat(messages, {
    memberCount: (req.group.members || []).length,
  });

  res.json({
    success: true,
    data: {
      source: "group_chat",
      groupId: String(req.group._id),
      analyzedMessages: messages.length,
      summary,
      alerts,
      collaboration,
      generatedAt: new Date(),
    },
  });
});
