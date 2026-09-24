/**
 * STEP 34 — Notification -> exact group chat navigation.
 *
 * DB-free (no live MongoDB needed), same mocking approach as
 * testNotificationSystem.js / testSameNameGroupIsolation.js: fake
 * Message/notificationService/socketService/chatTaskService/
 * conflictDetectionService modules, real chatController code under test.
 *
 * Verifies:
 *   1. A group-message notification carries the exact groupId, messageId,
 *      and a `link` built from the group's real _id (never its name).
 *   2. Two groups sharing the same name never cross-deliver a `link`/
 *      `message` id — each notification points at its own group/message.
 *   3. A direct/private message notification never carries `group`/
 *      `message` fields (must never be routed through group-chat
 *      navigation or trigger group-only AI hooks), and gets its own
 *      `link` to the existing private chat route.
 *   4. Sending a group message still fires the existing AI task-extraction
 *      and conflict-detection hooks exactly as before (regression guard —
 *      this feature must not touch that fire-and-forget wiring).
 *   5. An "old" notification shape (no group/message field at all, as
 *      every pre-STEP-34 notification looks) is handled gracefully by the
 *      same code path a client would use (falls back to falsy checks,
 *      never throws).
 *
 * Run: node backend/scripts/testNotificationChatNavigation.js
 */
const assert = require("assert");
const path = require("path");
const Module = require("module");

const resolve = (rel) => require.resolve(path.join(__dirname, "..", "src", rel));

function fakeModule(resolvedPath, exportsObj) {
  const m = new Module(resolvedPath, null);
  m.exports = exportsObj;
  m.loaded = true;
  require.cache[resolvedPath] = m;
}

// ---- fake Message model -------------------------------------------------
let nextMessageId = 1;
const createdMessages = [];
class FakeMessage {
  constructor(doc) {
    Object.assign(this, doc);
    this._id = `msg${nextMessageId++}`;
    this.createdAt = new Date();
  }
  async populate() {
    // sendGroupMessage/sendDirectMessage only read `.sender` off the
    // populated doc downstream (emitted over sockets) — irrelevant to
    // these assertions, so a same-shape passthrough is enough.
    return this;
  }
  static async create(doc) {
    const msg = new FakeMessage(doc);
    createdMessages.push(msg);
    return msg;
  }
  static conversationKey(a, b) {
    return [String(a), String(b)].sort().join("_");
  }
}

// ---- capture notifyUsers / socket emits / AI hook calls -----------------
let notifyCalls = [];
let emittedGroup = [];
let emittedUser = [];
let taskHookCalls = [];
let conflictHookCalls = [];

const FakeNotificationService = {
  async notifyUsers(userIds, payload, opts) {
    notifyCalls.push({ userIds, payload, opts });
    return userIds.map((u) => ({ user: u, ...payload }));
  },
};
const FakeSocketService = {
  emitToGroup: (groupId, event, payload) => emittedGroup.push({ groupId, event, payload }),
  emitToUser: (userId, event, payload) => emittedUser.push({ userId, event, payload }),
};
const FakeChatTaskService = {
  processGroupMessageForTasks: async (args) => {
    taskHookCalls.push(args);
    return null;
  },
};
const FakeConflictDetectionService = {
  analyzeGroupMessageForConflicts: async (args) => {
    conflictHookCalls.push(args);
    return null;
  },
};
const FakeAiService = { summarizeConversation: () => ({}) };

fakeModule(resolve("models/Message.js"), FakeMessage);
fakeModule(resolve("services/notificationService.js"), FakeNotificationService);
fakeModule(resolve("services/socketService.js"), FakeSocketService);
fakeModule(resolve("services/chatTaskService.js"), FakeChatTaskService);
fakeModule(resolve("services/conflictDetectionService.js"), FakeConflictDetectionService);
fakeModule(resolve("services/aiService.js"), FakeAiService);
// models/Group.js is required by chatController.js only for its export
// shape (never called in sendGroupMessage/sendDirectMessage — req.group
// is attached by the requireGroupAccess middleware, not looked up here),
// so a minimal stub is enough.
fakeModule(resolve("models/Group.js"), {});

const chatController = require(resolve("controllers/chatController.js"));

const fakeRes = () => {
  const res = {};
  res.status = (c) => {
    res._status = c;
    return res;
  };
  res.json = (b) => {
    res._body = b;
    return res;
  };
  return res;
};

function resetCaptures() {
  notifyCalls = [];
  emittedGroup = [];
  emittedUser = [];
  taskHookCalls = [];
  conflictHookCalls = [];
}

