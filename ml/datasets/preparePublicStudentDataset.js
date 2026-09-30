/**
 * ML TRAINING STEP 5A — Public Dataset Preparation (UCI Student Performance)
 * ---------------------------------------------------------------------------
 * IMPORTANT SCOPE NOTE (read before using this file):
 *
 * This is NOT the TeamSync real-data pipeline. It does not touch, replace,
 * or extend backend/scripts/prepareTrainingDataset.js, mlFeatureService.js,
 * or mlDatasetService.js. Those remain the only path that produces a
 * TeamSync-specific student-performance dataset from real MongoDB data.
 *
 * This script instead prepares the UCI "Student Performance" dataset
 * (Cortez, P. & Silva, A. (2008), UCI Machine Learning Repository,
 * https://doi.org/10.24432/C5TG7T) using ITS OWN native feature schema —
 * academic/demographic/behavioral attributes of Portuguese secondary-school
 * students — to predict final grade (G3). It is a DIFFERENT PREDICTION
 * PROBLEM than TeamSync's own task/chat/collaboration-based student
 * performance model. It does not use, imply, or fabricate a mapping onto
 * TeamSync's STUDENT_FEATURE_COLUMNS, because no genuine correspondence
 * exists between UCI's survey attributes and TeamSync's platform telemetry.
 *
 * Output of this script is written to a SEPARATE file
 * (backend/data/ml/public_student_performance_dataset.json) so it can never
 * be confused with, or silently overwrite, a real TeamSync dataset produced
 * by prepareTrainingDataset.js.
 *
 * USAGE
 *   cd backend
 *   node scripts/preparePublicStudentDataset.js
 */
const fs = require("fs");
const path = require("path");

const RAW_DIR = path.join(__dirname, "..", "data", "ml", "raw");
const OUT_DIR = path.join(__dirname, "..", "data", "ml");
const OUT_FILE = path.join(OUT_DIR, "public_student_performance_dataset.json");

// Source file: UCI "Student Performance" — Portuguese language course (larger of
// the two provided files: 649 records vs 395 for Math). We deliberately use ONE
// subject file, not a merge of student-mat.csv + student-por.csv: the original
// authors' own student-merge.R matches records by 13 shared demographic columns,
// and applying that merge ourselves without the authors' exact logic risks
// silently conflating different students who share demographics — which would
// be a data-integrity fabrication, not a preparation step.
const SOURCE_FILE = path.join(RAW_DIR, "student-por.csv");

// Native UCI feature columns actually used (own schema — see header note above).
// G1 and G2 (period grades) are DELIBERATELY EXCLUDED from features: they are
// near-deterministic of G3 (the original paper flags this explicitly), and
// including them would make the model trivially accurate while learning
// nothing about the demographic/behavioral factors this exercise is meant to
// explore. This mirrors a well-documented modeling choice in published work
// on this exact dataset, not an arbitrary omission.
const FEATURE_COLUMNS = [
  "age", "Medu", "Fedu", "traveltime", "studytime", "failures",
  "famrel", "freetime", "goout", "Dalc", "Walc", "health", "absences",
  "sex_M", "address_U", "schoolsup_yes", "famsup_yes", "paid_yes",
  "activities_yes", "higher_yes", "internet_yes", "romantic_yes",
];
const TARGET_COLUMN = "G3"; // final grade, 0-20, continuous

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    // simple CSV split is safe here: no embedded commas in this dataset's quoted fields
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function bin(v) { return v === "yes" ? 1 : 0; }

function toFeatureRow(raw) {
  return {
    age: Number(raw.age),
    Medu: Number(raw.Medu),
    Fedu: Number(raw.Fedu),
    traveltime: Number(raw.traveltime),
    studytime: Number(raw.studytime),
    failures: Number(raw.failures),
    famrel: Number(raw.famrel),
    freetime: Number(raw.freetime),
    goout: Number(raw.goout),
    Dalc: Number(raw.Dalc),
    Walc: Number(raw.Walc),
    health: Number(raw.health),
    absences: Number(raw.absences),
    sex_M: raw.sex === "M" ? 1 : 0,
    address_U: raw.address === "U" ? 1 : 0,
    schoolsup_yes: bin(raw.schoolsup),
    famsup_yes: bin(raw.famsup),
    paid_yes: bin(raw.paid),
    activities_yes: bin(raw.activities),
    higher_yes: bin(raw.higher),
    internet_yes: bin(raw.internet),
    romantic_yes: bin(raw.romantic),
  };
}

