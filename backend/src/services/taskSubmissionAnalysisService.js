/**
 * Task submission (ZIP) analysis orchestrator — Step 9.
 *
 * Flow (see routes/index.js + submissionController.submit):
 *   upload -> safe extraction -> project identity check -> task relevance
 *   check -> AI analysis -> classify -> caller saves + updates task status
 *
 * This module never executes uploaded code. It only reads text/source files
 * up to a small size cap and forwards a PREPROCESSED manifest (filenames +
 * truncated content of a bounded set of relevant files) to the AI engine —
 * never the raw ZIP, and never secret/.env contents (safeZipExtractor
 * already strips those out before we get here).
 */
const path = require("path");
const fs = require("fs");
const { safeExtractZip, hashFile } = require("./safeZipExtractor");
const { getProjectSignature } = require("./projectSignatureService");
const aiEngine = require("./aiEngineClient");
const plagiarismAnalyzer = require("./plagiarismAnalyzer");
const codeReviewAnalyzer = require("./codeReviewAnalyzer");

const TEXTY_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".go",
  ".rb", ".php", ".rs", ".kt", ".swift", ".dart", ".sql", ".html", ".css",
  ".json", ".md", ".yml", ".yaml", ".txt",
]);

const MANIFEST_LIMITS = {
  maxFilesWithContent: 60,
  maxBytesPerFile: 20_000,
  maxTotalContentBytes: 250_000,
};

const CATEGORIES = [
  "WRONG_PROJECT",
  "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
  "PARTIAL_PROGRESS",
  "VALID_BUT_NEEDS_IMPROVEMENT",
  "VALID_SUBMISSION",
  // Infrastructure-level outcome, not a project/task judgement: the ZIP
  // itself could not be opened (corrupted, not actually a ZIP, or unsafe to
  // extract). Kept in the same enum so the rest of the pipeline (task
  // status mapping, the review card) doesn't need a separate code path.
  "UNREADABLE_ZIP",
];

/**
 * Task status this category should drive the submission workflow to.
 *
 * Step 11: a VALID_SUBMISSION must always land in guide_review — the AI's
 * role is to classify and assist the guide, never to auto-complete a task
 * on its own ("Do NOT immediately bypass the existing human review
 * workflow", spec §1). This replaces the earlier Step 9/10 behaviour where
 * a high-confidence VALID_SUBMISSION could skip straight to "completed".
 */
const STATUS_FOR_CATEGORY = {
  WRONG_PROJECT: "changes_requested",
  PROJECT_RELATED_TASK_NOT_IMPLEMENTED: "changes_requested",
  PARTIAL_PROGRESS: "changes_requested",
  VALID_BUT_NEEDS_IMPROVEMENT: "changes_requested",
  VALID_SUBMISSION: "guide_review",
  UNREADABLE_ZIP: "changes_requested",
};

/** Error codes safeZipExtractor raises for a ZIP that could never be safely
 * opened/extracted — these are never the student's project being "wrong",
 * so they get their own graceful, non-throwing outcome (spec §11 Test 10)
 * instead of bubbling up as a 500. */
const UNREADABLE_ZIP_ERROR_CODES = new Set(["INVALID_ZIP", "ZIP_TOO_LARGE"]);

const GENERIC_RELEVANCE_TOKENS = new Set([
  "task", "assigned", "assignment", "project", "implement", "student", "team",
  "backend", "frontend", "module", "feature", "system", "application", "app",
  "code", "file", "submission", "zip", "final", "test", "demo", "src", "dist",
  "build", "node_modules", "package", "json", "readme", "git", "github", "main",
  "master", "index", "public", "assets", "with", "this", "that", "from", "have",
  "your", "will", "using", "into", "about", "more", "create", "update", "delete",
  "user", "users", "page", "pages", "view", "views", "component", "components",
]);

