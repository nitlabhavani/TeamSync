const mongoose = require("mongoose");

/**
 * STEP 20 — AI Project Health Command Center.
 *
 * Persisted, group-scoped history of services/projectHealthService.js
 * results. This is a NEW, separate model from `TeamRiskSnapshot` (Step 15)
 * and `ProjectForecastSnapshot` (Step 19) — it does not replace or
 * duplicate either collection. It only stores a compact snapshot of the
 * *aggregated dashboard indicator* (healthScore/health) plus references to
 * the already-computed team risk level and forecast probability at the
 * time the Command Center ran.
 *
 * Only aggregate numbers, a status label, and short issue *type* strings
 * are stored here — never raw submission content, chat text, plagiarism
 * fingerprints, or per-student reasoning (Feature 17 — Privacy), exactly
 * like the two models above.
 */
const projectHealthSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    healthScore: { type: Number, default: null, min: 0, max: 100 },
    health: {
      type: String,
      enum: ["HEALTHY", "STABLE", "NEEDS_ATTENTION", "AT_RISK", "CRITICAL", "INSUFFICIENT_DATA"],
      required: true,
    },
    trend: {
      type: String,
      enum: ["IMPROVING", "STABLE", "WORSENING", "INSUFFICIENT_DATA"],
      default: "INSUFFICIENT_DATA",
    },
    /** Reference only — the forecast probability already computed by
     * projectForecastService at aggregation time (never recomputed here). */
    forecastProbability: { type: Number, default: null },
    /** Reference only — the Team Risk level already computed by
     * teamRiskAnalyzer.computeTeamRisk at aggregation time. */
    teamRiskLevel: { type: String, default: "" },
    /** Top issue `type` strings only (e.g. "DEADLINE", "SUBMISSION") —
     * never the full issue object with reasons/evidence. */
    majorIssueTypes: [{ type: String }],
    /** Last `health` a guide notification was actually sent for, so
     * repeated views never re-notify unless health has genuinely
     * escalated (mirrors ProjectForecastSnapshot.lastNotifiedStatus). */
    lastNotifiedHealth: { type: String, default: null },
  },
  { timestamps: true }
);

projectHealthSnapshotSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("ProjectHealthSnapshot", projectHealthSnapshotSchema);
