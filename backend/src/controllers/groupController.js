const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Group = require("../models/Group");
const User = require("../models/User");
const Task = require("../models/Task");
const Milestone = require("../models/Milestone");
const Invitation = require("../models/Invitation");
const Message = require("../models/Message");
const FileAsset = require("../models/FileAsset");
const Meeting = require("../models/Meeting");
const ReviewRound = require("../models/ReviewRound");
const PeerReview = require("../models/PeerReview");
const RiskSnapshot = require("../models/RiskSnapshot");
const AiReport = require("../models/AiReport");
const ActivityLog = require("../models/ActivityLog");
const Badge = require("../models/Badge");
const { notifyUsers } = require("../services/notificationService");
const { issueInvitation, resendOtp } = require("../services/invitationService");
const { logActivity } = require("../services/activityService");
const { autoPlanAndAssignTasks } = require("../services/autoProjectPlanningService");
const { GROUP_CATEGORIES } = require("../models/Group");

const populated = (q) =>
  q
    .populate("guide", "name email color avatar")
    .populate("leader", "name email color avatar")
    .populate("members", "name email color avatar dept");

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** A guide explicitly re-inviting a rejected student resets the invitation. */
const req_forceReinvite = String(process.env.ALLOW_REINVITE_AFTER_REJECT ?? "true") === "true";

/** Normalise + de-duplicate a list of invitee emails. */
const cleanEmails = (list) => [
  ...new Set(
    (Array.isArray(list) ? list : [])
      .map((e) => String(e || "").toLowerCase().trim())
      .filter((e) => EMAIL_RE.test(e))
  ),
];

/**
 * Invite a set of emails to a group.
 *
 * Every invitee receives an invitation link + OTP. Nobody is added to the
 * group until they verify the OTP (see controllers/invitationController.js).
 * The first email of a brand-new group is invited as the Team Leader.
 */
