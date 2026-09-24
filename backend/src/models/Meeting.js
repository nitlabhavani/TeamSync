const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    title: { type: String, required: true, trim: true },
    when: { type: Date, required: true },
    durationMins: { type: Number, default: 30, min: 5 },
    attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["scheduled", "completed", "cancelled"], default: "scheduled" },
    agenda: [{ type: String }],
    notes: { type: String, default: "" },
    summary: {
      decisions: [{ type: String }],
      actionItems: [
        {
          text: String,
          ownerHint: String,
          dueHint: String,
        },
      ],
      risks: [{ type: String }],
      generatedAt: Date,
    },
    link: { type: String, default: "" },
    meetingLink: { type: String, trim: true, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model("Meeting", meetingSchema);
