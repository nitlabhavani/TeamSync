const mongoose = require("mongoose");

/**
 * PRIVATE CALL HISTORY — minimal metadata only.
 *
 * This model intentionally stores nothing about call *content*: no audio,
 * video, transcripts, or signaling payloads ever reach MongoDB — WebRTC
 * media flows directly peer-to-peer (or via TURN relay) and is never
 * touched by the backend at all. Only enough metadata to power a "missed
 * call" notification and a lightweight call-history list is kept.
 *
 * This is a private/direct-chat-only concept: there is deliberately no
 * `group` field and no group call log ever exists (see product rule in
 * FINAL_PRIVATE_CALL_REPORT.md — group calling is out of scope entirely).
 */
const callLogSchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["voice", "video"], required: true },
    status: {
      type: String,
      enum: ["accepted", "rejected", "missed", "cancelled", "failed", "ended"],
      required: true,
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Fast lookups of "my recent private calls" and per-conversation history.
callLogSchema.index({ caller: 1, createdAt: -1 });
callLogSchema.index({ receiver: 1, createdAt: -1 });

module.exports = mongoose.model("CallLog", callLogSchema);