async function inviteEmails({ group, emails, invitedBy, leaderEmail }) {
  const results = [];
  const existing = await User.find({ email: { $in: emails } }).select("name email role isActive");
  const byEmail = new Map(existing.map((u) => [u.email, u]));

  for (const email of emails) {
    if (email === String(invitedBy.email).toLowerCase()) {
      results.push({ email, status: "skipped", reason: "That's your own address" });
      continue;
    }

    const user = byEmail.get(email);
    const alreadyMember = user && group.members.some((m) => String(m) === String(user._id));
    if (alreadyMember) {
      results.push({ email, status: "skipped", reason: "Already a member" });
      continue;
    }

    const existingInvite = await Invitation.findOne({ group: group._id, email });
    if (existingInvite?.status === "rejected" && !req_forceReinvite) {
      results.push({ email, status: "rejected", reason: "Student rejected this invitation" });
      continue;
    }
    if (existingInvite?.status === "accepted") {
      results.push({ email, status: "accepted", reason: "Already joined this group" });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const { invitation, emailSent, devOtp } = await issueInvitation({
      group,
      email,
      invitedBy,
      role: leaderEmail && email === leaderEmail ? "leader" : "member",
    });

    results.push({
      email,
      status: invitation.status,
      role: invitation.role,
      token: invitation.token,
      emailSent,
      devOtp,
      name: user?.name || null,
      userId: user?._id || null,
    });
  }

  await group.save();
  await logActivity({
    group: group._id,
    req: { user: invitedBy },
    action: "invitation.sent",
    summary: `${results.filter((r) => r.status === "pending").length} invitation(s) sent for ${group.name}`,
    meta: { emails },
  });

  return results;
}

exports.list = asyncHandler(async (req, res) => {
  const filter = { status: req.query.status || "active" };
  if (req.user.role === "guide") filter.guide = req.user._id;
  else if (req.user.role === "student") filter.members = req.user._id;
  const groups = await populated(Group.find(filter)).sort("-createdAt");
  res.json({ success: true, data: groups });
});

exports.getOne = asyncHandler(async (req, res) => {
  const group = await populated(Group.findById(req.params.groupId));
  if (!group) throw ApiError.notFound("Group not found");
  res.json({ success: true, data: group });
});

/**
 * Create a group. Guides only — students can never create teams.
 * Body: { name, project, description, memberEmails: string[] }
 */
exports.create = asyncHandler(async (req, res) => {
  if (!["guide", "admin"].includes(req.user.role))
    throw ApiError.forbidden("Only a guide can create a group");

  const name = String(req.body.name || "").trim();
  const project = String(req.body.project || "").trim();
  if (name.length < 3) throw ApiError.badRequest("Team title must be at least 3 characters");
  if (!project) throw ApiError.badRequest("Project name is required");

  const rawEmails = req.body.memberEmails ?? req.body.emails ?? [];
  const emails = cleanEmails(rawEmails);
  const invalid = (Array.isArray(rawEmails) ? rawEmails : []).filter(
    (e) => String(e || "").trim() && !EMAIL_RE.test(String(e).trim())
  );
  if (invalid.length) throw ApiError.badRequest(`Invalid email address: ${invalid[0]}`);

  const category = GROUP_CATEGORIES.includes(req.body.category) ? req.body.category : "Other";
  const expectedCompletion = req.body.expectedCompletion ? new Date(req.body.expectedCompletion) : null;
  if (expectedCompletion && Number.isNaN(expectedCompletion.getTime()))
    throw ApiError.badRequest("Expected completion date is invalid");

  // If registered active students exist for the provided emails, include them in group.members
  // so they are immediate active participants and eligible for immediate task assignment.
  const registeredStudents = emails.length
    ? await User.find({ email: { $in: emails }, isActive: true, role: "student" }).select("_id email name")
    : [];
  const initialMemberIds = registeredStudents.map((u) => u._id);
  const matchedLeader = registeredStudents.find(
    (u) => emails[0] && u.email.toLowerCase() === emails[0].toLowerCase()
  );

  const group = await Group.create({
    name,
    project,
    description: String(req.body.description || "").trim(),
    category,
    expectedCompletion,
    maxMembers: Number(req.body.maxMembers || 0),
    guide: req.user._id,
    members: initialMemberIds,
    leader: matchedLeader ? matchedLeader._id : undefined,
    // The first student invited becomes the Team Leader once they accept.
    leaderEmail: emails[0] || "",
    inviteCode: crypto.randomBytes(4).toString("hex").toUpperCase(),
  });

  const invitations = emails.length
    ? await inviteEmails({ group, emails, invitedBy: req.user, leaderEmail: emails[0] })
    : [];

  await logActivity({ req, group: group._id, action: "group.created", summary: `Created group ${group.name}`, audit: true });

  // Trigger automatic project task planning if title and description are provided
  let autoPlanResult = null;
  const shouldAutoPlan = req.body.autoGenerateTasks !== false;
  if (shouldAutoPlan && group.description && group.description.trim().length >= 5) {
    try {
      autoPlanResult = await autoPlanAndAssignTasks({
        group,
        reqUser: req.user,
        projectTitle: group.project,
        projectDescription: group.description,
        deadline: group.expectedCompletion,
      });
    } catch (planErr) {
      console.error("[groupController.create] Automatic planning error:", planErr.message);
      autoPlanResult = { success: false, error: planErr.message };
    }
  }

  res.status(201).json({
    success: true,
    data: await populated(Group.findById(group._id)),
    meta: {
      invitations,
      autoTasksCreated: autoPlanResult?.count || 0,
      tasks: autoPlanResult?.tasks || [],
      autoPlan: autoPlanResult,
    },
  });
});

exports.update = asyncHandler(async (req, res) => {
  const isLeader =
    String(req.group.leader?._id || req.group.leader || "") === String(req.user._id) ||
    (req.group.leaderEmail && String(req.user.email || "").toLowerCase() === String(req.group.leaderEmail).toLowerCase());
  if (!req.isGuide && !isLeader) throw ApiError.forbidden("Only the guide or team leader can edit this group");

  if (isLeader && !req.group.leader) {
    req.group.leader = req.user._id;
  }

  const prevProject = req.group.project;
  const prevDescription = req.group.description;

  const allowed = req.isGuide
    ? ["name", "project", "description", "category", "expectedCompletion", "maxMembers", "progress", "collaborationScore", "status"]
    : ["project", "description", "category", "expectedCompletion"];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) req.group[k] = req.body[k];
  });
  await req.group.save();

  // If project title or description was modified, or autoGenerateTasks was requested:
  let autoPlanResult = null;
  const projectChanged =
    (req.body.project !== undefined && req.body.project !== prevProject) ||
    (req.body.description !== undefined && req.body.description !== prevDescription);
  const shouldAutoPlan = req.body.autoGenerateTasks === true || (projectChanged && req.body.autoGenerateTasks !== false);

  if (shouldAutoPlan && req.group.description && req.group.description.trim().length >= 5) {
    try {
      autoPlanResult = await autoPlanAndAssignTasks({
        group: req.group,
        reqUser: req.user,
        projectTitle: req.group.project,
        projectDescription: req.group.description,
        deadline: req.group.expectedCompletion,
        force: req.body.forcePlan === true,
      });
    } catch (planErr) {
      console.error("[groupController.update] Automatic planning error:", planErr.message);
      autoPlanResult = { success: false, error: planErr.message };
    }
  }

  res.json({
    success: true,
    data: await populated(Group.findById(req.group._id)),
    meta: {
      autoTasksCreated: autoPlanResult?.count || 0,
      tasks: autoPlanResult?.tasks || [],
      autoPlan: autoPlanResult,
    },
  });
});

