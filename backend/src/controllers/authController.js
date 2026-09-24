const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const User = require("../models/User");
const OtpVerification = require("../models/OtpVerification");
const Invitation = require("../models/Invitation");
const Group = require("../models/Group");
const { sendOtpEmail } = require("../services/mailer");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/token");

const OTP_TTL_MS = Number(process.env.OTP_TTL_MINUTES || 10) * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Configurable so local/automated testing (e.g. scripts/runtimeSmokeTest.js)
// can lower it without weakening the production default. Unset ->
// unchanged 30s anti-spam cooldown, same as before.
const RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS || 30 * 1000);

const publicUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  dept: u.dept,
  color: u.color,
  avatar: u.avatar,
  isVerified: u.isVerified,
  settings: u.settings,
});

const newOtp = () => String(crypto.randomInt(100000, 1000000));
const hashOtp = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");
const sessionFor = (user) => ({
  user: publicUser(user),
  token: signAccessToken(user),
  refreshToken: signRefreshToken(user),
});

/** Any pending invitations for this email become memberships once they register. */
async function acceptPendingInvitations(user) {
  const invites = await Invitation.find({
    email: user.email,
    status: "pending",
    otpVerifiedAt: { $ne: null },
  });

  await Promise.all(
    invites.map(async (invite) => {
      const group = await Group.findById(invite.group);
      if (!group) return;
      if (group.maxMembers && group.members.length >= group.maxMembers) return;
      if (!group.members.some((member) => String(member) === String(user._id))) {
        group.members.push(user._id);
      }
      if (!group.leader && group.leaderEmail === user.email) {
        group.leader = user._id;
      }
      await group.save();
      invite.status = "accepted";
      invite.user = user._id;
      invite.acceptedAt = new Date();
      await invite.save();
    })
  );
  return invites.length;
}

/* ------------------------------------------------------------------ */
/* Signup — step 1: validate details and email a 6-digit OTP.          */
/* No User document exists until the OTP is verified.                  */
/* ------------------------------------------------------------------ */
exports.signup = asyncHandler(async (req, res) => {
  const { name, email, password, role = "student", dept = "" } = req.body;

  if (!name || String(name).trim().length < 2) throw ApiError.badRequest("Enter your full name");
  if (!/^\S+@\S+\.\S+$/.test(String(email || ""))) throw ApiError.badRequest("Enter a valid email address");
  if (!password || String(password).length < 8)
    throw ApiError.badRequest("Password must be at least 8 characters");
  if (!["student", "guide"].includes(role)) throw ApiError.badRequest("Invalid role");

  const normalisedEmail = String(email).toLowerCase().trim();
  if (await User.findOne({ email: normalisedEmail })) throw ApiError.conflict("Email already registered");

  const code = newOtp();
  await OtpVerification.findOneAndUpdate(
    { email: normalisedEmail, purpose: "signup" },
    {
      email: normalisedEmail,
      purpose: "signup",
      codeHash: hashOtp(code),
      payload: {
        name: String(name).trim(),
        passwordHash: await bcrypt.hash(password, 10),
        role,
        dept,
      },
      attempts: 0,
      resendCount: 0,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const mail = await sendOtpEmail({ to: normalisedEmail, name, otp: code, purpose: "finish creating your account" });

  if (!mail.sent) {
    await OtpVerification.deleteOne({ email: normalisedEmail, purpose: "signup" });
    throw new ApiError(503, 
      "We couldn't send the verification email right now. Please check the email service configuration and try again."
    );
  }

  res.status(202).json({
    success: true,
    message: `We sent a 6-digit code to ${normalisedEmail}. Enter it to finish signing up.`,
    data: {
      email: normalisedEmail,
      otpRequired: true,
      expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
      emailSent: true,
    },
  });
});

/* ------------------------------------------------------------------ */
/* Signup — step 2: verify the OTP and actually create the account.    */
/* ------------------------------------------------------------------ */
exports.verifyOtp = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const otp = String(req.body.otp || "").trim();
  if (!/^\d{6}$/.test(otp)) throw ApiError.badRequest("Enter the 6-digit code");

  const record = await OtpVerification.findOne({ email, purpose: "signup" });
  if (!record) throw ApiError.badRequest("No pending signup for this email. Start again.");
  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    throw ApiError.badRequest("The code expired. Request a new one.");
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw ApiError.badRequest("Too many incorrect attempts. Start again.");
  }
  if (record.codeHash !== hashOtp(otp)) {
    record.attempts += 1;
    await record.save();
    throw ApiError.badRequest(`Incorrect code. ${MAX_ATTEMPTS - record.attempts} attempts left.`);
  }

  if (await User.findOne({ email })) {
    await record.deleteOne();
    throw ApiError.conflict("Email already registered");
  }

  const user = await User.create({
    name: record.payload.name,
    email,
    password: record.payload.passwordHash, // already bcrypt-hashed
    role: record.payload.role,
    dept: record.payload.dept || "",
    color: `#${crypto.randomBytes(3).toString("hex")}`,
    isVerified: true,
  });

  await record.deleteOne();
  const joinedGroups = await acceptPendingInvitations(user);

  res.status(201).json({
    success: true,
    message: "Account verified and created",
    data: { ...sessionFor(user), joinedGroups },
  });
});

