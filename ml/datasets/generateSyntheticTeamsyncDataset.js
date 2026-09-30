/**
 * ML TRAINING STEP 5E — SYNTHETIC development dataset generator.
 * ---------------------------------------------------------------------------
 * THIS SCRIPT DOES NOT TOUCH MONGODB AND DOES NOT READ ANY REAL TEAMSYNC
 * DATA. Every value it writes is procedurally generated with a seeded RNG.
 *
 * Purpose: the real TeamSync MongoDB currently has 0 labeled student
 * samples (confirmed via backend/scripts/generateTeamsyncDataset.js, which
 * connects fine but finds no PeerReview/submission-verdict outcomes to
 * derive labels from). That script's real-data output
 * (backend/data/ml/teamsync_student_performance_dataset.json) does not
 * exist yet and this script never creates, edits, or overwrites it.
 *
 * This script exists ONLY to produce a synthetic dataset with the same
 * shape (same 15 feature columns, same {featureColumns, split, label.value}
 * structure) that ai-engine/ml/train_student_performance_rf.py already
 * knows how to consume via ML_DATASET_PATH — so the Random Forest training
 * + evaluation + persistence + reload pipeline can be exercised end-to-end
 * before any real labeled TeamSync data exists. It is a plumbing test, not
 * a model of real students.
 *
 * Every record in the output is unambiguously marked as synthetic:
 *   - dataset.datasetSource   = "SYNTHETIC_DEVELOPMENT_DATA"
 *   - dataset.isRealTeamSyncData = false
 *   - each row's label.source = "SYNTHETIC_DEVELOPMENT_DATA"
 *   - each row's id is prefixed "synthetic:"
 *
 * Output path (fixed, not the real-dataset path):
 *   backend/data/ml/synthetic_teamsync_student_performance_dataset.json
 *
 * Run: node backend/scripts/generateSyntheticTeamsyncDataset.js
 */

const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(
  __dirname, "..", "data", "ml", "synthetic_teamsync_student_performance_dataset.json"
);

// Same 15 feature columns Step 3/5D use for real student records — reusing
// the existing approved feature contract, not inventing a new one.
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

const N_SAMPLES = 240; // >= 200 required
const SEED = 20260820; // fixed seed -> reproducible synthetic dataset

