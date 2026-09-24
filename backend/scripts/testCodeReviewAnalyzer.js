/**
 * Standalone tests for STEP 17 — Feature 3: Deep AI Code Review
 * (services/codeReviewAnalyzer.js + the codeQualityComparison helper in
 * taskSubmissionAnalysisService.js).
 *
 * No DB / no ZIP / no AI engine needed — this analyzer is pure, in-memory
 * static analysis over already-extracted file content (the same manifest
 * shape buildManifest() in taskSubmissionAnalysisService.js already
 * produces).
 *
 * Run: node backend/scripts/testCodeReviewAnalyzer.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  reviewCode,
  SEVERITY_WEIGHTS,
  isBackendish,
  isReactish,
} = require("../src/services/codeReviewAnalyzer");
const { computeCodeQualityComparison } = require("../src/services/taskSubmissionAnalysisService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const file = (relPath, content) => ({ relPath, ext: path.extname(relPath), content });

/* 1 — clean code: no issues, full score */
check("clean code produces no issues and a perfect score", () => {
  const f = file(
    "src/utils/mathHelpers.js",
    [
      "function add(a, b) {",
      "  return a + b;",
      "}",
      "",
      "function subtract(a, b) {",
      "  return a - b;",
      "}",
      "",
      "module.exports = { add, subtract };",
    ].join("\n")
  );
  const result = reviewCode([f]);
  assert.deepStrictEqual(result.issues, []);
  assert.strictEqual(result.score, 100);
});

/* 2 — empty catch */
check("detects an empty catch block", () => {
  const f = file(
    "src/services/foo.js",
    "async function run() {\n  try {\n    doThing();\n  } catch (err) {\n  }\n}\n"
  );
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.category === "ERROR_HANDLING" && i.message.includes("Empty catch"));
  assert.ok(issue, "expected an empty-catch issue");
  assert.strictEqual(issue.severity, "HIGH");
  assert.strictEqual(issue.line, 4);
});

/* 3 — missing error handling (backend async route handler, no try/catch/wrapper) */
check("detects an async route handler with no error handling", () => {
  const f = file(
    "src/controllers/widgetController.js",
    [
      "const express = require('express');",
      "const router = express.Router();",
      "router.post('/widgets', async (req, res) => {",
      "  const widget = await Widget.create(req.body);",
      "  res.json(widget);",
      "});",
      "module.exports = router;",
    ].join("\n")
  );
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.category === "ERROR_HANDLING" && i.message.includes("error-handling"));
  assert.ok(issue, "expected a missing-error-handling issue");
  assert.strictEqual(issue.severity, "MEDIUM");
  assert.strictEqual(issue.line, null, "file-level finding must not fabricate a line number");
});

check("does NOT flag error handling when a try/catch is present", () => {
  const f = file(
    "src/controllers/safeController.js",
    [
      "const router = require('express').Router();",
      "router.post('/x', async (req, res) => {",
      "  try {",
      "    const x = await doThing();",
      "    res.json(x);",
      "  } catch (err) {",
      "    res.status(500).json({ error: err.message });",
      "  }",
      "});",
    ].join("\n")
  );
  const result = reviewCode([f]);
  assert.ok(!result.issues.some((i) => i.message.includes("error-handling")));
});

/* 4 — TODO/FIXME */
check("detects TODO and FIXME markers", () => {
  const f = file("src/x.js", "function x() {\n  // TODO: handle edge case\n  // FIXME broken on Safari\n}\n");
  const result = reviewCode([f]);
  const todos = result.issues.filter((i) => i.message.includes("TODO") || i.message.includes("FIXME"));
  assert.strictEqual(todos.length, 2);
  assert.ok(todos.every((i) => i.severity === "INFO"));
});

/* 5 — long function */
check("detects an extremely long function", () => {
  const bodyLines = Array.from({ length: 70 }, (_, i) => `  const v${i} = ${i};`).join("\n");
  const f = file("src/big.js", `function doLots() {\n${bodyLines}\n  return v0;\n}\n`);
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.message.includes("long"));
  assert.ok(issue, "expected a long-function issue");
  assert.strictEqual(issue.severity, "LOW");
});

