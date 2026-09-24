/**
 * Standalone tests for STEP 17 — Feature 2: AI-Expanded Task Description
 * (Node side: services/taskExpansionService.js).
 *
 * The "AI engine unavailable" tests are NOT mocked — this script runs with
 * no Flask server listening on AI_ENGINE_URL, so aiEngine.analyzeTaskExpansion
 * genuinely fails and the real fallback path executes.
 *
 * Run: node backend/scripts/testTaskExpansionService.js
 */
const assert = require("assert");
const { expandTask, sanitizeEngineResponse, fallbackExpansion } = require("../src/services/taskExpansionService");

let passed = 0;
const check = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

(async () => {
  /* 1 — AI engine unavailable -> graceful, non-fabricated fallback (real, not mocked) */
  await check("AI engine unavailable: falls back to the documented stub, task creation is never blocked", async () => {
    const result = await expandTask({ title: "Login page" });
    assert.deepStrictEqual(result, fallbackExpansion());
    assert.strictEqual(result.estimatedDifficulty, "UNKNOWN");
    assert.deepStrictEqual(result.subtasks, []);
    assert.deepStrictEqual(result.acceptanceCriteria, []);
  });

  /* 2 — empty title never crashes, never fabricates */
  await check("empty title returns the fallback stub instead of crashing", async () => {
    const result = await expandTask({ title: "" });
    assert.deepStrictEqual(result, fallbackExpansion());
  });

  /* 3 — whitespace-only title also falls back cleanly */
  await check("whitespace-only title falls back cleanly", async () => {
    const result = await expandTask({ title: "   " });
    assert.deepStrictEqual(result, fallbackExpansion());
  });

  /* 4 — malformed engine response (missing description) is rejected, not passed through */
  check("sanitizer rejects a malformed engine response with no usable description", () => {
    assert.strictEqual(sanitizeEngineResponse({ subtasks: ["x"] }), null);
    assert.strictEqual(sanitizeEngineResponse(null), null);
    assert.strictEqual(sanitizeEngineResponse("not an object"), null);
  });

  /* 5 — sanitizer accepts a well-formed response and drops junk entries */
  check("sanitizer keeps a well-formed response and filters non-string list entries", () => {
    const cleaned = sanitizeEngineResponse({
      description: "Do the thing.",
      subtasks: ["Step 1", 42, null, "Step 2"],
      acceptanceCriteria: ["Works"],
      estimatedDifficulty: "MEDIUM",
      estimatedEffort: "3-5 hours (AI estimate)",
    });
    assert.deepStrictEqual(cleaned, {
      description: "Do the thing.",
      subtasks: ["Step 1", "Step 2"],
      acceptanceCriteria: ["Works"],
      estimatedDifficulty: "MEDIUM",
      estimatedEffort: "3-5 hours (AI estimate)",
    });
  });

  /* 6 — an invalid difficulty label is coerced to UNKNOWN rather than passed through */
  check("sanitizer coerces an invalid difficulty label to UNKNOWN", () => {
    const cleaned = sanitizeEngineResponse({ description: "x", estimatedDifficulty: "SUPER_HARD" });
    assert.strictEqual(cleaned.estimatedDifficulty, "UNKNOWN");
  });

  /* 7 — fallbackExpansion() matches the exact shape given in the Step 17 spec */
  check("fallback shape matches the spec's documented fallback example", () => {
    const fb = fallbackExpansion();
    assert.strictEqual(fb.description, "Complete the task described by the provided title.");
    assert.deepStrictEqual(fb.subtasks, []);
    assert.deepStrictEqual(fb.acceptanceCriteria, []);
    assert.strictEqual(fb.estimatedDifficulty, "UNKNOWN");
  });

  /* 8 — description + title together are both forwarded (engine unavailable, but the
   * call itself must not throw regardless of which optional fields are present) */
  await check("title + description input never throws, even with the engine offline", async () => {
    const result = await expandTask({ title: "Build settings page", description: "Also add a dark mode toggle" });
    assert.ok(result && typeof result === "object");
  });

  console.log(`\n${passed} passed`);
})();
