/**
 * ML TRAINING STEP 3 — Real Training Dataset Preparation (read-only)
 * ---------------------------------------------------------------------
 * Connects to whatever MONGO_URI is configured in backend/.env — your real
 * database, never seed/fixture data — pulls the real Group/Task/Message/
 * FileAsset/ActivityLog/PeerReview/ReviewRound documents, builds per-student
 * and per-project feature+label rows via mlFeatureService/mlDatasetService,
 * and writes a training-ready dataset to backend/data/ml/.
 *
 * This script NEVER writes/updates/deletes application data — only reads.
 * It does NOT train any model (no scikit-learn/pandas involved) and does
 * NOT touch ai-engine/ at all. It stops after producing and documenting the
 * dataset, per the Step 3 brief.
 *
 * USAGE
 *   cd backend
 *   node scripts/prepareTrainingDataset.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../src/config/db");

const Task = require("../src/models/Task");
const Message = require("../src/models/Message");
const FileAsset = require("../src/models/FileAsset");
const Group = require("../src/models/Group");
const PeerReview = require("../src/models/PeerReview");
const ActivityLog = require("../src/models/ActivityLog");

const { computeStudentFeatures, computeProjectFeatures } = require("../src/services/mlFeatureService");
const {
  deriveStudentLabel,
  deriveProjectLabel,
  handleMissingValues,
  dedupeRecords,
  splitDataset,
  assessSufficiency,
} = require("../src/services/mlDatasetService");

const OUT_DIR = path.join(__dirname, "..", "data", "ml");
const line = () => console.log("-".repeat(70));

const STUDENT_FEATURE_COLUMNS = [
  "taskCompletionRatio", "onTimeCompletionRate", "overdueTaskCount", "remainingTaskCount",
  "inProgressTaskCount", "estimatedEffortAssignedHours", "completedEffortPlannedHours",
  "deadlineProximityDays", "relevantFileCount", "meaningfulChatMessageCount",
  "blockerMentionCount", "progressUpdateMentionCount", "activeChatDays", "activityConsistency",
];
const PROJECT_FEATURE_COLUMNS = [
  "teamCompletionRatio", "completedTaskCount", "remainingTaskCount", "overdueTaskCountTeamWide",
  "remainingProjectEffortHours", "daysToExpectedCompletion", "workloadImbalance",
  "groupChatMeaningfulMessageCount", "blockerCountTeamWide",
  "recentMeaningfulMessageCount7d", "recentTaskCompletionCount7d",
];

async function main() {
  console.log("ML TRAINING STEP 3 — Real Training Dataset Preparation");
  console.log(`MONGO_URI: ${(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai").replace(/\/\/[^@]*@/, "//<credentials>@")}`);
  line();

  try {
    await connectDB();
  } catch (err) {
    console.log("\nDATASET PREPARATION: ABORTED");
    console.log(`Reason: could not connect to MongoDB — ${err.message}`);
    console.log("No dataset written. Nothing below was queried or fabricated.");
    process.exit(1);
  }

  const [groups, tasks, messages, files, peerReviews, activityLogs] = await Promise.all([
    Group.find().lean(),
    Task.find().lean(),
    Message.find({ group: { $ne: null } }).lean(), // group chat only — private/DM never used, per project rule
    FileAsset.find().lean(),
    PeerReview.find().lean(),
    ActivityLog.find().lean(),
  ]);

  line();
  console.log(`Real records pulled: groups=${groups.length} tasks=${tasks.length} group-messages=${messages.length} files=${files.length} peerReviews=${peerReviews.length} activityLogs=${activityLogs.length}`);
  line();

  const referenceDate = new Date();
  const excluded = [];

  // ---------------- STUDENT PERFORMANCE rows ----------------
  const studentRecords = [];
  for (const group of groups) {
    const groupId = String(group._id);
    const groupTasks = tasks.filter((t) => String(t.group) === groupId);
    const groupMessages = messages.filter((m) => String(m.group) === groupId);
    const groupFiles = files.filter((f) => String(f.group) === groupId);
    const groupActivity = activityLogs.filter((a) => String(a.group) === groupId);
    const groupPeerReviews = peerReviews.filter((r) => String(r.group) === groupId);

    const studentIds = new Set([
      ...groupTasks.map((t) => t.assignee && String(t.assignee)).filter(Boolean),
      ...(group.members || []).map(String),
    ]);

    for (const studentId of studentIds) {
      const sTasks = groupTasks.filter((t) => String(t.assignee) === studentId);
      const sMessages = groupMessages.filter((m) => String(m.sender) === studentId);
      const sFiles = groupFiles.filter((f) => String(f.uploadedBy) === studentId);
      const sActivity = groupActivity.filter((a) => String(a.actor) === studentId);
      const sPeerReviews = groupPeerReviews.filter((r) => String(r.reviewee) === studentId);
      const sSubmissions = sTasks.flatMap((t) => t.submissions || []);

      if (!sTasks.length && !sMessages.length && !sFiles.length && !sActivity.length && !sPeerReviews.length) {
        excluded.push({ id: `${studentId}:${groupId}`, type: "student", reason: "no real activity of any kind found for this student in this group" });
        continue;
      }

      const features = computeStudentFeatures({ tasks: sTasks, messages: sMessages, files: sFiles, activityLogs: sActivity, referenceDate });
      const label = deriveStudentLabel({ peerReviews: sPeerReviews, submissions: sSubmissions });
      if (!label) {
        excluded.push({ id: `${studentId}:${groupId}`, type: "student", reason: "no PeerReview or submission-verdict outcome available — cannot be labeled, not included in supervised set" });
        continue;
      }
      studentRecords.push({ id: `${studentId}:${groupId}`, studentId, groupId, features, label });
    }
  }

  // ---------------- PROJECT COMPLETION rows ----------------
  const projectRecords = [];
  for (const group of groups) {
    const groupId = String(group._id);
    const groupTasks = tasks.filter((t) => String(t.group) === groupId);
    const groupMessages = messages.filter((m) => String(m.group) === groupId);

    if (!groupTasks.length) {
      excluded.push({ id: groupId, type: "project", reason: "group has zero tasks — no real signal to build features from" });
      continue;
    }
    const features = computeProjectFeatures({ tasks: groupTasks, messages: groupMessages, group, referenceDate });
    const label = deriveProjectLabel({ group, teamCompletionRatio: features.teamCompletionRatio });
    if (!label) {
      excluded.push({ id: groupId, type: "project", reason: group.status !== "archived" ? "group is still active — no terminal outcome yet" : "archived but no computable completion ratio" });
      continue;
    }
    projectRecords.push({ id: groupId, groupId, features, label });
  }

  // ---------------- dedupe + missing-value handling ----------------
  const studentDedupe = dedupeRecords(studentRecords, (r) => `${r.studentId}:${r.groupId}`);
  const projectDedupe = dedupeRecords(projectRecords, (r) => r.groupId);

  const studentMissing = handleMissingValues(studentDedupe.kept, STUDENT_FEATURE_COLUMNS);
  const projectMissing = handleMissingValues(projectDedupe.kept, PROJECT_FEATURE_COLUMNS);

  // ---------------- split ----------------
  const studentSplit = splitDataset(studentMissing.kept, (r) => r.studentId);
  const projectSplit = splitDataset(projectMissing.kept, (r) => r.groupId);

  // ---------------- sufficiency ----------------
  const studentSufficiency = assessSufficiency(studentMissing.kept.length);
  const projectSufficiency = assessSufficiency(projectMissing.kept.length, { minLabeled: 20 }); // lower bar: one row per group, real volume is inherently capped by group count

  // ---------------- write outputs ----------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const writeJson = (name, obj) => fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj, null, 2));
  writeJson("student_performance_dataset.json", { featureColumns: STUDENT_FEATURE_COLUMNS, split: studentSplit, generatedAt: referenceDate.toISOString() });
  writeJson("project_completion_dataset.json", { featureColumns: PROJECT_FEATURE_COLUMNS, split: projectSplit, generatedAt: referenceDate.toISOString() });

  const excludedByType = { student: excluded.filter((e) => e.type === "student"), project: excluded.filter((e) => e.type === "project") };

  const manifest = {
    generatedAt: referenceDate.toISOString(),
    source: "real MongoDB (MONGO_URI from backend/.env), no seed/fixture data",
    student: {
      usableRecords: studentMissing.kept.length,
      featureColumns: STUDENT_FEATURE_COLUMNS,
      target: { candidateSources: ["PeerReview.scores (preferred)", "Task.submissions[].verdict (fallback)"], note: "never Step 3's own AI prediction" },
      excludedRecords: excludedByType.student.length + studentDedupe.dropped.length + studentMissing.dropped.length,
      exclusionBreakdown: {
        noActivity: excludedByType.student.filter((e) => e.reason.includes("no real activity")).length,
        unlabeled: excludedByType.student.filter((e) => e.reason.includes("cannot be labeled")).length,
        duplicates: studentDedupe.dropped.length,
        tooManyMissingFeatures: studentMissing.dropped.length,
      },
      missingValuePolicy: studentMissing.policy,
      duplicateHandling: `exact (studentId, groupId) key de-dup; ${studentDedupe.dropped.length} duplicate(s) dropped`,
      splitStrategy: "deterministic, student-grouped 70/15/15 (no student appears in more than one split)",
      splitCounts: { train: studentSplit.train.length, val: studentSplit.val.length, test: studentSplit.test.length },
      sufficiency: studentSufficiency,
    },
    project: {
      usableRecords: projectMissing.kept.length,
      featureColumns: PROJECT_FEATURE_COLUMNS,
      target: { source: "Group.status=archived + real Task completion ratio at archive time", note: "no explicit final-outcome field exists in the schema (see Step 1 audit); active/unfinished groups are excluded, not guessed" },
      excludedRecords: excludedByType.project.length + projectDedupe.dropped.length + projectMissing.dropped.length,
      exclusionBreakdown: {
        noTasks: excludedByType.project.filter((e) => e.reason.includes("zero tasks")).length,
        stillActive: excludedByType.project.filter((e) => e.reason.includes("still active")).length,
        duplicates: projectDedupe.dropped.length,
        tooManyMissingFeatures: projectMissing.dropped.length,
      },
      missingValuePolicy: projectMissing.policy,
      duplicateHandling: `exact groupId key de-dup; ${projectDedupe.dropped.length} duplicate(s) dropped`,
      splitStrategy: "deterministic, group-keyed 70/15/15",
      splitCounts: { train: projectSplit.train.length, val: projectSplit.val.length, test: projectSplit.test.length },
      sufficiency: projectSufficiency,
    },
  };
  writeJson("dataset_manifest.json", manifest);

  // ---------------- final report ----------------
  line();
  console.log("FINAL REPORT");
  line();
  console.log(`Student performance — usable labeled records: ${manifest.student.usableRecords}`);
  console.log(`  Features (${STUDENT_FEATURE_COLUMNS.length}): ${STUDENT_FEATURE_COLUMNS.join(", ")}`);
  console.log(`  Target: PeerReview.scores (preferred) / Task.submissions[].verdict (fallback)`);
  console.log(`  Excluded: ${manifest.student.excludedRecords} — no-activity=${manifest.student.exclusionBreakdown.noActivity}, unlabeled=${manifest.student.exclusionBreakdown.unlabeled}, duplicates=${manifest.student.exclusionBreakdown.duplicates}, too-much-missing=${manifest.student.exclusionBreakdown.tooManyMissingFeatures}`);
  console.log(`  Split: train=${manifest.student.splitCounts.train} val=${manifest.student.splitCounts.val} test=${manifest.student.splitCounts.test}`);
  console.log(`  Sufficiency (>= ${studentSufficiency.minLabeledThreshold} labeled records): ${studentSufficiency.sufficient ? "MET" : "NOT MET"}`);
  line();
  console.log(`Project completion — usable labeled records: ${manifest.project.usableRecords}`);
  console.log(`  Features (${PROJECT_FEATURE_COLUMNS.length}): ${PROJECT_FEATURE_COLUMNS.join(", ")}`);
  console.log(`  Target: Group.status=archived + real completion ratio at archive time`);
  console.log(`  Excluded: ${manifest.project.excludedRecords} — no-tasks=${manifest.project.exclusionBreakdown.noTasks}, still-active=${manifest.project.exclusionBreakdown.stillActive}, duplicates=${manifest.project.exclusionBreakdown.duplicates}, too-much-missing=${manifest.project.exclusionBreakdown.tooManyMissingFeatures}`);
  console.log(`  Split: train=${manifest.project.splitCounts.train} val=${manifest.project.splitCounts.val} test=${manifest.project.splitCounts.test}`);
  console.log(`  Sufficiency (>= ${projectSufficiency.minLabeledThreshold} labeled records): ${projectSufficiency.sufficient ? "MET" : "NOT MET"}`);
  line();

  const overallReady = studentSufficiency.sufficient || projectSufficiency.sufficient;
  console.log(overallReady ? "ML TRAINING DATA: READY (for whichever target met its threshold above)" : "ML TRAINING DATA: INSUFFICIENT");
  console.log("\nFiles written to backend/data/ml/: student_performance_dataset.json, project_completion_dataset.json, dataset_manifest.json");
  console.log("No model was trained. No ai-engine/ file was touched. Stopping here per instructions.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Dataset preparation failed:", err);
  process.exit(1);
});
