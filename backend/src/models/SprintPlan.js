const mongoose = require("mongoose");

/**
 * STEP 23 — AI Sprint Planner.
 *
 * Persisted, group-scoped Sprint Plan. Chosen over a non-persistent preview
 * object because the spec explicitly asks for:
 *   - a stale-plan re-check on Apply (§13), which needs the exact task
 *     snapshot the preview was generated from to diff against current state
 *   - optional history (§16) and weekly-report integration (§23)
 * A plan never duplicates a Task — `plannedTasks[].task` is a reference to
 * an existing Task document; nothing about the underlying task is copied
 * except the read-only fields needed to detect staleness
 * (statusAtGeneration/dueAtGeneration/assigneeAtGeneration/updatedAtAtGeneration).
 *
 * This is purely additive: it does not touch TeamRiskSnapshot,
 * ProjectForecastSnapshot, ProjectHealthSnapshot, ProjectExecutionSnapshot,
 * or TeamPerformanceSnapshot, and none of those models are modified here.
 */

const plannedTaskSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    title: { type: String, required: true },
    priority: { type: String, default: "" },
    currentStatus: { type: String, default: "" },
    currentAssignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recommendedOrder: { type: Number, required: true },
    recommendedStart: { type: Date, default: null },
    recommendedDue: { type: Date, default: null },
    estimatedEffort: { type: Number, default: null },
    dependencyTaskIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    riskLevel: { type: String, default: "UNKNOWN" },
    reason: { type: String, default: "" },
    recommendation: { type: String, default: "" },
    // Staleness fingerprint — read-only snapshot of the fields Apply must
    // re-check haven't changed since preview (see sprintPlannerService.
    // findStaleTasks). Never used to overwrite the real task.
    statusAtGeneration: { type: String, default: "" },
    dueAtGeneration: { type: Date, default: null },
    assigneeAtGeneration: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedAtAtGeneration: { type: Date, default: null },
  },
  { _id: false }
);

const workloadEntrySchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    taskCount: { type: Number, default: 0 },
    balanceLabel: { type: String, default: "BALANCED" },
  },
  { _id: false }
);

const sprintPlanSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    title: { type: String, default: "Sprint Plan" },
    sprintStart: { type: Date, required: true },
    sprintEnd: { type: Date, required: true },
    planningHorizonDays: { type: Number, required: true },

    status: { type: String, enum: ["DRAFT", "APPLIED", "CANCELLED"], default: "DRAFT", index: true },

    plannedTasks: [plannedTaskSchema],

    workloadSummary: {
      totalSelectedTasks: { type: Number, default: 0 },
      totalEstimatedEffort: { type: Number, default: null },
      effortEstimatesAvailable: { type: Boolean, default: false },
      byMember: [workloadEntrySchema],
      overloadedMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      underUtilizedMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    },

    dependencySummary: {
      totalDependencies: { type: Number, default: 0 },
      blockedTaskCount: { type: Number, default: 0 },
      bottleneckTaskIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
      cyclesDetected: { type: Boolean, default: false },
    },

    riskSummary: {
      sprintRiskLevel: {
        type: String,
        enum: ["LOW_RISK", "MODERATE_RISK", "HIGH_RISK", "CRITICAL_RISK", "INSUFFICIENT_DATA"],
        default: "INSUFFICIENT_DATA",
      },
      factors: [{ type: String }],
      // References to the existing snapshots this sprint risk was derived
      // from — never a duplicated score.
      teamRiskLevelAtGeneration: { type: String, default: null },
      forecastStatusAtGeneration: { type: String, default: null },
      healthStatusAtGeneration: { type: String, default: null },
    },

    recommendations: [{ type: String }],

    baselineMetrics: {
      totalOpenTasks: { type: Number, default: 0 },
      eligibleCandidateCount: { type: Number, default: 0 },
    },

    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    appliedAt: { type: Date, default: null },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

sprintPlanSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("SprintPlan", sprintPlanSchema);
