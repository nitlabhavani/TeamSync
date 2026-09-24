const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Community = require("../models/Community");
const Group = require("../models/Group");

/**
 * Checks if user is authorized to manage a community (owner, admin, guide).
 */
function isCommunityManager(community, user) {
  if (!community || !user) return false;
  if (user.role === "admin" || user.role === "guide") return true;
  if (String(community.createdBy) === String(user._id)) return true;
  return (community.admins || []).some((a) => String(a) === String(user._id));
}

/**
 * Filters community groups based on user access (preserves student privacy).
 */
function filterAccessibleGroups(groups, user) {
  if (!Array.isArray(groups)) return [];
  if (user.role === "admin" || user.role === "guide") return groups;

  const uid = String(user._id);
  return groups.filter((g) => {
    if (!g) return false;
    const isMember = (g.members || []).some((m) => String(m._id || m) === uid);
    const isLeader = String(g.leader?._id || g.leader) === uid;
    return isMember || isLeader;
  });
}

/**
 * GET /api/communities — list all communities respecting student group isolation.
 */
exports.list = asyncHandler(async (req, res) => {
  const communities = await Community.find()
    .populate("createdBy", "name avatar color role dept")
    .populate("groups", "name project category progress members leader guide")
    .sort("-createdAt")
    .lean();

  const filtered = communities.map((comm) => {
    const accessibleGroups = filterAccessibleGroups(comm.groups, req.user);
    return {
      ...comm,
      groups: accessibleGroups,
      totalGroupsCount: accessibleGroups.length,
    };
  });

  res.json({ success: true, data: filtered });
});

/**
 * POST /api/communities — create a new community (Guide or Admin only).
 */
exports.create = asyncHandler(async (req, res) => {
  if (req.user.role === "student") {
    throw ApiError.forbidden("Only guides and administrators can create communities");
  }

  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    throw ApiError.badRequest("Community name is required");
  }

  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const category = typeof req.body.category === "string" ? req.body.category.trim() : "General";
  const color = typeof req.body.color === "string" ? req.body.color.trim() : "#059669";
  const initialGroupIds = Array.isArray(req.body.groupIds) ? req.body.groupIds : [];

  const community = await Community.create({
    name,
    description,
    category,
    color,
    createdBy: req.user._id,
    admins: [req.user._id],
    groups: initialGroupIds,
    members: [req.user._id],
  });

  const populated = await community.populate("createdBy", "name avatar color role dept");
  res.status(201).json({ success: true, data: populated });
});

/**
 * GET /api/communities/:id — get community details with group isolation.
 */
exports.getOne = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id)
    .populate("createdBy admins", "name avatar color role dept email")
    .populate({
      path: "groups",
      select: "name project description category collaborationScore progress members guide leader",
      populate: { path: "guide leader", select: "name avatar color" },
    })
    .populate("announcements.sender", "name avatar color role")
    .lean();

  if (!community) {
    throw ApiError.notFound("Community not found");
  }

  community.groups = filterAccessibleGroups(community.groups, req.user);
  res.json({ success: true, data: community });
});

/**
 * POST /api/communities/:id/groups — link a project group to community.
 * Validates manager permissions and ensures a group belongs to at most one community.
 */
exports.addGroup = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id);
  if (!community) throw ApiError.notFound("Community not found");

  if (!isCommunityManager(community, req.user)) {
    throw ApiError.forbidden("Only community managers or guides can add groups");
  }

  const { groupId } = req.body;
  if (!groupId) throw ApiError.badRequest("groupId is required");

  const group = await Group.findById(groupId);
  if (!group) throw ApiError.notFound("Group not found");

  // Enforce single-community membership: a group cannot belong to another community
  const existingCommunity = await Community.findOne({
    _id: { $ne: community._id },
    groups: groupId,
  });
  if (existingCommunity) {
    throw ApiError.badRequest(`Group "${group.name}" already belongs to community "${existingCommunity.name}"`);
  }

  if (!community.groups.some((g) => String(g) === String(groupId))) {
    community.groups.push(groupId);
    await community.save();
  }

  const updated = await Community.findById(community._id)
    .populate("groups", "name project description category members")
    .lean();

  res.json({ success: true, data: updated });
});

/**
 * DELETE /api/communities/:id/groups/:groupId — remove a project group from community.
 */
exports.removeGroup = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id);
  if (!community) throw ApiError.notFound("Community not found");

  if (!isCommunityManager(community, req.user)) {
    throw ApiError.forbidden("Only community managers or guides can remove groups");
  }

  const { groupId } = req.params;
  community.groups = community.groups.filter((g) => String(g) !== String(groupId));
  await community.save();

  res.json({ success: true, message: "Group removed from community" });
});

/**
 * POST /api/communities/:id/announcements — post an announcement to the community.
 * Restricts posting to community managers, admins, and guides.
 */
exports.postAnnouncement = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id);
  if (!community) throw ApiError.notFound("Community not found");

  if (!isCommunityManager(community, req.user)) {
    throw ApiError.forbidden("Only community managers or guides can post announcements");
  }

  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

  if (!title || !content) {
    throw ApiError.badRequest("Title and content are required for community announcement");
  }

  community.announcements.unshift({
    title,
    content,
    sender: req.user._id,
    createdAt: new Date(),
  });

  await community.save();
  const populated = await Community.findById(community._id)
    .populate("announcements.sender", "name avatar color role")
    .lean();

  res.status(201).json({ success: true, data: populated.announcements });
});

/**
 * DELETE /api/communities/:id/announcements/:announcementId — delete an announcement.
 */
exports.deleteAnnouncement = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id);
  if (!community) throw ApiError.notFound("Community not found");

  if (!isCommunityManager(community, req.user)) {
    throw ApiError.forbidden("Only community managers or guides can delete announcements");
  }

  const { announcementId } = req.params;
  community.announcements = community.announcements.filter(
    (a) => String(a._id) !== String(announcementId)
  );
  await community.save();

  res.json({ success: true, message: "Announcement deleted" });
});
