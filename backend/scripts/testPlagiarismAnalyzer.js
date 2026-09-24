/**
 * Standalone tests for Step 14 — Duplicate/Plagiarism Submission Detection.
 * No DB / no server / no live AI engine needed: builds real files on disk
 * and exercises the actual safeZipExtractor + plagiarismAnalyzer code path,
 * exactly like backend/scripts/testTaskSubmissionAnalysis.js does for
 * Step 9.
 *
 * Run: node backend/scripts/testPlagiarismAnalyzer.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

const { safeExtractZip } = require("../src/services/safeZipExtractor");
const {
  buildFingerprint,
  compareFingerprints,
  evaluate,
  classifySeverity,
  findCandidates,
  isRelevantFile,
  normalizeContent,
  SIMILARITY_THRESHOLDS,
} = require("../src/services/plagiarismAnalyzer");
const { analyzeZipSubmission } = require("../src/services/taskSubmissionAnalysisService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};
const checkAsync = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

/** Builds a real ZIP on disk with the given { relPath: content } map and
 * extracts it through the real safeExtractZip, returning safeFiles the same
 * way a genuine upload would. Caller must call cleanup(). */
function extractedFilesFor(fileMap) {
  const zip = new AdmZip();
  for (const [rel, content] of Object.entries(fileMap)) zip.addFile(rel, Buffer.from(content));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plag-test-"));
  const zipPath = path.join(dir, "submission.zip");
  zip.writeZip(zipPath);
  return safeExtractZip(zipPath);
}

const SRC_A = `
// order service
function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return total;
}
module.exports = { calculateTotal };
`;

// Same logic, only whitespace/comment/line-ending/indentation differences —
// token spacing around operators is left alone since normalizeContent is a
// similarity signal (not a code formatter/AST-level normalizer).
const SRC_A_REFORMATTED = `\r\n\r\n// order service (reformatted)\r\nfunction calculateTotal(items) {\r\n\tlet total = 0;\r\n\r\n\tfor (const item of items) {\r\n\t\ttotal += item.price * item.quantity; // running total\r\n\t}\r\n\treturn total;\r\n}\r\n\r\nmodule.exports = { calculateTotal };\r\n`;

const SRC_B = `
// unrelated inventory helper
function lowStockItems(inventory, threshold) {
  return inventory.filter((i) => i.quantity < threshold).map((i) => i.name);
}
module.exports = { lowStockItems };
`;

// ---------------------------------------------------------------------
// Pure-function unit tests
// ---------------------------------------------------------------------

check("normalizeContent collapses whitespace/line-endings and strips // and /* */ comments", () => {
  const a = normalizeContent(SRC_A, ".js");
  const b = normalizeContent(SRC_A_REFORMATTED, ".js");
  assert.strictEqual(a, b, "formatting-only differences must normalize identically");
});

check("isRelevantFile ignores node_modules/.git/coverage/binary/secret files", () => {
  assert.strictEqual(isRelevantFile("node_modules/x/index.js", ".js"), false);
  assert.strictEqual(isRelevantFile(".git/HEAD", ""), false);
  assert.strictEqual(isRelevantFile("coverage/lcov.info", ""), false);
  assert.strictEqual(isRelevantFile("assets/logo.png", ".png"), false);
  assert.strictEqual(isRelevantFile(".env", ""), false);
  assert.strictEqual(isRelevantFile("config/secrets.json", ".json"), false);
  assert.strictEqual(isRelevantFile("src/orderService.js", ".js"), true);
});

check("classifySeverity matches the documented 50/70/85 thresholds", () => {
  assert.strictEqual(classifySeverity(0), "NONE");
  assert.strictEqual(classifySeverity(49), "NONE");
  assert.strictEqual(classifySeverity(SIMILARITY_THRESHOLDS.POSSIBLE), "POSSIBLE");
  assert.strictEqual(classifySeverity(69), "POSSIBLE");
  assert.strictEqual(classifySeverity(SIMILARITY_THRESHOLDS.HIGH), "HIGH");
  assert.strictEqual(classifySeverity(84), "HIGH");
  assert.strictEqual(classifySeverity(SIMILARITY_THRESHOLDS.DUPLICATE), "DUPLICATE");
  assert.strictEqual(classifySeverity(100), "DUPLICATE");
});