const GENERIC_RELEVANCE_FILENAMES = new Set([
  "readme.md", "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  ".gitignore", "tsconfig.json", "vite.config.js", "vite.config.ts", ".eslintrc.json",
  ".eslintrc.js", ".prettierrc", "index.html", "license", "license.md", "license.txt",
  ".env.example", "dockerfile", "docker-compose.yml", "favicon.ico", "robots.txt",
]);

function extractKeywords(text) {
  if (!text || typeof text !== "string") return [];
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length > 2 && !GENERIC_RELEVANCE_TOKENS.has(w))
    ),
  ];
}

/**
 * Safe ZIP Content Relevance Check.
 * Determines if the submitted archive contains work relevant to the assigned task and project.
 *
 * Out-of-the-box outcomes:
 * - RELEVANT: strong token and file match with task and project.
 * - POSSIBLY_RELEVANT: weak/partial match (shares project terminology or partial task hits).
 * - IRRELEVANT: completely different project, 0 task-related files, or unrelated archive.
 */
function evaluateZipRelevance({
  originalName = "",
  manifest = { files: [] },
  task = {},
  projectTitle = "",
  projectDescription = "",
  engineResult = null,
}) {
  const taskKeywords = extractKeywords(`${task.title || ""} ${task.description || ""} ${task.module || ""}`);
  const projectKeywords = extractKeywords(`${projectTitle || ""} ${projectDescription || ""}`);

  const zipBaseName = path.basename(originalName, path.extname(originalName)).toLowerCase();
  const zipTokens = extractKeywords(zipBaseName);

  const nonGenericFiles = (manifest.files || []).filter((f) => {
    const base = path.basename(f.relPath || "").toLowerCase();
    return !GENERIC_RELEVANCE_FILENAMES.has(base) && !base.endsWith(".lock") && !f.relPath.startsWith(".git/");
  });

  const matchedTaskFiles = [];
  const matchedProjFiles = [];
  const matchedFiles = [];
  const reasons = [];

  for (const f of nonGenericFiles) {
    const relLower = (f.relPath || "").toLowerCase();
    const contentLower = (f.content || "").toLowerCase();
    const searchSpace = `${relLower} ${contentLower}`;

    const taskHits = taskKeywords.filter((k) => searchSpace.includes(k));
    const projHits = projectKeywords.filter((k) => searchSpace.includes(k));

    if (taskHits.length > 0) {
      matchedTaskFiles.push({ file: f.relPath, hits: taskHits });
    }
    if (projHits.length > 0) {
      matchedProjFiles.push({ file: f.relPath, hits: projHits });
    }
    if (taskHits.length > 0 || projHits.length > 0) {
      matchedFiles.push(f.relPath);
    }
  }

  const zipTaskMatch = taskKeywords.some((k) => zipTokens.includes(k) || zipBaseName.includes(k));
  const zipProjMatch = projectKeywords.some((k) => zipTokens.includes(k) || zipBaseName.includes(k));

  let score = 0;
  let status = "IRRELEVANT";
  let isIrrelevant = false;

  const isWrongProject = engineResult && engineResult.implementationStatus === "WRONG_PROJECT";

  if (isWrongProject) {
    score = Math.min(20, matchedFiles.length * 5);
    status = "IRRELEVANT";
    isIrrelevant = true;
    reasons.push("Archive structure and identifiers do not match the expected project repository.");
    if (matchedTaskFiles.length === 0) {
      reasons.push(`No files found matching assigned task keywords (${taskKeywords.slice(0, 5).join(", ") || "none"}).`);
    }
  } else if (nonGenericFiles.length === 0) {
    score = 0;
    status = "IRRELEVANT";
    isIrrelevant = true;
    reasons.push("Archive does not contain any recognizable source or implementation files.");
  } else if (
    matchedTaskFiles.length >= 2 ||
    (matchedTaskFiles.length >= 1 && (matchedProjFiles.length >= 1 || zipTaskMatch))
  ) {
    score = Math.min(100, Math.max(70, 45 + matchedTaskFiles.length * 15 + matchedProjFiles.length * 10 + (zipTaskMatch ? 15 : 0)));
    status = "RELEVANT";
    isIrrelevant = false;
  } else if (matchedTaskFiles.length === 1 || (matchedProjFiles.length >= 2 && !isWrongProject)) {
    score = Math.min(65, Math.max(35, 25 + matchedTaskFiles.length * 20 + matchedProjFiles.length * 10));
    status = "POSSIBLY_RELEVANT";
    isIrrelevant = false;
    reasons.push("Partial match: files share some project or task keywords, but dedicated task implementation is limited.");
  } else if (matchedProjFiles.length === 1 && !isWrongProject) {
    score = 25;
    status = "POSSIBLY_RELEVANT";
    isIrrelevant = false;
    reasons.push("Weak match: archive contains project-level references but minimal evidence for the specific task.");
  } else {
    // 0 task matches, 0 project matches
    score = zipTaskMatch || zipProjMatch ? 15 : 5;
    status = "IRRELEVANT";
    isIrrelevant = true;
    if (taskKeywords.length > 0) {
      reasons.push(`No files or code found matching task keywords (${taskKeywords.slice(0, 5).join(", ")}).`);
    } else {
      reasons.push("No task-specific files found in the archive.");
    }
    if (projectKeywords.length > 0 && !zipProjMatch) {
      reasons.push(`No references found matching project "${projectTitle || "assigned project"}".`);
    }
    if (!zipTaskMatch && !zipProjMatch) {
      reasons.push(`Archive name "${originalName}" does not correspond to the assigned task or project.`);
    }
  }

  const reason = isIrrelevant
    ? `The uploaded ZIP does not appear to match your assigned task "${task.title || "Task"}". ${reasons.join(" ")}`
    : status === "POSSIBLY_RELEVANT"
    ? `Submission has partial relevance to "${task.title || "Task"}". Review suggested.`
    : `Submission is relevant to "${task.title || "Task"}" with ${matchedTaskFiles.length} task file(s) matched.`;

  return {
    status,
    isIrrelevant,
    score,
    reason,
    evidence: {
      zipName: originalName,
      projectKeywords: projectKeywords.slice(0, 15),
      taskKeywords: taskKeywords.slice(0, 15),
      matchedFiles: [...new Set(matchedFiles)].slice(0, 20),
      unmatchedReasons: reasons,
    },
    evaluatedAt: new Date(),
  };
}

