/**
 * Step 2 — Same-name group isolation test.
 *
 * Verifies that chatTaskService.processGroupMessageForTasks never confuses
 * two different groups that happen to share the same `name`. DB-free (no
 * live MongoDB needed), same mocking approach as
 * testChatTaskServiceIntegration.js — Task/User/aiEngineClient/
 * notificationService/groupController are faked in-process.
 *
 * Scenario (matches the Step 2 spec exactly):
 *   Group A: _id "A", name "Team Vision", members [Bhavani A, Pujitha]
 *   Group B: _id "B", name "Team Vision", members [Bhavani B, Ramya]
 *
 * A message "Bhavani, complete the frontend page." sent from Group A must
 * create a task with group === "A" and assignee === the Bhavani who
 * belongs to Group A — never Group B's Bhavani, even though both groups
 * have the identical name and both have a member literally named
 * "Bhavani".
 *
 * Run: node backend/scripts/testSameNameGroupIsolation.js
 */
const assert = require("assert");
const path = require("path");
const Module = require("module");

const resolve = (rel) => require.resolve(path.join(__dirname, "..", "src", "services", rel));

// ---- in-memory fake Task collection ----------------------------------
let tasks = [];
let nextId = 1;
const FakeTask = {
  async exists(query) {
    return tasks.some((t) => matches(t, query));
  },
  async create(input) {
    const doc = { _id: `t${nextId++}`, ...input };
    tasks.push(doc);
    return doc;
  },
};
function matches(t, query) {
  return Object.entries(query).every(([k, v]) => String(t[k]) === String(v));
}

// ---- two distinct rosters, both containing a user literally named
// "Bhavani" — this is the crux of the test: name collisions must never
// leak across groups, only the group's own `members` list may be searched.
const GROUP_A_USERS = [
  { _id: "a_bhavani", name: "Bhavani", email: "bhavani.a@x.com" },
  { _id: "a_pujitha", name: "Pujitha", email: "pujitha@x.com" },
];
const GROUP_B_USERS = [
  { _id: "b_bhavani", name: "Bhavani", email: "bhavani.b@x.com" },
  { _id: "b_ramya", name: "Ramya", email: "ramya@x.com" },
];
const ALL_USERS = [...GROUP_A_USERS, ...GROUP_B_USERS];

const FakeUser = {
  find(query) {
    const ids = (query._id && query._id.$in) || [];
    const found = ALL_USERS.filter((m) => ids.includes(m._id));
    return {
      select() {
        return this;
      },
      lean: async () => found,
    };
  },
};

// ---- fake AI engine client / notification / groupController ----------
let engineOkResult = null;
const FakeAiEngineClient = {
  async analyzeMessageTask() {
    return engineOkResult
      ? { ok: true, data: engineOkResult }
      : { ok: false, reason: "engine_offline_for_test" };
  },
};
let notifyCalls = [];
const FakeNotificationService = {
  async notifyUsers(userIds, payload, opts) {
    notifyCalls.push({ userIds, payload, opts });
    return [];
  },
};
let recalcCalls = [];
const FakeGroupController = {
  async recalcGroupProgress(groupId) {
    recalcCalls.push(groupId);
  },
};

function fakeModule(resolvedPath, exportsObj) {
  const m = new Module(resolvedPath, null);
  m.exports = exportsObj;
  m.loaded = true;
  require.cache[resolvedPath] = m;
}
fakeModule(resolve("../models/Task"), FakeTask);
fakeModule(resolve("../models/User"), FakeUser);
fakeModule(resolve("aiEngineClient"), FakeAiEngineClient);
fakeModule(resolve("notificationService"), FakeNotificationService);
fakeModule(resolve("../controllers/groupController"), FakeGroupController);

const { processGroupMessageForTasks } = require("../src/services/chatTaskService");

// ---- capture console.log for checkpoint assertions --------------------
let logs = [];
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
console.log = (...a) => {
  logs.push(a.join(" "));
};
console.warn = () => {};
console.error = () => {};

