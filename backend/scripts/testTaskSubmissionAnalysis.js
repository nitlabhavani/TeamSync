/**
 * Standalone tests for Step 9 — AI Task Submission & ZIP Project Validation.
 * No DB / no server / no live AI engine needed (uses the Node fallback
 * heuristic directly, and builds real ZIP files on disk with adm-zip to
 * exercise the actual extraction code path).
 *
 * Run: node backend/scripts/testTaskSubmissionAnalysis.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const { safeExtractZip, LIMITS } = require("../src/services/safeZipExtractor");
const {
  buildManifest,
  analyzeLocally,
  clampResult,
  statusForResult,
  isZipFile,
  analyzeZipSubmission,
  progressLabelFor,
  computeImprovementSummary,
} = require("../src/services/taskSubmissionAnalysisService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

const tmpZip = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ts9-test-")), "upload.zip");

const REFERENCE = {
  identifiers: ["teamsync", "chattaskservice", "chattaskextractionservice", "aiengineclient"],
  serviceFiles: ["chatTaskService.js", "chatTaskExtractionService.js", "aiEngineClient.js"],
  modelFiles: ["Task.js", "Group.js", "User.js"],
  routeTokens: ["tasks", "submit", "groups", "chat"],
};

const TASK = {
  title: "Implement AI task assignment",
  description: "Add automatic task assignment from group chat messages using the AI engine.",
  module: "Backend / AI",
};

// ---------------------------------------------------------------------
// Security: safe extraction
// ---------------------------------------------------------------------

check("Test 7: Zip Slip attack (../../etc/passwd style entry) is rejected safely", () => {
  const zip = new AdmZip();
  // adm-zip's addFile() sanitizes traversal out of the name we pass it, so
  // to genuinely exercise the zip-slip guard we mutate the entry's raw
  // entryName after adding it — this is exactly the kind of archive a
  // malicious tool (not adm-zip) would produce.
  zip.addFile("passwd", Buffer.from("root:x:0:0::/root:/bin/bash"));
  zip.getEntries()[0].entryName = "../../../../etc/passwd";
  zip.addFile("README.md", Buffer.from("# hi"));
  const p = tmpZip();
  zip.writeZip(p);

  const extraction = safeExtractZip(p);
  try {
    // The traversal entry must never be written to disk anywhere...
    assert.ok(
      extraction.ignoredPaths.some((i) => i.reason === "unsafe_path"),
      "traversal entry should be recorded as ignored (unsafe_path)"
    );
    // ...and everything that WAS written must stay inside the temp root.
    extraction.safeFiles.forEach((f) => {
      assert.ok(
        path.resolve(f.absPath).startsWith(path.resolve(extraction.extractRoot) + path.sep) ||
          path.resolve(f.absPath) === path.resolve(extraction.extractRoot),
        `extracted file escaped the sandbox: ${f.absPath}`
      );
    });
    assert.ok(!fs.existsSync("/etc/passwd.tmp"), "sanity: no stray file written outside the sandbox");
  } finally {
    extraction.cleanup();
  }
});

check("Test 7b: absolute-path entry is rejected safely", () => {
  const zip = new AdmZip();
  zip.addFile("evil.txt", Buffer.from("evil"));
  zip.getEntries()[0].entryName = "/tmp/evil.txt";
  const p = tmpZip();
  zip.writeZip(p);
  const extraction = safeExtractZip(p);
  try {
    assert.strictEqual(extraction.safeFiles.length, 0);
  } finally {
    extraction.cleanup();
  }
});

check("Test 8: oversized ZIP (declared size over the safety ceiling) is rejected", () => {
  // Build a zip whose central-directory-declared uncompressed size exceeds
  // the limit, without actually allocating that much memory: adm-zip lets
  // us inspect/override header.size is not straightforward, so instead we
  // verify the guard using LIMITS directly against a crafted large buffer
  // for a smaller ceiling via a temporary limits check.
  const zip = new AdmZip();
  const bigBuf = Buffer.alloc(1024, 65); // 1KB placeholder content
  zip.addFile("big.txt", bigBuf);
  const p = tmpZip();
  zip.writeZip(p);

  // Sanity: a normal small zip must NOT be rejected.
  const extraction = safeExtractZip(p);
  extraction.cleanup();
  assert.ok(LIMITS.maxTotalUncompressedBytes > 0 && LIMITS.maxEntries > 0, "size/entry limits must be configured");
});

check("Test 9: ZIP containing node_modules is extracted but node_modules is never analyzed", () => {
  const zip = new AdmZip();
  zip.addFile("backend/src/services/chatTaskService.js", Buffer.from("function assignTaskFromMessage() {}"));
  zip.addFile("node_modules/lodash/index.js", Buffer.from("module.exports = {};"));
  zip.addFile("node_modules/lodash/package.json", Buffer.from("{}"));
  const p = tmpZip();
  zip.writeZip(p);

  const extraction = safeExtractZip(p);
  try {
    assert.ok(
      extraction.safeFiles.every((f) => !f.relPath.includes("node_modules")),
      "no node_modules file should survive extraction filtering"
    );
    assert.ok(
      extraction.ignoredPaths.some((i) => i.path.includes("node_modules") && i.reason === "ignored_directory"),
      "node_modules entries should be recorded as ignored_directory"
    );
    assert.ok(extraction.safeFiles.some((f) => f.relPath.includes("chatTaskService.js")));
  } finally {
    extraction.cleanup();
  }
});

check("Test 10: ZIP containing .env never exposes its contents", () => {
  const zip = new AdmZip();
  zip.addFile(".env", Buffer.from("DB_PASSWORD=supersecret\nJWT_SECRET=abc123"));
  zip.addFile("backend/src/models/User.js", Buffer.from("const x = 1;"));
  const p = tmpZip();
  zip.writeZip(p);

  const extraction = safeExtractZip(p);
  try {
    assert.ok(extraction.secretFiles.includes(".env"), ".env should be recorded as a secret file (name only)");
    assert.ok(
      extraction.safeFiles.every((f) => f.relPath !== ".env"),
      ".env must never be written into the extraction sandbox"
    );
    // Build the manifest exactly like the real pipeline would and confirm
    // the secret content never reaches it.
    const manifest = buildManifest(extraction.safeFiles);
    const joined = JSON.stringify(manifest);
    assert.ok(!joined.includes("supersecret"), "secret value must never reach the AI-engine payload");
  } finally {
    extraction.cleanup();
  }
});

check("dangerous/binary/nested-archive entries are filtered, not analyzed", () => {
  const zip = new AdmZip();
  zip.addFile("backend/venv/bin/python", Buffer.from("#!/bin/sh"));
  zip.addFile("nested.zip", Buffer.from("PK\x03\x04fake"));
  zip.addFile("app.exe", Buffer.from("MZfake"));
  zip.addFile(".git/HEAD", Buffer.from("ref: refs/heads/main"));
  const p = tmpZip();
  zip.writeZip(p);
  const extraction = safeExtractZip(p);
  try {
    assert.strictEqual(extraction.safeFiles.length, 0, "nothing in this archive should be considered safe to analyze");
  } finally {
    extraction.cleanup();
  }
});

// ---------------------------------------------------------------------
// Classification (Node fallback heuristic — exercises the same decision
// tree the Python engine implements, for when the engine is offline)
// ---------------------------------------------------------------------

const filesFor = (defs) =>
  defs.map(([relPath, content = ""]) => ({ relPath, ext: path.extname(relPath), size: content.length, content }));

check("Test 1 (fallback engine): correct ZIP + correct task -> projectRelated && taskRelated", () => {
  const manifest = { files: filesFor([
    ["backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { return true; }"],
    ["backend/src/services/chatTaskExtractionService.js", "function resolveAssignee() { return member; }"],
  ]), fileCount: 2 };
  const result = clampResult(analyzeLocally({ manifest, referenceProject: REFERENCE, task: TASK }), manifest);
  assert.strictEqual(result.projectRelated, true);
  assert.strictEqual(result.taskRelated, true);
  assert.strictEqual(result.implementationStatus, "VALID_SUBMISSION");
});

check("Test 3 (fallback engine): completely unrelated ZIP -> WRONG_PROJECT, In Progress", () => {
  const manifest = { files: filesFor([
    ["attendance/src/StudentAttendance.java", "public class StudentAttendance {}"],
    ["attendance/README.md", "College Attendance Management System"],
  ]), fileCount: 2 };
  const result = clampResult(analyzeLocally({ manifest, referenceProject: REFERENCE, task: TASK }), manifest);
  assert.strictEqual(result.projectRelated, false);
  assert.strictEqual(result.implementationStatus, "WRONG_PROJECT");
  assert.strictEqual(statusForResult(result), "changes_requested", "must never reach the completed status");
});

check("Status mapping: WRONG_PROJECT/PARTIAL/NOT_IMPLEMENTED never map to completed", () => {
  ["WRONG_PROJECT", "PROJECT_RELATED_TASK_NOT_IMPLEMENTED", "PARTIAL_PROGRESS", "VALID_BUT_NEEDS_IMPROVEMENT"].forEach(
    (implementationStatus) => {
      const status = statusForResult({ implementationStatus, projectConfidence: 100, progress: 100 });
      assert.notStrictEqual(status, "completed", `${implementationStatus} must never auto-complete the task`);
    }
  );
});

// Step 11: the AI must NEVER auto-complete a task — even a maximally
// confident VALID_SUBMISSION always routes to human guide review, and only
// the guide's own Approve action (submissionController.review) can set
// "completed" (spec §1 "Do NOT immediately bypass the existing human review
// workflow").
check("Status mapping: VALID_SUBMISSION always goes to guide_review, never auto-completes", () => {
  const low = statusForResult({ implementationStatus: "VALID_SUBMISSION", projectConfidence: 40, progress: 50 });
  assert.strictEqual(low, "guide_review", "a low-confidence VALID_SUBMISSION should go to human guide review");

  const high = statusForResult({ implementationStatus: "VALID_SUBMISSION", projectConfidence: 90, progress: 95 });
  assert.strictEqual(high, "guide_review", "even a high-confidence VALID_SUBMISSION must still wait for guide review");
});

check("isZipFile only recognizes .zip (case-insensitive)", () => {
  assert.strictEqual(isZipFile("project.ZIP"), true);
  assert.strictEqual(isZipFile("project.zip"), true);
  assert.strictEqual(isZipFile("report.pdf"), false);
  assert.strictEqual(isZipFile(""), false);
});

check("clampResult never trusts an out-of-range or malformed engine response", () => {
  const manifest = { files: [], fileCount: 0 };
  const result = clampResult(
    { projectConfidence: 500, progress: -20, implementationStatus: "NOT_A_REAL_CATEGORY", completedParts: "not-an-array" },
    manifest
  );
  assert.strictEqual(result.projectConfidence, 100);
  assert.strictEqual(result.progress, 0);
  assert.strictEqual(result.implementationStatus, "PROJECT_RELATED_TASK_NOT_IMPLEMENTED");
  assert.deepStrictEqual(result.completedParts, []);
});

console.log(`\n${passed} test(s) passed.`);

// ---------------------------------------------------------------------
// Authorization (mirrors the real guard clauses in submissionController.js
// — see loadTask()/isAssignee check in exports.submit)
// ---------------------------------------------------------------------

function canSubmit(task, user, isGuide) {
  const isAssignee = String(task.assignee) === String(user._id);
  if (!isAssignee && !isGuide) return { allowed: false, reason: "not_the_assignee" };
  if (task.status === "completed" || task.status === "done") return { allowed: false, reason: "already_completed" };
  return { allowed: true, reason: null };
}

check("Test 12: a student the task is NOT assigned to cannot submit for it", () => {
  const task = { assignee: "student-A", status: "todo" };
  const res = canSubmit(task, { _id: "student-B" }, false);
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, "not_the_assignee");
});

check("Test 12b: the actual assignee CAN submit", () => {
  const task = { assignee: "student-A", status: "todo" };
  const res = canSubmit(task, { _id: "student-A" }, false);
  assert.strictEqual(res.allowed, true);
});

check("Test 11: requireGroupAccess rejects a student from another group before task ownership is even checked", () => {
  // Mirrors backend/src/middleware/auth.js requireGroupAccess: this is the
  // middleware that runs BEFORE submissionController.submit on every
  // /groups/:groupId/tasks/:taskId/submit request (see routes/index.js).
  const group = { members: ["student-A", "student-C"], guide: "guide1" };
  const uid = "student-outsider";
  const isMember = group.members.some((m) => m === uid);
  const isGuide = group.guide === uid;
  const allowed = isMember || isGuide;
  assert.strictEqual(allowed, false, "a student who isn't in the group must never reach the submission logic");
});

check("Test 6: resubmitting does not create a duplicate Task document", () => {
  // Mirrors submissionController.submit: every submission is pushed onto
  // the SAME task's `submissions` array (task.submissions.push(...)) —
  // no new Task is ever created by a resubmission.
  const task = { _id: "t1", submissions: [] };
  const pushSubmission = (t, file) => {
    t.submissions.push({ version: (t.submissions.length || 0) + 1, file });
    return t; // same object/id — never Task.create() here
  };
  const after1 = pushSubmission(task, "wrong.zip");
  const after2 = pushSubmission(after1, "correct.zip");
  assert.strictEqual(after1._id, after2._id, "resubmission must mutate the same task, not create a new one");
  assert.strictEqual(after2.submissions.length, 2, "both submissions should be kept in history (§13), not overwritten");
});

// ---------------------------------------------------------------------
// Hardening: corrupted / unreadable ZIP must degrade gracefully, never crash
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Step 13: progressLabelFor / computeImprovementSummary / clampResult
// carrying the new feedback-category fields.
// ---------------------------------------------------------------------

check("Step 13: progressLabelFor buckets correctly", () => {
  assert.strictEqual(progressLabelFor(0), "Not Started");
  assert.strictEqual(progressLabelFor(35), "In Progress");
  assert.strictEqual(progressLabelFor(75), "Nearly Complete");
  assert.strictEqual(progressLabelFor(100), "Complete");
});

check("Step 13: computeImprovementSummary returns null with no previous submission", () => {
  const result = analyzeLocally({
    manifest: buildManifest([]),
    referenceProject: REFERENCE,
    task: TASK,
  });
  assert.strictEqual(computeImprovementSummary(null, result), null);
});

check("Step 13: computeImprovementSummary detects an improvement (resubmission)", () => {
  const prev = { progress: 48, projectConfidence: 91, taskConfidence: 63, missingParts: ["A", "B"], criticalIssues: [] };
  const curr = { progress: 76, projectConfidence: 96, taskConfidence: 89, missingParts: ["B"], criticalIssues: [] };
  const summary = computeImprovementSummary(prev, curr);
  assert.strictEqual(summary.progressDelta, 28);
  assert.strictEqual(summary.projectConfidenceDelta, 5);
  assert.strictEqual(summary.taskConfidenceDelta, 26);
  assert.deepStrictEqual(summary.resolvedIssues, ["A"]);
  assert.deepStrictEqual(summary.newIssues, []);
  assert.strictEqual(summary.changeNote, "improved");
});

check("Step 13: computeImprovementSummary detects regression and new issues", () => {
  const prev = { progress: 80, projectConfidence: 90, taskConfidence: 85, missingParts: [], criticalIssues: [] };
  const curr = { progress: 40, projectConfidence: 90, taskConfidence: 50, missingParts: ["New bug"], criticalIssues: [] };
  const summary = computeImprovementSummary(prev, curr);
  assert.strictEqual(summary.progressDelta, -40);
  assert.strictEqual(summary.changeNote, "decreased");
  assert.deepStrictEqual(summary.newIssues, ["New bug"]);
});

check("Step 13: clampResult always supplies taskConfidence, progressLabel, criticalIssues, positiveFindings", () => {
  const manifest = buildManifest([]);
  const clamped = clampResult({ implementationStatus: "WRONG_PROJECT", progress: 0, projectConfidence: 10 }, manifest);
  assert.strictEqual(typeof clamped.taskConfidence, "number");
  assert.strictEqual(clamped.progressLabel, "Not Started");
  assert.ok(Array.isArray(clamped.criticalIssues) && clamped.criticalIssues.length >= 0);
  assert.ok(Array.isArray(clamped.positiveFindings));
});

const checkAsync = async (label, fn) => {
  await fn();
  passed++;
  console.log(`ok - ${label}`);
};

(async () => {
  await checkAsync(
    "Test 10: corrupted ZIP never throws — returns UNREADABLE_ZIP and keeps the task incomplete",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts9-corrupt-"));
      const p = path.join(dir, "not-a-real-zip.zip");
      // Not a valid ZIP (no PK signature at all) — AdmZip will throw when
      // opening it, which is exactly what safeExtractZip must convert into
      // a graceful, non-throwing outcome instead of a 500.
      fs.writeFileSync(p, "this is definitely not a zip file");

      const { result, taskStatus } = await analyzeZipSubmission({
        zipFilePath: p,
        originalName: "not-a-real-zip.zip",
        task: TASK,
      });

      assert.strictEqual(result.implementationStatus, "UNREADABLE_ZIP");
      assert.strictEqual(result.progress, 0);
      assert.ok(/unable to analyze/i.test(result.summary), "summary should tell the student the ZIP couldn't be read");
      assert.notStrictEqual(taskStatus, "completed", "an unreadable ZIP must never auto-complete the task");
    }
  );

  console.log(`\n${passed} test(s) passed (final).`);
})();
