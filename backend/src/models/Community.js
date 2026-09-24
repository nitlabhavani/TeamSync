const mongoose = require("mongoose");

/**
 * COMMUNITY (WhatsApp "Communities")
 * ===================================
 * Groups related project teams and channels under an umbrella domain/batch/department,
 * featuring broadcast announcements and a constituent group directory.
 */
const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      default: "General",
    },
    color: {
      type: String,
      default: "#059669",
    },
    avatar: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    groups: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
      },
    ],
    announcements: [
      {
        title: { type: String, required: true, trim: true },
        content: { type: String, required: true, trim: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

communitySchema.index({ createdBy: 1 });

module.exports = mongoose.model("Community", communitySchema);
