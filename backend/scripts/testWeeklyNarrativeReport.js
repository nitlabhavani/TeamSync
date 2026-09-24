/**
 * Standalone tests for Step 14 — AI Weekly Narrative Report.
 * Pure-function tests only (no DB/server needed) against
 * reportService.buildWeeklyNarrative / summarizeSubmissions, the same
 * pattern as testTaskSubmissionAnalysis.js / testPlagiarismAnalyzer.js.
 *
 * Run: node backend/scripts/testWeeklyNarrativeReport.js
 */
const assert = require("assert");
const { buildWeeklyNarrative, summarizeSubmissions } = require("../src/services/reportService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const baseGroup = { id: "g1", name: "Team Nimbus", project: "TeamSync AI" };

function baseSnapshot(overrides = {}) {
  return {
    group: baseGroup,
    students: [
      { userId: "u1", name: "Ramya", overall: 82, overdue: 0, messages: 12, filesShared: 2 },
      { userId: "u2", name: "Bhavani", overall: 40, overdue: 1, messages: 2, filesShared: 0 },
    ],
    collaborationScore: 60,
    delayedTasks: [],
    pendingTasks: [],
    completedTasks: 3,
    totalTasks: 4,
    prediction: { completion: 78, onTrack: true, velocityPerWeek: 1.2 },
    submissionStats: summarizeSubmissions([]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------

check("Test 1: normal weekly report produces a summary built only from given data", () => {
  const n = buildWeeklyNarrative(baseSnapshot());
  assert.strictEqual(n.period, "weekly");
  assert.ok(n.summary.includes("Team Nimbus"));
  assert.ok(n.summary.includes("78%"));
  assert.ok(Array.isArray(n.highlights));
  assert.ok(Array.isArray(n.concerns));
  assert.ok(Array.isArray(n.recommendations) && n.recommendations.length > 0);
  assert.ok(["improving", "declining", "steady", "insufficient_data"].includes(n.teamTrend));
});

check("Test 2: improving team -> teamTrend 'improving' and an upward highlight", () => {
  const current = baseSnapshot({ prediction: { completion: 78 }, collaborationScore: 60 });
  const previous = { prediction: { completion: 60 }, collaborationScore: 50 };
  const n = buildWeeklyNarrative(current, previous);
  assert.strictEqual(n.teamTrend, "improving");
  assert.ok(n.highlights.some((h) => /improved/i.test(h)));
});

check("Test 3: declining team -> teamTrend 'declining' and a concern is raised", () => {
  const current = baseSnapshot({ prediction: { completion: 40 }, collaborationScore: 45 });
  const previous = { prediction: { completion: 60 }, collaborationScore: 55 };
  const n = buildWeeklyNarrative(current, previous);
  assert.strictEqual(n.teamTrend, "declining");
  assert.ok(n.concerns.some((c) => /declined/i.test(c)));
});

check("Test 4: overdue tasks are surfaced as a concern and a recommendation, with the real count", () => {
  const n = buildWeeklyNarrative(
    baseSnapshot({ delayedTasks: [{ id: "t1", title: "API docs" }, { id: "t2", title: "Login UI" }] })
  );
  assert.ok(n.concerns.some((c) => c.includes("2 task(s) are overdue")));
  assert.ok(n.recommendations.includes("Follow up on overdue tasks."));
  assert.ok(n.summary.includes("2 assignments remain overdue"));
});

check("Test 5: submissions awaiting guide review are surfaced without inventing which ones", () => {
  const stats = summarizeSubmissions([
    { status: "guide_review", submissions: [{ student: "u1", verdict: "", aiAnalysis: { implementationStatus: "VALID_SUBMISSION" } }] },
  ]);
  const n = buildWeeklyNarrative(baseSnapshot({ submissionStats: stats }));
  assert.ok(n.concerns.some((c) => c.includes("1 submission(s) are awaiting guide review")));
  assert.ok(n.recommendations.includes("Review pending submissions."));
});

check("Test 6: similarity/plagiarism warnings are surfaced as a concern + recommendation", () => {
  const stats = summarizeSubmissions([
    {
      status: "guide_review",
      submissions: [
        {
          student: "u1",
          verdict: "",
          aiAnalysis: { implementationStatus: "VALID_SUBMISSION", plagiarism: { detected: true, severity: "HIGH" } },
        },
      ],
    },
  ]);
  const n = buildWeeklyNarrative(baseSnapshot({ submissionStats: stats }));
  assert.ok(n.concerns.some((c) => /similarity\/originality warning/.test(c)));
  assert.ok(n.recommendations.some((r) => /flagged similarity/.test(r)));
});

check("Test 7: no activity / insufficient data -> teamTrend 'insufficient_data', no fabricated highlights", () => {
  const empty = baseSnapshot({
    students: [{ userId: "u1", name: "Ramya", overall: 0, overdue: 0, messages: 0, filesShared: 0 }],
    totalTasks: 0,
    completedTasks: 0,
    delayedTasks: [],
    prediction: { completion: 0 },
  });
  const n = buildWeeklyNarrative(empty);
  assert.strictEqual(n.teamTrend, "insufficient_data");
  assert.deepStrictEqual(n.highlights, []);
  assert.deepStrictEqual(n.concerns, []);
});

check("Test 8: empty group (no members) does not throw and returns a safe default", () => {
  const empty = baseSnapshot({ students: [], totalTasks: 0, completedTasks: 0, prediction: { completion: 0 } });
  const n = buildWeeklyNarrative(empty);
  assert.strictEqual(n.teamTrend, "insufficient_data");
  assert.ok(typeof n.summary === "string" && n.summary.length > 0);
});

check("Test 9: missing optional metrics (no previous week) never throws and skips trend language", () => {
  const n = buildWeeklyNarrative(baseSnapshot(), null);
  assert.strictEqual(n.teamTrend, "steady");
  assert.ok(!n.summary.includes("from last week"));
});

check("Test 10: no invented student information — only students present in the snapshot are named", () => {
  const n = buildWeeklyNarrative(baseSnapshot());
  const mentionedNames = ["Ramya", "Bhavani"];
  const words = n.summary.match(/[A-Z][a-z]+/g) || [];
  const properNouns = new Set(words.filter((w) => w !== "Team" && w !== "Nimbus" && w !== "The"));
  for (const name of properNouns) {
    if (["Overall", "Collaboration"].includes(name)) continue;
    assert.ok(
      mentionedNames.includes(name) || name === "Nimbus",
      `narrative mentioned an unexpected name/word not derivable from input data: ${name}`
    );
  }
});

check("summarizeSubmissions never crashes on tasks with no submissions", () => {
  const stats = summarizeSubmissions([{ status: "todo", submissions: [] }, { status: "todo" }]);
  assert.strictEqual(stats.valid, 0);
  assert.strictEqual(stats.awaitingReview, 0);
});

check("summarizeSubmissions flags repeated changes_requested for the same student", () => {
  const stats = summarizeSubmissions([
    { status: "changes_requested", submissions: [{ student: "u2", verdict: "changes_requested", aiAnalysis: {} }] },
    { status: "changes_requested", submissions: [{ student: "u2", verdict: "changes_requested", aiAnalysis: {} }] },
  ]);
  assert.deepStrictEqual(stats.studentsWithRepeatedIssues, ["u2"]);
});

console.log(`\n${passed} test(s) passed (final).`);
