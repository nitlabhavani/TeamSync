const mongoose = require("mongoose");

/**
 * STATUS UPDATE (WhatsApp "Updates" / Stories)
 * ============================================
 * Short ephemeral status post created by a student or guide.
 * Expiring after 24 hours (mirrors WhatsApp status updates).
 */
const statusUpdateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 300,
      required: [
        function () {
          return !this.mediaUrl;
        },
        "Status text is required when no media is attached",
      ],
    },
    color: {
      type: String,
      default: "#10B981", // WhatsApp Emerald Green
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    mediaType: {
      type: String,
      enum: ["image", "video", "text", null],
      default: null,
    },
    views: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: true,
    },
  },
  { timestamps: true }
);

statusUpdateSchema.index({ expiresAt: 1, user: 1 });
statusUpdateSchema.index({ "views.user": 1 });

module.exports = mongoose.model("StatusUpdate", statusUpdateSchema);
