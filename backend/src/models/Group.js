const mongoose = require("mongoose");

const GROUP_CATEGORIES = [
  "Web Development",
  "Mobile Application",
  "Machine Learning",
  "Data Science",
  "IoT",
  "Cyber Security",
  "Cloud Computing",
  "Blockchain",
  "Research",
  "Other",
];

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    project: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    category: { type: String, enum: GROUP_CATEGORIES, default: "Other" },
    expectedCompletion: { type: Date },
    guide: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    /** The team leader — the first student added to the group. */
    leader: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** Email of the first invitee, used to promote them to leader on acceptance. */
    leaderEmail: { type: String, default: "", lowercase: true, trim: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    maxMembers: { type: Number, default: 0 }, // 0 = unlimited
    inviteCode: { type: String, unique: true, sparse: true },
    collaborationScore: { type: Number, default: 50, min: 0, max: 100 },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: ["active", "archived"], default: "active" },
  },
  { timestamps: true }
);

groupSchema.index({ guide: 1, status: 1 });

module.exports = mongoose.model("Group", groupSchema);
module.exports.GROUP_CATEGORIES = GROUP_CATEGORIES;