/**
 * POST /api/groups/:groupId/ai/auto-plan-tasks
 * Explicit manual trigger/retry by Guide or Team Leader.
 */
exports.autoPlanTasks = asyncHandler(async (req, res) => {
  const isLeader =
    String(req.group.leader?._id || req.group.leader || "") === String(req.user._id) ||
    (req.group.leaderEmail && String(req.user.email || "").toLowerCase() === String(req.group.leaderEmail).toLowerCase());
  if (!req.isGuide && !isLeader) {
    throw ApiError.forbidden("Only the guide or team leader can trigger automatic project planning");
  }

  const result = await autoPlanAndAssignTasks({
    group: req.group,
    reqUser: req.user,
    projectTitle: req.body.projectTitle || req.group.project,
    projectDescription: req.body.projectDescription || req.group.description,
    deadline: req.body.deadline || req.group.expectedCompletion,
    force: req.body.force === true,
  });

  res.status(result.success && !result.skipped ? 201 : 200).json({
    success: result.success,
    data: {
      created: result.count || 0,
      tasks: result.tasks || [],
      skipped: result.skipped || false,
      reason: result.reason || null,
      assignedMembers: result.assignedMembers || 0,
      duplicates: result.duplicates || [],
    },
  });
});

/** Add members by email (guide only). */
exports.inviteMembers = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can invite members");
  const emails = cleanEmails(req.body.memberEmails ?? req.body.emails ?? [req.body.email]);
  if (!emails.length) throw ApiError.badRequest("Enter at least one valid email address");

  const leaderEmail = !req.group.leader && !req.group.leaderEmail ? emails[0] : req.group.leaderEmail;
  if (!req.group.leaderEmail) req.group.leaderEmail = leaderEmail || "";
  const invitations = await inviteEmails({ group: req.group, emails, invitedBy: req.user, leaderEmail });
  res.status(201).json({
    success: true,
    data: await populated(Group.findById(req.group._id)),
    meta: { invitations },
  });
});

exports.listInvitations = asyncHandler(async (req, res) => {
  const invites = await Invitation.find({ group: req.group._id })
    .populate("user", "name email color avatar")
    .sort("-createdAt");
  res.json({ success: true, data: invites });
});

exports.cancelInvitation = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can cancel invitations");
  const invite = await Invitation.findOneAndDelete({
    _id: req.params.invitationId,
    group: req.group._id,
    status: "pending",
  });
  if (!invite) throw ApiError.notFound("Pending invitation not found");
  res.json({ success: true, message: "Invitation cancelled" });
});

exports.resendInvitation = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can resend invitations");
  const invite = await Invitation.findOne({ _id: req.params.invitationId, group: req.group._id });
  if (!invite) throw ApiError.notFound("Invitation not found");

  try {
    const result = await resendOtp(invite, req.group, req.user);
    res.json({
      success: true,
      data: invite,
      meta: result,
      message: result.emailSent ? "Invitation and new OTP resent" : "Email delivery failed",
    });
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
});

/** Promote a member to Team Leader (guide only). */
exports.setLeader = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can change the team leader");
  const { userId } = req.body;
  if (!req.group.members.some((m) => String(m) === String(userId)))
    throw ApiError.badRequest("That student is not a member of this group");
  req.group.leader = userId;
  await req.group.save();
  await notifyUsers([userId], {
    title: "You are now the Team Leader",
    body: `${req.group.name} — you can now assign tasks to your team.`,
    type: "system",
    link: `/app/groups/${req.group._id}`,
    group: req.group._id,
  });
  await logActivity({ req, group: req.group._id, action: "group.leader_changed", summary: "Team leader updated", audit: true });
  res.json({ success: true, data: await populated(Group.findById(req.group._id)) });
});

/** Legacy add-by-id, still used by the member picker. */
exports.addMember = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can add members");
  const { userId } = req.body;
  if (req.group.members.some((m) => String(m) === String(userId)))
    throw ApiError.conflict("User is already a member");
  req.group.members.push(userId);
  await req.group.save();
  await notifyUsers([userId], {
    title: `Added to ${req.group.name}`,
    body: req.group.project,
    type: "system",
    group: req.group._id,
  });
  res.json({ success: true, data: await populated(Group.findById(req.group._id)) });
});

