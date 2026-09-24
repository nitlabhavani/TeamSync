const mongoose = require("mongoose");

/**
 * STEP 19 — AI Project Progress Forecast & Early Intervention System.
 *
 * Persisted, group-scoped history of services/projectForecastService.js
 * results. This is a NEW, separate model from `TeamRiskSnapshot` (Step 15)
 * — it does not replace or duplicate that collection, it only references
 * the risk *level* that was already computed by the existing Team Risk
 * engine at the time the forecast ran (see `riskLevel` below).
 *
 * Only aggregate numbers, a status label, and short recommendation *type*
 * strings are stored here — never raw submission content, plagiarism
 * fingerprints, or guide-only reasoning text (Feature 17 — Privacy).
 */
const projectForecastSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    forecastDate: { type: Date, required: true, default: Date.now },
    probability: { type: Number, required: true, min: 0, max: 100 },
    forecastStatus: {
      type: String,
      enum: ["ON_TRACK", "AT_RISK", "LIKELY_LATE", "CRITICAL", "INSUFFICIENT_DATA"],
      required: true,
    },
    projectedCompletionDate: { type: Date, default: null },
    completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
    remainingTasks: { type: Number, default: 0, min: 0 },
    /** The Team Risk level (LOW/MODERATE/HIGH/CRITICAL/INSUFFICIENT_DATA)
     * from teamRiskAnalyzer.computeTeamRisk at forecast time — a reference,
     * never a recomputation of that formula. */
    riskLevel: { type: String, default: "" },
    /** Recommendation `type` strings only (e.g. "PRIORITIZE_OVERDUE_TASK") —
     * never the full recommendation object with evidence/reasons. */
    majorRecommendationTypes: [{ type: String }],
    /** Last forecastStatus a guide notification was actually sent for, so
     * repeated scans never re-notify unless the status has genuinely
     * escalated (Feature 9 dedup/throttle, mirrors TeamRiskSnapshot's
     * `alerted` pattern in teamRiskAnalyzer.analyzeGroupRisk). */
    lastNotifiedStatus: { type: String, default: null },
  },
  { timestamps: true }
);

projectForecastSnapshotSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("ProjectForecastSnapshot", projectForecastSnapshotSchema);