// --- deterministic seeded RNG (mulberry32) so this dataset is reproducible ---
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function gaussianNoise(std) {
  // Box-Muller, using the seeded RNG so results stay reproducible.
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function poissonish(lambda) {
  // Simple non-negative-integer approximation good enough for synthetic
  // counts (not used for anything statistically load-bearing).
  return Math.max(0, Math.round(lambda + gaussianNoise(Math.sqrt(Math.max(lambda, 0.5)))));
}

/**
 * Generates one synthetic student-record. A single latent "engagement/
 * quality" variable in [0,1] drives correlated-but-noisy feature values and
 * the label, so the dataset has a learnable-but-realistic signal (not a
 * trivial 1:1 mapping, not pure noise either).
 */
function generateRecord(i) {
  const latent = clamp(rng() * 0.9 + gaussianNoise(0.08), 0, 1); // underlying "how well this synthetic student is doing"

  const totalTasksAssigned = Math.max(1, poissonish(4 + latent * 8));
  const taskCompletionRatio = clamp(latent + gaussianNoise(0.12), 0, 1);
  const completedTasks = Math.round(taskCompletionRatio * totalTasksAssigned);
  const remainingRaw = totalTasksAssigned - completedTasks;
  const overdueTaskCount = Math.round(clamp(remainingRaw * (1 - latent) * (0.4 + gaussianNoise(0.1)), 0, remainingRaw));
  const remainingTaskCount = Math.max(0, remainingRaw - overdueTaskCount);
  const inProgressTaskCount = Math.min(remainingTaskCount, poissonish(remainingTaskCount * 0.5));

  const onTimeCompletionRate = completedTasks > 0
    ? clamp(latent * 0.9 + gaussianNoise(0.1), 0, 1)
    : 0;

  const estimatedEffortAssignedHours = Math.round(totalTasksAssigned * (4 + rng() * 6) * 10) / 10;
  const completedEffortPlannedHours = Math.round(estimatedEffortAssignedHours * taskCompletionRatio * 10) / 10;

  // NOTE: the real feature service returns null here when there are no
  // remaining tasks (no proximity to compute). We deliberately do NOT do
  // that in this synthetic dataset: train_student_performance_rf.py's
  // to_xy() does feats.get(col, 0), which only substitutes 0 for a
  // *missing* key, not for an explicit null — a null here would reach
  // sklearn's .fit() and break it. Since this script must not modify that
  // training script, every synthetic feature value is always numeric.
  const deadlineProximityDays = remainingTaskCount > 0
    ? Math.round(clamp(3 + (1 - latent) * 10 + gaussianNoise(3), 0, 45))
    : 0;

  const relevantFileCount = poissonish(1 + latent * 5);
  const meaningfulChatMessageCount = poissonish(3 + latent * 14);
  const blockerMentionCount = poissonish((1 - latent) * 4);
  const progressUpdateMentionCount = poissonish(latent * 6);
  const activeChatDays = Math.min(21, poissonish(2 + latent * 10));
  const activityConsistency = clamp(latent * 0.8 + gaussianNoise(0.15), 0, 1);

  const features = {
    taskCompletionRatio,
    onTimeCompletionRate,
    overdueTaskCount,
    remainingTaskCount,
    inProgressTaskCount,
    estimatedEffortAssignedHours,
    completedEffortPlannedHours,
    deadlineProximityDays,
    relevantFileCount,
    meaningfulChatMessageCount,
    blockerMentionCount,
    progressUpdateMentionCount,
    activeChatDays,
    activityConsistency,
    totalTasksAssigned,
  };

  // Continuous label on a 1-5 scale (same scale family as the real
  // PeerReview.scores-derived label), built from the same latent variable
  // plus its own independent noise term so label != a deterministic
  // function of the features (a real ML task, not a lookup).
  const rawLabel = 1 + 4 * clamp(latent * 0.75 + taskCompletionRatio * 0.15 + onTimeCompletionRate * 0.1 + gaussianNoise(0.35), 0, 1);
  const labelValue = Math.round(clamp(rawLabel, 1, 5) * 100) / 100;

  return {
    id: `synthetic:student:${i}`,
    type: "student",
    // No real studentId/groupId exist for synthetic rows — fields omitted
    // rather than filled with fake ObjectId-looking strings, so nothing
    // here could be mistaken for a real Mongo reference.
    features,
    label: {
      value: labelValue,
      scale: "1-5 continuous",
      source: "SYNTHETIC_DEVELOPMENT_DATA",
      sourceCount: 1,
    },
  };
}

function splitDataset(records, ratios = { train: 0.7, val: 0.15, test: 0.15 }) {
  // Deterministic shuffle using the same seeded RNG, then contiguous slice —
  // no leakage, reproducible across runs.
  const shuffled = [...records];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const nTrain = Math.round(shuffled.length * ratios.train);
  const nVal = Math.round(shuffled.length * ratios.val);
  return {
    train: shuffled.slice(0, nTrain),
    val: shuffled.slice(nTrain, nTrain + nVal),
    test: shuffled.slice(nTrain + nVal),
  };
}

function main() {
  console.log("STEP 5E — SYNTHETIC TeamSync development dataset generation");
  console.log("=".repeat(60));
  console.log("This dataset is 100% synthetic. No MongoDB connection is made.");
  console.log("No real TeamSync user data is read or represented.");
  console.log("-".repeat(60));

  const records = [];
  for (let i = 0; i < N_SAMPLES; i++) records.push(generateRecord(i));

  const splits = splitDataset(records);

  const labelValues = records.map((r) => r.label.value);
  const labelDistribution = {
    count: labelValues.length,
    min: Math.min(...labelValues),
    max: Math.max(...labelValues),
    mean: Math.round((labelValues.reduce((a, b) => a + b, 0) / labelValues.length) * 1000) / 1000,
  };

  const dataset = {
    generatedAt: new Date().toISOString(),
    // Clearly and unambiguously marked as synthetic — read by
    // train_student_performance_rf.py's metadata step (data["datasetSource"])
    // so the resulting model.metadata.json inherits this exact label.
    datasetSource: "SYNTHETIC_DEVELOPMENT_DATA",
    isRealTeamSyncData: false,
    scopeNote:
      "SYNTHETIC DEVELOPMENT DATA ONLY. Procedurally generated (seeded RNG, no MongoDB access) " +
      "to exercise the Random Forest training/evaluation/persistence pipeline while the real " +
      "TeamSync MongoDB has 0 labeled student samples. Must NOT be described as, or treated as, " +
      "real TeamSync user data. See backend/data/ml/teamsync_student_performance_dataset.json " +
      "for the (currently empty/unavailable) real dataset.",
    generationMethod: "seeded procedural generation (mulberry32 PRNG, seed=" + SEED + "), backend/scripts/generateSyntheticTeamsyncDataset.js",
    featureColumns: STUDENT_FEATURE_COLUMNS,
    counts: {
      totalSamples: records.length,
      featureCount: STUDENT_FEATURE_COLUMNS.length,
      trainCount: splits.train.length,
      valCount: splits.val.length,
      testCount: splits.test.length,
    },
    labelDistribution,
    split: {
      train: splits.train,
      val: splits.val,
      test: splits.test,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));

  console.log(`Total synthetic samples:  ${records.length}`);
  console.log(`Feature count:            ${STUDENT_FEATURE_COLUMNS.length}`);
  console.log(`Label distribution:       count=${labelDistribution.count} min=${labelDistribution.min} max=${labelDistribution.max} mean=${labelDistribution.mean}`);
  console.log(`Train count:              ${splits.train.length}`);
  console.log(`Validation count:         ${splits.val.length}`);
  console.log(`Test count:               ${splits.test.length}`);
  console.log("-".repeat(60));
  console.log(`Dataset written to: ${OUTPUT_PATH}`);
  console.log("\nSYNTHETIC DATASET GENERATION COMPLETE");
}

main();
