const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    type: {
      type: String,
      enum: ["chat", "task", "meeting", "review", "file", "risk", "system", "call"],
      default: "system",
    },
    link: { type: String, default: "" },
    // Optional exact-ObjectId references so a notification can be traced
    // back to the group/task it's about without parsing `link`, and so
    // recipient/content scoping never has to fall back to a group *name*
    // (two groups can share a name — see the same-name isolation tests).
    // Both are optional: plenty of notification types (invitations,
    // team-leader changes, generic system messages) have no task, and a
    // few (e.g. a direct-message notification) have no group either.
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    // STEP 34 — Notification -> exact group chat navigation. Optional exact
    // Message ObjectId so a group-message notification can point at (and the
    // chat UI can scroll/highlight) the precise message it's about, in
    // addition to `group` above. Additive only: existing notifications
    // (older docs, and every non-chat notification type) simply have this
    // as null, and every consumer must treat that as "no exact message
    // target" rather than an error — see chatController.sendGroupMessage
    // (producer) and GroupContext.consumePendingMessageTarget (consumer).
    message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
