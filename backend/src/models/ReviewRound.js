const mongoose = require("mongoose");

const reviewRoundSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    title: { type: String, required: true },
    opensAt: { type: Date, default: Date.now },
    closesAt: { type: Date },
    status: { type: String, enum: ["open", "closed"], default: "open" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReviewRound", reviewRoundSchema);
