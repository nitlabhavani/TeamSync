/**
 * Standalone tests for STEP 18 — AI Task Intelligence / Smart Planning
 * (services/taskPlanService.js).
 *
 * Everything here is DB-free by design, matching this project's existing
 * test convention (see testSmartTaskAssignmentService.js,
 * testTaskExpansionService.js) — buildPlanningSummary() itself calls
 * gatherGroupEvidence()/getRecommendation(), which need a real Mongo
 * connection this standalone script doesn't have, so it is NOT exercised
 * here; every function that IS pure/network-only (sanitization, the
 * fallback plan, priority/deadline-buffer reasoning, the real-not-mocked
 * AI-engine-offline path) is fully covered instead.
 *
 * Run: node backend/scripts/testTaskPlanService.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  sanitizeText,
  sanitizeStringList,
  sanitizePlan,
  fallbackPlan,
  generateSubtaskPlan,
  computeSuggestedPriority,
  computeDeadlineBufferDays,
} = require("../src/services/taskPlanService");

let passed = 0;
const check = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

(async () => {
  /* ---------------- sanitizeText / sanitizeStringList ---------------- */

  await check("sanitizeText strips HTML-like tags and control characters", async () => {
    const cleaned = sanitizeText('<script>alert(1)</script>Do the thing\u0007');
    assert.strictEqual(cleaned, "alert(1)Do the thing");
  });

  await check("sanitizeText caps length at 300 characters", async () => {
    const long = "x".repeat(500);
    assert.strictEqual(sanitizeText(long).length, 300);
  });

  await check("sanitizeText rejects non-string input without throwing", async () => {
    assert.strictEqual(sanitizeText(null), "");
    assert.strictEqual(sanitizeText(undefined), "");
    assert.strictEqual(sanitizeText(42), "");
    assert.strictEqual(sanitizeText({ evil: true }), "");
  });

  await check("sanitizeStringList filters junk and caps list length", async () => {
    const cleaned = sanitizeStringList(["a", "", null, 42, "<b>b</b>", "c"], 2);
    assert.deepStrictEqual(cleaned, ["a", "b"]);
  });

  /* ---------------- sanitizePlan (malformed AI response defense) ---------------- */

  await check("sanitizePlan rejects a response with no subtasks array", async () => {
    assert.strictEqual(sanitizePlan({ subtasks: "not an array" }), null);
    assert.strictEqual(sanitizePlan(null), null);
    assert.strictEqual(sanitizePlan("just a string"), null);
  });

  await check("sanitizePlan rejects a response with fewer than 3 valid subtasks", async () => {
    const result = sanitizePlan({ subtasks: [{ title: "Only one" }] });
    assert.strictEqual(result, null);
  });

  await check("sanitizePlan accepts a well-formed response and coerces bad fields", async () => {
    const result = sanitizePlan({
      domain: "auth",
      subtasks: [
        { title: "Step 1", difficulty: "HIGH", estimatedHours: 3, dependsOnIndex: null },
        { title: "Step 2", difficulty: "NOT_A_REAL_LEVEL", estimatedHours: "not a number", dependsOnIndex: 0 },
        { title: "Step 3", difficulty: "LOW", estimatedHours: 999999, dependsOnIndex: 1 },
      ],
      acceptanceCriteria: ["Works", "<img onerror=alert(1)>Also works"],
      testingChecklist: ["Verify: works"],
      estimatedDifficulty: "HIGH",
      estimatedTotalEffort: "6-10 hours (AI estimate)",
    });
    assert.strictEqual(result.subtasks.length, 3);
    assert.strictEqual(result.subtasks[1].difficulty, "MEDIUM", "invalid difficulty must be coerced to MEDIUM");
    assert.strictEqual(result.subtasks[1].estimatedHours, null, "non-numeric hours must become null, not NaN");
    assert.strictEqual(result.subtasks[2].estimatedHours, 200, "hours must be clamped to a sane ceiling");
    assert.strictEqual(result.acceptanceCriteria[1], "Also works", "HTML-like content must be stripped");
  });

  await check("sanitizePlan strips a dependsOnIndex that points forward or out of range", async () => {
    const result = sanitizePlan({
      subtasks: [
        { title: "A", dependsOnIndex: 5 }, // forward/out-of-range reference on the FIRST subtask
        { title: "B", dependsOnIndex: 0 },
        { title: "C", dependsOnIndex: 99 }, // out of range
      ],
    });
    assert.strictEqual(result.subtasks[0].dependsOnIndex, null, "must never accept a forward/out-of-range dependency");
    assert.strictEqual(result.subtasks[1].dependsOnIndex, 0, "a valid backward reference must be kept");
    assert.strictEqual(result.subtasks[2].dependsOnIndex, null, "an out-of-range dependency must be dropped, not clamped");
  });

  await check("sanitizePlan never reads an assignee/student ID off the AI response", async () => {
    const result = sanitizePlan({
      subtasks: [{ title: "A" }, { title: "B" }, { title: "C" }],
      assigneeId: "attacker-controlled-id",
      recommendedAssignee: { id: "attacker-controlled-id" },
    });
    assert.ok(!("assigneeId" in result));
    assert.ok(!("recommendedAssignee" in result));
  });

  /* ---------------- fallback plan (AI engine unavailable) ---------------- */

  await check("AI engine unavailable: falls back to a safe, deterministic plan (real, not mocked)", async () => {
    // No Flask server is listening in this environment (verified with curl
    // before running this suite), so this genuinely exercises the offline path.
    const plan = await generateSubtaskPlan({ title: "Login page" });
    assert.ok(plan.subtasks.length >= 3, "fallback must still produce a usable subtask count");
    assert.strictEqual(plan.estimatedDifficulty, "UNKNOWN");
    assert.strictEqual(plan.estimatedTotalEffort, null, "fallback must never fabricate a specific effort figure");
  });

  await check("empty title never crashes plan generation, falls back cleanly", async () => {
    const plan = await generateSubtaskPlan({ title: "" });
    assert.ok(Array.isArray(plan.subtasks) && plan.subtasks.length >= 3);
  });

  await check("fallbackPlan() never invents technology/specifics beyond the given title", async () => {
    const plan = fallbackPlan("Refactor the widget loader");
    const text = JSON.stringify(plan).toLowerCase();
    assert.ok(text.includes("refactor the widget loader"));
    for (const forbidden of ["kubernetes", "graphql", "react native", "stripe"]) {
      assert.ok(!text.includes(forbidden), `must not invent unrelated technology: ${forbidden}`);
    }
  });

  /* ---------------- priority / deadline-buffer reasoning ---------------- */

  await check("suggested priority: an imminent deadline raises priority with a transparent reason", () => {
    const soon = new Date(Date.now() + 1 * 86400000);
    const { priority, reasons } = computeSuggestedPriority({ due: soon, teamRisk: null, evidence: null, blockingOpenDependencyCount: 0 });
    assert.strictEqual(priority, "high");
    assert.ok(reasons.some((r) => r.includes("Due within 2 days")));
  });

  await check("suggested priority: CRITICAL team risk alone pushes priority up with a stated reason", () => {
    const { priority, reasons } = computeSuggestedPriority({
      due: null,
      teamRisk: { riskLevel: "CRITICAL" },
      evidence: null,
      blockingOpenDependencyCount: 0,
    });
    assert.strictEqual(priority, "high");
    assert.ok(reasons.some((r) => r.toLowerCase().includes("critical")));
  });

  await check("suggested priority: combined deadline + risk + overdue signals reach CRITICAL", () => {
    const soon = new Date(Date.now() + 1 * 86400000);
    const { priority } = computeSuggestedPriority({
      due: soon,
      teamRisk: { riskLevel: "CRITICAL" },
      evidence: { tasks: { overdue: 2, dueSoonNoProgress: 1 } },
      blockingOpenDependencyCount: 1,
    });
    assert.strictEqual(priority, "critical");
  });

  await check("suggested priority: a real, existing task dependency is used as a reason (never fabricated)", () => {
    const { reasons } = computeSuggestedPriority({ due: null, teamRisk: null, evidence: null, blockingOpenDependencyCount: 2 });
    assert.ok(reasons.some((r) => r.includes("2 task(s) are waiting")));
  });

  await check("suggested priority: with no signals at all, defaults to LOW with an honest reason (never fabricated)", () => {
    const { priority, reasons } = computeSuggestedPriority({ due: null, teamRisk: null, evidence: null, blockingOpenDependencyCount: 0 });
    assert.strictEqual(priority, "low");
    assert.strictEqual(reasons.length, 1);
    assert.ok(reasons[0].includes("No elevated"));
  });

  await check("deadline buffer: high group risk recommends extra days with a reason", () => {
    const { days, reasons } = computeDeadlineBufferDays({ teamRisk: { riskLevel: "HIGH" }, evidence: null });
    assert.strictEqual(days, 2);
    assert.ok(reasons[0].includes("risk is high"));
  });

  await check("deadline buffer: no risk/workload signals recommends 0 days with an honest reason", () => {
    const { days, reasons } = computeDeadlineBufferDays({ teamRisk: { riskLevel: "LOW" }, evidence: { tasks: { stalled: 0 } } });
    assert.strictEqual(days, 0);
    assert.ok(reasons[0].includes("No workload/risk"));
  });

  /* ---------------- structural: authorization / no-trust-AI-for-IDs ---------------- */

  await check("authorization: all three Step 18 controller endpoints reuse the existing guide/leader check (no new auth logic)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "controllers", "taskController.js"), "utf8");
    const planSection = src.slice(src.indexOf("exports.generateTaskPlan"), src.indexOf("exports.stats"));
    const occurrences = planSection.match(/canRequestRecommendation\(/g) || [];
    assert.strictEqual(occurrences.length, 3, "generateTaskPlan, generateTaskPlanForTask, and applyTaskPlan must each check canRequestRecommendation");
  });

  await check("applyTaskPlan re-sanitizes client-submitted content rather than trusting it", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "controllers", "taskController.js"), "utf8");
    const applySection = src.slice(src.indexOf("exports.applyTaskPlan"), src.indexOf("exports.stats"));
    assert.ok(applySection.includes("sanitizeText("), "applyTaskPlan must sanitize submitted text");
    assert.ok(applySection.includes("sanitizeStringList("), "applyTaskPlan must sanitize submitted lists");
  });

  await check("taskPlanService never reads a student/assignee ID off the AI engine's response", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "services", "taskPlanService.js"), "utf8");
    // The only place an assignee ID is ever produced is getRecommendation()
    // (Step 17's own, already-tested, DB-backed scorer) — never `data.*`
    // (the raw engine response variable used throughout sanitizePlan/fallbackPlan).
    assert.ok(!/data\.assignee/i.test(src));
    assert.ok(!/data\.studentId/i.test(src));
    assert.ok(!/data\.recommendedAssignee/i.test(src));
    assert.ok(src.includes("getRecommendation("), "the recommended assignee must come from the existing, real scorer");
  });

  console.log(`\n${passed} passed`);
})();