/** Builds the graceful result for a ZIP that could not be extracted at all. */
function buildUnreadableZipResult(err, originalName = "") {
  return {
    engine: "safety-guard",
    projectRelated: false,
    projectConfidence: 0,
    taskRelated: false,
    taskConfidence: 0,
    implementationStatus: "UNREADABLE_ZIP",
    progress: 0,
    progressLabel: "Not Started",
    summary: "❌ Unable to open or extract this ZIP file. Please verify and re-upload your project ZIP.",
    completedParts: [],
    missingParts: [err?.message || "The uploaded file could not be safely extracted or is corrupted."],
    criticalIssues: ["❌ Unreadable archive — file cannot be extracted safely."],
    positiveFindings: [],
    suggestions: [
      "1. Make sure your project directory is compressed as a standard, non-corrupt .zip archive.",
      "2. Avoid password-protecting the zip file.",
      "3. Re-upload the .zip folder here to try again.",
    ],
    analyzedFiles: [],
    relevance: {
      status: "IRRELEVANT",
      isIrrelevant: true,
      score: 0,
      reason: "The uploaded file could not be safely extracted or is not a valid ZIP.",
      evidence: {
        zipName: originalName,
        projectKeywords: [],
        taskKeywords: [],
        matchedFiles: [],
        unmatchedReasons: [err?.message || "Invalid or corrupt ZIP archive"],
      },
      evaluatedAt: new Date(),
    },
  };
}


