/**
 * ML TRAINING STEP 5D — REAL TeamSync ML dataset generation.
 * ---------------------------------------------------------------------------
 * Connects to the existing MongoDB (MONGO_URI), reads REAL Task / Message /
 * FileAsset / PeerReview / ActivityLog / Group / User documents, extracts
 * the already-approved Step 3 features via mlFeatureService, derives labels
 * from independent real outcomes via mlDatasetService (PeerReview scores,
 * then submission verdicts — NEVER Step 3's own AI predictions), cleans /
 * de-dupes / splits the result, and writes:
 *
 *   backend/data/ml/teamsync_student_performance_dataset.json
 *
 * This script does NOT train anything and does NOT touch the UCI dataset or
 * model (ai-engine/models/student_performance_rf_uci_public/**, untouched).
 * It does not modify Step 3 AI logic (ai-engine/analyzers/**) — it only
 * *reads* real Mongo documents through the existing feature/dataset
 * services. If MongoDB is unreachable, it reports
 * "TEAMSYNC DATASET BLOCKED — REAL DATA UNAVAILABLE" and writes nothing —
 * it never substitutes UCI, seed, fixture, or fabricated data.
 *
 * Run: node backend/scripts/generateTeamsyncDataset.js
 */

require("../src/config/env");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");

const User = require("../src/models/User");
const Group = require("../src/models/Group");
const Task = require("../src/models/Task");
const Message = require("../src/models/Message");
const FileAsset = require("../src/models/FileAsset");
const ActivityLog = require("../src/models/ActivityLog");
const PeerReview = require("../src/models/PeerReview");

const { computeStudentFeatures, computeProjectFeatures } = require("../src/services/mlFeatureService");
const {
  deriveStudentLabel,
  deriveProjectLabel,
  handleMissingValues,
  dedupeRecords,
  splitDataset,
  assessSufficiency,
} = require("../src/services/mlDatasetService");

const OUTPUT_PATH = path.join(__dirname, "..", "data", "ml", "teamsync_student_performance_dataset.json");

const STUDENT_FEATURE_COLUMNS = [
  "taskCompletionRatio",
  "onTimeCompletionRate",
  "overdueTaskCount",
  "remainingTaskCount",
  "inProgressTaskCount",
  "estimatedEffortAssignedHours",
  "completedEffortPlannedHours",
  "deadlineProximityDays",
  "relevantFileCount",
  "meaningfulChatMessageCount",
  "blockerMentionCount",
  "progressUpdateMentionCount",
  "activeChatDays",
  "activityConsistency",
  "totalTasksAssigned",
];

function fail(reason) {
  console.log("\nTEAMSYNC DATASET BLOCKED \u2014 REAL DATA UNAVAILABLE");
  console.log(`Reason: ${reason}`);
  console.log("No UCI, seed, fixture, or fabricated data was substituted. Nothing was written.\n");
  process.exitCode = 1;
}

