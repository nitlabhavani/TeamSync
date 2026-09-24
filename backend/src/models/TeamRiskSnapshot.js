const mongoose = require("mongoose");

/**
 * Step 15 — AI Team Risk & Early Warning System.
 *
 * Persisted, group-scoped history of the richer team-risk analysis produced
 * by services/teamRiskAnalyzer.js. This is intentionally a NEW, separate
 * model from the existing `RiskSnapshot` (used by the older risk
 * radar/`/groups/:groupId/risk` endpoint from a previous step) — Step 15
 * must not replace or reshape that existing system, only add to it.
 *
 * Only aggregate scores, category labels and short evidence strings are
 * stored here. No submission file contents, chat text, or plagiarism
 * source material is ever persisted on this document (Feature 17 —
 * Privacy).
 */
const warningSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    severity: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    evidence: [{ type: String }],
    recommendation: { type: String, default: "" },
  },
  { _id: false }
);

const affectedStudentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    riskLevel: {
      type: String,
      enum: ["ON_TRACK", "NEEDS_ATTENTION", "AT_RISK", "CRITICAL"],
      required: true,
    },
    riskScore: { type: Number, default: 0 },
    reasons: [{ type: String }],
  },
  { _id: false }
);

const teamRiskSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    riskScore: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: {
      type: String,
      enum: ["LOW", "MODERATE", "HIGH", "CRITICAL", "INSUFFICIENT_DATA"],
      required: true,
    },
    confidence: { type: String, enum: ["low", "medium", "high"], default: "low" },
    reasons: [{ type: String }],
    criticalRisks: [{ type: String }],
    warnings: [warningSchema],
    positiveSignals: [{ type: String }],
    recommendations: [{ type: String }],
    affectedStudents: [affectedStudentSchema],
  },
  { timestamps: true }
);

teamRiskSnapshotSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model("TeamRiskSnapshot", teamRiskSnapshotSchema);
