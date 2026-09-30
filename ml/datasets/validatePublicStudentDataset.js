/**
 * ML TRAINING STEP 5A — Validation for the public (UCI) student dataset.
 * Checks: file exists, records > 0, required features/target present,
 * no corrupted records, no target-in-features leakage, splits are usable.
 *
 * USAGE
 *   cd backend
 *   node scripts/validatePublicStudentDataset.js
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "ml", "public_student_performance_dataset.json");
const MIN_TRAIN_SAMPLES = 50;

function fail(msg) {
  console.log(`FAIL: ${msg}`);
  console.log("\nDATASET PREPARATION BLOCKED");
  process.exit(1);
}

function main() {
  console.log("Validating public_student_performance_dataset.json");
  console.log("-".repeat(70));

  if (!fs.existsSync(FILE)) fail(`file does not exist at ${FILE}`);
  console.log("PASS: file exists");

  const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));

  if (!Array.isArray(data.featureColumns) || data.featureColumns.length === 0) {
    fail("featureColumns missing or empty");
  }
  console.log(`PASS: ${data.featureColumns.length} feature columns present`);

  if (!data.targetColumn) fail("targetColumn missing");
  console.log(`PASS: target column present ("${data.targetColumn}")`);

  const split = data.split;
  if (!split || !split.train || !split.val || !split.test) fail("split.train/val/test missing");
  const { train, val, test } = split;
  const total = train.length + val.length + test.length;
  if (total === 0) fail("all splits are empty — records = 0");
  console.log(`PASS: records > 0 (train=${train.length} val=${val.length} test=${test.length}, total=${total})`);

  if (train.length < MIN_TRAIN_SAMPLES) fail(`train split (${train.length}) below minimum (${MIN_TRAIN_SAMPLES})`);
  if (val.length === 0) fail("validation split is empty");
  if (test.length === 0) fail("test split is empty");
  console.log("PASS: train/val/test splitting is usable (all partitions non-empty, train above minimum)");

  let corrupted = 0;
  let leaks = 0;
  for (const part of [train, val, test]) {
    for (const r of part) {
      const feats = r.features || {};
      for (const c of data.featureColumns) {
        if (feats[c] === undefined || feats[c] === null || Number.isNaN(feats[c])) corrupted++;
      }
      if (!r.label || typeof r.label.value !== "number" || Number.isNaN(r.label.value)) corrupted++;
      if (Object.prototype.hasOwnProperty.call(feats, data.targetColumn)) leaks++;
    }
  }
  if (corrupted > 0) fail(`${corrupted} corrupted feature/label values found`);
  console.log("PASS: no corrupted records (all feature values numeric, all labels numeric)");

  if (leaks > 0) fail(`${leaks} records contain the target column inside features (data leakage)`);
  console.log("PASS: no data leakage (target column absent from all feature rows)");

  // duplicate-id check
  const ids = [...train, ...val, ...test].map((r) => r.id);
  const dupIds = ids.length - new Set(ids).size;
  if (dupIds > 0) fail(`${dupIds} duplicate record ids found across splits`);
  console.log("PASS: no duplicate record ids across splits");

  console.log(`\nDataset: ${data.datasetName}`);
  console.log(`Source: ${data.datasetSourceUrl}`);
  console.log(`Scope note: ${data.scopeNote}`);

  console.log("\nDATASET PREPARATION COMPLETE");
  process.exit(0);
}

main();
