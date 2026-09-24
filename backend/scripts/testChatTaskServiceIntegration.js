/**
 * Integration-style test for chatTaskService.processGroupMessageForTasks,
 * with Task/User/notificationService/groupController mocked (no live
 * MongoDB needed — this sandbox has no reachable Mongo instance).
 * Verifies: authorization rule, duplicate protection, AI-result handling,
 * assignee resolution, task creation payload, notification firing, and
 * the required "[chat-task] ..." debug checkpoints.
 *
 * Run: node backend/scripts/testChatTaskServiceIntegration.js
 */
const assert = require("assert");
const path = require("path");
const Module = require("module");

const resolve = (rel) => require.resolve(path.join(__dirname, "..", "src", "services", rel));

// ---- in-memory fake Task collection ---------------------------------
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

// ---- in-memory fake User collection ---------------------------------
const GROUP_MEMBERS = [
  { _id: "u_bhavani", name: "Bhavani Nitla", email: "bhavani@x.com" },
  { _id: "u_ramya", name: "Ramya Rao", email: "ramya@x.com" },
];
const FakeUser = {
  find(query) {
    const ids = (query._id && query._id.$in) || [];
    const found = GROUP_MEMBERS.filter((m) => ids.includes(m._id));
    return {
      select() { return this; },
      lean: async () => found,
    };
  },
};

// ---- fake AI engine client / notification / groupController ---------
let engineOkResult = null; // set per test
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

// ---- inject fakes into require cache BEFORE chatTaskService loads ---
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

// ---- capture console.log for checkpoint assertions -------------------
let logs = [];
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
console.log = (...a) => { logs.push(a.join(" ")); };
console.warn = () => {};
console.error = () => {};

function reset() {
  tasks = [];
  notifyCalls = [];
  recalcCalls = [];
  logs = [];
  engineOkResult = null;
}

const GROUP = { _id: "g1", leader: "u_leader", members: ["u_bhavani", "u_ramya", "u_leader"] };
const GUIDE_SENDER = { _id: "u_guide" };
const LEADER_SENDER = { _id: "u_leader" };
const STUDENT_SENDER = { _id: "u_ramya" }; // ordinary member, not leader/guide
const NON_MEMBER_SENDER = { _id: "u_outsider" }; // not in GROUP.members, not leader/guide

let passed = 0;
async function check(label, fn) {
  await fn();
  passed++;
  console.log !== origLog ? null : null;
  origLog(`ok - ${label}`);
}

