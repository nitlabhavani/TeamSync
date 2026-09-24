const mongoose = require("mongoose");

/**
 * STEP 22 — AI Team Performance Insights.
 *
 * Persisted, group-scoped history of services/teamPerformanceService.js
 * results. This is a NEW, independent model — it does not extend or read
 * from `TeamRiskSnapshot` (Step 15), `ProjectForecastSnapshot` (Step 19),
 * `ProjectHealthSnapshot` (Step 20), or `ProjectExecutionSnapshot` (Step 21).
 * Team Performance is a separate metric (evidence-based member performance)
 * from Team Risk (evidence-based risk of missing deadlines/quality issues)
 * — the two scores are computed independently and neither formula reads
 * the other's score as an input.
 *
 * Only aggregate numbers, a level label, and compact per-member summaries
 * (id + score + level only — never raw reasons, submission content, chat
 * text, or anything that would let one student infer another's private
 * detail) are stored here, mirroring the privacy discipline of the other
 * three snapshot models above.
 */
const memberSummarySchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    performanceScore: { type: Number, default: null, min: 0, max: 100 },
    performanceLevel: {
      type: String,
      enum: ["EXCEPTIONAL", "STRONG", "ON_TRACK", "NEEDS_IMPROVEMENT", "INSUFFICIENT_DATA"],
      required: true,
    },
  },
  { _id: false }
);

const teamPerformanceSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    overallPerformanceScore: { type: Number, default: null, min: 0, max: 100 },
    performanceLevel: {
      type: String,
      enum: ["EXCEPTIONAL", "STRONG", "ON_TRACK", "NEEDS_IMPROVEMENT", "INSUFFICIENT_DATA"],
      required: true,
    },
    memberSummaries: [memberSummarySchema],
    /** Short type strings only (e.g. "STRONG_CODE_QUALITY") — never the
     * full evidence text, matching the "type tally" shape produced by
     * analyzeTeamPerformance(). */
    topStrengths: [{ type: String }],
    topImprovementAreas: [{ type: String }],
    trend: {
      type: String,
      enum: ["IMPROVING", "STABLE", "DECLINING", "INSUFFICIENT_DATA"],
      default: "INSUFFICIENT_DATA",
    },
    /** How many members were in NEEDS_IMPROVEMENT at this snapshot —
     * reference only, used purely to detect "a new serious improvement
     * need appeared" for the notification-threshold check. */
    membersNeedingAttentionCount: { type: Number, default: 0 },
    /** Last `performanceLevel` a guide notification was actually sent
     * for, so repeated dashboard views never re-notify unless the level
     * has genuinely changed (mirrors ProjectExecutionSnapshot.lastNotifiedStatus). */
    lastNotifiedLevel: { type: String, default: null },
  },
  { timestamps: true }
);

teamPerformanceSnapshotSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("TeamPerformanceSnapshot", teamPerformanceSnapshotSchema);
