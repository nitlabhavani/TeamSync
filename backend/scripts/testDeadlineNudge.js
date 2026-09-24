/**
 * STEP 16 — Feature 2 tests: proactive deadline early warning.
 * No DB / server needed — exercises the pure classifyEarlyWarning() /
 * estimateProgress() functions directly with hand-built task objects.
 *
 * Run: node backend/scripts/testDeadlineNudge.js
 */
const assert = require("assert");
const { classifyEarlyWarning, estimateProgress } = require("../src/services/deadlineNudgeService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-08-31T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW - n * DAY);
const daysFromNow = (n) => new Date(NOW.getTime() + n * DAY);

function baseTask(overrides = {}) {
  return {
    title: "Implement authentication",
    status: "in_progress",
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    due: daysFromNow(5),
    submissions: [],
    ...overrides,
  };
}

check("1. on-track task", () => {
  // Created 10 days before a 15-day-total window, 5 days left => elapsed
  // ratio ~67%. Give it matching progress via a submission so gap is small.
  const task = baseTask({
    submissions: [{ aiAnalysis: { progress: 65 } }],
  });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result.level, "ON_TRACK");
});

check("2. approaching deadline", () => {
  const task = baseTask({ submissions: [{ aiAnalysis: { progress: 45 } }] });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result.level, "DEADLINE_APPROACHING");
  assert.ok(result.reason.includes("progress"));
});

check("3. at-risk task (spec example: 20% progress, 5 days remaining)", () => {
  const task = baseTask({ submissions: [{ aiAnalysis: { progress: 20 } }] });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result.level, "AT_RISK");
  assert.strictEqual(result.severity, "HIGH");
  assert.ok(result.reason.includes("20%"));
  assert.ok(result.reason.includes("5 day"));
});

check("4. overdue task returns null (existing overdue logic owns this)", () => {
  const task = baseTask({ due: daysAgo(1), submissions: [{ aiAnalysis: { progress: 10 } }] });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result, null);
});

check("5. stalled task", () => {
  const task = baseTask({
    updatedAt: daysAgo(6),
    submissions: [{ aiAnalysis: { progress: 60 } }], // otherwise fine on pace
  });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result.level, "AT_RISK");
  assert.ok(result.reason.toLowerCase().includes("no progress update"));
});

check("6. sufficient progress never flagged", () => {
  const task = baseTask({ submissions: [{ aiAnalysis: { progress: 95 } }] });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result.level, "ON_TRACK");
});

check("7. insufficient progress flagged", () => {
  const task = baseTask({ submissions: [{ aiAnalysis: { progress: 5 } }] });
  const result = classifyEarlyWarning(task, NOW);
  assert.notStrictEqual(result.level, "ON_TRACK");
});

check("8. done task never flagged, even with a due date in the past window", () => {
  const task = baseTask({ status: "done", submissions: [{ aiAnalysis: { progress: 100 } }] });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result, null);
});

check("9. no due date -> nothing to warn about", () => {
  const task = baseTask({ due: null });
  const result = classifyEarlyWarning(task, NOW);
  assert.strictEqual(result, null);
});

check("10. estimateProgress falls back to status map when no submission data", () => {
  assert.strictEqual(estimateProgress(baseTask({ status: "todo", submissions: [] })), 0);
  assert.strictEqual(estimateProgress(baseTask({ status: "in_progress", submissions: [] })), 35);
  assert.strictEqual(estimateProgress(baseTask({ status: "done", submissions: [] })), 100);
});

check("existing overdue behavior is untouched (separate scan owns overdue)", () => {
  // This module's task-save path only ever writes task.earlyWarning — it
  // never assigns to the existing remindersSent/overdueNotifiedAt fields
  // that deadlineService.js's own overdue/reminder scan owns.
  const src = require("fs").readFileSync(require.resolve("../src/services/deadlineNudgeService"), "utf8");
  assert.ok(!/task\.remindersSent\s*=/.test(src));
  assert.ok(!/task\.overdueNotifiedAt\s*=/.test(src));
});

console.log(`\n${passed} passed`);