function seededShuffle(arr, seed) {
  // deterministic Mulberry32 PRNG so the split is reproducible, not re-randomized on every run
  let a = seed;
  function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function main() {
  console.log("ML TRAINING STEP 5A — Public Dataset Preparation (UCI Student Performance)");
  console.log("-".repeat(70));

  if (!fs.existsSync(SOURCE_FILE)) {
    console.log(`\nBLOCKED: raw source file not found at ${SOURCE_FILE}`);
    console.log("DATASET PREPARATION BLOCKED");
    process.exit(1);
  }

  const rawRows = parseCsv(fs.readFileSync(SOURCE_FILE, "utf-8"));
  console.log(`Raw records read: ${rawRows.length} from ${path.basename(SOURCE_FILE)}`);

  // --- quality checks ---
  const corrupted = [];
  const records = [];
  rawRows.forEach((raw, idx) => {
    const missingCols = [...FEATURE_COLUMNS.filter((c) => false), TARGET_COLUMN].filter(
      (c) => raw[c] === undefined || raw[c] === ""
    );
    const requiredRaw = ["age","Medu","Fedu","traveltime","studytime","failures","famrel",
      "freetime","goout","Dalc","Walc","health","absences","sex","address","schoolsup",
      "famsup","paid","activities","higher","internet","romantic","G3"];
    const missingRaw = requiredRaw.filter((c) => raw[c] === undefined || raw[c] === "");
    if (missingRaw.length > 0) {
      corrupted.push({ row: idx, missing: missingRaw });
      return;
    }
    const g3 = Number(raw.G3);
    if (!Number.isFinite(g3) || g3 < 0 || g3 > 20) {
      corrupted.push({ row: idx, reason: `G3 out of expected range: ${raw.G3}` });
      return;
    }
    records.push({
      id: `upor-${idx}`,
      features: toFeatureRow(raw),
      label: { value: g3, source: "UCI.G3" },
    });
  });

  console.log(`Corrupted/incomplete rows dropped: ${corrupted.length}`);
  console.log(`Clean records: ${records.length}`);

  // dedupe: exact duplicate rows (all features + label identical) collapse to one
  const seen = new Set();
  const deduped = [];
  for (const r of records) {
    const key = JSON.stringify(r.features) + "|" + r.label.value;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  console.log(`Exact-duplicate records removed: ${records.length - deduped.length}`);
  console.log(`Final unique records: ${deduped.length}`);

  // no-leakage check: target column is not present in any feature row
  const leaks = deduped.filter((r) => Object.prototype.hasOwnProperty.call(r.features, TARGET_COLUMN));
  if (leaks.length > 0) {
    console.log("\nBLOCKED: target column found inside features — data leakage detected.");
    console.log("DATASET PREPARATION BLOCKED");
    process.exit(1);
  }

  const MIN_TRAIN_SAMPLES = 50;
  if (deduped.length < MIN_TRAIN_SAMPLES * 2) {
    console.log(`\nBLOCKED: only ${deduped.length} usable records — insufficient for a train/val/test split.`);
    console.log("DATASET PREPARATION BLOCKED");
    process.exit(1);
  }

  // deterministic 70/15/15 split
  const shuffled = seededShuffle(deduped, 42);
  const nTrain = Math.floor(shuffled.length * 0.7);
  const nVal = Math.floor(shuffled.length * 0.15);
  const train = shuffled.slice(0, nTrain);
  const val = shuffled.slice(nTrain, nTrain + nVal);
  const test = shuffled.slice(nTrain + nVal);

  if (train.length < MIN_TRAIN_SAMPLES || val.length === 0 || test.length === 0) {
    console.log("\nBLOCKED: resulting split has an empty or below-minimum partition.");
    console.log("DATASET PREPARATION BLOCKED");
    process.exit(1);
  }

  const labelValues = new Set(train.map((r) => r.label.value));
  console.log(`Split sizes — train=${train.length} val=${val.length} test=${test.length}`);
  console.log(`Distinct label values in train: ${labelValues.size}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    datasetName: "UCI Student Performance (Portuguese course) — student-por.csv",
    datasetSourceUrl: "https://archive.ics.uci.edu/dataset/320/student+performance",
    datasetCitation: "Cortez, P. (2008). Student Performance [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5TG7T",
    scopeNote: "Native UCI schema. NOT mapped to TeamSync's MongoDB-derived STUDENT_FEATURE_COLUMNS — no genuine field-level correspondence exists between platform telemetry and this survey/demographic dataset. This is a separate, independently-scoped grade-prediction exercise, not a TeamSync collaboration-performance predictor.",
    featureColumns: FEATURE_COLUMNS,
    targetColumn: TARGET_COLUMN,
    rawRecordCount: rawRows.length,
    corruptedRecordsDropped: corrupted.length,
    duplicatesRemoved: records.length - deduped.length,
    finalRecordCount: deduped.length,
    split: { train, val, test },
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nProcessed dataset written to: ${OUT_FILE}`);
  console.log("\nDATASET PREPARATION COMPLETE");
}

main();
