/**
 * Public invitation endpoints — the OTP join flow.
 *
 *   Receive email -> open invitation -> enter OTP -> verify -> join group
 *
 * A rejected invitation can never become a membership.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Invitation = require("../models/Invitation");
const Group = require("../models/Group");
const User = require("../models/User");
const { verifyOtp, resendOtp, OTP_TTL_MINUTES } = require("../services/invitationService");
const { notifyUsers } = require("../services/notificationService");
const { logActivity } = require("../services/activityService");

const loadInvitation = async (token) => {
  const invitation = await Invitation.findOne({ token })
    .populate("group", "name project description category expectedCompletion guide leader leaderEmail members")
    .populate("invitedBy", "name email");
  if (!invitation) throw ApiError.notFound("Invitation not found or already removed");
  return invitation;
};

const isInvitationExpired = (invitation) => {
  if (invitation.status === "expired") return true;
  if (invitation.status === "pending" && invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
    return true;
  }
  return false;
};

const publicView = (invitation) => {
  const expired = isInvitationExpired(invitation);
  const status = expired ? "expired" : invitation.status;

  return {
    token: invitation.token,
    email: invitation.email,
    status,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    acceptedAt: invitation.acceptedAt,
    rejectedAt: invitation.rejectedAt,
    group: invitation.group
      ? {
          id: String(invitation.group._id),
          name: invitation.group.name,
          project: invitation.group.project,
          description: invitation.group.description,
          category: invitation.group.category,
          expectedCompletion: invitation.group.expectedCompletion,
        }
      : null,
    guideName: invitation.invitedBy?.name || "",
    invitedBy: invitation.invitedBy
      ? {
          id: String(invitation.invitedBy._id),
          name: invitation.invitedBy.name,
          email: invitation.invitedBy.email,
        }
      : null,
    otpExpiresAt: invitation.otpExpiresAt,
    otpTtlMinutes: OTP_TTL_MINUTES,
    locked: Boolean(invitation.lockedUntil && invitation.lockedUntil > new Date()),
  };
};

/** GET /api/invitations/:token */
exports.getByToken = asyncHandler(async (req, res) => {
  const invitation = await loadInvitation(req.params.token);
  res.json({ success: true, data: publicView(invitation) });
});

/** POST /api/invitations/:token/resend-otp */
exports.resend = asyncHandler(async (req, res) => {
  const invitation = await loadInvitation(req.params.token);
  try {
    const result = await resendOtp(invitation, invitation.group, invitation.invitedBy);
    res.json({ success: true, message: `A new OTP was sent to ${invitation.email}`, data: result });
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
});

/**
 * POST /api/invitations/:token/accept
 * Requires authentication (student must be logged in).
 */
exports.accept = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw ApiError.unauthorized("You must be logged in to accept an invitation");
  }

  const invitation = await loadInvitation(req.params.token);

  // Check expiration
  if (isInvitationExpired(invitation)) {
    if (invitation.status !== "expired") {
      invitation.status = "expired";
      await invitation.save();
    }
    throw ApiError.badRequest("This invitation has expired. Ask your guide to resend an invitation.");
  }

  // Check existing statuses
  if (invitation.status === "rejected") {
    throw ApiError.forbidden("This invitation was rejected and cannot be accepted. Contact your guide for a new invitation.");
  }
  if (invitation.status === "accepted") {
    throw ApiError.badRequest("This invitation has already been accepted.");
  }
  if (invitation.status !== "pending") {
    throw ApiError.badRequest(`This invitation cannot be accepted because it is ${invitation.status}.`);
  }

  // Check email match
  const userEmail = String(req.user.email || "").trim().toLowerCase();
  const invitedEmail = String(invitation.email || "").trim().toLowerCase();
  if (userEmail !== invitedEmail) {
    throw ApiError.forbidden(
      `You are logged in as ${req.user.email}, but this invitation was sent to ${invitation.email}. Please log in with the invited account.`
    );
  }

  // Load group
  if (!invitation.group?._id) {
    throw ApiError.notFound("The group associated with this invitation no longer exists.");
  }
  const group = await Group.findById(invitation.group._id);
  if (!group) {
    throw ApiError.notFound("The group associated with this invitation no longer exists.");
  }

  const isAlreadyMember = group.members.some((m) => String(m) === String(req.user._id));
  if (group.maxMembers && group.members.length >= group.maxMembers && !isAlreadyMember) {
    throw ApiError.badRequest("This group has reached its maximum member limit.");
  }

  // Add member safely
  if (!isAlreadyMember) {
    group.members.push(req.user._id);
  }

  // Promote to leader if applicable
  const shouldPromoteToLeader = !group.leader && (invitation.role === "leader" || group.leaderEmail === invitedEmail);
  if (shouldPromoteToLeader) {
    group.leader = req.user._id;
  }
  await group.save();

  // Mark invitation accepted
  invitation.status = "accepted";
  invitation.acceptedAt = new Date();
  invitation.user = req.user._id;
  invitation.otpHash = "";
  await invitation.save();

  // Notify guide
  if (group.guide) {
    await notifyUsers([group.guide], {
      title: "Student joined group",
      body: `${req.user.name} accepted the invitation to ${group.name}${shouldPromoteToLeader ? " as Team Leader" : ""}.`,
      type: "system",
      link: `/guide/groups`,
      group: group._id,
    });
  }

  // Notify student
  await notifyUsers([req.user._id], {
    title: `Welcome to ${group.name}`,
    body: group.project || `You have joined ${group.name}`,
    type: "system",
    link: `/app/groups/${group._id}`,
    group: group._id,
  });

  // Log activity
  await logActivity({
    req,
    group: group._id,
    action: "invitation.accepted",
    summary: `${req.user.name} accepted the invitation and joined ${group.name}`,
    meta: { leader: shouldPromoteToLeader, groupId: group._id },
  });

  res.json({
    success: true,
    message: `You have joined ${group.name} successfully!`,
    data: {
      ...publicView(invitation),
      joined: true,
      isLeader: String(group.leader) === String(req.user._id),
      groupId: String(group._id),
      groupName: group.name,
    },
  });
});