const isZipFile = (originalName = "") => path.extname(originalName).toLowerCase() === ".zip";

/** Step 13 §1 — human-readable progress bucket. Pure function of the
 * already-clamped 0-100 progress number, never a separate guess. */
function progressLabelFor(progress) {
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  if (p >= 100) return "Complete";
  if (p >= 70) return "Nearly Complete";
  if (p > 0) return "In Progress";
  return "Not Started";
}

/**
 * Step 13 §7 — compares the previous submission's stored aiAnalysis against
 * the just-computed result for the new one. Returns null when there is no
 * previous submission (nothing to compare). Every field is derived only
 * from the two real analyses passed in — never fabricated.
 */
function computeImprovementSummary(prevAnalysis, currentResult) {
  if (!prevAnalysis) return null;

  const delta = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? b - a : null);
  const progressDelta = delta(prevAnalysis.progress, currentResult.progress);
  const projectConfidenceDelta = delta(prevAnalysis.projectConfidence, currentResult.projectConfidence);
  const taskConfidenceDelta = delta(prevAnalysis.taskConfidence, currentResult.taskConfidence);

  const prevIssues = new Set([...(prevAnalysis.criticalIssues || []), ...(prevAnalysis.missingParts || [])]);
  const currIssues = new Set([...(currentResult.criticalIssues || []), ...(currentResult.missingParts || [])]);
  const resolvedIssues = [...prevIssues].filter((i) => !currIssues.has(i)).slice(0, 10);
  const newIssues = [...currIssues].filter((i) => !prevIssues.has(i)).slice(0, 10);

  let changeNote = "no_change";
  if (progressDelta != null) {
    if (progressDelta > 0) changeNote = "improved";
    else if (progressDelta < 0) changeNote = "decreased";
  }

  return {
    progressDelta,
    projectConfidenceDelta,
    taskConfidenceDelta,
    resolvedIssues,
    newIssues,
    changeNote,
  };
}

/**
 * STEP 17 — Feature 3 §"SUBMISSION HISTORY": compares this version's code
 * quality score against the previous version's, if that previous version
 * actually has one. Returns null (never a fabricated comparison) when
 * there is no previous submission or the previous submission has no
 * codeReview score (e.g. it predates Step 17, or its ZIP was unreadable).
 */
function computeCodeQualityComparison(prevCodeReview, currentScore) {
  if (!Number.isFinite(prevCodeReview?.score) || !Number.isFinite(currentScore)) return null;
  const delta = currentScore - prevCodeReview.score;
  return {
    previousScore: prevCodeReview.score,
    currentScore,
    delta,
    changeNote: delta > 0 ? "improved" : delta < 0 ? "decreased" : "no_change",
  };
}

/**
 * Only the guide (or team leader) approval decision — see
 * submissionController.review() — can ever move a task to "completed".
 * The AI never does, regardless of how confident it is (Step 11 spec §1/§4).
 */
function statusForResult(result) {
  return STATUS_FOR_CATEGORY[result.implementationStatus] || "changes_requested";
}

/** Builds the bounded, secret-free manifest sent to the AI engine. */
function buildManifest(safeFiles) {
  const sorted = [...safeFiles].sort((a, b) => a.relPath.length - b.relPath.length);
  const files = [];
  let totalBytes = 0;

  for (const f of sorted) {
    const isTexty = TEXTY_EXT.has(f.ext);
    const entry = { relPath: f.relPath, ext: f.ext, size: f.size, content: "" };

    if (isTexty && files.length < MANIFEST_LIMITS.maxFilesWithContent && totalBytes < MANIFEST_LIMITS.maxTotalContentBytes) {
      try {
        const buf = fs.readFileSync(f.absPath);
        const slice = buf.subarray(0, MANIFEST_LIMITS.maxBytesPerFile);
        const text = slice.toString("utf8");
        entry.content = text;
        totalBytes += text.length;
      } catch {
        entry.content = "";
      }
    }
    files.push(entry);
  }

  return { files, fileCount: safeFiles.length };
}

