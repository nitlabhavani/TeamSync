/**
 * Duplicate / plagiarism submission detection — Step 14, Feature 1.
 *
 * Inspects an already safely-extracted submission directory (the output of
 * safeZipExtractor.safeExtractZip — never a raw/untrusted ZIP) and produces
 * a compact, privacy-safe "fingerprint" of its relevant source content.
 * Fingerprints from past submissions (stored server-side only, see the
 * `_plagiarismFingerprint` field on Task.submissions in models/Task.js) are
 * then compared against the current one to estimate similarity — without
 * ever re-reading another student's actual files and without ever sending
 * another student's source code anywhere, including to the AI engine.
 *
 * This module never executes anything it reads; it only hashes/tokenizes
 * text content that safeZipExtractor already deemed safe to read.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Mirrors taskSubmissionAnalysisService's TEXTY_EXT — only source/text files
// are meaningful for a plagiarism comparison. Anything else (images,
// binaries, archives) never reaches safeFiles in the first place because
// safeZipExtractor already filtered them out, but we re-check here too
// (defense in depth) in case this module is ever called on a differently
// sourced file list.
const TEXTY_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".go",
  ".rb", ".php", ".rs", ".kt", ".swift", ".dart", ".sql", ".html", ".css",
  ".json", ".md", ".yml", ".yaml",
]);

// Belt-and-suspenders re-application of the same "irrelevant directory"
// rules as safeZipExtractor.IGNORED_DIR_NAMES, plus a few more that only
// matter for a *content-similarity* comparison specifically (coverage
// reports and lockfiles are near-identical across every project and would
// otherwise dominate the similarity score with false positives).
const IGNORED_DIR_NAMES = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv",
  ".next", ".cache", "coverage", ".pytest_cache", ".idea", ".vscode",
]);

const SECRET_FILE_RE = /^(\.env(\..*)?|.*\.pem|.*\.key|.*secret.*|.*credentials.*)$/i;

// Auto-generated / vendored files that are identical across almost every
// project regardless of authorship — including these would make unrelated
// submissions look artificially similar.
const GENERATED_FILE_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.js|\.min\.css)$/i;

const FINGERPRINT_LIMITS = {
  maxFiles: 400,
  maxBytesPerFile: 200_000,
  // Bottom-k sketch size: the k smallest shingle-hash values represent the
  // whole submission's content for approximate Jaccard similarity, without
  // storing the actual shingles (i.e. without storing recoverable content).
  bottomK: 200,
  shingleSize: 5, // words per shingle
};

/**
 * Similarity thresholds (Feature 1 "Similarity classification").
 *
 * The spec's example bands (50/70/85) are used as-is: they map cleanly onto
 * the three severities the guide UI needs (POSSIBLE / HIGH / DUPLICATE) and,
 * empirically against this project's own near-duplicate fixtures (see
 * backend/scripts/testPlagiarismAnalyzer.js), formatting-only differences
 * between two copies of the *same* submission score in the mid-90s while
 * genuinely unrelated projects that merely share a tech stack (React +
 * Express boilerplate) score under 20 — leaving a wide, safe margin around
 * each boundary. Kept as named constants rather than inlined so a future
 * calibration pass only has to change one place.
 */
const SIMILARITY_THRESHOLDS = { DUPLICATE: 85, HIGH: 70, POSSIBLE: 50 };

function classifySeverity(score) {
  if (score >= SIMILARITY_THRESHOLDS.DUPLICATE) return "DUPLICATE";
  if (score >= SIMILARITY_THRESHOLDS.HIGH) return "HIGH";
  if (score >= SIMILARITY_THRESHOLDS.POSSIBLE) return "POSSIBLE";
  return "NONE";
}

const RECOMMENDATION_FOR_SEVERITY = {
  NONE: "No action needed — this submission does not show significant similarity to existing submissions.",
  POSSIBLE: "Worth a quick look — similarity may be coincidental (shared starter code/boilerplate) but the guide should confirm before approving.",
  HIGH: "Manual review strongly recommended before approval — significant overlap with another submission was found.",
  DUPLICATE: "Investigate before approval — this submission closely matches another existing submission.",
};