/** Re-send the signup OTP (rate limited). */
exports.resendOtp = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const record = await OtpVerification.findOne({ email, purpose: "signup" });
  if (!record) throw ApiError.badRequest("No pending signup for this email. Start again.");
  const elapsedMs = Date.now() - new Date(record.lastSentAt).getTime();
  if (elapsedMs < RESEND_COOLDOWN_MS)
    throw ApiError.badRequest("Please wait a moment before requesting another code.", {
      retryAfterMs: RESEND_COOLDOWN_MS - elapsedMs,
    });
  if (record.resendCount >= 5) throw ApiError.badRequest("Resend limit reached. Start signup again.");

  const code = newOtp();
  record.codeHash = hashOtp(code);
  record.attempts = 0;
  record.resendCount += 1;
  record.lastSentAt = new Date();
  record.expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await record.save();

  const mail = await sendOtpEmail({
    to: email,
    name: record.payload?.name,
    otp: code,
    purpose: "finish creating your account",
  });

  if (!mail.sent) {
    throw new ApiError(503, 
      "We couldn't send the verification email right now. Please try again in a moment."
    );
  }

  res.json({
    success: true,
    message: "A new verification code has been sent to your email.",
    data: { emailSent: true },
  });
});

/** Abandon a pending signup so the email can be reused immediately. */
exports.cancelSignup = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  await OtpVerification.deleteOne({ email, purpose: "signup" });
  res.json({ success: true, message: "Pending signup cleared" });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || "").toLowerCase().trim() }).select("+password");
  if (!user || !(await user.comparePassword(password || "")))
    throw ApiError.unauthorized("Invalid email or password");
  if (!user.isActive) throw ApiError.forbidden("Account deactivated");
  if (!user.isVerified) throw ApiError.unauthorized("Account email is not verified. Please verify your account first.");

  user.lastSeenAt = new Date();
  await user.save();
  await acceptPendingInvitations(user);

  res.json({ success: true, data: sessionFor(user) });
});

/* ---------------- Password reset (OTP by email) ---------------- */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const user = await User.findOne({ email });

  if (user) {
    const code = newOtp();
    await OtpVerification.findOneAndUpdate(
      { email, purpose: "password-reset" },
      {
        email,
        purpose: "password-reset",
        codeHash: hashOtp(code),
        attempts: 0,
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await sendOtpEmail({ to: email, name: user.name, otp: code, purpose: "reset your password" });
  }

  // Always the same answer, to avoid leaking which emails exist.
  res.json({ success: true, message: "If the account exists, a reset code was sent." });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const { otp, password } = req.body;
  if (!password || String(password).length < 8)
    throw ApiError.badRequest("Password must be at least 8 characters");

  const record = await OtpVerification.findOne({ email, purpose: "password-reset" });
  if (!record || record.expiresAt < new Date() || record.codeHash !== hashOtp(String(otp || "")))
    throw ApiError.badRequest("Invalid or expired reset code");

  const user = await User.findOne({ email }).select("+password");
  if (!user) throw ApiError.notFound("User not found");
  user.password = password;
  await user.save();
  await record.deleteOne();

  res.json({ success: true, message: "Password updated" });
});

exports.refresh = asyncHandler(async (req, res) => {
  const payload = verifyRefreshToken(req.body.refreshToken);
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized();
  res.json({ success: true, data: { token: signAccessToken(user) } });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: publicUser(req.user) });
});

exports.logout = asyncHandler(async (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Logged out" });
});

exports.publicUser = publicUser;
exports.acceptPendingInvitations = acceptPendingInvitations;