/**
 * Deterministic Node-side fallback used only when the Python AI engine is
 * unreachable — mirrors ai-engine/analyzers/projectSubmissionAnalyzer.py so
 * a submission is never left unreviewed just because the engine is down
 * (same graceful-degrade contract as fileAnalysisService.analyseLocally).
 */
function analyzeLocally({ manifest, referenceProject, task }) {
  const idset = new Set(referenceProject.identifiers);
  const haystackNames = manifest.files.map((f) => f.relPath.toLowerCase());
  const haystackContent = manifest.files.map((f) => f.content.toLowerCase()).join("\n");

  let nameHits = 0;
  haystackNames.forEach((n) => {
    const base = path.basename(n, path.extname(n)).toLowerCase();
    if (idset.has(base)) nameHits += 1;
  });
  const contentHits = [...idset].filter((id) => id.length > 4 && haystackContent.includes(id)).length;

  // No dilution-by-file-count here on purpose (mirrors
  // ai-engine/analyzers/projectSubmissionAnalyzer.py's reasoning): matches
  // only ever come from a real filename hit against the current repo's
  // known identifiers or a genuine identifier string appearing in file
  // content, so more matching evidence should never LOWER confidence.
  const projectConfidence = Math.max(0, Math.min(100, Math.round(nameHits * 35 + contentHits * 8)));
  const projectRelated = projectConfidence >= 55;

  const GENERIC_WORDS = new Set([
    "task", "assigned", "assignment", "project", "implement", "student", "team",
    "backend", "frontend", "module", "feature", "system", "application", "app",
  ]);
  const taskTokens = `${task.title || ""} ${task.description || ""} ${task.module || ""}`
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w));
  const uniqueTaskTokens = [...new Set(taskTokens)];
  let taskHits = 0;
  const matchedFiles = [];
  manifest.files.forEach((f) => {
    // Basename + content only — NOT the full directory path, so a generic
    // folder segment (e.g. every backend file living under "backend/...")
    // never trivially "matches" a task_module like "Backend / AI".
    const base = path.basename(f.relPath).toLowerCase();
    const hay = `${base} ${f.content.toLowerCase()}`;
    const hits = uniqueTaskTokens.filter((t) => hay.includes(t));
    if (hits.length) {
      taskHits += hits.length;
      matchedFiles.push(f.relPath);
    }
  });
  const taskRelated = projectRelated && taskHits >= 2;
  const taskConfidence = projectRelated ? Math.max(0, Math.min(100, Math.round(taskHits * 12))) : 0;

  const todoCount = (haystackContent.match(/todo|fixme/g) || []).length;
  const hasPlaceholders = todoCount > 0;

  let implementationStatus;
  let progress;
  let summary;
  let suggestions = [];
  let missingParts = [];
  let criticalIssues = [];

  if (!projectRelated) {
    implementationStatus = "WRONG_PROJECT";
    progress = 0;
    summary = "❌ Incorrect ZIP folder uploaded. The files in this ZIP do not belong to the TeamSync AI project.";
    missingParts = ["Expected TeamSync AI project files and assigned task code were not found."];
    criticalIssues = ["❌ Wrong ZIP folder — archive does not match the assigned project."];
    suggestions = [
      "1. Make sure you select the correct TeamSync project folder on your computer.",
      "2. Compress the root project folder into a .zip archive.",
      "3. Upload the correct ZIP folder here to redo the task check.",
    ];
  } else if (!taskRelated) {
    implementationStatus = "PROJECT_RELATED_TASK_NOT_IMPLEMENTED";
    progress = 15;
    summary = `⚠️ Project folder detected, but code for assigned task "${task.title || "Task"}" is missing from this ZIP.`;
    missingParts = [
      `Missing task-specific code files for "${task.title || "Task"}" (${task.module || "General module"}).`,
      "No implementation functions or routes found for this assigned task.",
    ];
    criticalIssues = [`Assigned task "${task.title || "Task"}" has not been implemented in this ZIP yet.`];
    suggestions = [
      `1. Open your code editor and implement the required features for "${task.title || "Task"}".`,
      "2. Save your new or updated code files inside your project directory.",
      "3. Re-zip your project folder and submit the updated ZIP folder again.",
    ];
  } else if (hasPlaceholders || matchedFiles.length < 2) {
    implementationStatus = "PARTIAL_PROGRESS";
    progress = Math.min(65, Math.max(35, 35 + matchedFiles.length * 10));
    summary = `🔄 Task partially completed (${progress}%). Some required features or topics are still missing.`;
    missingParts = hasPlaceholders
      ? ["Unresolved TODO/FIXME markers found in the submission."]
      : ["Additional task components and full logic implementation needed."];
    criticalIssues = ["Unfinished code or placeholders need to be completed before approval."];
    suggestions = [
      "1. Complete the missing features and resolve all TODO/placeholder markers in your code.",
      "2. Verify that all components for this task function properly.",
      "3. Re-zip your project folder and upload the new ZIP folder to reach 100% completion.",
    ];
  } else {
    implementationStatus = "VALID_SUBMISSION";
    progress = Math.min(100, Math.max(90, 85 + matchedFiles.length * 3));
    summary = `🎉 Valid submission (${progress}%)! All required implementation files for "${task.title || "Task"}" are present across ${matchedFiles.length} file(s): ${matchedFiles.slice(0, 5).join(", ")}.`;
    missingParts = [];
    criticalIssues = [];
    suggestions = [
      "Your submission looks complete and has been forwarded to your guide for final review and approval.",
    ];
  }

  const positiveFindings = [];
  if (projectRelated) positiveFindings.push("Correct TeamSync AI project detected.");
  if (taskRelated) positiveFindings.push(`Task-related implementation found in ${matchedFiles.length} file(s): ${matchedFiles.slice(0, 3).join(", ")}.`);

  return {
    engine: "node-heuristics",
    projectRelated,
    projectConfidence,
    taskRelated,
    taskConfidence,
    implementationStatus,
    progress,
    progressLabel: progressLabelFor(progress),
    summary,
    completedParts: taskRelated ? matchedFiles.slice(0, 10) : [],
    missingParts,
    criticalIssues,
    positiveFindings,
    suggestions,
    analyzedFiles: manifest.files.map((f) => f.relPath),
  };
}


