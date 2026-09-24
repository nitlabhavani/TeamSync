/**
 * Standalone unit test for projectPlanTaskService (no DB / no server needed).
 * Run: node backend/scripts/testProjectPlanTaskService.js
 */
const assert = require("assert");
const {
  sanitizeTasks,
  resolveAssignments,
  topoSortTasks,
  computeTaskDueDates,
} = require("../src/services/projectPlanTaskService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`ok - ${label}`);
};

// --- sanitizeTasks -----------------------------------------------------
check("sanitizeTasks drops empty titles and de-dupes case-insensitively", () => {
  const out = sanitizeTasks([
    { title: "Design database schema", estimatedDays: 2 },
    { title: "  " },
    { title: "design database schema", estimatedDays: 99 }, // duplicate, ignored
    { title: "Build core UI screens", estimatedDays: 3, priority: "bogus", dependencies: ["Implement authentication"] },
  ]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].estimatedDays, 2);
  assert.strictEqual(out[1].priority, "medium"); // invalid priority -> falls back
  assert.deepStrictEqual(out[1].dependencies, ["Implement authentication"]);
});

check("sanitizeTasks clamps non-positive/garbage estimatedDays to 1", () => {
  const out = sanitizeTasks([{ title: "X", estimatedDays: -5 }, { title: "Y", estimatedDays: "n/a" }]);
  assert.strictEqual(out[0].estimatedDays, 1);
  assert.strictEqual(out[1].estimatedDays, 1);
});

// --- resolveAssignments --------------------------------------------------
check("resolveAssignments maps by email against real members", () => {
  const members = new Map([
    ["bhavani@example.com", { _id: "u1", name: "Bhavani" }],
    ["student2@example.com", { _id: "u2", name: "Student 2" }],
  ]);
  const titles = new Set(["build login and registration ui", "create authentication apis"]);
  const { assignmentsByTitle, unresolvedEmail } = resolveAssignments(
    [
      { taskTitle: "Build Login and Registration UI", studentEmail: "Bhavani@example.com" },
      { taskTitle: "Create authentication APIs", studentEmail: "student2@example.com" },
    ],
    titles,
    members
  );
  assert.strictEqual(unresolvedEmail, null);
  assert.strictEqual(assignmentsByTitle.get("build login and registration ui")._id, "u1");
  assert.strictEqual(assignmentsByTitle.get("create authentication apis")._id, "u2");
});

check("resolveAssignments reports the first unmatched email and stops", () => {
  const members = new Map([["known@example.com", { _id: "u1" }]]);
  const titles = new Set(["task a"]);
  const { unresolvedEmail } = resolveAssignments(
    [{ taskTitle: "Task A", studentEmail: "ghost@example.com" }],
    titles,
    members
  );
  assert.strictEqual(unresolvedEmail, "ghost@example.com");
});

check("resolveAssignments ignores assignments for tasks outside this batch", () => {
  const members = new Map([["known@example.com", { _id: "u1" }]]);
  const titles = new Set(["task a"]);
  const { assignmentsByTitle, unresolvedEmail } = resolveAssignments(
    [{ taskTitle: "Some Other Task", studentEmail: "ghost@example.com" }],
    titles,
    members
  );
  assert.strictEqual(unresolvedEmail, null);
  assert.strictEqual(assignmentsByTitle.size, 0);
});

// --- topoSortTasks ---------------------------------------------------------
check("topoSortTasks orders dependencies before dependents", () => {
  const tasks = [
    { title: "Connect frontend to backend APIs", dependencies: ["Build core UI screens", "Build core backend APIs"] },
    { title: "Build core UI screens", dependencies: ["Implement authentication"] },
    { title: "Implement authentication", dependencies: ["Design database schema"] },
    { title: "Design database schema", dependencies: [] },
    { title: "Build core backend APIs", dependencies: ["Design database schema"] },
  ];
  const ordered = topoSortTasks(tasks).map((t) => t.title);
  const indexOf = (t) => ordered.indexOf(t);
  assert.ok(indexOf("Design database schema") < indexOf("Implement authentication"));
  assert.ok(indexOf("Implement authentication") < indexOf("Build core UI screens"));
  assert.ok(indexOf("Design database schema") < indexOf("Build core backend APIs"));
  assert.ok(indexOf("Build core UI screens") < indexOf("Connect frontend to backend APIs"));
  assert.ok(indexOf("Build core backend APIs") < indexOf("Connect frontend to backend APIs"));
  assert.strictEqual(ordered.length, 5);
});

check("topoSortTasks never hangs or drops tasks on a dependency cycle", () => {
  const tasks = [
    { title: "A", dependencies: ["B"] },
    { title: "B", dependencies: ["A"] },
  ];
  const ordered = topoSortTasks(tasks).map((t) => t.title);
  assert.strictEqual(ordered.length, 2);
  assert.ok(ordered.includes("A") && ordered.includes("B"));
});

// --- computeTaskDueDates ----------------------------------------------------
check("computeTaskDueDates gives later tasks later dates, scaled to the deadline", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const deadline = new Date("2026-01-21T00:00:00.000Z"); // 20 days out
  const tasks = [
    { title: "Design database schema", estimatedDays: 2, dependencies: [] },
    { title: "Implement authentication", estimatedDays: 2, dependencies: ["Design database schema"] },
    { title: "Build core UI screens", estimatedDays: 3, dependencies: ["Implement authentication"] },
  ];
  const due = computeTaskDueDates(tasks, deadline, now);
  const d1 = due.get("design database schema");
  const d2 = due.get("implement authentication");
  const d3 = due.get("build core ui screens");
  assert.ok(d1 < d2, "earlier task must be due before its dependent");
  assert.ok(d2 < d3, "chain must strictly increase");
  // total offset is 7 days (2+2+3), scaled into a 20-day span -> last task
  // lands at day 20 (the deadline itself), not day 7.
  assert.strictEqual(Math.round((d3 - now) / 86400000), 20);
  // no duplicate flat deadlines
  assert.notStrictEqual(d1.getTime(), d2.getTime());
  assert.notStrictEqual(d2.getTime(), d3.getTime());
});

check("computeTaskDueDates falls back to raw estimatedDays pace with no deadline", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const tasks = [
    { title: "A", estimatedDays: 2, dependencies: [] },
    { title: "B", estimatedDays: 3, dependencies: ["A"] },
  ];
  const due = computeTaskDueDates(tasks, null, now);
  assert.strictEqual(Math.round((due.get("a") - now) / 86400000), 2);
  assert.strictEqual(Math.round((due.get("b") - now) / 86400000), 5);
});

check("computeTaskDueDates treats a past deadline like no deadline (no negative dates)", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const pastDeadline = new Date("2026-01-01T00:00:00.000Z");
  const tasks = [{ title: "A", estimatedDays: 3, dependencies: [] }];
  const due = computeTaskDueDates(tasks, pastDeadline, now);
  assert.ok(due.get("a") > now, "must not schedule a task in the past");
});

console.log(`\n${passed} passed`);
