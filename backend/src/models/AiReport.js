const mongoose = require("mongoose");

const aiReportSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", index: true },
    guide: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    period: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

aiReportSchema.index({ group: 1, period: 1, periodStart: 1 }, { unique: true });

module.exports = mongoose.model("AiReport", aiReportSchema);
