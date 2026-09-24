const mongoose = require("mongoose");

/**
 * Append-only activity / audit trail: who did what, when, in which group.
 * Guide actions are additionally flagged with `audit: true`.
 */
const activitySchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", index: true, default: null },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorName: { type: String, default: "" },
    action: { type: String, required: true }, // e.g. "task.created"
    summary: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    audit: { type: Boolean, default: false },
    ip: { type: String, default: "" },
  },
  { timestamps: true }
);

activitySchema.index({ createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activitySchema);
