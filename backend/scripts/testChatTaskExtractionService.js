/**
 * Standalone unit tests for the group-chat AI task assignment feature's
 * pure functions (no DB / no server / no AI engine needed).
 * Run: node backend/scripts/testChatTaskService.js
 */
const assert = require("assert");
const { resolveAssignee, buildTaskInput } = require("../src/services/chatTaskExtractionService");
const { detectMessageTasks } = require("../src/services/aiService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

const members = [
  { _id: "u1", name: "Bhavani" },
  { _id: "u2", name: "Ramya" },
  { _id: "u3", name: "Pujitha" },
];

// --- resolveAssignee -----------------------------------------------------
check("resolveAssignee matches a real group member by name", () => {
  const { member, reason } = resolveAssignee({ assigneeName: "Bhavani" }, members);
  assert.strictEqual(reason, null);
  assert.strictEqual(member._id, "u1");
});

check("resolveAssignee rejects a name that is not a group member", () => {
  const { member, reason } = resolveAssignee({ assigneeName: "John" }, members);
  assert.strictEqual(member, null);
  assert.strictEqual(reason, "not_a_member_of_this_group");
});

check("resolveAssignee rejects an ambiguous name (two members share it)", () => {
  const dup = [...members, { _id: "u4", name: "Bhavani" }];
  const { member, reason } = resolveAssignee({ assigneeName: "Bhavani" }, dup);
  assert.strictEqual(member, null);
  assert.strictEqual(reason, "ambiguous_name_multiple_members_match");
});

check("resolveAssignee never invents an assignee for a missing name", () => {
  const { member, reason } = resolveAssignee({ assigneeName: "" }, members);
  assert.strictEqual(member, null);
  assert.strictEqual(reason, "missing_assignee_name");
});

// --- buildTaskInput --------------------------------------------------------
check("buildTaskInput produces a Task.create-ready object with source=ai_chat", () => {
  const input = buildTaskInput(
    { title: "Frontend Login Page", description: "Complete the login page.", priority: "high", dueDate: "2026-08-21" },
    { groupId: "g1", senderId: "s1", memberId: "u1", sourceMessageId: "m1" }
  );
  assert.strictEqual(input.source, "ai_chat");
  assert.strictEqual(input.sourceMessageId, "m1");
  assert.strictEqual(input.assignee, "u1");
  assert.strictEqual(input.createdBy, "s1");
  assert.strictEqual(input.status, "pending");
  assert.strictEqual(input.priority, "high");
  assert.ok(input.due instanceof Date);
});

check("buildTaskInput falls back to medium priority for an invalid/missing value", () => {
  const input = buildTaskInput(
    { title: "X", description: "" },
    { groupId: "g1", senderId: "s1", memberId: "u1", sourceMessageId: "m1" }
  );
  assert.strictEqual(input.priority, "medium");
  assert.strictEqual(input.due, undefined);
});

check("buildTaskInput never invents a title", () => {
  const input = buildTaskInput({}, { groupId: "g1", senderId: "s1", memberId: "u1", sourceMessageId: "m1" });
  assert.strictEqual(input.title, "Untitled task");
});

// --- detectMessageTasks (Node fallback heuristic) ---------------------------
const memberPayload = [
  { id: "u1", name: "Bhavani" },
  { id: "u2", name: "Ramya" },
  { id: "u3", name: "Pujitha" },
];
const CURRENT = new Date("2026-08-19T10:00:00Z"); // a Wednesday

check("detectMessageTasks: normal message is not a task", () => {
  const r = detectMessageTasks("Hi everyone", memberPayload, CURRENT);
  assert.strictEqual(r.isTask, false);
});

check("detectMessageTasks: discussion is not a task", () => {
  const r = detectMessageTasks("I think we should improve the login page.", memberPayload, CURRENT);
  assert.strictEqual(r.isTask, false);
});

check("detectMessageTasks: clear single assignment is detected with title/due date", () => {
  const r = detectMessageTasks(
    "Bhavani, complete the frontend login page by Friday. Add form validation and connect it with the login API.",
    memberPayload,
    CURRENT
  );
  assert.strictEqual(r.isTask, true);
  assert.strictEqual(r.tasks.length, 1);
  assert.strictEqual(r.tasks[0].assigneeName, "Bhavani");
  assert.strictEqual(r.tasks[0].title, "Frontend Login Page");
  assert.strictEqual(r.tasks[0].dueDate, "2026-08-21"); // the Friday after 2026-08-19
});

check("detectMessageTasks: multiple assignments produce separate tasks sharing the trailing due date", () => {
  const r = detectMessageTasks(
    "Bhavani handle frontend, Ramya handle backend, and Pujitha handle testing by Monday.",
    memberPayload,
    CURRENT
  );
  assert.strictEqual(r.isTask, true);
  assert.strictEqual(r.tasks.length, 3);
  assert.deepStrictEqual(
    r.tasks.map((t) => t.assigneeName),
    ["Bhavani", "Ramya", "Pujitha"]
  );
  r.tasks.forEach((t) => assert.strictEqual(t.dueDate, "2026-08-24")); // the Monday after 2026-08-19
});

check("detectMessageTasks: a name that is not a real group member is reported, not silently reassigned", () => {
  const r = detectMessageTasks("John, complete the backend.", memberPayload, CURRENT);
  assert.strictEqual(r.isTask, false);
  assert.strictEqual(r.tasks.length, 0);
  assert.strictEqual(r.unmatchedMentions.length, 1);
  assert.strictEqual(r.unmatchedMentions[0].name, "John");
  assert.strictEqual(r.unmatchedMentions[0].reason, "not_a_member_of_this_group");
});

check("detectMessageTasks: lowercase words are never mistaken for a capitalized name", () => {
  // regression test: an early version of the case-insensitive regex let
  // "and" match as a fake name here.
  const r = detectMessageTasks(
    "Bhavani, complete the login page. Add form validation and connect it with the API.",
    memberPayload,
    CURRENT
  );
  assert.strictEqual(r.unmatchedMentions.length, 0);
});

// --- regression tests: full name / reversed full name resolution --------
// (root cause of "AI task assignment is not working correctly": the name
// regex used to capture only the single word immediately before the comma
// or verb, so "Bhavani Nitla, complete X" resolved the assignee mention as
// just "Nitla" and never matched any real member.)
const fullNameMembers = [
  { id: "u1", name: "Bhavani Nitla" },
  { id: "u2", name: "Ramya Rao" },
  { id: "u3", name: "Pujitha" },
];

check("detectMessageTasks: full name assignment resolves to the real member", () => {
  const r = detectMessageTasks("Bhavani Nitla, complete the frontend login page by tomorrow.", fullNameMembers, CURRENT);
  assert.strictEqual(r.isTask, true);
  assert.strictEqual(r.tasks.length, 1);
  assert.strictEqual(r.tasks[0].assigneeId, "u1");
  assert.strictEqual(r.tasks[0].assigneeName, "Bhavani Nitla");
});

check("detectMessageTasks: reversed full name resolves to the same real member", () => {
  const r = detectMessageTasks("Nitla Bhavani, complete the frontend login page.", fullNameMembers, CURRENT);
  assert.strictEqual(r.isTask, true);
  assert.strictEqual(r.tasks.length, 1);
  assert.strictEqual(r.tasks[0].assigneeId, "u1");
});

check("detectMessageTasks: multiple full-name assignments each create a separate task", () => {
  const r = detectMessageTasks(
    "Bhavani Nitla handle frontend, Ramya Rao handle backend, Pujitha handle testing.",
    fullNameMembers,
    CURRENT
  );
  assert.strictEqual(r.tasks.length, 3);
  assert.deepStrictEqual(r.tasks.map((t) => t.assigneeId), ["u1", "u2", "u3"]);
});

check("resolveAssignee: reversed full name resolves against the real roster", () => {
  const { member, reason } = resolveAssignee({ assigneeName: "Nitla Bhavani" }, [
    { _id: "u1", name: "Bhavani Nitla" },
  ]);
  assert.strictEqual(reason, null);
  assert.strictEqual(member._id, "u1");
});

// --- Project Title & Description Decomposition and Assignment tests ---
check("detectMessageTasks: project title and description with numbered tasks are assigned to team members", () => {
  const message =
    "Project Title: Healthcare AI Assistant\n" +
    "Description:\n" +
    "1. Setup backend API and FHIR database schema\n" +
    "2. Develop doctor appointment booking module\n" +
    "3. Integrate symptom checker AI model";

  const r = detectMessageTasks(message, fullNameMembers, CURRENT);
  assert.strictEqual(r.isTask, true);
  assert.strictEqual(r.tasks.length, 3);
  assert.strictEqual(r.projectTitle, "Healthcare AI Assistant");
  // Every task must be assigned to a real team member
  assert.ok(r.tasks[0].assigneeId && r.tasks[0].assigneeName);
  assert.ok(r.tasks[1].assigneeId && r.tasks[1].assigneeName);
  assert.ok(r.tasks[2].assigneeId && r.tasks[2].assigneeName);
  assert.deepStrictEqual(r.tasks.map((t) => t.assigneeId), ["u1", "u2", "u3"]);
});

check("detectMessageTasks: project title and description with member prefixes assign tasks accurately", () => {
  const message =
    "Project Title: Online Examination Portal\n" +
    "Description:\n" +
    "1. Ramya Rao: Create question bank API\n" +
    "2. Bhavani Nitla: Build student test view\n" +
    "3. Setup database migrations";

  const r = detectMessageTasks(message, fullNameMembers, CURRENT);
  assert.strictEqual(r.isTask, true);
  assert.strictEqual(r.tasks.length, 3);
  assert.strictEqual(r.tasks[0].assigneeName, "Ramya Rao");
  assert.strictEqual(r.tasks[0].assigneeId, "u2");
  assert.strictEqual(r.tasks[1].assigneeName, "Bhavani Nitla");
  assert.strictEqual(r.tasks[1].assigneeId, "u1");
  // Third task has no prefix, auto-assigned to team member
  assert.ok(r.tasks[2].assigneeId);
});

check("detectMessageTasks: freeform project description generates modular tasks assigned to members", () => {
  const message =
    "Project: Smart City Traffic Monitor\n" +
    "Description: We want to collect IoT sensor feeds, build computer vision vehicle counting, design real-time alerting map, and write unit tests.";

  const r = detectMessageTasks(message, fullNameMembers, CURRENT);
  assert.strictEqual(r.isTask, true);
  assert.ok(r.tasks.length >= 3);
  assert.ok(r.tasks.every((t) => t.assigneeId && t.assigneeName));
});

console.log(`\n${passed} test(s) passed.`);