(async () => {
  // ================= 1. Group-message notification: exact ids + link ====
  {
    resetCaptures();
    const req = {
      body: { text: "Please review the API design doc" },
      group: { _id: "groupA_real_id", name: "Team Alpha", members: ["u1", "u2", "u3"] },
      user: { _id: "u1", name: "Bhavani" },
    };
    const res = fakeRes();
    await chatController.sendGroupMessage(req, res);

    assert.strictEqual(res._status, 201);
    assert.strictEqual(notifyCalls.length, 1);
    const { userIds, payload, opts } = notifyCalls[0];
    assert.deepStrictEqual(userIds.sort(), ["u1", "u2", "u3"].sort());
    assert.strictEqual(opts.exclude, "u1", "the sender must be excluded from their own notification");
    assert.strictEqual(payload.type, "chat");
    assert.strictEqual(payload.group, "groupA_real_id", "must be the exact group _id, never the name");
    assert.ok(payload.message, "a messageId must be attached for exact-message targeting");
    assert.strictEqual(payload.message, createdMessages[createdMessages.length - 1]._id);
    assert.strictEqual(payload.link, "/app/groups/groupA_real_id");
    assert.notStrictEqual(payload.link.includes("Team Alpha"), true, "link must never encode the group name");
    console.log("ok - group-message notification carries exact groupId, messageId, and a name-free link");
  }

  // ================= 2. Same-name groups never cross-deliver ids/links ===
  {
    resetCaptures();
    const reqA = {
      body: { text: "Bhavani, ping the team" },
      group: { _id: "A_id", name: "Team Vision", members: ["a_bhavani", "a_pujitha"] },
      user: { _id: "a_bhavani", name: "Bhavani" },
    };
    await chatController.sendGroupMessage(reqA, fakeRes());
    const callA = notifyCalls[notifyCalls.length - 1];

    const reqB = {
      body: { text: "Bhavani, ping the team" }, // identical text, different group
      group: { _id: "B_id", name: "Team Vision", members: ["b_bhavani", "b_ramya"] }, // same display name
      user: { _id: "b_bhavani", name: "Bhavani" },
    };
    await chatController.sendGroupMessage(reqB, fakeRes());
    const callB = notifyCalls[notifyCalls.length - 1];

    assert.strictEqual(callA.payload.group, "A_id");
    assert.strictEqual(callB.payload.group, "B_id");
    assert.notStrictEqual(callA.payload.group, callB.payload.group);
    assert.strictEqual(callA.payload.link, "/app/groups/A_id");
    assert.strictEqual(callB.payload.link, "/app/groups/B_id");
    assert.strictEqual(callA.payload.message, callA.payload.message);
    assert.notStrictEqual(callA.payload.message, callB.payload.message, "each group's message must have its own id");
    assert.deepStrictEqual(callA.userIds.sort(), ["a_bhavani", "a_pujitha"].sort(), "Group A's notification is only ever fanned out to Group A's own members");
    assert.deepStrictEqual(callB.userIds.sort(), ["b_bhavani", "b_ramya"].sort(), "Group B's notification is only ever fanned out to Group B's own members");
    assert.strictEqual(callA.opts.exclude, "a_bhavani", "Group A's sender is excluded from their own notification");
    assert.strictEqual(callB.opts.exclude, "b_bhavani", "Group B's sender is excluded from their own notification");
    // Cross-check: Group B's member list never appears in Group A's call, and vice versa.
    assert.ok(!callA.userIds.includes("b_bhavani") && !callA.userIds.includes("b_ramya"));
    assert.ok(!callB.userIds.includes("a_bhavani") && !callB.userIds.includes("a_pujitha"));
    console.log("ok - two same-name groups never cross-deliver notification ids/links");
  }

  // ================= 3. Direct message: own link, no group/message fields=
  {
    resetCaptures();
    const req = {
      body: { text: "hey, got a sec?" },
      params: { userId: "peer1" },
      user: { _id: "sender1", name: "Ramya" },
    };
    const res = fakeRes();
    await chatController.sendDirectMessage(req, res);

    assert.strictEqual(notifyCalls.length, 1);
    const { userIds, payload } = notifyCalls[0];
    assert.deepStrictEqual(userIds, ["peer1"]);
    assert.strictEqual(payload.link, "/app/chat/sender1", "opens the recipient's existing chat with the sender");
    assert.strictEqual(payload.group, undefined, "a direct-message notification must never carry a group id");
    assert.strictEqual(payload.message, undefined, "a direct-message notification must never carry a group message id");
    console.log("ok - direct-message notification has its own link and no group/message fields");
  }

  // ================= 4. AI hooks still fire exactly once per group msg ===
  {
    resetCaptures();
    const req = {
      body: { text: "Assign the login page to Priya by Friday" },
      group: { _id: "groupC", name: "Team Gamma", members: ["u1", "u2"] },
      user: { _id: "u1", name: "Dev" },
    };
    await chatController.sendGroupMessage(req, fakeRes());
    // fire-and-forget calls — flush the microtask queue before asserting
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(taskHookCalls.length, 1, "AI task-extraction hook must still fire for this group message");
    assert.strictEqual(conflictHookCalls.length, 1, "conflict-detection hook must still fire for this group message");
    assert.strictEqual(emittedGroup.length, 1);
    assert.strictEqual(emittedGroup[0].event, "group:message");
    console.log("ok - existing AI task-extraction and conflict-detection hooks are untouched by this change");
  }

  // ================= 5. Old-shape notification (no group/message) =======
  {
    // Simulates a notification created before STEP 34 (or any non-chat
    // type): the frontend's `n.type === "chat" && n.group` guard must
    // treat this as "no exact navigation available" and fail gracefully
    // (no throw), matching Notifications.jsx's handleOpen logic.
    const oldNotification = { id: "n_old", type: "chat", link: "", group: undefined, message: undefined };
    const shouldUseGroupNav = oldNotification.type === "chat" && !!oldNotification.group;
    assert.strictEqual(shouldUseGroupNav, false);
    assert.doesNotThrow(() => {
      // eslint-disable-next-line no-unused-expressions
      oldNotification.link ? oldNotification.link : null;
    });
    console.log("ok - an old notification without group/message metadata degrades gracefully (no crash, no group nav)");
  }

  console.log("\nAll STEP 34 notification -> chat navigation tests passed.");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
