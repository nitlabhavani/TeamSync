/**
 * ML TRAINING STEP 2 — Real Data Availability Check (read-only)
 * ----------------------------------------------------------------
 * Connects to whatever MONGO_URI is configured in backend/.env (your real
 * database — never the repo's seed/fixture data) and reports counts and
 * field-completeness for every collection that could feed ML training.
 *
 * This script NEVER writes, updates, or deletes anything. It only runs
 * countDocuments()/aggregate() read queries, then disconnects.
 *
 * USAGE
 *   cd backend
 *   node scripts/checkRealDataAvailability.js
 *
 * It does not fabricate or estimate any number — every figure printed is a
 * real query result against your actual configured database. If the
 * connection fails, it reports that plainly instead of guessing.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");

const Task = require("../src/models/Task");
const Message = require("../src/models/Message");
const FileAsset = require("../src/models/FileAsset");
const Group = require("../src/models/Group");
const AiReport = require("../src/models/AiReport");
const RiskSnapshot = require("../src/models/RiskSnapshot");
const PeerReview = require("../src/models/PeerReview");
const ReviewRound = require("../src/models/ReviewRound");
const ActivityLog = require("../src/models/ActivityLog");

const line = () => console.log("-".repeat(70));

async function main() {
  console.log("ML TRAINING STEP 2 — Real Data Availability Check");
  console.log(`MONGO_URI: ${(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai").replace(/\/\/[^@]*@/, "//<credentials>@")}`);
  line();

  try {
    await connectDB();
  } catch (err) {
    console.log("\nREAL DATA CHECK: UNVERIFIED");
    console.log(`Reason: could not connect to MongoDB — ${err.message}`);
    console.log("No counts below are real; nothing was queried.");
    process.exit(1);
  }

  const [
    groupCount,
    taskCount,
    tasksWithCompletedAt,
    tasksWithDue,
    tasksWithSubmissions,
    submissionVerdictAgg,
    messageCount,
    groupMessageCount,
    privateMessageCount,
    fileCount,
    aiReportCount,
    riskSnapshotCount,
    peerReviewCount,
    reviewRoundCount,
    activityLogCount,
  ] = await Promise.all([
    Group.countDocuments(),
    Task.countDocuments(),
    Task.countDocuments({ completedAt: { $ne: null } }),
    Task.countDocuments({ due: { $ne: null } }),
    Task.countDocuments({ "submissions.0": { $exists: true } }),
    Task.aggregate([
      { $unwind: "$submissions" },
      { $match: { "submissions.verdict": { $ne: "" } } },
      { $group: { _id: "$submissions.verdict", count: { $sum: 1 } } },
    ]),
    Message.countDocuments(),
    Message.countDocuments({ group: { $ne: null } }),
    Message.countDocuments({ conversation: { $ne: null } }),
    FileAsset.countDocuments(),
    AiReport.countDocuments(),
    RiskSnapshot.countDocuments(),
    PeerReview.countDocuments(),
    ReviewRound.countDocuments(),
    ActivityLog.countDocuments(),
  ]);

  line();
  console.log("REAL DATA CHECK: OK — connected, all counts below are live query results.\n");

  console.log("Groups/projects:            ", groupCount);
  console.log("Tasks (total):               ", taskCount);
  console.log("  with completedAt set:      ", tasksWithCompletedAt);
  console.log("  with a due date:           ", tasksWithDue);
  console.log("  with >=1 submission:       ", tasksWithSubmissions);
  console.log("  submission verdicts:       ", submissionVerdictAgg.map((v) => `${v._id}=${v.count}`).join(", ") || "none");
  console.log("Messages (total):            ", messageCount);
  console.log("  group (project) messages:  ", groupMessageCount);
  console.log("  private/direct messages:   ", privateMessageCount, "(excluded from Step 3 by design — never a feature source)");
  console.log("Files:                       ", fileCount);
  console.log("AiReport snapshots:          ", aiReportCount);
  console.log("RiskSnapshot records:        ", riskSnapshotCount);
  console.log("PeerReview ratings:          ", peerReviewCount);
  console.log("ReviewRounds:                ", reviewRoundCount);
  console.log("ActivityLog entries:         ", activityLogCount);

  line();
  console.log("Interpretation is left to the ML Step 2 report — this script only measures, it does not decide readiness.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Unexpected error:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
