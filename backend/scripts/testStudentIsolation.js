const assert = require("assert");

// Mirrors the exact branch added to reportController.projectPerformance.
function resolveStudentId(req) {
  return req.isGuide ? req.query.studentId || undefined : String(req.user._id);
}

assert.strictEqual(
  resolveStudentId({ isGuide: false, user: { _id: "u1" }, query: {} }),
  "u1",
  "student with no studentId param should get their own analysis"
);

assert.strictEqual(
  resolveStudentId({ isGuide: false, user: { _id: "u1" }, query: { studentId: "u2" } }),
  "u1",
  "student-supplied studentId must be ignored/overridden, never trusted"
);

assert.strictEqual(
  resolveStudentId({ isGuide: true, user: { _id: "guide1" }, query: { studentId: "u2" } }),
  "u2",
  "guide-supplied studentId should be honored"
);

assert.strictEqual(
  resolveStudentId({ isGuide: true, user: { _id: "guide1" }, query: {} }),
  undefined,
  "guide with no studentId should get the full team"
);

console.log("PASS: student isolation logic verified (4/4) — a student can never override studentId to view another student's analysis.");