/* 6 — large file */
check("detects a large file", () => {
  const content = Array.from({ length: 320 }, (_, i) => `const line${i} = ${i};`).join("\n");
  const f = file("src/huge.js", content);
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.message.startsWith("File is large"));
  assert.ok(issue);
  assert.strictEqual(issue.line, null);
});

/* 7 — console/debug statement */
check("detects console/debug statements", () => {
  const f = file("src/y.js", "function y() {\n  console.log('debug');\n  return 1;\n}\n");
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.message.includes("console/debug"));
  assert.ok(issue);
  assert.strictEqual(issue.severity, "LOW");
  assert.strictEqual(issue.line, 2);
});

/* 8 — obvious duplicated block */
check("detects an obvious duplicated block of code", () => {
  const block = [
    "  const total = price * quantity;",
    "  const tax = total * 0.08;",
    "  const shipping = total > 50 ? 0 : 5.99;",
    "  const grandTotal = total + tax + shipping;",
    "  console.log('order total', grandTotal);",
  ].join("\n");
  const f = file("src/checkout.js", `function checkoutA() {\n${block}\n}\n\nfunction checkoutB() {\n${block}\n}\n`);
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.message.includes("duplicated"));
  assert.ok(issue, "expected a duplicated-block issue");
});

/* 9 — React-specific issue (missing key + missing dependency array) */
check("detects a mapped list with no key prop anywhere in the file", () => {
  const f = file(
    "src/components/List.jsx",
    "import React from 'react';\nexport default function List({ items }) {\n  return <ul>{items.map((item) => <li>{item.name}</li>)}</ul>;\n}\n"
  );
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.category === "REACT" && i.message.includes("key"));
  assert.ok(issue);
  assert.strictEqual(issue.severity, "MEDIUM");
});

check("does NOT flag missing key when key= is present anywhere in the file", () => {
  const f = file(
    "src/components/GoodList.jsx",
    "import React from 'react';\nexport default function GoodList({ items }) {\n  return <ul>{items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;\n}\n"
  );
  const result = reviewCode([f]);
  assert.ok(!result.issues.some((i) => i.message.includes("key")));
});

check("detects useEffect() with no dependency array", () => {
  const f = file(
    "src/components/Widget.jsx",
    "import React, { useEffect } from 'react';\nexport default function Widget() {\n  useEffect(() => {\n    fetchData();\n  });\n  return null;\n}\n"
  );
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.category === "REACT" && i.message.includes("dependency array"));
  assert.ok(issue);
});

check("does NOT flag useEffect() when a dependency array is present", () => {
  const f = file(
    "src/components/Widget2.jsx",
    "import React, { useEffect } from 'react';\nexport default function Widget2({ id }) {\n  useEffect(() => {\n    fetchData(id);\n  }, [id]);\n  return null;\n}\n"
  );
  const result = reviewCode([f]);
  assert.ok(!result.issues.some((i) => i.message.includes("dependency array")));
});

/* 10 — backend-specific issue (unvalidated body write, client-controlled ID) */
check("detects req.body written directly to the DB with no validation", () => {
  const f = file(
    "src/controllers/orderController.js",
    "const router = require('express').Router();\nrouter.post('/orders', async (req, res) => {\n  const order = await Order.create(req.body);\n  res.json(order);\n});\n"
  );
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.category === "BACKEND" && i.message.includes("validation"));
  assert.ok(issue);
});

check("does NOT flag req.body write when a validation library is used", () => {
  const f = file(
    "src/controllers/validatedController.js",
    "const { z } = require('zod');\nconst schema = z.object({ name: z.string() });\nrouter.post('/x', async (req, res) => {\n  const data = schema.parse(req.body);\n  const order = await Order.create(data);\n  res.json(order);\n});\n"
  );
  const result = reviewCode([f]);
  assert.ok(!result.issues.some((i) => i.message.includes("validation")));
});

check("detects a client-supplied ID used in a delete with no ownership check", () => {
  const f = file(
    "src/controllers/deleteController.js",
    "router.delete('/items/:id', async (req, res) => {\n  await Item.findByIdAndDelete(req.params.id);\n  res.status(204).end();\n});\n"
  );
  const result = reviewCode([f]);
  const issue = result.issues.find((i) => i.category === "BACKEND" && i.message.includes("ownership"));
  assert.ok(issue);
  assert.strictEqual(issue.severity, "MEDIUM", "must not overclaim severity without stronger evidence");
});