function reset() {
  tasks = [];
  notifyCalls = [];
  recalcCalls = [];
  logs = [];
  engineOkResult = null;
}

// Two different groups, SAME name, SAME leader-authorization shape, DIFFERENT ids/members.
const GROUP_A = { _id: "A", name: "Team Vision", leader: "a_pujitha", members: ["a_bhavani", "a_pujitha"] };
const GROUP_B = { _id: "B", name: "Team Vision", leader: "b_ramya", members: ["b_bhavani", "b_ramya"] };

const LEADER_A = { _id: "a_pujitha" };
const LEADER_B = { _id: "b_ramya" };

const candidateMessage = (text) => ({
  isTask: true,
  tasks: [{ assigneeName: "Bhavani", title: "Frontend Login Page", description: text, priority: "medium", dueDate: null }],
  unmatchedMentions: [],
  reason: null,
});

let passed = 0;
async function check(label, fn) {
  await fn();
  passed++;
  origLog(`ok - ${label}`);
}

(async () => {
  // 1. Message from Group A must create a task scoped to Group A, assigned
  //    to Group A's Bhavani — never Group B's.
  reset();
  engineOkResult = candidateMessage("Bhavani, complete the frontend page.");
  await processGroupMessageForTasks({
    message: { _id: "mA", text: "Bhavani, complete the frontend page." },
    group: GROUP_A,
    sender: LEADER_A,
    isGuide: false,
  });
  await check("message from Group A creates a task with group === A", async () => {
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(String(tasks[0].group), "A");
  });
  await check("Group A's task is assigned to Group A's Bhavani, not Group B's", async () => {
    assert.strictEqual(String(tasks[0].assignee), "a_bhavani");
    assert.notStrictEqual(String(tasks[0].assignee), "b_bhavani");
  });

  // 2. The identical message from Group B must independently create a task
  //    scoped to Group B, assigned to Group B's Bhavani.
  reset();
  engineOkResult = candidateMessage("Bhavani, complete the frontend page.");
  await processGroupMessageForTasks({
    message: { _id: "mB", text: "Bhavani, complete the frontend page." },
    group: GROUP_B,
    sender: LEADER_B,
    isGuide: false,
  });
  await check("the identical message from Group B creates a task with group === B", async () => {
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(String(tasks[0].group), "B");
  });
  await check("Group B's task is assigned to Group B's Bhavani, not Group A's", async () => {
    assert.strictEqual(String(tasks[0].assignee), "b_bhavani");
    assert.notStrictEqual(String(tasks[0].assignee), "a_bhavani");
  });

  // 3. Sequentially process both groups' messages together (as would
  //    happen in a real server handling concurrent chats) and confirm both
  //    tasks land in the correct group with zero cross-contamination.
  reset();
  engineOkResult = candidateMessage("Bhavani, complete the frontend page.");
  await processGroupMessageForTasks({
    message: { _id: "mA2", text: "Bhavani, complete the frontend page." },
    group: GROUP_A,
    sender: LEADER_A,
    isGuide: false,
  });
  await processGroupMessageForTasks({
    message: { _id: "mB2", text: "Bhavani, complete the frontend page." },
    group: GROUP_B,
    sender: LEADER_B,
    isGuide: false,
  });
  await check("both same-name groups end up with exactly one correctly-scoped task each", async () => {
    assert.strictEqual(tasks.length, 2);
    const taskA = tasks.find((t) => String(t.group) === "A");
    const taskB = tasks.find((t) => String(t.group) === "B");
    assert.ok(taskA, "Group A task missing");
    assert.ok(taskB, "Group B task missing");
    assert.strictEqual(String(taskA.assignee), "a_bhavani");
    assert.strictEqual(String(taskB.assignee), "b_bhavani");
    assert.notStrictEqual(String(taskA.assignee), String(taskB.assignee));
  });

  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
  origLog(`\n${passed} test(s) passed.`);
})().catch((err) => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
  console.error("FAILED:", err);
  process.exit(1);
});
