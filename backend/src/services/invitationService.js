const crypto = require("crypto");
const Invitation = require("../models/Invitation");
const { sendInvitationOtpEmail } = require("./emailTemplates");

const OTP_TTL_MINUTES = Number(process.env.INVITE_OTP_TTL_MINUTES || 5);
const MAX_ATTEMPTS = Number(process.env.INVITE_OTP_MAX_ATTEMPTS || 5);
const MAX_RESENDS = Number(process.env.INVITE_OTP_MAX_RESENDS || 5);
const LOCK_MINUTES = Number(process.env.INVITE_OTP_LOCK_MINUTES || 15);
const EXPOSE_OTP = process.env.NODE_ENV !== "production" && process.env.EXPOSE_DEV_OTP !== "false";

const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const hashOtp = (code) => crypto.createHash("sha256").update(String(code).trim()).digest("hex");

/** Attach a fresh OTP to an invitation document (does not save). */
function attachOtp(invitation) {
  const otp = generateOtp();
  invitation.otpHash = hashOtp(otp);
  invitation.otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  invitation.otpAttempts = 0;
  invitation.lastOtpSentAt = new Date();
  invitation.otpVerifiedAt = null;
  invitation.lockedUntil = null;
  return otp;
}

/** Create/refresh an invitation and email the link + OTP. */
async function issueInvitation({ group, email, invitedBy, role = "member" }) {
  let invitation = await Invitation.findOne({ group: group._id, email });
  if (!invitation) {
    invitation = new Invitation({ group: group._id, email, invitedBy: invitedBy._id, role });
  }
  if (invitation.status === "rejected") {
    // A rejected student is never silently re-added; the guide must re-invite,
    // which resets the invitation to pending with a new OTP.
    invitation.status = "pending";
    invitation.rejectedAt = null;
  }
  invitation.role = role;
  invitation.invitedBy = invitedBy._id;
  if (invitation.status !== "accepted") invitation.status = "pending";

  const otp = attachOtp(invitation);
  const mail = await sendInvitationOtpEmail({
    to: email,
    groupName: group.name,
    project: group.project,
    guideName: invitedBy.name,
    otp,
    token: invitation.token,
    ttlMinutes: OTP_TTL_MINUTES,
    isLeader: role === "leader",
  });
  invitation.emailSent = mail.sent;
  invitation.emailError = mail.sent ? "" : mail.reason || "";
  await invitation.save();

  return {
    invitation,
    emailSent: mail.sent,
    // Only exposed in dev so the flow can be tested without a working email provider.
    devOtp: EXPOSE_OTP ? otp : undefined,
  };
}

/** Re-send the OTP for an existing pending invitation. */
async function resendOtp(invitation, group, invitedBy) {
  if (invitation.status === "accepted") throw new Error("This invitation was already accepted");
  if (invitation.status === "rejected") throw new Error("This invitation was rejected");
  if (invitation.otpResends >= MAX_RESENDS) throw new Error("Resend limit reached. Ask your guide to re-invite you.");

  const otp = attachOtp(invitation);
  invitation.otpResends += 1;
  const mail = await sendInvitationOtpEmail({
    to: invitation.email,
    groupName: group.name,
    project: group.project,
    guideName: invitedBy?.name,
    otp,
    token: invitation.token,
    ttlMinutes: OTP_TTL_MINUTES,
    isLeader: invitation.role === "leader",
  });
  invitation.emailSent = mail.sent;
  invitation.emailError = mail.sent ? "" : mail.reason || "";
  await invitation.save();
  return { emailSent: mail.sent, devOtp: EXPOSE_OTP ? otp : undefined };
}

/**
 * Verify a submitted OTP.
 * Returns { ok } or throws an Error carrying a human readable message.
 */
async function verifyOtp(invitation, code) {
  if (invitation.status === "rejected") throw new Error("This invitation was rejected");
  if (invitation.status === "cancelled") throw new Error("This invitation was cancelled");
  if (invitation.lockedUntil && invitation.lockedUntil > new Date())
    throw new Error("Too many invalid attempts. Try again later or request a new code.");
  if (!invitation.otpHash || !invitation.otpExpiresAt) throw new Error("Request a new OTP to continue");
  if (invitation.otpExpiresAt.getTime() < Date.now()) throw new Error("OTP expired. Please resend the code.");

  const valid = hashOtp(code) === invitation.otpHash;
  if (!valid) {
    invitation.otpAttempts += 1;
    if (invitation.otpAttempts >= MAX_ATTEMPTS) {
      invitation.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    }
    await invitation.save();
    const left = Math.max(0, MAX_ATTEMPTS - invitation.otpAttempts);
    throw new Error(left ? `Invalid OTP. ${left} attempt${left === 1 ? "" : "s"} remaining.` : "Invalid OTP. Account locked temporarily.");
  }

  invitation.otpHash = "";
  invitation.otpExpiresAt = null;
  invitation.otpAttempts = 0;
  invitation.lockedUntil = null;
  await invitation.save();
  return { ok: true };
}

module.exports = {
  OTP_TTL_MINUTES,
  MAX_ATTEMPTS,
  MAX_RESENDS,
  issueInvitation,
  resendOtp,
  verifyOtp,
};
