/**
 * Comprehensive Automated Verification for the AI-Controlled Task Lifecycle:
 * 1. Title and Description human inputs strictly (client control fields ignored/overridden).
 * 2. AI decomposition into objective, problem statement, implementation plan, expected files, required skills.
 * 3. AI Preview endpoint (POST /groups/:groupId/tasks/ai-preview).
 * 4. Strict One-Active-Task-Per-Student enforcement (queue in backlog with NO_ELIGIBLE_ASSIGNEE when all members busy).
 * 5. Student cannot manually complete tasks via drag-and-drop or move endpoint (403 ApiError).
 * 6. Non-compliant / wrong ZIP submissions preserve previous progress without advancing.
 * 7. Verified compliant ZIP submission marks task 100% completed and frees the student for subsequent assignments.
 */
const assert = require("assert");
const express = require("express");
const Module = require("module");
const mongoose = require("mongoose");

const originalLoad = Module._load;
const inMemoryTasks = [];

function createMockTaskDoc(doc) {
  const t = {
    ...doc,
    _id: `task_${inMemoryTasks.length + 1}`,
    submissions: doc.submissions || [],
    toJSON() {
      return { ...this, id: this._id };
    },
    async populate() {
      return this;
    },
    async save() {
      return this;
    },
  };
  return t;
}

const mockGroup = {
  _id: "group_ai_1",
  name: "AI Test Group",
  leader: "user_leader",
  members: ["user_leader", "user_student_1", "user_student_2"],
  expectedCompletion: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

const mockUsers = [
  { _id: "user_guide", name: "Dr. Guide", email: "guide@test.edu", role: "guide" },
  { _id: "user_leader", name: "Alice Leader", email: "alice@test.edu", role: "student" },
  { _id: "user_student_1", name: "Bob Dev", email: "bob@test.edu", role: "student" },
  { _id: "user_student_2", name: "Charlie QA", email: "charlie@test.edu", role: "student" },
];

Module._load = function (request, parent, isMain) {
  if (request.endsWith("models/Task")) {
    return {
      ACTIVE_TASK_STATUSES: [
        "todo", "in_progress", "review", "in_review", "pending", "submitted",
        "ai_review", "guide_review", "changes_requested"
      ],
      TASK_STATUSES: ["backlog", "todo", "in_progress", "review", "done", "pending"],
      create: async (doc) => {
        const task = createMockTaskDoc(doc);
        inMemoryTasks.push(task);
        return task;
      },
      find: (filter = {}) => {
        let results = [...inMemoryTasks];
        if (filter.group) results = results.filter((t) => String(t.group) === String(filter.group));
        if (filter.assignee && filter.assignee.$in) {
          const ids = filter.assignee.$in.map(String);
          results = results.filter((t) => ids.includes(String(t.assignee)));
        }
        if (filter.status && filter.status.$in) {
          results = results.filter((t) => filter.status.$in.includes(t.status));
        }
        return {
          select: () => ({
            lean: async () => results,
          }),
          populate: function () {
            return this;
          },
          sort: function () {
            return Promise.resolve(results);
          },
        };
      },
      findOne: async (filter = {}) => {
        const match = inMemoryTasks.find((t) => {
          if (filter._id && String(t._id) !== String(filter._id)) return false;
          if (filter.group && String(t.group) !== String(filter.group)) return false;
          return true;
        });
        return match || null;
      },
      countDocuments: async (filter = {}) => {
        let matches = [...inMemoryTasks];
        if (filter.group) matches = matches.filter((t) => String(t.group) === String(filter.group));
        if (filter.assignee) matches = matches.filter((t) => String(t.assignee) === String(filter.assignee));
        if (filter.status && filter.status.$in) {
          matches = matches.filter((t) => filter.status.$in.includes(t.status));
        }
        return matches.length;
      },
    };
  }

  if (request.endsWith("models/User")) {
    return {
      find: (filter = {}) => ({
        select: () => ({
          lean: async () => {
            if (filter._id && filter._id.$in) {
              const ids = filter._id.$in.map(String);
              return mockUsers.filter((u) => ids.includes(String(u._id)));
            }
            return mockUsers;
          },
        }),
      }),
      findById: async (id) => mockUsers.find((u) => String(u._id) === String(id)) || null,
    };
  }

  if (request.endsWith("models/Group")) {
    return {
      findById: async (id) => (String(id) === String(mockGroup._id) ? mockGroup : null),
      findByIdAndUpdate: async () => mockGroup,
    };
  }

  if (request.endsWith("services/notificationService")) {
    return { notifyUsers: async () => [] };
  }

  return originalLoad.apply(this, arguments);
};

const taskController = require("../src/controllers/taskController");
const {
  decomposeTaskRequirement,
  determineEligibleAssignee,
  calculateAiDeadlineAndPriority,
  previewTask,
  orchestrateTaskCreation,
} = require("../src/services/aiTaskOrchestrationService");
const {
  verifyTaskRequirements,
} = require("../src/services/taskCompletionVerificationService");
const { errorHandler } = require("../src/middleware/error");

Module._load = originalLoad;

function buildApp(userContext) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = userContext;
    req.isGuide = userContext.role === "guide";
    req.group = mockGroup;
    next();
  });

  app.post("/groups/:groupId/tasks/ai-preview", taskController.previewTask);
  app.post("/groups/:groupId/tasks", taskController.create);
  app.patch("/groups/:groupId/tasks/:taskId/move", taskController.move);
  app.use(errorHandler);
  return app;
}

