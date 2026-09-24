const crypto = require("crypto");
const mongoose = require("mongoose");

const INVITE_STATUSES = ["pending", "accepted", "rejected", "expired", "cancelled"];

/**
 * Team invitation issued by a guide when creating / expanding a group.
 *
 * Every invitation carries a one-time password (OTP). The invitee cannot join
 * the group directly — they must open the invitation link and enter the OTP.
 * A rejected invitation can never be converted into a membership.
 */
const invitationSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    role: { type: String, enum: ["leader", "member"], default: "member" },
    status: { type: String, enum: INVITE_STATUSES, default: "pending", index: true },

    /** Public, unguessable identifier used in the invitation link. */
    token: { type: String, unique: true, index: true, default: () => crypto.randomBytes(24).toString("hex") },

    /** OTP — stored hashed, never in plain text. */
    otpHash: { type: String, default: "" },
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    otpResends: { type: Number, default: 0 },
    lastOtpSentAt: { type: Date, default: null },
    otpVerifiedAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },

    emailSent: { type: Boolean, default: false },
    emailError: { type: String, default: "" },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);

invitationSchema.index({ group: 1, email: 1 }, { unique: true });

invitationSchema.methods.otpIsValid = function otpIsValid(code) {
  if (!this.otpHash || !this.otpExpiresAt) return false;
  if (this.otpExpiresAt.getTime() < Date.now()) return false;
  const hash = crypto.createHash("sha256").update(String(code).trim()).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(this.otpHash));
};

module.exports = mongoose.model("Invitation", invitationSchema);
module.exports.INVITE_STATUSES = INVITE_STATUSES;