function isDangerousDirSegment(seg) {
  return IGNORED_DIR_NAMES.has(seg) || IGNORED_DIR_NAMES.has(String(seg).toLowerCase());
}

/** Whether a given (already safety-filtered) file should feed the content comparison. */
function isRelevantFile(relPath, ext) {
  const segments = String(relPath).replace(/\\/g, "/").split("/").filter(Boolean);
  const baseName = segments[segments.length - 1] || "";
  if (segments.slice(0, -1).some(isDangerousDirSegment)) return false;
  if (SECRET_FILE_RE.test(baseName)) return false;
  if (GENERATED_FILE_RE.test(baseName)) return false;
  if (!TEXTY_EXT.has(ext)) return false;
  return true;
}

/**
 * Normalizes source content so that harmless formatting differences
 * (whitespace, line endings, incidental comment edits) don't masquerade as
 * "different content" and dodge detection (Feature 1 "must not create false
 * negatives" test). Deliberately conservative: it does not rename
 * identifiers or reorder code, so genuinely different implementations still
 * normalize to different text.
 */
function normalizeContent(text, ext) {
  let out = String(text).replace(/\r\n?/g, "\n");

  // Best-effort comment stripping for common C-like / script languages.
  // Simple regexes on purpose — this is a similarity signal, not a parser,
  // and a slightly imperfect strip is safe (worst case a comment survives
  // and both sides still normalize consistently for identical code).
  if ([".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".kt", ".swift", ".css"].includes(ext)) {
    out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
    if (ext !== ".css") out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  } else if ([".py", ".rb", ".yml", ".yaml"].includes(ext)) {
    out = out.replace(/(^|\s)#.*$/gm, "$1");
  }

  // Collapse all whitespace runs (including newlines) to single spaces, then
  // trim — this is what makes indentation/blank-line/line-ending changes a
  // non-factor while keeping token order (and therefore genuine logic
  // differences) intact.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/** Cheap deterministic 32-bit hash for the shingle bottom-k sketch (not
 * used for anything security-sensitive — only similarity estimation). */
function hash32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function shinglesOf(normalizedText, k) {
  const tokens = normalizedText.split(" ").filter(Boolean);
  const grams = [];
  for (let i = 0; i + k <= tokens.length; i += 1) grams.push(tokens.slice(i, i + k).join(" "));
  // A file shorter than one shingle still contributes its own full content
  // as a single unit so very small files aren't silently invisible to the
  // comparison.
  if (!grams.length && tokens.length) grams.push(tokens.join(" "));
  return grams;
}

/**
 * Builds a fingerprint of a submission's relevant source content.
 * `safeFiles` is the array produced by safeZipExtractor.safeExtractZip
 * ({ relPath, absPath, size, ext }) — content is read from disk once, here,
 * and never persisted; only hashes derived from it are kept.
 */
function buildFingerprint(safeFiles) {
  const relevant = (safeFiles || []).filter((f) => isRelevantFile(f.relPath, f.ext)).slice(0, FINGERPRINT_LIMITS.maxFiles);

  const fileHashes = [];
  const shingleHashes = new Set();

  for (const f of relevant) {
    let raw;
    try {
      raw = fs.readFileSync(f.absPath, "utf8").slice(0, FINGERPRINT_LIMITS.maxBytesPerFile);
    } catch {
      continue; // eslint-disable-line no-continue -- unreadable file, skip it, never crash the pipeline
    }
    const normalized = normalizeContent(raw, f.ext);
    if (!normalized) continue; // eslint-disable-line no-continue

    fileHashes.push({
      relPath: f.relPath,
      baseName: path.basename(f.relPath).toLowerCase(),
      hash: sha256(normalized),
    });

    for (const gram of shinglesOf(normalized, FINGERPRINT_LIMITS.shingleSize)) {
      shingleHashes.add(hash32(gram));
    }
  }

  const signature = [...shingleHashes].sort((a, b) => a - b).slice(0, FINGERPRINT_LIMITS.bottomK);

  return {
    fileCount: fileHashes.length,
    // Only hashes + basenames are kept — never raw content, never full
    // relative paths beyond what the student already sees for their own
    // submission, and this whole object is stored server-side only (see
    // the select:false `_plagiarismFingerprint` field on Task.js).
    fileHashes,
    signature,
    generatedAt: new Date(),
  };
}

/** Estimated Jaccard similarity between two bottom-k shingle sketches. */
function estimateJaccard(sigA, sigB) {
  if (!sigA?.length || !sigB?.length) return 0;
  const setA = new Set(sigA);
  const setB = new Set(sigB);
  const k = Math.min(sigA.length, sigB.length, FINGERPRINT_LIMITS.bottomK);
  const merged = [...new Set([...sigA, ...sigB])].sort((a, b) => a - b).slice(0, k);
  if (!merged.length) return 0;
  const inBoth = merged.filter((v) => setA.has(v) && setB.has(v)).length;
  return inBoth / merged.length;
}

function exactFileMatches(current, candidate) {
  if (!current.fileHashes.length) return [];
  const candidateHashes = new Set((candidate.fileHashes || []).map((f) => f.hash));
  return current.fileHashes.filter((f) => candidateHashes.has(f.hash));
}

function filenameOverlapRatio(current, candidate) {
  if (!current.fileHashes.length) return 0;
  const candidateNames = new Set((candidate.fileHashes || []).map((f) => f.baseName));
  const overlap = current.fileHashes.filter((f) => candidateNames.has(f.baseName));
  return overlap.length / current.fileHashes.length;
}

/**
 * Compares the current fingerprint against a single candidate fingerprint.
 * Weighting: exact normalized-file matches are the strongest, least
 * ambiguous signal (0.45); shingle-based content similarity catches
 * near-duplicates with minor edits (0.40); filename overlap is the weakest
 * signal on its own (renamed folders are common and innocent) so it only
 * contributes 0.15.
 */
function compareFingerprints(current, candidate) {
  const exactMatches = exactFileMatches(current, candidate);
  const exactRatio = current.fileHashes.length ? exactMatches.length / current.fileHashes.length : 0;
  const nameRatio = filenameOverlapRatio(current, candidate);
  const jaccard = estimateJaccard(current.signature, candidate.signature);

  const score = Math.round(100 * Math.max(0, Math.min(1, 0.45 * exactRatio + 0.4 * jaccard + 0.15 * nameRatio)));

  const reasons = [];
  if (exactMatches.length) {
    reasons.push(
      `${exactMatches.length} file(s) are byte-identical to another submission after normalizing whitespace/comments.`
    );
  }
  if (jaccard >= 0.3) {
    reasons.push(`Estimated content overlap (shingle analysis) is ${Math.round(jaccard * 100)}%.`);
  }
  if (nameRatio >= 0.3) {
    reasons.push(`${Math.round(nameRatio * 100)}% of filenames overlap with another submission.`);
  }

  return {
    score,
    matchedFiles: exactMatches.map((f) => f.relPath).slice(0, 15),
    reasons,
  };
}

/**
 * Evaluates a fingerprint against a list of candidate fingerprints (from
 * other students'/groups' submissions) and returns the public, privacy-safe
 * result shape described in Feature 1. Never includes raw content or the
 * fingerprint itself.
 */
function evaluate(fingerprint, candidates) {
  if (!fingerprint.fileCount) {
    return {
      detected: false,
      similarityScore: 0,
      severity: "NONE",
      matchedSubmissionId: null,
      matchedStudentId: null,
      matchedGroupId: null,
      matchedFiles: [],
      reasons: ["No comparable source files were found in this submission to analyze."],
      recommendation: RECOMMENDATION_FOR_SEVERITY.NONE,
      analyzedAt: new Date(),
    };
  }

  let best = null;
  for (const candidate of candidates || []) {
    if (!candidate?.fingerprint?.signature) continue; // eslint-disable-line no-continue
    const cmp = compareFingerprints(fingerprint, candidate.fingerprint);
    if (!best || cmp.score > best.score) best = { ...cmp, candidate };
  }

  const score = best?.score || 0;
  const severity = classifySeverity(score);

  return {
    detected: severity !== "NONE",
    similarityScore: score,
    severity,
    matchedSubmissionId: best && severity !== "NONE" ? best.candidate.submissionId : null,
    matchedStudentId: best && severity !== "NONE" ? best.candidate.studentId : null,
    matchedGroupId: best && severity !== "NONE" ? best.candidate.groupId : null,
    matchedFiles: severity !== "NONE" ? best.matchedFiles : [],
    reasons: severity !== "NONE" ? best.reasons : ["No significant similarity found with existing submissions."],
    recommendation: RECOMMENDATION_FOR_SEVERITY[severity],
    analyzedAt: new Date(),
  };
}

/** Graceful degrade result used when the check itself fails (Feature 3/12 —
 * plagiarism-detection failures must never break the core submission
 * pipeline or leak an error's internals to the student/guide). */
function buildErrorResult() {
  return {
    detected: false,
    similarityScore: 0,
    severity: "NONE",
    matchedSubmissionId: null,
    matchedStudentId: null,
    matchedGroupId: null,
    matchedFiles: [],
    reasons: ["Originality check could not be completed for this submission."],
    recommendation: RECOMMENDATION_FOR_SEVERITY.NONE,
    analyzedAt: new Date(),
  };
}

/**
 * Loads candidate fingerprints from previous submissions "available to the
 * current application" (Feature 1 §5) to compare against. Scoped to other
 * Tasks that share the same title — in this project a guide assigns the
 * same task to every group, so same-title tasks across different groups are
 * exactly the population a duplicate/plagiarism check needs to cover,
 * without doing an unbounded full-collection content comparison. The
 * current task is always excluded (Feature 1 §6 "never compare a submission
 * against itself").
 *
 * Only the internal, select:false `_plagiarismFingerprint` projection is
 * read — never `files`, `note`, or any other submission content — so this
 * query itself cannot leak another student's actual work (Feature 1 §7/§8,
 * Feature 12).
 *
 * Returns [] (never throws) when there is no live DB connection — this
 * keeps the pure-function unit tests (and any environment without Mongo)
 * working exactly as before, per Step 14's "do not rewrite existing working
 * functionality" requirement.
 */
async function findCandidates({ taskTitle, excludeTaskId }) {
  const title = String(taskTitle || "").trim();
  if (!title) return [];

  // eslint-disable-next-line global-require -- required lazily to avoid a
  // hard dependency on mongoose/Task for callers (and tests) that only
  // exercise the pure fingerprint/compare functions above.
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 1) return [];

  try {
    // eslint-disable-next-line global-require
    const Task = require("../models/Task");
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const query = { title: new RegExp(`^${escaped}$`, "i") };
    if (excludeTaskId) query._id = { $ne: excludeTaskId };

    const tasks = await Task.find(query)
      .select("+submissions._plagiarismFingerprint")
      .select("group submissions._id submissions.student submissions._plagiarismFingerprint")
      .limit(200)
      .lean();

    const candidates = [];
    for (const t of tasks) {
      for (const s of t.submissions || []) {
        if (s._plagiarismFingerprint?.signature?.length) {
          candidates.push({
            taskId: t._id,
            groupId: t.group,
            submissionId: s._id,
            studentId: s.student,
            fingerprint: s._plagiarismFingerprint,
          });
        }
      }
    }
    return candidates;
  } catch {
    // A DB hiccup here must never fail the submission pipeline.
    return [];
  }
}

module.exports = {
  SIMILARITY_THRESHOLDS,
  classifySeverity,
  buildFingerprint,
  compareFingerprints,
  estimateJaccard,
  evaluate,
  buildErrorResult,
  findCandidates,
  isRelevantFile,
  normalizeContent,
  // Step 14, Feature 6 — the additive flag name the frontend (SubmissionReviewCard
  // / SubmissionReview.jsx) keys its badge off of whenever
  // aiAnalysis.plagiarism.severity !== "NONE". Exported as a named constant
  // (rather than hardcoded in multiple UI files) so there is exactly one
  // place that defines it. Purely a UI/documentation flag — it is never
  // written to task.status, so none of the existing statuses (WRONG_PROJECT,
  // UNREADABLE_ZIP, guide_review, changes_requested, completed, rejected,
  // ...) are touched by it.
  PLAGIARISM_FLAG: "SIMILAR_TO_EXISTING_SUBMISSION",
  // exported for tests only
  RECOMMENDATION_FOR_SEVERITY,
};
