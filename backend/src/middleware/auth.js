const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");
const { verifyAccessToken } = require("../utils/token");
const User = require("../models/User");
const Group = require("../models/Group");

const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : (req.cookies?.token || req.query?.token);
  if (!token) throw ApiError.unauthorized("Missing authentication token");

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).select("-password");
  if (!user || !user.isActive) throw ApiError.unauthorized("User no longer active");

  req.user = user;
  next();
});

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role))
      return next(ApiError.forbidden(`Requires role: ${roles.join(" or ")}`));
    next();
  };

/** Ensures the caller is a member (or guide/admin) of :groupId */
const requireGroupAccess = asyncHandler(async (req, res, next) => {
  const groupId = req.params.groupId || req.body.groupId || req.query.groupId;
  if (!groupId) throw ApiError.badRequest("groupId is required");

  const group = await Group.findById(groupId);
  if (!group) throw ApiError.notFound("Group not found");

  const uid = String(req.user._id);
  const isMember = group.members.some((m) => String(m) === uid);
  const isGuide = String(group.guide) === uid;
  if (!isMember && !isGuide && req.user.role !== "admin")
    throw ApiError.forbidden("You are not part of this group");

  const isLeader =
    String(group.leader?._id || group.leader || "") === uid ||
    (group.leaderEmail && req.user.email && group.leaderEmail.toLowerCase() === req.user.email.toLowerCase());
  if (isLeader && !group.leader) {
    group.leader = req.user._id;
    await group.save().catch(() => {});
  }

  req.group = group;
  req.isGuide = isGuide || req.user.role === "admin";
  req.isLeader = isLeader;
  next();
});

/**
 * Attaches req.user when a valid token is present, but never rejects the
 * request. Used by public endpoints (e.g. the invitation OTP flow) that behave
 * slightly differently for a signed-in student.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select("-password");
    if (user && user.isActive) req.user = user;
  } catch {
    /* ignore — the route works anonymously */
  }
  next();
});

module.exports = { protect, optionalAuth, requireRole, requireGroupAccess };
