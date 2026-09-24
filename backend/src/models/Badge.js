const mongoose = require("mongoose");

const badgeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
    key: { type: String, required: true }, // reliable | unblocker | communicator | finisher | mentor
    label: { type: String, required: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "award" },
    awardedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

badgeSchema.index({ user: 1, group: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Badge", badgeSchema);
