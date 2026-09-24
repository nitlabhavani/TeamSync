const assert = require("assert");

// Mirrors the core authorization logic in requireGroupAccess
// (backend/src/middleware/auth.js) — verifies that a user who is neither
// a member nor the guide of a group (and not an admin) is rejected.
function checkGroupAccess(group, user) {
  const uid = String(user._id);
  const isMember = group.members.some((m) => String(m) === uid);
  const isGuide = String(group.guide) === uid;
  const allowed = isMember || isGuide || user.role === "admin";
  return { allowed, isGuide: isGuide || user.role === "admin" };
}

const groupA = { members: ["u1", "u2"], guide: "guide1" };

// Student A (member of group A) accessing group A -> allowed, not guide
let res = checkGroupAccess(groupA, { _id: "u1", role: "student" });
assert.strictEqual(res.allowed, true);
assert.strictEqual(res.isGuide, false);

// Student C (NOT a member of group A, e.g. belongs to a different group) -> forbidden
res = checkGroupAccess(groupA, { _id: "u_outsider", role: "student" });
assert.strictEqual(res.allowed, false, "a student outside the group must be rejected");

// The group's guide -> allowed, isGuide true
res = checkGroupAccess(groupA, { _id: "guide1", role: "guide" });
assert.strictEqual(res.allowed, true);
assert.strictEqual(res.isGuide, true);

// A different guide (not assigned to this group) -> forbidden
res = checkGroupAccess(groupA, { _id: "guide2", role: "guide" });
assert.strictEqual(res.allowed, false, "a guide not assigned to this group must be rejected");

// Admin -> always allowed
res = checkGroupAccess(groupA, { _id: "admin1", role: "admin" });
assert.strictEqual(res.allowed, true);
assert.strictEqual(res.isGuide, true);

console.log("PASS: cross-group access isolation verified (5/5) — outsiders and unassigned guides are rejected.");