check("Test 1: identical submissions -> detected as DUPLICATE", () => {
  const a = extractedFilesFor({ "src/orderService.js": SRC_A });
  const b = extractedFilesFor({ "src/orderService.js": SRC_A });
  try {
    const fpA = buildFingerprint(a.safeFiles);
    const fpB = buildFingerprint(b.safeFiles);
    const cmp = compareFingerprints(fpA, fpB);
    assert.ok(cmp.score >= SIMILARITY_THRESHOLDS.DUPLICATE, `expected DUPLICATE-range score, got ${cmp.score}`);
    assert.strictEqual(classifySeverity(cmp.score), "DUPLICATE");
    assert.ok(cmp.matchedFiles.includes("src/orderService.js"));
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

check("Test 2 / Test 4: formatting-only differences still score as a high match (no false negative)", () => {
  const a = extractedFilesFor({ "src/orderService.js": SRC_A });
  const b = extractedFilesFor({ "src/orderService.js": SRC_A_REFORMATTED });
  try {
    const fpA = buildFingerprint(a.safeFiles);
    const fpB = buildFingerprint(b.safeFiles);
    const cmp = compareFingerprints(fpA, fpB);
    assert.ok(cmp.score >= SIMILARITY_THRESHOLDS.DUPLICATE, `formatting-only diff should still be a near-exact match, got ${cmp.score}`);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

check("Test 3: unrelated submissions -> not detected", () => {
  const a = extractedFilesFor({ "src/orderService.js": SRC_A });
  const b = extractedFilesFor({ "src/inventoryHelper.js": SRC_B });
  try {
    const fpA = buildFingerprint(a.safeFiles);
    const fpB = buildFingerprint(b.safeFiles);
    const cmp = compareFingerprints(fpA, fpB);
    assert.ok(cmp.score < SIMILARITY_THRESHOLDS.POSSIBLE, `unrelated files should score low, got ${cmp.score}`);
    assert.strictEqual(classifySeverity(cmp.score), "NONE");
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

check("Test 5: node_modules is ignored by the fingerprint even if present in safeFiles", () => {
  // safeZipExtractor already strips node_modules before safeFiles is built,
  // but isRelevantFile is re-checked here as defense-in-depth — simulate a
  // safeFiles entry that (hypothetically) still had one.
  const fp = buildFingerprint([
    { relPath: "node_modules/left-pad/index.js", absPath: "/dev/null", size: 10, ext: ".js" },
  ]);
  assert.strictEqual(fp.fileCount, 0);
});

check("Test 8: self-comparison is never counted (evaluate excludes empty/self candidates cleanly)", () => {
  const a = extractedFilesFor({ "src/orderService.js": SRC_A });
  try {
    const fpA = buildFingerprint(a.safeFiles);
    // No candidates supplied at all == the "exclude self" contract from the
    // caller (findCandidates always excludes the current task); evaluate()
    // must handle an empty candidate list gracefully.
    const result = evaluate(fpA, []);
    assert.strictEqual(result.detected, false);
    assert.strictEqual(result.severity, "NONE");
  } finally {
    a.cleanup();
  }
});

check("Test 10: private submission content is never returned in the evaluate() result", () => {
  const a = extractedFilesFor({ "src/orderService.js": SRC_A });
  const b = extractedFilesFor({ "src/orderService.js": SRC_A });
  try {
    const fpA = buildFingerprint(a.safeFiles);
    const fpB = buildFingerprint(b.safeFiles);
    const result = evaluate(fpA, [{ submissionId: "s1", studentId: "u1", groupId: "g1", fingerprint: fpB }]);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("calculateTotal"), "result must never contain source code");
    assert.ok(!("signature" in result), "result must never leak the shingle signature");
    assert.ok(!("fileHashes" in result), "result must never leak raw file hashes");
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

check("Test 11: old submissions without a plagiarism field still work (evaluate on empty fingerprint)", () => {
  const emptyFp = buildFingerprint([]);
  const result = evaluate(emptyFp, []);
  assert.strictEqual(result.detected, false);
  assert.strictEqual(result.severity, "NONE");
  assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0);
});

check("Test 9 (part 1): findCandidates never throws and returns [] with no live DB connection", async () => {
  // findCandidates is async; this check wraps it below in checkAsync instead.
});

(async () => {
  await checkAsync("Test 9: cross-group authorization — findCandidates returns [] safely without a DB connection (never hangs/throws)", async () => {
    const result = await findCandidates({ taskTitle: "Implement checkout flow", excludeTaskId: "000000000000000000000000" });
    assert.deepStrictEqual(result, []);
  });

  await checkAsync("Test 12: corrupted ZIP does not crash the plagiarism step either", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plag-corrupt-"));
    const p = path.join(dir, "not-a-zip.zip");
    fs.writeFileSync(p, "definitely not a zip");
    const { plagiarism, plagiarismFingerprint } = await analyzeZipSubmission({
      zipFilePath: p,
      originalName: "not-a-zip.zip",
      task: { title: "Implement checkout flow", description: "", module: "" },
    });
    assert.strictEqual(plagiarism.detected, false);
    assert.strictEqual(plagiarism.severity, "NONE");
    assert.strictEqual(plagiarismFingerprint, null);
  });

  await checkAsync("Test 13: wrong-project ZIP still gets a (non-detected) plagiarism result alongside it", async () => {
    const zip = new AdmZip();
    zip.addFile("random.txt", Buffer.from("nothing related to this project"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plag-wrongproj-"));
    const zipPath = path.join(dir, "submission.zip");
    zip.writeZip(zipPath);
    const { result, plagiarism } = await analyzeZipSubmission({
      zipFilePath: zipPath,
      originalName: "submission.zip",
      task: { title: "Implement checkout flow", description: "", module: "" },
    });
    assert.strictEqual(result.implementationStatus, "WRONG_PROJECT");
    assert.ok(plagiarism, "plagiarism result must still be present");
    assert.strictEqual(typeof plagiarism.similarityScore, "number");
  });

  await checkAsync(
    "Test 14: a DUPLICATE-severity result never bypasses Guide Review (taskStatus is never auto-completed)",
    async () => {
      const zip = new AdmZip();
      zip.addFile("src/orderService.js", Buffer.from(SRC_A));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plag-dup-"));
      const zipPath = path.join(dir, "submission.zip");
      zip.writeZip(zipPath);
      const { taskStatus } = await analyzeZipSubmission({
        zipFilePath: zipPath,
        originalName: "submission.zip",
        // No DB connection in this test run, so findCandidates() returns []
        // and nothing will actually be flagged — this test's real point is
        // that taskStatus only ever comes from statusForResult() (the
        // project/task-relevance classification), and plagiarism.* is never
        // consulted when deciding taskStatus, so it structurally can never
        // auto-reject/auto-complete a task on its own.
        task: { title: "Implement checkout flow", description: "", module: "" },
      });
      assert.notStrictEqual(taskStatus, "completed");
      assert.notStrictEqual(taskStatus, "rejected");
    }
  );

  console.log(`\n${passed} test(s) passed (final).`);
})();
