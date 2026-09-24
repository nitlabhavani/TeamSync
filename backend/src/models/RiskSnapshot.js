const mongoose = require("mongoose");

/** Snapshot of a group's AI risk score, written each time the radar runs. */
const riskSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    level: { type: String, enum: ["low", "medium", "high"], required: true },
    drivers: [{ key: String, label: String, impact: Number, detail: String }],
    recommendations: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("RiskSnapshot", riskSnapshotSchema);
