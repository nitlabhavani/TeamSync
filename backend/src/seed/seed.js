/* Seeds the database with the same demo data the frontend mocks use. */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Group = require("../models/Group");
const Task = require("../models/Task");
const Meeting = require("../models/Meeting");
const Milestone = require("../models/Milestone");
const Message = require("../models/Message");
const ReviewRound = require("../models/ReviewRound");
const PeerReview = require("../models/PeerReview");
const { recomputeBadges } = require("../services/badgeService");

const DAY = 86400000;
const inDays = (d) => new Date(Date.now() + d * DAY);

async function run() {
  await connectDB();
  await Promise.all(
    [User, Group, Task, Meeting, Milestone, Message, ReviewRound, PeerReview].map((M) => M.deleteMany({}))
  );

  const password = "Password123";
  const [aisha, rohan, priya, karthik, sneha, dev, meera] = await User.create([
    { name: "Aisha Verma", email: "aisha.verma@teamsync.edu", password, dept: "CSE", color: "#5B5FEF", isVerified: true },
    { name: "Rohan Mehta", email: "rohan.mehta@teamsync.edu", password, dept: "CSE", color: "#23C486", isVerified: true },
    { name: "Priya Nair", email: "priya.nair@teamsync.edu", password, dept: "IT", color: "#F2A93B", isVerified: true },
    { name: "Karthik Iyer", email: "karthik.iyer@teamsync.edu", password, dept: "CSE", color: "#EF5B5B", isVerified: true },
    { name: "Sneha Reddy", email: "sneha.reddy@teamsync.edu", password, dept: "ECE", color: "#8B5CF6", isVerified: true },
    { name: "Dev Kulkarni", email: "dev.kulkarni@teamsync.edu", password, dept: "IT", color: "#0EA5E9", isVerified: true },
    { name: "Dr. Meera Rao", email: "meera.rao@teamsync.edu", password, role: "guide", dept: "CSE", color: "#4347C4", isVerified: true },
  ]);

  const [nimbus, vortex] = await Group.create([
    { name: "Team Nimbus", project: "AI-Based Crop Disease Detection", guide: meera._id, members: [aisha._id, rohan._id, priya._id, karthik._id], collaborationScore: 82, progress: 64, inviteCode: "NIMBUS01" },
    { name: "Team Vortex", project: "Smart Campus Energy Monitor", guide: meera._id, members: [sneha._id, dev._id, rohan._id], collaborationScore: 41, progress: 28, inviteCode: "VORTEX01" },
  ]);

  await Task.create([
    { group: nimbus._id, title: "Clean and augment the leaf dataset", assignee: karthik._id, status: "done", priority: "high", due: inDays(-3), estimate: 6, tags: ["data"], completedAt: inDays(-4) },
    { group: nimbus._id, title: "Baseline CNN training run", assignee: aisha._id, status: "in_progress", priority: "high", due: inDays(2), estimate: 10, tags: ["model"] },
    { group: nimbus._id, title: "Label leaf-blight samples", assignee: priya._id, status: "in_progress", priority: "medium", due: inDays(4), estimate: 8, tags: ["data"] },
    { group: nimbus._id, title: "Write literature review section", assignee: aisha._id, status: "todo", priority: "medium", due: inDays(6), estimate: 5, tags: ["report"] },
    { group: nimbus._id, title: "Set up inference API", assignee: rohan._id, status: "todo", priority: "high", due: inDays(5), estimate: 7, tags: ["backend"] },
    { group: nimbus._id, title: "Design result dashboard mockups", assignee: priya._id, status: "review", priority: "low", due: inDays(1), estimate: 4, tags: ["design"] },
    { group: vortex._id, title: "Wire up the sensor REST API", assignee: dev._id, status: "todo", priority: "high", due: inDays(-4), estimate: 9, tags: ["hardware"] },
    { group: vortex._id, title: "Energy usage dashboard layout", assignee: sneha._id, status: "in_progress", priority: "medium", due: inDays(3), estimate: 6, tags: ["design"] },
    { group: vortex._id, title: "Order replacement hardware kit", assignee: rohan._id, status: "backlog", priority: "high", due: inDays(-1), estimate: 1, tags: ["hardware"] },
  ]);

  await Milestone.create([
    { group: nimbus._id, title: "Dataset finalised", due: inDays(-6), status: "done" },
    { group: nimbus._id, title: "Model v1 demo", due: inDays(5), status: "pending" },
    { group: vortex._id, title: "Hardware integration", due: inDays(-2), status: "missed" },
    { group: vortex._id, title: "Mid-term review", due: inDays(10), status: "pending" },
  ]);

  await Meeting.create([
    {
      group: nimbus._id, title: "Model training split & sprint sync", when: inDays(-1), durationMins: 45,
      attendees: [aisha._id, rohan._id, priya._id, karthik._id], status: "completed", createdBy: aisha._id,
      agenda: ["Review preprocessing notebook", "Divide model training tasks"],
      notes: "Karthik confirmed the agri-dept dataset landed and is cleaned. Aisha will own the baseline CNN run and share metrics by Thursday. Priya is labeling leaf-blight samples but flagged that 400 images are blurry and may need re-capture. Rohan is blocked on the inference API until the checkpoint format is decided. The team agreed to keep Thursday as demo day.",
    },
    { group: nimbus._id, title: "Mid-sprint demo dry run", when: inDays(2), durationMins: 30, attendees: [aisha._id, rohan._id], status: "scheduled", createdBy: aisha._id, agenda: ["Demo script", "Metrics review"] },
    { group: vortex._id, title: "Hardware unblock call", when: inDays(1), durationMins: 30, attendees: [sneha._id, dev._id], status: "scheduled", createdBy: sneha._id },
  ]);

  await Message.create([
    { group: nimbus._id, sender: aisha._id, text: "Pushed the preprocessing notebook, can someone review?" },
    { group: nimbus._id, sender: rohan._id, text: "On it — checking the augmentation pipeline now." },
    { group: nimbus._id, sender: karthik._id, text: "Dataset from the agri-dept finally came through 🎉" },
    { group: nimbus._id, sender: priya._id, text: "Nice! I'll start labeling the leaf-blight samples tonight." },
    { group: vortex._id, sender: sneha._id, text: "Has anyone wired up the sensor API yet?" },
    { group: vortex._id, sender: dev._id, text: "Not yet, still blocked waiting on the hardware kit." },
  ]);

  const round = await ReviewRound.create({ group: nimbus._id, title: "Sprint 2 peer review", closesAt: inDays(3) });
  await PeerReview.create([
    { round: round._id, group: nimbus._id, reviewer: aisha._id, reviewee: rohan._id, scores: { contribution: 5, communication: 4, reliability: 5, helpfulness: 5 }, comment: "Always unblocks the team fast." },
    { round: round._id, group: nimbus._id, reviewer: rohan._id, reviewee: aisha._id, scores: { contribution: 5, communication: 5, reliability: 4, helpfulness: 4 } },
    { round: round._id, group: nimbus._id, reviewer: priya._id, reviewee: karthik._id, scores: { contribution: 4, communication: 3, reliability: 4, helpfulness: 4 } },
  ]);
  await recomputeBadges(nimbus);

  console.log("Seed complete. Login with any seeded email / password: Password123");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
