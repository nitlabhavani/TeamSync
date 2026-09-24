/**
 * Global search: groups, members and files, scoped to what the caller can see.
 * GET /api/search?q=design&type=all|groups|members|files&limit=20
 */
const asyncHandler = require("../utils/asyncHandler");
const Group = require("../models/Group");
const User = require("../models/User");
const FileAsset = require("../models/FileAsset");
const Message = require("../models/Message");

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every group the caller may read. Admins see everything. */
async function visibleGroups(user) {
  const filter =
    user.role === "admin"
      ? {}
      : { $or: [{ guide: user._id }, { members: user._id }] };
  return Group.find(filter)
    .populate("guide", "name email color avatar")
    .populate("members", "name email role dept color avatar")
    .sort("name");
}

exports.search = asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const type = String(req.query.type || "all");
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  if (!q) {
    return res.json({
      success: true,
      data: { query: "", groups: [], members: [], files: [], messages: [], total: 0 },
    });
  }

  const re = new RegExp(escapeRe(q), "i");
  const groups = await visibleGroups(req.user);
  const groupIds = groups.map((g) => g._id);

  const wants = (t) => type === "all" || type === t;

  const matchedGroups = wants("groups")
    ? groups
        .filter((g) => re.test(g.name || "") || re.test(g.project || "") || re.test(g.description || ""))
        .slice(0, limit)
    : [];

  let members = [];
  if (wants("members")) {
    const memberIds = new Set();
    groups.forEach((g) => {
      (g.members || []).forEach((m) => memberIds.add(String(m._id)));
      if (g.guide) memberIds.add(String(g.guide._id));
    });
    // Guides and admins can find any active user; students search their teams
    // plus the wider directory so they can start a private chat.
    const found = await User.find({
      isActive: true,
      $or: [{ name: re }, { email: re }, { dept: re }],
    })
      .select("name email role dept color avatar")
      .sort("name")
      .limit(limit);
    members = found.map((u) => ({
      ...u.toObject(),
      inMyTeams: memberIds.has(String(u._id)),
    }));
  }

  const files = wants("files")
    ? await FileAsset.find({
        group: { $in: groupIds },
        $or: [{ name: re }, { originalName: re }, { type: re }],
      })
        .populate("uploadedBy", "name color avatar")
        .populate("group", "name")
        .sort("-createdAt")
        .limit(limit)
    : [];

  const messages = wants("messages")
    ? await Message.find({ group: { $in: groupIds }, text: re, deleted: { $ne: true } })
        .populate("sender", "name color avatar")
        .populate("group", "name")
        .sort("-createdAt")
        .limit(limit)
    : [];

  res.json({
    success: true,
    data: {
      query: q,
      groups: matchedGroups,
      members,
      files,
      messages,
      total: matchedGroups.length + members.length + files.length + messages.length,
    },
  });
});