check("does NOT flag client-supplied ID deletion when req.user is referenced in the file", () => {
  const f = file(
    "src/controllers/safeDeleteController.js",
    "router.delete('/items/:id', async (req, res) => {\n  const item = await Item.findById(req.params.id);\n  if (String(item.owner) !== String(req.user._id)) return res.status(403).end();\n  await Item.findByIdAndDelete(req.params.id);\n  res.status(204).end();\n});\n"
  );
  const result = reviewCode([f]);
  assert.ok(!result.issues.some((i) => i.message.includes("ownership")));
});

/* 11/12 — binary and secret filtering: NOT re-implemented here — this
 * analyzer only ever receives the manifest safeZipExtractor + buildManifest
 * already produced, which already excludes binaries/.env/secrets/
 * node_modules/.git before this module ever sees a file. This test
 * confirms this module's own behavior on that already-filtered input:
 * files with no textual content (as binaries/oversized files would have,
 * per buildManifest's own TEXTY_EXT + size-cap logic) are silently
 * skipped, never crash, and never appear in the issues list. */
check("binary/non-content files (empty content, as buildManifest produces for them) are skipped, not crashed on", () => {
  const files = [
    { relPath: "assets/logo.png", ext: ".png", content: "" },
    { relPath: "assets/data.bin", ext: ".bin", content: "" },
    file("src/real.js", "function ok() { return 1; }"),
  ];
  const result = reviewCode(files);
  assert.strictEqual(result.analyzedFileCount, 1, "only the one real text file should be analyzed");
});

check("secret-like filenames are simply analyzed as text like any other file (exclusion is safeZipExtractor's job, already unmodified) — never crashes", () => {
  // safeZipExtractor already strips .env/secret files out of the manifest
  // before this module runs; this only proves this module itself doesn't
  // choke on a file that happens to mention "secret" in its path/content.
  const f = file("config/secretsExample.js", "const apiKeyPlaceholder = 'REDACTED';\n");
  assert.doesNotThrow(() => reviewCode([f]));
});

/* 13/14 — malicious ZIP safety / no code execution: this module never
 * opens a ZIP, never reads from disk, and never executes anything — it
 * only does regex/string operations on content strings it's handed. A
 * "malicious" payload is just more text to pattern-match, never runs. */
check("a payload designed to look executable is only ever treated as text, never executed", () => {
  const maliciousLookingContent = [
    "eval(\"require('child_process').exec('rm -rf /')\");",
    "// this file is intentionally scary-looking text only",
  ].join("\n");
  const f = file("src/scary.js", maliciousLookingContent);
  // Must not throw, must not do anything beyond returning plain-data issues.
  const result = reviewCode([f]);
  assert.ok(Array.isArray(result.issues));
});