async function main() {
  console.log("STEP 5D \u2014 TeamSync real ML dataset generation");
  console.log("=".repeat(60));

  // 1. Connect to the existing MONGO_URI --------------------------------
  try {
    await connectDB();
  } catch (err) {
    fail(`MongoDB connection failed (${err.message})`);
    return;
  }

  try {
    // 2. Read REAL MongoDB records ---------------------------------------
    const [groups, tasks, messages, files, activityLogs, peerReviews, users] = await Promise.all([
      Group.find({}).lean(),
      Task.find({}).lean(),
      Message.find({ group: { $ne: null } }).lean(), // group chat only; DMs excluded, per Step 3 rule
      FileAsset.find({}).lean(),
      ActivityLog.find({}).lean(),
      PeerReview.find({}).lean(),
      User.find({ role: "student" }).lean(),
    ]);

    const totalRealRecords = groups.length + tasks.length + messages.length + files.length + activityLogs.length + peerReviews.length;
    console.log(`Real documents read: groups=${groups.length} tasks=${tasks.length} messages=${messages.length} ` +
      `files=${files.length} activityLogs=${activityLogs.length} peerReviews=${peerReviews.length} students=${users.length}`);

    if (totalRealRecords === 0) {
      fail("MongoDB connected but contains zero real records across Task/Message/File/ActivityLog/PeerReview/Group \u2014 there is no real data yet to build a dataset from.");
      return;
    }

    // Index helpers --------------------------------------------------------
    const tasksByGroup = new Map();
    for (const t of tasks) {
      const g = String(t.group);
      if (!tasksByGroup.has(g)) tasksByGroup.set(g, []);
      tasksByGroup.get(g).push(t);
    }
    const messagesByGroup = new Map();
    for (const m of messages) {
      const g = String(m.group);
      if (!messagesByGroup.has(g)) messagesByGroup.set(g, []);
      messagesByGroup.get(g).push(m);
    }
    const filesByGroup = new Map();
    for (const f of files) {
      const g = String(f.group);
      if (!filesByGroup.has(g)) filesByGroup.set(g, []);
      filesByGroup.get(g).push(f);
    }
    const activityByGroupActor = new Map(); // `${group}:${actor}` -> logs
    for (const a of activityLogs) {
      const key = `${a.group}:${a.actor}`;
      if (!activityByGroupActor.has(key)) activityByGroupActor.set(key, []);
      activityByGroupActor.get(key).push(a);
    }
    const peerReviewsByGroupReviewee = new Map();
    for (const r of peerReviews) {
      const key = `${r.group}:${r.reviewee}`;
      if (!peerReviewsByGroupReviewee.has(key)) peerReviewsByGroupReviewee.set(key, []);
      peerReviewsByGroupReviewee.get(key).push(r);
    }

    // 3+4. Extract approved features + derive labels — student records -----
    const rawStudentRecords = [];
    const excluded = [];
    const referenceDate = new Date();

    for (const group of groups) {
      const gid = String(group._id);
      const groupTasks = tasksByGroup.get(gid) || [];
      const groupMessages = messagesByGroup.get(gid) || [];
      const groupFiles = filesByGroup.get(gid) || [];

      // Real members of this group only (no fabricated pairs).
      const memberIds = (group.members || []).map(String);

      for (const uid of memberIds) {
        const studentTasks = groupTasks.filter((t) => String(t.assignee) === uid);
        const studentMessages = groupMessages.filter((m) => String(m.sender) === uid);
        const studentFiles = groupFiles.filter((f) => String(f.uploadedBy) === uid);
        const studentActivity = activityByGroupActor.get(`${gid}:${uid}`) || [];

        const features = computeStudentFeatures({
          tasks: studentTasks,
          messages: studentMessages,
          files: studentFiles,
          activityLogs: studentActivity,
          referenceDate,
        });

        // 5/6. Label from independent real outcomes only (never Step 3 AI output)
        const studentSubmissions = studentTasks.flatMap((t) => (t.submissions || []).filter((s) => String(s.student) === uid));
        const label = deriveStudentLabel({
          peerReviews: peerReviewsByGroupReviewee.get(`${gid}:${uid}`) || [],
          submissions: studentSubmissions,
        });

        const id = `student:${uid}:${gid}`;
        if (!label) {
          excluded.push({ id, reason: "no independent real outcome (no PeerReview scores and no real submission verdicts for this student in this group)" });
          continue;
        }

        rawStudentRecords.push({
          id,
          type: "student",
          studentId: uid,
          groupId: gid,
          features,
          // Nested {value, scale, source, sourceCount} shape — matches what
          // ai-engine/ml/train_student_performance_rf.py already reads via
          // row["label"]["value"], so the two scripts chain without any
          // change to Step 4's file.
          label: { value: label.value, scale: label.scale, source: label.source, sourceCount: label.sourceCount },
        });
      }
    }

    // 7. Missing-value handling + de-duplication ---------------------------
    const { kept: mvKept, dropped: mvDropped } = handleMissingValues(rawStudentRecords, STUDENT_FEATURE_COLUMNS, { maxMissingRatio: 0.5 });
    for (const d of mvDropped) excluded.push(d);

    const { kept: deduped, dropped: dupeDropped } = dedupeRecords(mvKept, (r) => `${r.studentId}:${r.groupId}`);
    for (const d of dupeDropped) excluded.push({ id: d.id, reason: `duplicate of ${d.duplicateOf}` });

    const usableSamples = deduped;

    // 8. Deterministic train/validation/test split (grouped by student) ----
    const splits = splitDataset(usableSamples, (r) => r.studentId, { train: 0.7, val: 0.15, test: 0.15 });

    // Label distribution (bucketed, since label can be a continuous 1-5
    // PeerReview average OR a 0-1 submission approval rate — report both
    // scales actually present in the real data, never invented buckets).
    const labelDistribution = { "PeerReview.scores (1-5 continuous)": [], "Task.submissions[].verdict (0-1 approval rate)": [] };
    for (const r of usableSamples) {
      if (r.label.source === "PeerReview.scores") labelDistribution["PeerReview.scores (1-5 continuous)"].push(r.label.value);
      else labelDistribution["Task.submissions[].verdict (0-1 approval rate)"].push(r.label.value);
    }
    const distSummary = {};
    for (const [k, vals] of Object.entries(labelDistribution)) {
      distSummary[k] = {
        count: vals.length,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      };
    }

    const sufficiency = assessSufficiency(usableSamples.length, { minLabeled: 50 });

    // Also compute REAL project-level features/labels for archived groups,
    // included in the dataset file for completeness (not required by the
    // console summary, which STEP 5D specifies at the student level).
    const projectRecords = [];
    for (const group of groups) {
      const gid = String(group._id);
      const groupTasks = tasksByGroup.get(gid) || [];
      const groupMessages = messagesByGroup.get(gid) || [];
      const pf = computeProjectFeatures({ tasks: groupTasks, messages: groupMessages, group, referenceDate });
      const label = deriveProjectLabel({ group, teamCompletionRatio: pf.teamCompletionRatio });
      if (!label) continue; // active (non-archived) groups have no terminal outcome yet — excluded, not fabricated
      projectRecords.push({
        id: `project:${gid}`,
        type: "project",
        groupId: gid,
        features: pf,
        label: { value: label.value, scale: label.scale, source: label.source, sourceCount: label.sourceCount },
      });
    }

    // Assemble + write dataset file -----------------------------------------
    const dataset = {
      generatedAt: new Date().toISOString(),
      // Read by ai-engine/ml/train_student_performance_rf.py's metadata step
      // (data.get("datasetSource")) so the trained model's metadata.json
      // accurately reports this as the real-MongoDB TeamSync pipeline.
      datasetSource: "real MongoDB (backend/scripts/generateTeamsyncDataset.js), no seed/fixture/UCI data",
      source: "MongoDB (real TeamSync production collections: Task, Message, FileAsset, PeerReview, ActivityLog, Group, User)",
      pipeline: "backend/src/services/mlFeatureService.js + backend/src/services/mlDatasetService.js",
      featureColumns: STUDENT_FEATURE_COLUMNS,
      counts: {
        totalRealRecordsRead: totalRealRecords,
        rawStudentGroupPairs: rawStudentRecords.length + excluded.filter((e) => e.id?.startsWith("student:") && !mvKept.find((k) => k.id === e.id)).length,
        usableSamples: usableSamples.length,
        excludedSamples: excluded.length,
        featureCount: STUDENT_FEATURE_COLUMNS.length,
        trainCount: splits.train.length,
        valCount: splits.val.length,
        testCount: splits.test.length,
      },
      labelDistribution: distSummary,
      sufficiency,
      excludedSampleLog: excluded,
      // Key name "split" (singular) matches what
      // ai-engine/ml/train_student_performance_rf.py reads via data["split"] —
      // required so Step 4 can consume this file when pointed at it via
      // ML_DATASET_PATH, with zero changes to Step 4's script.
      split: {
        train: splits.train,
        val: splits.val,
        test: splits.test,
      },
      projectLevelRecords: projectRecords,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));

    // 9. Print required summary --------------------------------------------
    const status = sufficiency.sufficient ? "READY" : "INSUFFICIENT";
    console.log("-".repeat(60));
    console.log(`Total real records read:      ${totalRealRecords}`);
    console.log(`Usable samples (student):     ${usableSamples.length}`);
    console.log(`Excluded samples:             ${excluded.length}`);
    console.log(`Feature count:                ${STUDENT_FEATURE_COLUMNS.length}`);
    console.log("Label distribution:");
    for (const [k, v] of Object.entries(distSummary)) {
      console.log(`  ${k}: count=${v.count} min=${v.min} max=${v.max} mean=${v.mean !== null ? v.mean.toFixed(3) : null}`);
    }
    console.log(`Train count:                   ${splits.train.length}`);
    console.log(`Validation count:              ${splits.val.length}`);
    console.log(`Test count:                    ${splits.test.length}`);
    console.log(`Sufficiency threshold:         ${sufficiency.minLabeledThreshold} labeled samples`);
    console.log("-".repeat(60));
    console.log(`FINAL STATUS: ${status}`);
    console.log("-".repeat(60));
    console.log(`Dataset written to: ${OUTPUT_PATH}`);
  } catch (err) {
    fail(`Error while reading/processing real MongoDB data (${err.message})`);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

main();