(async () => {
  // 1. Ordinary student sender CANNOT create tasks through chat (Part 1 & 3 & 16.8).
  reset();
  engineOkResult = {
    isTask: true,
    tasks: [{ assigneeName: "Bhavani", title: "Frontend Login Page", description: "x", priority: "medium", dueDate: null }],
    unmatchedMentions: [],
    reason: null,
  };
  await processGroupMessageForTasks({
    message: { _id: "m1", text: "Bhavani, complete the frontend login page." },
    group: GROUP,
    sender: STUDENT_SENDER,
    isGuide: false,
  });
  await check("ordinary student chat cannot create tasks", async () => {
    assert.strictEqual(tasks.length, 0);
    assert.strictEqual(
      logs.some((l) => l.includes("[chat-task] isLeader: false") && l.includes("[chat-task] authorized: false")),
      true
    );
  });

  // 1a. Team Leader sender IS authorized and creates a task.
  reset();
  await processGroupMessageForTasks({
    message: { _id: "m1_leader", text: "Bhavani, complete the frontend login page." },
    group: GROUP,
    sender: LEADER_SENDER,
    isGuide: false,
  });
  await check("team leader sender is authorized and creates a task", async () => {
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(
      logs.some((l) => l.includes("[chat-task] isLeader: true") && l.includes("[chat-task] authorized: true")),
      true
    );
  });

  // 1b. Sender who is NOT a member of this group (and not guide/leader) is
  // rejected, even though they are a valid authenticated user in general.
  reset();
  engineOkResult = {
    isTask: true,
    tasks: [{ assigneeName: "Bhavani", title: "Frontend Login Page", description: "x", priority: "medium", dueDate: null }],
    unmatchedMentions: [],
    reason: null,
  };
  await processGroupMessageForTasks({
    message: { _id: "m1b", text: "Bhavani, complete the frontend login page." },
    group: GROUP,
    sender: NON_MEMBER_SENDER,
    isGuide: false,
  });
  await check("non-member sender never creates a task", async () => {
    assert.strictEqual(tasks.length, 0);
    assert.strictEqual(logs.some((l) => l.startsWith("[chat-task] groupId:")), false);
    assert.strictEqual(
      logs.some((l) => l.includes("[chat-task] isGroupMember: false") && l.includes("[chat-task] authorized: false")),
      true
    );
  });

  // 2. Guide sender + valid assignment -> task created with correct fields.
  reset();
  engineOkResult = {
    isTask: true,
    tasks: [{ assigneeName: "Bhavani", title: "Frontend Login Page", description: "Complete it.", priority: "medium", dueDate: "2026-08-25" }],
    unmatchedMentions: [],
    reason: null,
  };
  await processGroupMessageForTasks({
    message: { _id: "m2", text: "Bhavani, complete the frontend login page by August 25." },
    group: GROUP,
    sender: GUIDE_SENDER,
    isGuide: true,
  });
  await check("valid guide-sent assignment creates exactly one task with correct fields", async () => {
    assert.strictEqual(tasks.length, 1);
    const t = tasks[0];
    assert.strictEqual(String(t.group), "g1");
    assert.strictEqual(String(t.assignee), "u_bhavani");
    assert.strictEqual(String(t.createdBy), "u_guide");
    assert.strictEqual(t.source, "ai_chat");
    assert.strictEqual(String(t.sourceMessageId), "m2");
    assert.strictEqual(notifyCalls.length, 1);
    assert.strictEqual(String(notifyCalls[0].userIds[0]), "u_bhavani");
    assert.strictEqual(recalcCalls.length, 1);
  });

  await check("all 5 required debug checkpoints are logged, in order", async () => {
    const tags = ["[chat-task] groupId:", "[chat-task] AI result:", "[chat-task] resolved assignee:", "[chat-task] creating task:", "[chat-task] task created:"];
    let cursor = -1;
    tags.forEach((tag) => {
      const idx = logs.findIndex((l, i) => i > cursor && l.startsWith(tag));
      assert.ok(idx > cursor, `missing/out-of-order checkpoint: ${tag}`);
      cursor = idx;
    });
  });

  // 3. Team leader (non-guide) sender is also authorized.
  reset();
  engineOkResult = {
    isTask: true,
    tasks: [{ assigneeName: "Bhavani", title: "X", description: "x", priority: "medium", dueDate: null }],
    unmatchedMentions: [],
    reason: null,
  };
  await processGroupMessageForTasks({
    message: { _id: "m3", text: "Bhavani, complete X." },
    group: GROUP,
    sender: LEADER_SENDER,
    isGuide: false,
  });
  await check("team leader sender is authorized to trigger task creation", async () => {
    assert.strictEqual(tasks.length, 1);
  });

  // 4. Duplicate message never creates a second task.
  reset();
  engineOkResult = {
    isTask: true,
    tasks: [{ assigneeName: "Bhavani", title: "X", description: "x", priority: "medium", dueDate: null }],
    unmatchedMentions: [],
    reason: null,
  };
  const dupMsg = { _id: "m4", text: "Bhavani, complete X." };
  await processGroupMessageForTasks({ message: dupMsg, group: GROUP, sender: GUIDE_SENDER, isGuide: true });
  await processGroupMessageForTasks({ message: dupMsg, group: GROUP, sender: GUIDE_SENDER, isGuide: true });
  await check("processing the same message twice creates only one task", async () => {
    assert.strictEqual(tasks.length, 1);
  });

  // 5. Non-member name ("Rahul") never creates a task.
  reset();
  engineOkResult = {
    isTask: false,
    tasks: [],
    unmatchedMentions: [{ name: "Rahul", reason: "not_a_member_of_this_group" }],
    reason: "no_recognized_group_member_in_any_assignment",
  };
  await processGroupMessageForTasks({
    message: { _id: "m5", text: "Rahul, complete the frontend page." },
    group: GROUP,
    sender: GUIDE_SENDER,
    isGuide: true,
  });
  await check("a name that is not a group member never creates a task", async () => {
    assert.strictEqual(tasks.length, 0);
  });

  // 6. Ambiguous name never creates a task (never guesses).
  reset();
  engineOkResult = {
    isTask: false,
    tasks: [],
    unmatchedMentions: [{ name: "Sam", reason: "ambiguous_name_multiple_members_match" }],
    reason: "no_recognized_group_member_in_any_assignment",
  };
  await processGroupMessageForTasks({
    message: { _id: "m6", text: "Sam, complete the backend." },
    group: GROUP,
    sender: GUIDE_SENDER,
    isGuide: true,
  });
  await check("an ambiguous name never creates a task", async () => {
    assert.strictEqual(tasks.length, 0);
  });

  // 7. Non-task discussion message never creates a task.
  reset();
  engineOkResult = { isTask: false, tasks: [], unmatchedMentions: [], reason: "no_actionable_assignment_found" };
  await processGroupMessageForTasks({
    message: { _id: "m7", text: "Should we work on the login page?" },
    group: GROUP,
    sender: GUIDE_SENDER,
    isGuide: true,
  });
  await check("a discussion-style message never creates a task", async () => {
    assert.strictEqual(tasks.length, 0);
  });

  // 8. Team leader sends project title and description -> AI decomposes and assigns tasks across team members.
  reset();
  const leaderMessageText =
    "Project Title: Healthcare AI Assistant\n" +
    "Description:\n" +
    "1. Setup backend API and FHIR database schema\n" +
    "2. Develop doctor appointment booking module\n" +
    "3. Integrate symptom checker AI model";
  await processGroupMessageForTasks({
    message: { _id: "m8_proj", text: leaderMessageText },
    group: GROUP,
    sender: LEADER_SENDER,
    isGuide: false,
  });
  await check("team leader sending project title and description causes AI to assign tasks to team members", async () => {
    assert.strictEqual(tasks.length, 3);
    // Tasks must be assigned to real group members
    assert.ok(tasks.every((t) => t.assignee === "u_bhavani" || t.assignee === "u_ramya" || t.assignee === "u_leader"));
    assert.strictEqual(notifyCalls.length, 3);
  });

  // 9. Team leader identified by leaderEmail when group.leader is not yet populated.
  reset();
  const emailLeaderGroup = {
    _id: "g2",
    leader: null,
    leaderEmail: "leader@x.com",
    members: ["u_bhavani", "u_ramya"],
  };
  const emailLeaderSender = { _id: "u_email_leader", email: "leader@x.com" };
  await processGroupMessageForTasks({
    message: { _id: "m9_email", text: "Project Title: AI Calendar\nDescription: 1. Setup backend\n2. Setup frontend" },
    group: emailLeaderGroup,
    sender: emailLeaderSender,
    isGuide: false,
  });
  await check("team leader identified by leaderEmail is authorized and tasks are assigned", async () => {
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(notifyCalls.length, 2);
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