exports.removeMember = asyncHandler(async (req, res) => {
  const isSelf = String(req.params.userId) === String(req.user._id);
  if (!req.isGuide && !isSelf)
    throw ApiError.forbidden("Only the guide can remove other members");

  req.group.members = req.group.members.filter((m) => String(m) !== String(req.params.userId));
  await req.group.save();
  await Invitation.deleteOne({ group: req.group._id, user: req.params.userId });

  if (!isSelf) {
    await notifyUsers([req.params.userId], {
      title: `Removed from ${req.group.name}`,
      body: `You have been removed from ${req.group.name} by your guide.`,
      type: "system",
      group: req.group._id,
    });
  }

  res.json({
    success: true,
    message: isSelf ? "You left the group" : "Member removed",
    data: await populated(Group.findById(req.group._id)),
  });
});

exports.join = asyncHandler(async (req, res) => {
  const group = await Group.findOne({ inviteCode: String(req.body.inviteCode || "").toUpperCase() });
  if (!group) throw ApiError.notFound("Invalid invite code");
  if (!group.members.some((m) => String(m) === String(req.user._id))) {
    group.members.push(req.user._id);
    await group.save();
  }
  res.json({ success: true, data: await populated(Group.findById(group._id)) });
});

exports.remove = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can delete this group");
  const groupId = req.group._id;

  // Best-effort cleanup of uploaded files on disk for this group's file assets.
  const assets = await FileAsset.find({ group: groupId }).select("url").lean();
  const uploadsRoot = path.join(__dirname, "..", "..", process.env.UPLOAD_DIR || "uploads");
  assets.forEach((a) => {
    if (!a.url || !a.url.startsWith("/uploads/")) return;
    const abs = path.join(uploadsRoot, a.url.replace(/^\/uploads\//, ""));
    if (abs.startsWith(uploadsRoot)) fs.promises.unlink(abs).catch(() => {});
  });

  // Cascade-delete every collection that references this group so a deleted
  // group doesn't leave orphaned Tasks/Messages/Files/Reports/etc behind.
  await Promise.all([
    Invitation.deleteMany({ group: groupId }),
    Task.deleteMany({ group: groupId }),
    Milestone.deleteMany({ group: groupId }),
    Message.deleteMany({ group: groupId }),
    FileAsset.deleteMany({ group: groupId }),
    Meeting.deleteMany({ group: groupId }),
    ReviewRound.deleteMany({ group: groupId }),
    PeerReview.deleteMany({ group: groupId }),
    RiskSnapshot.deleteMany({ group: groupId }),
    AiReport.deleteMany({ group: groupId }),
    ActivityLog.deleteMany({ group: groupId }),
    Badge.deleteMany({ group: groupId }),
  ]);

  await Group.findByIdAndDelete(groupId);
  res.json({ success: true, message: "Group deleted" });
});

/** Milestones */
exports.listMilestones = asyncHandler(async (req, res) => {
  const items = await Milestone.find({ group: req.group._id }).sort("due");
  res.json({ success: true, data: items });
});

exports.createMilestone = asyncHandler(async (req, res) => {
  const m = await Milestone.create({ ...req.body, group: req.group._id });
  res.status(201).json({ success: true, data: m });
});

exports.updateMilestone = asyncHandler(async (req, res) => {
  const m = await Milestone.findOneAndUpdate(
    { _id: req.params.milestoneId, group: req.group._id },
    req.body,
    { new: true, runValidators: true }
  );
  if (!m) throw ApiError.notFound("Milestone not found");
  res.json({ success: true, data: m });
});

exports.deleteMilestone = asyncHandler(async (req, res) => {
  await Milestone.findOneAndDelete({ _id: req.params.milestoneId, group: req.group._id });
  res.json({ success: true, message: "Milestone deleted" });
});

/** Recompute and persist a group's progress from its tasks (done / total). */
const recalcGroupProgress = async (groupId) => {
  const tasks = await Task.find({ group: groupId }).select("status").lean();
  const progress = tasks.length
    ? Math.round((tasks.filter((t) => t.status === "done" || t.status === "completed").length / tasks.length) * 100)
    : 0;
  await Group.findByIdAndUpdate(groupId, { progress });
  return progress;
};

/** Group progress derived from tasks. */
exports.recalcProgress = asyncHandler(async (req, res) => {
  const progress = await recalcGroupProgress(req.group._id);
  res.json({ success: true, data: { progress } });
});

/** Consolidate all student submission ZIPs into a single master archive and post to Group Chat */
exports.assembleFinalArchive = asyncHandler(async (req, res) => {
  const { assembleAndPostFinalProjectZip } = require("../services/groupFinalArchiveService");
  const result = await assembleAndPostFinalProjectZip({
    groupId: req.group._id,
    triggerUser: req.user,
  });
  res.json({ success: true, data: result });
});

exports.recalcGroupProgress = recalcGroupProgress;