function clampResult(raw, manifest) {
  const implementationStatus = CATEGORIES.includes(raw.implementationStatus)
    ? raw.implementationStatus
    : "PROJECT_RELATED_TASK_NOT_IMPLEMENTED";
  const projectConfidence = Math.max(0, Math.min(100, Math.round(Number(raw.projectConfidence) || 0)));
  const progress = Math.max(0, Math.min(100, Math.round(Number(raw.progress) || 0)));
  const taskRelated = Boolean(raw.taskRelated);
  // taskConfidence is new in Step 13 — older ai-engine responses (or the
  // Node fallback before this change) won't send it, so derive a
  // reasonable value from taskRelated rather than leaving the UI with
  // nothing to show.
  const taskConfidence = Number.isFinite(Number(raw.taskConfidence))
    ? Math.max(0, Math.min(100, Math.round(Number(raw.taskConfidence))))
    : taskRelated
      ? Math.max(progress, 50)
      : 0;
  const missingParts = Array.isArray(raw.missingParts) ? raw.missingParts.slice(0, 20) : [];
  const completedParts = Array.isArray(raw.completedParts) ? raw.completedParts.slice(0, 20) : [];
  // criticalIssues/positiveFindings are new in Step 13 too — fall back to
  // deriving them from the existing missingParts/completedParts+flags so
  // older/local-fallback payloads still render a full Step 13 panel.
  const BLOCKING_STATUSES = new Set(["WRONG_PROJECT", "PROJECT_RELATED_TASK_NOT_IMPLEMENTED", "UNREADABLE_ZIP"]);
  const criticalIssues = Array.isArray(raw.criticalIssues)
    ? raw.criticalIssues.slice(0, 20)
    : BLOCKING_STATUSES.has(implementationStatus)
      ? missingParts.slice(0, 5)
      : [];
  const positiveFindings = Array.isArray(raw.positiveFindings)
    ? raw.positiveFindings.slice(0, 20)
    : [
        ...(raw.projectRelated ? ["Correct TeamSync AI project detected."] : []),
        ...(taskRelated ? completedParts.slice(0, 5) : []),
      ];

  return {
    engine: raw.engine || "ai-engine",
    projectRelated: Boolean(raw.projectRelated),
    projectConfidence,
    taskRelated,
    taskConfidence,
    implementationStatus,
    progress,
    progressLabel: raw.progressLabel || progressLabelFor(progress),
    summary: String(raw.summary || "").slice(0, 2000),
    completedParts,
    missingParts,
    criticalIssues,
    positiveFindings,
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions.slice(0, 12) : [],
    analyzedFiles: Array.isArray(raw.analyzedFiles) ? raw.analyzedFiles.slice(0, 200) : manifest.files.map((f) => f.relPath),
    analyzedAt: new Date(),
    relevance: raw.relevance || null,
  };
}

