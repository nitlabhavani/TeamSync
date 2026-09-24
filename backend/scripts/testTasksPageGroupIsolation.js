/**
 * Step 3 — Student Tasks page: group isolation + AI-chat task visibility test.
 *
 * DB-free (no live MongoDB needed), same mocking approach as
 * testGroupAccessIsolation.js / testSameNameGroupIsolation.js: this
 * replicates the exact filter-building logic used by
 * backend/src/controllers/taskController.js#list against an in-memory
 * Task array, so it exercises the real scoping rules without a database.
 *
 * Covers the Step 3 spec:
 *   - GET /groups/:groupId/tasks scopes strictly by the group's ObjectId
 *     (never by name), so two groups sharing a name never leak tasks.
 *   - source = "ai_chat" tasks are returned like any other task (never
 *     filtered out).
 *   - A student only sees tasks assigned to them within the active group;
 *     a guide / team leader sees every task in the group.
 *
 * Run: node backend/scripts/testTasksPageGroupIsolation.js
 */
const assert = require("assert");

// ---- Mirrors taskController.list's filter construction exactly ----------
function buildListFilter({ groupId, query = {}, user, isGuide }) {
  const filter = { group: groupId };
  if (query.status) filter.status = query.status;
  if (query.assignee) filter.assignee = query.assignee;
  if (query.priority) filter.priority = query.priority;
  if (user.role === "student" && !isGuide) {
    filter.assignee = user._id;
  }
  return filter;
}

// ---- Fake Task collection + matcher (Mongo-like exact field match) ------
function matches(t, filter) {
  return Object.entries(filter).every(([k, v]) => String(t[k]) === String(v));
}
function findTasks(tasks, filter) {
  return tasks.filter((t) => matches(t, filter));
}

// ---- Fixture: two groups that share the literal name "Team Vision" ------
const GROUP_A = { _id: "A", name: "Team Vision" };
const GROUP_B = { _id: "B", name: "Team Vision" };

const BHAVANI_A = "a_bhavani";
const BHAVANI_B = "b_bhavani";
const GUIDE = "guide1";

const tasks = [
  {
    _id: "t1",
    title: "Frontend Login",
    group: GROUP_A._id,
    assignee: BHAVANI_A,
    createdBy: GUIDE,
    source: "ai_chat",
    sourceMessageId: "m1",
    status: "pending",
  },
  {
    _id: "t2",
    title: "Backend API",
    group: GROUP_B._id,
    assignee: BHAVANI_B,
    createdBy: GUIDE,
    source: "ai_chat",
    sourceMessageId: "m2",
    status: "pending",
  },
  {
    _id: "t3",
    title: "Manual cleanup task",
    group: GROUP_A._id,
    assignee: BHAVANI_A,
    createdBy: GUIDE,
    source: "manual",
    status: "todo",
  },
  {
    _id: "t4",
    title: "AI project-plan task",
    group: GROUP_A._id,
    assignee: BHAVANI_A,
    createdBy: GUIDE,
    source: "ai",
    status: "todo",
  },
];

// 1. Fetching Group A by its exact id must return only Group A's tasks,
//    even though Group B shares the same name.
let res = findTasks(
  tasks,
  buildListFilter({ groupId: GROUP_A._id, user: { _id: BHAVANI_A, role: "student" }, isGuide: false })
);
assert.strictEqual(res.length, 3, "Group A's student should see exactly their 3 tasks in Group A");
assert.ok(
  res.every((t) => t.group === GROUP_A._id),
  "no task from Group B must leak into Group A's results"
);
assert.ok(
  res.some((t) => t.title === "Frontend Login"),
  "the ai_chat task assigned in Group A must be visible"
);
assert.ok(
  !res.some((t) => t.title === "Backend API"),
  "Group B's task must never be visible while viewing Group A"
);
console.log("ok - fetching by exact group id returns only that group's tasks (never by name)");

// 2. Same-name group isolation, mirrored for Group B.
res = findTasks(
  tasks,
  buildListFilter({ groupId: GROUP_B._id, user: { _id: BHAVANI_B, role: "student" }, isGuide: false })
);
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].title, "Backend API");
console.log("ok - Group B (same name as Group A) sees only its own task");

// 3. source = "ai_chat" is never filtered out — all three source types
//    ("manual", "ai", "ai_chat") come back for the assignee.
res = findTasks(
  tasks,
  buildListFilter({ groupId: GROUP_A._id, user: { _id: BHAVANI_A, role: "student" }, isGuide: false })
);
const sources = res.map((t) => t.source).sort();
assert.deepStrictEqual(sources, ["ai", "ai_chat", "manual"]);
console.log('ok - "manual", "ai" and "ai_chat" tasks are all returned (no source filtering)');

// 4. A guide/team leader viewing the group sees every task, not just their own.
res = findTasks(tasks, buildListFilter({ groupId: GROUP_A._id, user: { _id: GUIDE, role: "guide" }, isGuide: true }));
assert.strictEqual(res.length, 3, "the guide should see all of Group A's tasks");
console.log("ok - guide/team leader sees the full group task list");

// 5. A student who is a member of Group A can never see a task by passing
//    Group B's id with Group A's assignee id — isolation is by the task's
//    own `group` field, not by who is asking.
res = findTasks(
  tasks,
  buildListFilter({ groupId: GROUP_B._id, user: { _id: BHAVANI_A, role: "student" }, isGuide: false })
);
assert.strictEqual(res.length, 0, "Group A's student querying Group B's id must see nothing of theirs");
console.log("ok - cross-group id/assignee combination returns no results");

console.log("\n5 test(s) passed.");
