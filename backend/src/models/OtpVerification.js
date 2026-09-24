const mongoose = require("mongoose");

/**
 * OTP verification collection.
 *
 * A signup is parked here (with the password already hashed) until the user
 * proves control of the email address with the 6-digit code. The real `User`
 * document is only created after successful verification.
 */
const otpVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    purpose: {
      type: String,
      enum: ["signup", "password-reset", "email-change"],
      default: "signup",
    },
    codeHash: { type: String, required: true },
    // Parked signup payload (only for purpose === "signup")
    payload: {
      name: String,
      passwordHash: String,
      role: { type: String, enum: ["student", "guide"], default: "student" },
      dept: String,
    },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

otpVerificationSchema.index({ email: 1, purpose: 1 }, { unique: true });
// TTL cleanup — Mongo removes the document once it expires.
otpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("OtpVerification", otpVerificationSchema);
