/**
 * ML TRAINING STEP 3 — dataset assembly: labels, missing-value handling,
 * de-duplication and train/val/test splitting. Pure functions, no DB access
 * — everything here operates on records already built by mlFeatureService
 * from real documents. Nothing in this file invents a value; where real
 * data is insufficient to compute something, the function returns null and
 * documents why, rather than filling in a guess.
 */

const crypto = require("crypto");

/**
 * Derives a student outcome label for one (student, group) pair from real
 * human-judgment sources only, in priority order:
 *   1. PeerReview.scores.average across all reviews of this student in this
 *      group (independent peer judgment — never Step 3's own output).
 *   2. Task submission verdicts (guide's approved/rejected/changes_requested)
 *      for this student's tasks, mapped to a 0-1 "approval rate".
 * Returns null (with a reason) if neither source has any real data for this
 * student — such a record is UNLABELED and must be excluded from supervised
 * training, never assigned a synthetic label.
 */
function deriveStudentLabel({ peerReviews = [], submissions = [] } = {}) {
  if (peerReviews.length) {
    const avgs = peerReviews.map((r) => {
      const s = r.scores || {};
      const vals = [s.contribution, s.communication, s.reliability, s.helpfulness].filter((v) => Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }).filter((v) => v !== null);
    if (avgs.length) {
      return {
        value: avgs.reduce((a, b) => a + b, 0) / avgs.length,
        scale: "1-5 continuous",
        source: "PeerReview.scores",
        sourceCount: avgs.length,
      };
    }
  }
  const verdicts = submissions.map((s) => s.verdict).filter((v) => v === "approved" || v === "rejected" || v === "changes_requested");
  if (verdicts.length) {
    const approved = verdicts.filter((v) => v === "approved").length;
    return {
      value: approved / verdicts.length,
      scale: "0-1 approval rate",
      source: "Task.submissions[].verdict",
      sourceCount: verdicts.length,
    };
  }
  return null;
}

/**
 * Derives a project outcome label for a group from real data only.
 * There is NO explicit "project succeeded/failed" field anywhere in the
 * schema (confirmed in Step 1 audit §7). The only defensible real proxy is:
 * groups with status "archived" (i.e. actually concluded, not merely
 * in-progress) labeled by their real task-completion ratio at the time of
 * the snapshot. Active (non-archived) groups have no terminal outcome yet
 * and are excluded from the labeled set — including them with today's
 * partial completion ratio as if it were final would be fabricating an
 * outcome for a project that hasn't finished.
 */
function deriveProjectLabel({ group = {}, teamCompletionRatio = null } = {}) {
  if (group.status !== "archived") {
    return null;
  }
  if (teamCompletionRatio === null) return null;
  return {
    value: teamCompletionRatio,
    scale: "0-1 completion ratio at archive time",
    source: "Group.status=archived + Task completion ratio",
    sourceCount: 1,
  };
}

const NUMERIC_FEATURE_MISSING_POLICY = "null-with-flag"; // never mean/zero-imputed silently

/**
 * Handles missing values across a set of feature records. For every numeric
 * feature column, adds a companion `${col}_missing` boolean instead of
 * silently imputing a number (imputation would fabricate data the brief
 * forbids). Rows missing MORE THAN `maxMissingRatio` of their feature
 * columns are dropped (too little real signal to be usable), and the drop
 * reason is recorded — never patched over.
 */
function handleMissingValues(records, featureColumns, { maxMissingRatio = 0.5 } = {}) {
  const kept = [];
  const dropped = [];
  for (const rec of records) {
    let missingCount = 0;
    const out = { ...rec, features: { ...rec.features } };
    for (const col of featureColumns) {
      const v = out.features[col];
      const isMissing = v === null || v === undefined || Number.isNaN(v);
      out.features[`${col}_missing`] = isMissing;
      if (isMissing) {
        missingCount += 1;
        out.features[col] = 0; // placeholder only after being explicitly flagged — never treated as a real 0
      }
    }
    const missingRatio = missingCount / featureColumns.length;
    if (missingRatio > maxMissingRatio) {
      dropped.push({ id: rec.id, reason: `missing ${missingCount}/${featureColumns.length} feature columns (> ${maxMissingRatio * 100}% threshold)` });
      continue;
    }
    kept.push(out);
  }
  return { kept, dropped, policy: NUMERIC_FEATURE_MISSING_POLICY, maxMissingRatio };
}

/** Drops exact-duplicate records by a caller-supplied key (e.g. `${studentId}:${groupId}:${periodStart}`). */
function dedupeRecords(records, keyFn) {
  const seen = new Map();
  const dupes = [];
  for (const rec of records) {
    const key = keyFn(rec);
    if (seen.has(key)) {
      dupes.push({ id: rec.id, duplicateOf: seen.get(key) });
      continue;
    }
    seen.set(key, rec.id);
  }
  const keptKeys = new Set(seen.values());
  return { kept: records.filter((r) => keptKeys.has(r.id)), dropped: dupes };
}

/**
 * Deterministic group-based train/val/test split: all records sharing the
 * same `groupKeyFn` value (e.g. the same student, or the same project group)
 * always land in the same split, so no student/group leaks information
 * across splits. Uses a stable hash of the key, not RNG, so re-running the
 * pipeline on the same data always produces the same split.
 */
function splitDataset(records, groupKeyFn, ratios = { train: 0.7, val: 0.15, test: 0.15 }) {
  const buckets = { train: [], val: [], test: [] };
  const assignment = new Map();
  for (const rec of records) {
    const key = groupKeyFn(rec);
    if (!assignment.has(key)) {
      const hash = crypto.createHash("md5").update(String(key)).digest("hex");
      const frac = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
      let split;
      if (frac < ratios.train) split = "train";
      else if (frac < ratios.train + ratios.val) split = "val";
      else split = "test";
      assignment.set(key, split);
    }
    buckets[assignment.get(key)].push(rec);
  }
  return buckets;
}

/**
 * Applies a documented, conservative sufficiency heuristic. This is a rule
 * of thumb for deciding READY vs INSUFFICIENT, not a guarantee that a
 * model trained on `minLabeled` rows will be accurate — it only says
 * whether there's enough real labeled data to attempt training at all.
 */
function assessSufficiency(labeledCount, { minLabeled = 50 } = {}) {
  return {
    minLabeledThreshold: minLabeled,
    labeledCount,
    sufficient: labeledCount >= minLabeled,
  };
}

module.exports = {
  deriveStudentLabel,
  deriveProjectLabel,
  handleMissingValues,
  dedupeRecords,
  splitDataset,
  assessSufficiency,
  NUMERIC_FEATURE_MISSING_POLICY,
};
