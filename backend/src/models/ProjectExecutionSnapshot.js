const mongoose = require("mongoose");

/**
 * STEP 21 — AI Project Execution Copilot.
 *
 * Persisted, group-scoped history of services/projectExecutionCopilotService.js
 * results. This is a NEW, separate model from `TeamRiskSnapshot` (Step 15),
 * `ProjectForecastSnapshot` (Step 19), and `ProjectHealthSnapshot` (Step 20)
 * — it does not replace or duplicate any of them. It only stores a compact
 * snapshot of the *execution plan* (score/status/action counts) plus a
 * couple of reference fields needed for the trend + notification-throttling
 * logic in projectExecutionCopilotService.js, exactly mirroring how
 * ProjectHealthSnapshot stores a reference to teamRiskLevel/forecastProbability
 * without recomputing either.
 *
 * Only aggregate numbers, a status label, and short action *type* strings
 * are stored here — never raw task titles, submission content, chat text,
 * or per-student reasoning (Feature 12 — Privacy), exactly like the three
 * models above.
 */
const projectExecutionSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    executionScore: { type: Number, default: null, min: 0, max: 100 },
    overallStatus: {
      type: String,
      enum: ["HEALTHY", "STABLE", "NEEDS_ATTENTION", "AT_RISK", "CRITICAL", "INSUFFICIENT_DATA"],
      required: true,
    },
    trend: {
      type: String,
      enum: ["IMPROVING", "STABLE", "WORSENING", "INSUFFICIENT_DATA"],
      default: "INSUFFICIENT_DATA",
    },
    /** Reference only — the top priority action's `type` at the time this
     * snapshot ran (never the full action object). */
    topPriorityType: { type: String, default: null },
    criticalActionCount: { type: Number, default: 0 },
    todayActionCount: { type: Number, default: 0 },
    thisWeekActionCount: { type: Number, default: 0 },
    /** Reference only — the Project Forecast status already computed by
     * projectForecastService at aggregation time, used to detect a
     * forecast->CRITICAL escalation without re-querying forecast history. */
    forecastStatus: { type: String, default: "" },
    /** Reference only — count of currently-overdue tasks at aggregation
     * time, used to detect "multiple tasks became overdue" (Feature 7). */
    overdueTaskCount: { type: Number, default: 0 },
    /** Last `overallStatus` a guide notification was actually sent for, so
     * repeated views never re-notify unless status has genuinely escalated
     * (mirrors ProjectHealthSnapshot.lastNotifiedHealth). */
    lastNotifiedStatus: { type: String, default: null },
  },
  { timestamps: true }
);

projectExecutionSnapshotSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("ProjectExecutionSnapshot", projectExecutionSnapshotSchema);
