/**
 * ISSUE #3 — "Add Task" role/authorization regression tests.
 *
 * Exercises the REAL production authorization line in
 * taskController.create (`if (!req.isGuide && String(req.group.leader) !==
 * String(req.user._id)) throw ApiError.forbidden(...)`) over real HTTP,
 * through a real Express app — not a reimplementation of the check.
 *
 * DB-touching collaborators (Task.create/find, Group.findByIdAndUpdate)
 * are monkeypatched with minimal in-memory fakes BEFORE taskController is
 * required, so this needs no live MongoDB — same convention as
 * testProjectMemoryAssistant.js / testTaskReassignmentIsolation.js.
 *
 * Run: node backend/scripts/testAddTaskAuthorization.js
 */
const assert = require("assert");
const express = require("express");
const Module = require("module");

/* ---------------------------------------------------------------------
 * Monkeypatch Task / Group / notificationService BEFORE requiring
 * taskController, so every internal `require("../models/Task")` etc.
 * inside it resolves to these same fakes (Node module cache).
 * --------------------------------------------------------------------- */
const originalLoad = Module._load;
const createdTasks = [];

function fakeTask(doc) {
  return {
    ...doc,
    _id: `task_${createdTasks.length + 1}`,
    toJSON() {
      return { ...doc, id: this._id };
    },
    async populate() {
      return this;
    },
  };
}

Module._load = function (request, parent, isMain) {
  if (request.endsWith("models/Task")) {
    return {
      TASK_STATUSES: ["backlog", "todo", "in_progress", "review", "done", "pending"],
      create: async (doc) => {
        const t = fakeTask(doc);
        createdTasks.push(t);
        return t;
      },
      find: () => ({
        select: () => ({
          lean: async () => createdTasks,
        }),
      }),
    };
  }
  if (request.endsWith("models/Group")) {
    return { findByIdAndUpdate: async () => null };
  }
  if (request.endsWith("services/notificationService")) {
    return { notifyUsers: async () => [] };
  }
  return originalLoad.apply(this, arguments);
};

const taskController = require("../src/controllers/taskController");
Module._load = originalLoad; // restore immediately after the patched require

/* ---------------------------------------------------------------------
 * Minimal Express app: a fake "requireGroupAccess"-equivalent sets
 * req.group / req.isGuide directly from test fixtures (this test is about
 * the CREATE authorization line itself, not re-testing requireGroupAccess,
 * which already has its own coverage), then the REAL taskController.create
 * runs unmodified.
 * --------------------------------------------------------------------- */
const { errorHandler } = require("../src/middleware/error");

function buildApp({ userId, role, groupLeader }) {
  const app = express();
  app.use(express.json());
  app.post("/groups/:groupId/tasks", (req, res, next) => {
    req.user = { _id: userId, role };
    req.isGuide = role === "guide";
    req.group = { _id: req.params.groupId, leader: groupLeader };
    next();
  }, taskController.create);
  app.use(errorHandler);
  return app;
}

async function withServer(fixture, fn) {
  const app = buildApp(fixture);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const GUIDE = "guide_1";
const LEADER_A = "leader_of_A";
const LEADER_B = "leader_of_B";
const STUDENT = "plain_student";
const GROUP_A = "group_A";
const GROUP_B = "group_B";

let passed = 0;
function ok(label) {
  console.log(`ok - ${label}`);
  passed += 1;
}

async function createTask(base, groupId, body = { title: "Test task" }) {
  const res = await fetch(`${base}/groups/${groupId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

async function main() {
  // 1. Guide can create a task in their own group.
  await withServer({ userId: GUIDE, role: "guide", groupLeader: LEADER_A }, async (base) => {
    const res = await createTask(base, GROUP_A);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.title, "Test task");
  });
  ok("1. Guide can create a task");

  // 2. Team Leader can create a task in the group they lead.
  await withServer({ userId: LEADER_A, role: "student", groupLeader: LEADER_A }, async (base) => {
    const res = await createTask(base, GROUP_A);
    assert.strictEqual(res.status, 201);
  });
  ok("2. Team Leader can create a task in the group they lead");

  // 3. A plain student cannot create a task.
  await withServer({ userId: STUDENT, role: "student", groupLeader: LEADER_A }, async (base) => {
    const res = await createTask(base, GROUP_A);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(/guide or team leader/i.test(body.message));
  });
  ok("3. A plain student cannot create a task (backend 403, not just UI)");

  // 4. An "unauthorized user" (student with no leader relationship at all) cannot create a task.
  await withServer({ userId: "some_random_user", role: "student", groupLeader: LEADER_A }, async (base) => {
    const res = await createTask(base, GROUP_A);
    assert.strictEqual(res.status, 403);
  });
  ok("4. An unauthorized user cannot create a task");

  // 5. Team Leader of Group A CANNOT create a task in Group B (group isolation).
  await withServer({ userId: LEADER_A, role: "student", groupLeader: LEADER_B }, async (base) => {
    // req.group.leader here represents *Group B's* leader (LEADER_B) —
    // i.e. LEADER_A is calling POST /groups/B/tasks, and Group B's real
    // leader is LEADER_B, not LEADER_A.
    const res = await createTask(base, GROUP_B);
    assert.strictEqual(res.status, 403);
  });
  ok("5. Team Leader of Group A cannot create a task in Group B");

  // 6. Guide of Group B can create a task in Group B (sanity check the
  // isolation above isn't just "everything fails").
  await withServer({ userId: GUIDE, role: "guide", groupLeader: LEADER_B }, async (base) => {
    const res = await createTask(base, GROUP_B);
    assert.strictEqual(res.status, 201);
  });
  ok("6. Guide of Group B can add a task to Group B");

  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