async function withServer(userContext, fn) {
  const app = buildApp(userContext);
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

async function runTests() {
  console.log("========================================================");
  console.log("RUNNING AI TASK WORKFLOW & VERIFICATION TEST SUITE");
  console.log("========================================================\n");

  // TEST 1: decomposeTaskRequirement creates complete plan from title and description only
  const decomposition = await decomposeTaskRequirement({
    title: "Implement JWT Authentication Filter",
    description: "Build secure token verification middleware with expired token refresh handling and role checks.",
    group: mockGroup,
  });
  assert.ok(decomposition.objective, "Objective should be generated");
  assert.ok(decomposition.problemStatement, "Problem statement should be generated");
  assert.ok(Array.isArray(decomposition.implementationPlan) && decomposition.implementationPlan.length >= 2, "Implementation plan must have steps");
  assert.ok(Array.isArray(decomposition.expectedFiles) && decomposition.expectedFiles.length > 0, "Expected files must be generated");
  assert.ok(Array.isArray(decomposition.completionCriteria) && decomposition.completionCriteria.length > 0, "Criteria must be generated");
  assert.strictEqual(decomposition.module, "Authentication");
  console.log("✓ TEST 1: decomposeTaskRequirement generates comprehensive structure from title & description");

  // TEST 2: previewTask returns complete structured preview before creation
  await withServer(mockUsers[0], async (base) => {
    const res = await fetch(`${base}/groups/${mockGroup._id}/tasks/ai-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Build Responsive Navigation Drawer",
        description: "Develop mobile responsive drawer menu with accessible toggle button and smooth transitions.",
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.preview, true);
    assert.ok(body.data.implementationPlan.length >= 2);
    assert.ok(body.data.aiAssignment.selectedStudentId);
    assert.strictEqual(body.data.aiAssignment.eligibilityStatus, "ASSIGNED");
    console.log("✓ TEST 2: POST /groups/:groupId/tasks/ai-preview returns AI preview with assignment and decomposition");
  });

  // TEST 3: Creation strips client-supplied controls (assignee, priority, status, progress, due)
  await withServer(mockUsers[1], async (base) => {
    const maliciousPayload = {
      title: "Develop User Profile Settings API",
      description: "API route for updating user bios, avatars, and notification preferences.",
      assignee: "user_student_2", // client tries to pick Charlie
      priority: "urgent_override", // client tries to pick priority
      status: "done", // client tries to start task in done!
      progress: 100, // client tries to claim 100% progress
      due: "2099-01-01",
    };
    const res = await fetch(`${base}/groups/${mockGroup._id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousPayload),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    const created = body.data;

    // Must NOT be 'done', progress must NOT be 100, priority must not be 'urgent_override'
    assert.strictEqual(created.progress, 0, "Progress must start at 0");
    assert.strictEqual(created.status, "todo", "Status must start at todo, not client-supplied done");
    assert.notStrictEqual(created.priority, "urgent_override", "Priority override must be discarded");
    assert.strictEqual(created.aiAnalysisVersion, "2.0");
    console.log("✓ TEST 3: POST /groups/:groupId/tasks strips client-supplied control fields and applies AI orchestration");
  });

  // TEST 4: Strict one-active-task rule: Busy students are not double-assigned
  // Now mock in-memory tasks has 1 active task assigned to an eligible student.
  // Let's create more tasks until all 3 student members (Alice, Bob, Charlie) have an active task.
  const task2 = await orchestrateTaskCreation({
    title: "Database Schema Migration for Teams",
    description: "Write script to migrate team relations and add unique index constraints.",
    group: mockGroup,
    createdBy: mockUsers[0],
  });
  assert.ok(task2.assignee, "Second member receives task");

  const task3 = await orchestrateTaskCreation({
    title: "Setup CI/CD Deployment Pipeline",
    description: "Configure GitHub actions workflow for linting, testing, and container deployment.",
    group: mockGroup,
    createdBy: mockUsers[0],
  });
  assert.ok(task3.assignee, "Third member receives task");

  // Now all 3 members (Alice, Bob, Charlie) have active tasks in progress!
  // Creating a 4th task MUST be placed in backlog with NO_ELIGIBLE_ASSIGNEE
  const task4 = await orchestrateTaskCreation({
    title: "Implement Realtime Notifications Webhook",
    description: "Handle incoming webhooks and broadcast notifications via WebSocket connections.",
    group: mockGroup,
    createdBy: mockUsers[0],
  });

  assert.strictEqual(task4.status, "backlog", "4th task must be placed in backlog when all members are busy");
  assert.strictEqual(task4.assignee, undefined, "Assignee must be undefined when no eligible assignee exists");
  assert.strictEqual(task4.aiAssignment.eligibilityStatus, "NO_ELIGIBLE_ASSIGNEE");
  assert.ok(task4.aiAssignment.assignmentReason.includes("one-active-task-at-a-time rule"));
  console.log("✓ TEST 4: Strict one-active-task rule enforced: 4th task routed to backlog with NO_ELIGIBLE_ASSIGNEE");

  // TEST 5: Student cannot manually move task to Done (blocked with 403 ApiError)
  await withServer(mockUsers[2], async (base) => { // Bob Dev
    const targetTaskId = inMemoryTasks[0]._id;
    const res = await fetch(`${base}/groups/${mockGroup._id}/tasks/${targetTaskId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(/cannot manually complete tasks/i.test(body.message));
    console.log("✓ TEST 5: PATCH .../move to 'done' by student is strictly blocked with 403 ApiError");
  });

  // TEST 6: Non-compliant / wrong / unrelated ZIP submission preserves progress without advancing
  const nonCompliantVerification = await verifyTaskRequirements({
    task: { title: "Database Schema Migration for Teams", progress: 0 },
    submission: {
      aiAnalysis: {
        implementationStatus: "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
        taskRelated: false,
        progress: 0,
        missingParts: ["Migration scripts missing", "Schema models not found"],
      },
    },
    group: mockGroup,
  });
  assert.strictEqual(nonCompliantVerification.status, "FAIL", "Unrelated/incomplete submission must FAIL verification");
  assert.strictEqual(nonCompliantVerification.progressPercent, 0, "Failed verification must yield 0 progress advancement");
  assert.ok(nonCompliantVerification.missingItems.length > 0, "Missing items must be flagged");
  console.log("✓ TEST 6: Unrelated ZIP verification returns FAIL with 0 progress advancement and explicit missing items");

  // TEST 7: Verified compliant ZIP submission satisfies criteria and scores high
  const compliantVerification = await verifyTaskRequirements({
    task: {
      title: "Database Schema Migration for Teams",
      progress: 0,
      aiPlan: {
        acceptanceCriteria: [
          "Data models are defined with schema validations",
          "Indexes are configured for optimal query performance",
          "Migration scripts run cleanly",
        ],
        subtasks: [
          { title: "Define Mongoose schemas", status: "completed" },
          { title: "Run migration script", status: "completed" },
        ],
      },
    },
    submission: {
      aiAnalysis: {
        implementationStatus: "COMPLETE",
        taskRelated: true,
        projectRelated: true,
        progress: 95,
        score: 95,
        completedParts: [
          "Data models defined with schema validations",
          "Indexes configured for optimal query performance",
          "Migration scripts verified cleanly and run idempotently",
        ],
        relevance: {
          matchedFiles: ["Team.js", "migration.js"],
        },
      },
    },
    group: mockGroup,
  });
  assert.strictEqual(compliantVerification.status, "PASS", "Relevant verified submission must PASS verification");
  assert.strictEqual(compliantVerification.progressPercent, 100, "Passed verification must achieve 100%");
  assert.ok(compliantVerification.requirementsPassed.length >= 3, "Verified requirements must be recorded");
  console.log("✓ TEST 7: Verified compliant submission passes verification with 100% progress and passed requirements");

  console.log("\n========================================================");
  console.log("ALL 7 AI TASK WORKFLOW VERIFICATION TESTS PASSED!");
  console.log("========================================================");
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