/** POST /api/invitations/:token/reject */
exports.reject = asyncHandler(async (req, res) => {
  const invitation = await loadInvitation(req.params.token);
  if (invitation.status === "accepted") throw ApiError.badRequest("You already joined this group");
  if (invitation.status === "rejected") {
    return res.json({ success: true, message: "Invitation already rejected", data: publicView(invitation) });
  }

  // If user is authenticated, ensure their email matches the invited email
  if (req.user) {
    const userEmail = String(req.user.email || "").trim().toLowerCase();
    const invitedEmail = String(invitation.email || "").trim().toLowerCase();
    if (userEmail !== invitedEmail) {
      throw ApiError.forbidden("You cannot reject an invitation sent to a different email address.");
    }
  }

  invitation.status = "rejected";
  invitation.rejectedAt = new Date();
  invitation.otpHash = "";
  await invitation.save();

  const group = invitation.group;
  if (group?.guide) {
    await notifyUsers([group.guide], {
      title: "Invitation rejected",
      body: `${invitation.email} rejected the invitation to ${group.name}.`,
      type: "system",
      link: `/guide/groups`,
      group: group._id,
    });
  }
  await logActivity({ req, group: group?._id, action: "invitation.rejected", summary: `${invitation.email} rejected the invitation` });

  res.json({ success: true, message: "Invitation rejected.", data: publicView(invitation) });
});

/**
 * POST /api/invitations/:token/verify-otp
 * Body: { otp, userId? }
 *
 * The student must already have an account (they sign up with the invited
 * email). Once the OTP is valid they are added to the group; the first invitee
 * becomes the Team Leader.
 */
exports.verify = asyncHandler(async (req, res) => {
  const invitation = await loadInvitation(req.params.token);
  const otp = String(req.body.otp || "").trim();
  if (!/^\d{4,8}$/.test(otp)) throw ApiError.badRequest("Enter the OTP sent to your email");

  if (invitation.status === "accepted") throw ApiError.badRequest("You already joined this group");
  if (invitation.status === "rejected") throw ApiError.forbidden("This invitation was rejected");

  try {
    await verifyOtp(invitation, otp);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }

  invitation.otpVerifiedAt = new Date();
  await invitation.save();

  const user =
    (req.user && String(req.user.email).toLowerCase() === invitation.email ? req.user : null) ||
    (await User.findOne({ email: invitation.email }));

  if (!user) {
    // OTP is correct but there is no account yet — tell the client to sign up.
    res.json({
      success: true,
      data: { ...publicView(invitation), otpVerified: true, needsAccount: true },
      message: "OTP verified. Create your account with this email to finish joining.",
    });
    return;
  }

  const group = await Group.findById(invitation.group._id);
  if (!group) throw ApiError.notFound("Group no longer exists");
  if (group.maxMembers && group.members.length >= group.maxMembers)
    throw ApiError.badRequest("This group is already full");

  if (!group.members.some((m) => String(m) === String(user._id))) group.members.push(user._id);
  const shouldPromoteToLeader = !group.leader && (invitation.role === "leader" || group.leaderEmail === invitation.email);
  if (shouldPromoteToLeader) {
    group.leader = user._id;
  }
  await group.save();

  invitation.user = user._id;
  invitation.status = "accepted";
  invitation.acceptedAt = new Date();
  await invitation.save();

  await notifyUsers([group.guide], {
    title: "Student joined",
    body: `${user.name} joined ${group.name}${String(group.leader) === String(user._id) ? " as Team Leader" : ""}.`,
    type: "system",
    link: `/guide/groups`,
    group: group._id,
  });
  await notifyUsers([user._id], {
    title: `Welcome to ${group.name}`,
    body: group.project,
    type: "system",
    link: `/app/groups/${group._id}`,
    group: group._id,
  });
  await logActivity({
    req,
    group: group._id,
    action: "invitation.accepted",
    summary: `${user.name} joined ${group.name}`,
    meta: { leader: String(group.leader) === String(user._id) },
  });

  res.json({
    success: true,
    data: {
      ...publicView(invitation),
      otpVerified: true,
      joined: true,
      isLeader: String(group.leader) === String(user._id),
      groupId: String(group._id),
    },
  });
});