check("the analyzer module itself has no dependency on child_process, fs, or eval", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "services", "codeReviewAnalyzer.js"), "utf8");
  assert.ok(!/require\(["']child_process["']\)/.test(src));
  assert.ok(!/require\(["']fs["']\)/.test(src), "this module must never read from disk itself");
  assert.ok(!/\beval\(/.test(src));
});

/* 15 — score calculation */
check("score calculation matches severity weights exactly", () => {
  const f = file(
    "src/scored.js",
    "async function run() {\n  try { x(); } catch (e) {\n  }\n}\n// TODO: cleanup\nconsole.log('hi');\n"
  );
  const result = reviewCode([f]);
  const expected = 100 - result.issues.reduce((sum, i) => sum + (SEVERITY_WEIGHTS[i.severity] || 0), 0);
  assert.strictEqual(result.score, Math.max(0, Math.min(100, expected)));
});

check("score never goes below 0 even with many severe issues", () => {
  const manyEmptyCatches = Array.from({ length: 10 }, (_, i) => `try { f${i}(); } catch (e) {}`).join("\n");
  const f = file("src/lots.js", manyEmptyCatches);
  const result = reviewCode([f]);
  assert.ok(result.score >= 0);
});

/* 16 — severity classification: every issue's severity is one of the 5 documented levels */
check("every issue uses one of the 5 documented severity levels", () => {
  const f = file(
    "src/mixed.jsx",
    [
      "import React, { useEffect } from 'react';",
      "router.post('/x', async (req, res) => { const o = await Order.create(req.body); });",
      "export default function Mixed({ items }) {",
      "  useEffect(() => { load(); });",
      "  console.log('x');",
      "  // TODO fix",
      "  return <ul>{items.map((i) => <li>{i}</li>)}</ul>;",
      "}",
    ].join("\n")
  );
  const result = reviewCode([f]);
  assert.ok(result.issues.length > 0, "expected this deliberately messy fixture to trigger multiple issues");
  assert.ok(result.issues.every((i) => Object.keys(SEVERITY_WEIGHTS).includes(i.severity)));
});

/* 17 — positive findings */
check("positive findings are reported when a category genuinely has no issues", () => {
  const f = file("src/clean2.js", "function clean() {\n  return 42;\n}\n");
  const result = reviewCode([f]);
  assert.ok(result.positiveFindings.some((p) => p.includes("empty catch")));
  assert.ok(result.positiveFindings.some((p) => p.includes("console")));
});

check("positive findings never claim something about a category with zero relevant files", () => {
  const f = file("src/plainNode.js", "function x() { return 1; }"); // no react, no backend markers
  const result = reviewCode([f]);
  assert.ok(!result.positiveFindings.some((p) => p.toLowerCase().includes("react")));
  assert.ok(!result.positiveFindings.some((p) => p.toLowerCase().includes("backend")));
});

/* 18 — previous-version comparison */
check("previous-version comparison: improved score", () => {
  const cmp = computeCodeQualityComparison({ score: 74 }, 82);
  assert.deepStrictEqual(cmp, { previousScore: 74, currentScore: 82, delta: 8, changeNote: "improved" });
});
check("previous-version comparison: decreased score", () => {
  const cmp = computeCodeQualityComparison({ score: 82 }, 68);
  assert.strictEqual(cmp.changeNote, "decreased");
  assert.strictEqual(cmp.delta, -14);
});
check("previous-version comparison: never fabricated when the previous version has no score", () => {
  assert.strictEqual(computeCodeQualityComparison({ score: null }, 82), null);
  assert.strictEqual(computeCodeQualityComparison(undefined, 82), null);
  assert.strictEqual(computeCodeQualityComparison({ score: 74 }, null), null);
});

/* 19 — "group isolation": reviewCode is a pure, stateless function — two
 * calls with different single-file inputs must never leak results into
 * each other (no shared/global state to leak across groups/submissions). */
check("reviewCode has no shared state across calls (isolation)", () => {
  const resultA = reviewCode([file("src/a.js", "console.log('a');")]);
  const resultB = reviewCode([file("src/b.js", "function clean() { return 1; }")]);
  assert.ok(resultA.issues.every((i) => i.file === "src/a.js"));
  assert.ok(resultB.issues.length === 0, "clean file B must not inherit issues found while analyzing A");
});

/* 20 — "AI engine unavailable fallback": this analyzer has no AI-engine
 * dependency at all (it's pure Node static analysis, by design — see the
 * Step 17 report for why), so there is nothing to fall back FROM; this
 * test proves that independence structurally rather than asserting
 * something that can't happen. */
check("code review has no AI-engine dependency to begin with — verified structurally", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "services", "codeReviewAnalyzer.js"), "utf8");
  assert.ok(!src.includes("aiEngineClient"), "codeReviewAnalyzer must work with zero AI-engine involvement");
});

/* extra — isBackendish / isReactish sanity */
check("isBackendish / isReactish classify files sensibly", () => {
  assert.ok(isBackendish(file("src/controllers/x.js", "router.get('/x')")));
  assert.ok(!isBackendish(file("src/utils/math.js", "function add(a,b){return a+b}")));
  assert.ok(isReactish(file("src/Comp.jsx", "")));
  assert.ok(!isReactish(file("src/plain.js", "function x(){}")));
});

console.log(`\n${passed} passed`);