/**
 * Main entry point. `zipFilePath` must already be safely on disk (multer).
 * Returns { result, taskStatus, meta } — never throws for a "bad" submission
 * (wrong project etc.), only for infrastructure failures (unreadable file).
 * Always cleans up its own temp extraction directory.
 */
async function analyzeZipSubmission({ zipFilePath, originalName, task }) {
  let extraction;
  try {
    extraction = safeExtractZip(zipFilePath);
  } catch (err) {
    // Corrupted / not-actually-a-ZIP / unsafe-to-extract uploads must never
    // crash the request (spec §11 Test 10) — safeExtractZip has already
    // cleaned up its own temp dir before throwing, so there's nothing left
    // to release here.
    if (UNREADABLE_ZIP_ERROR_CODES.has(err.code)) {
      const result = clampResult(buildUnreadableZipResult(err, originalName), { files: [] });
      return {
        result,
        relevance: result.relevance,
        // Nothing was extracted, so there's nothing to compare — a duplicate
        // check on an unreadable ZIP would be meaningless, not a real
        // "originality passed" verdict.
        plagiarism: {
          detected: false,
          similarityScore: 0,
          severity: "NONE",
          matchedSubmissionId: null,
          matchedStudentId: null,
          matchedGroupId: null,
          matchedFiles: [],
          reasons: ["The ZIP could not be read, so an originality check could not be performed."],
          recommendation: "Ask the student to re-upload a valid ZIP before assessing originality.",
          analyzedAt: new Date(),
        },
        // STEP 17 — Feature 3: nothing was extracted, so there is nothing to
        // statically review — score stays null (not a fabricated 100 or 0),
        // matching how the plagiarism check above also declines to render a
        // verdict on an unreadable ZIP.
        codeReview: { score: null, issues: [], positiveFindings: [], analyzedFileCount: 0, analyzedAt: new Date() },
        plagiarismFingerprint: null,
        taskStatus: statusForResult(result),
        meta: {
          totalEntries: 0,
          keptFiles: 0,
          ignoredCount: 0,
          secretFilesExcluded: 0,
          originalName,
          contentHash: null,
          extractionError: err.code,
        },
      };
    }
    throw err;
  }

  try {
    const manifest = buildManifest(extraction.safeFiles);
    const referenceProject = getProjectSignature();

    const enginePayload = {
      taskTitle: task.title,
      taskDescription: task.description,
      taskModule: task.module,
      referenceProject: {
        identifiers: referenceProject.identifiers,
        serviceFiles: referenceProject.serviceFiles,
        modelFiles: referenceProject.modelFiles,
        routeTokens: referenceProject.routeTokens,
      },
      files: manifest.files,
      fileCount: manifest.fileCount,
      ignoredCount: extraction.ignoredPaths.length,
      secretFileCount: extraction.secretFiles.length,
    };

    const engineResp = await aiEngine.analyzeTaskSubmission(enginePayload);
    const raw = engineResp.ok && engineResp.data ? engineResp.data : analyzeLocally({ manifest, referenceProject, task });
    const result = clampResult(raw, manifest);

    // Safe ZIP Content Relevance Check — evaluates whether archive matches task & project
    const relevance = evaluateZipRelevance({
      originalName,
      manifest,
      task,
      projectTitle: task.projectTitle || "",
      projectDescription: task.projectDescription || "",
      engineResult: result,
    });
    result.relevance = relevance;

    // Step 14, Feature 1/3 — duplicate/plagiarism detection runs alongside
    // (never instead of) the existing project/task-relevance analysis
    // above, and is computed here (before extraction.cleanup() below) since
    // it needs the same already-extracted, already-safety-filtered files.
    // A failure here must never take down the core submission pipeline —
    // it degrades to "not detected" and the guide/student still get the
    // rest of the analysis exactly as before.
    let plagiarism;
    let plagiarismFingerprint = null;
    try {
      plagiarismFingerprint = plagiarismAnalyzer.buildFingerprint(extraction.safeFiles);
      const candidates = task?._id
        ? await plagiarismAnalyzer.findCandidates({ taskTitle: task.title, excludeTaskId: task._id })
        : [];
      plagiarism = plagiarismAnalyzer.evaluate(plagiarismFingerprint, candidates);
    } catch {
      plagiarism = plagiarismAnalyzer.buildErrorResult();
    }

    // STEP 17 — Feature 3: Deep AI Code Review — runs alongside (never
    // instead of) the analysis above, on the SAME manifest (already
    // safety-filtered, already size-capped) — no re-extraction, no code
    // execution. A failure here must never take down the core submission
    // pipeline, same contract as plagiarism above.
    let codeReview;
    try {
      const review = codeReviewAnalyzer.reviewCode(manifest.files);
      codeReview = { ...review, analyzedAt: new Date() };
    } catch {
      codeReview = { score: null, issues: [], positiveFindings: [], analyzedFileCount: 0, analyzedAt: new Date() };
    }

    return {
      result,
      relevance,
      plagiarism,
      plagiarismFingerprint,
      codeReview,
      taskStatus: statusForResult(result),
      meta: {
        totalEntries: extraction.totalEntries,
        keptFiles: extraction.safeFiles.length,
        ignoredCount: extraction.ignoredPaths.length,
        secretFilesExcluded: extraction.secretFiles.length,
        originalName,
        contentHash: hashFile(zipFilePath),
      },
    };
  } finally {
    extraction.cleanup();
  }
}

module.exports = {
  analyzeZipSubmission,
  isZipFile,
  CATEGORIES,
  STATUS_FOR_CATEGORY,
  // Exported for unit testing (backend/scripts/testTaskSubmissionAnalysis.js)
  // — these are pure functions with no I/O beyond what's passed in.
  buildManifest,
  analyzeLocally,
  clampResult,
  statusForResult,
  buildUnreadableZipResult,
  UNREADABLE_ZIP_ERROR_CODES,
  // Step 13
  progressLabelFor,
  computeImprovementSummary,
  // Step 17 — Feature 3
  computeCodeQualityComparison,
  // Safe ZIP Relevance Check
  evaluateZipRelevance,
};
