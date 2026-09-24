const mongoose = require("mongoose");

/**
 * STEP 16 — Feature 3 support model.
 *
 * Purely additive new collection (mirrors the precedent set by
 * RiskSnapshot/TeamRiskSnapshot in earlier steps — a small dedicated model
 * per feature rather than overloading an unrelated schema). Tracks, per
 * group+student, the last collaboration/communication risk level a
 * notification was actually sent for, so the scheduler never re-sends the
 * same nudge on every run (see services/collaborationRiskService.js).
 */
const collaborationAlertStateSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastNotifiedLevel: {
      type: String,
      enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"],
      default: "LOW",
    },
    lastNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

collaborationAlertStateSchema.index({ group: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("CollaborationAlertState", collaborationAlertStateSchema);
