const mongoose = require("mongoose");

const milestoneSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    title: { type: String, required: true },
    due: { type: Date, required: true },
    status: { type: String, enum: ["pending", "at_risk", "done", "missed"], default: "pending" },
    weight: { type: Number, default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Milestone", milestoneSchema);
