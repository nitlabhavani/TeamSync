const path = require("path");
const backendRoot = path.resolve(__dirname, "..");
require(path.join(backendRoot, "node_modules", "dotenv")).config({ path: path.join(backendRoot, ".env") });
const mongoose = require(path.join(backendRoot, "node_modules", "mongoose"));
const assert = require("assert");

const User = require(path.join(backendRoot, "src/models/User"));
const Group = require(path.join(backendRoot, "src/models/Group"));
const Task = require(path.join(backendRoot, "src/models/Task"));
const { autoPlanAndAssignTasks } = require(path.join(backendRoot, "src/services/autoProjectPlanningService"));
const { signAccessToken } = require(path.join(backendRoot, "src/utils/token"));

let passedCount = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function run() {
  console.log("==> Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai");

  console.log("\n=======================================================");
  console.log("AUTOMATIC PROJECT TASK PLANNING COMPREHENSIVE TESTS");
  console.log("=======================================================\n");

  // 1. Setup test users
  const guideEmail = `test_guide_${Date.now()}@example.com`;
  const student1Email = `test_student1_${Date.now()}@example.com`;
  const student2Email = `test_student2_${Date.now()}@example.com`;
  const outsiderEmail = `test_outsider_${Date.now()}@example.com`;

  const guide = await User.create({
    name: "Dr. Guide",
    email: guideEmail,
    role: "guide",
    password: "Password123!",
    isActive: true,
  });

  const student1 = await User.create({
    name: "Alice Student",
    email: student1Email,
    role: "student",
    password: "Password123!",
    isActive: true,
  });

  const student2 = await User.create({
    name: "Bob Student",
    email: student2Email,
    role: "student",
    password: "Password123!",
    isActive: true,
  });

  const outsider = await User.create({
    name: "Charlie Outsider",
    email: outsiderEmail,
    role: "student",
    password: "Password123!",
    isActive: true,
  });

  const targetDeadline = new Date(Date.now() + 25 * 86400000); // 25 days in future

  // 2. Test Group 1 creation and auto-planning
  const group1 = await Group.create({
    name: "Alpha Diagnostic Team",
    project: "AI Medical Imaging Assistant",
    description: "An AI-powered web platform for analyzing chest X-rays, identifying pulmonary anomalies, and generating doctor clinical reports.",
    category: "Machine Learning",
    expectedCompletion: targetDeadline,
    guide: guide._id,
    leader: student1._id,
    leaderEmail: student1.email,
    members: [student1._id, student2._id],
  });

  await asyncTest("1. Auto-planning generates structured tasks with clear details and deadlines", async () => {
    const res = await autoPlanAndAssignTasks({
      group: group1,
      reqUser: guide,
    });

    assert.strictEqual(res.success, true, "Planning should be successful");
    assert.ok(res.count >= 4, `Expected at least 4 tasks, got ${res.count}`);

    const createdTasks = await Task.find({ group: group1._id }).populate("assignee");
    assert.strictEqual(createdTasks.length, res.count);

    // Verify properties
    for (const t of createdTasks) {
      assert.strictEqual(String(t.group), String(group1._id), "Task must belong to group1._id");
      assert.ok(t.title, "Task must have title");
      assert.ok(t.description, "Task must have description");
      assert.ok(t.whatToDo, "Task must have whatToDo step-by-step instructions");
      assert.ok(t.expectedOutput, "Task must have tangible expectedOutput");
      assert.ok(Array.isArray(t.completionCriteria) && t.completionCriteria.length > 0, "Task must have acceptance criteria");
      assert.ok(t.assignee, "Task must have a real assignee");
      assert.ok([String(student1._id), String(student2._id)].includes(String(t.assignee._id)), "Assignee must be student1 or student2");
      assert.ok(t.due, "Task must have a due date");
      assert.ok(new Date(t.due) <= targetDeadline, `Due date (${t.due}) must be on or before project target deadline (${targetDeadline})`);
      assert.ok(new Date(t.due) >= new Date(Date.now() - 60000), "Due date must be in the future");
    }
  });

  await asyncTest("2. Workload is balanced across all active student members", async () => {
    const tasks = await Task.find({ group: group1._id });
    const student1Tasks = tasks.filter((t) => String(t.assignee) === String(student1._id));
    const student2Tasks = tasks.filter((t) => String(t.assignee) === String(student2._id));

    assert.ok(student1Tasks.length > 0, "Student 1 must have tasks");
    assert.ok(student2Tasks.length > 0, "Student 2 must have tasks");
    assert.strictEqual(student1Tasks.length + student2Tasks.length, tasks.length, "All tasks must be assigned");
  });

  await asyncTest("3. Task dependencies and topological deadline order are preserved", async () => {
    const tasks = await Task.find({ group: group1._id });
    const byId = new Map(tasks.map((t) => [String(t._id), t]));

    for (const t of tasks) {
      for (const depId of t.dependencies || []) {
        const dep = byId.get(String(depId));
        if (dep) {
          assert.ok(
            new Date(t.due).getTime() >= new Date(dep.due).getTime(),
            `Dependent task "${t.title}" due date (${t.due}) must be >= dependency "${dep.title}" due date (${dep.due})`
          );
        }
      }
    }
  });

  await asyncTest("4. Duplicate protection prevents re-generating duplicate AI tasks", async () => {
    const countBefore = await Task.countDocuments({ group: group1._id });
    const res = await autoPlanAndAssignTasks({
      group: group1,
      reqUser: guide,
      force: false,
    });

    assert.strictEqual(res.skipped, true, "Should skip re-generation when tasks already exist and force=false");
    const countAfter = await Task.countDocuments({ group: group1._id });
    assert.strictEqual(countBefore, countAfter, "Task count must not change");
  });

  await asyncTest("5. Manual tasks are preserved and not overwritten", async () => {
    const manualTask = await Task.create({
      group: group1._id,
      title: "Manual Custom Setup Task",
      description: "Custom task added manually by guide",
      source: "manual",
      assignee: student1._id,
      createdBy: guide._id,
      due: new Date(Date.now() + 5 * 86400000),
      priority: "high",
    });

    const res = await autoPlanAndAssignTasks({
      group: group1,
      reqUser: guide,
      force: true,
    });

    const manualCheck = await Task.findById(manualTask._id);
    assert.ok(manualCheck, "Manual task must still exist");
    assert.strictEqual(manualCheck.title, "Manual Custom Setup Task");
  });

  await asyncTest("6. Group isolation: A second group with identical name has isolated tasks", async () => {
    const group2 = await Group.create({
      name: "Alpha Diagnostic Team", // identical name!
      project: "Different Scope Platform",
      description: "Completely separate project under identical team title.",
      guide: guide._id,
      members: [student2._id],
    });

    const res2 = await autoPlanAndAssignTasks({
      group: group2,
      reqUser: guide,
    });

    assert.strictEqual(res2.success, true);
    const g1Tasks = await Task.find({ group: group1._id });
    const g2Tasks = await Task.find({ group: group2._id });

    assert.ok(g1Tasks.length > 0);
    assert.ok(g2Tasks.length > 0);

    const g1Ids = new Set(g1Tasks.map((t) => String(t._id)));
    for (const t2 of g2Tasks) {
      assert.ok(!g1Ids.has(String(t2._id)), "Group 2 task must never match Group 1 task ID");
      assert.strictEqual(String(t2.group), String(group2._id), "Group 2 task must have group2._id");
    }
  });

  await asyncTest("7. Student privacy: Student query only returns their assigned tasks", async () => {
    const allG1Tasks = await Task.find({ group: group1._id });
    const student1Filter = { group: group1._id, assignee: student1._id };
    const student1Tasks = await Task.find(student1Filter);

    assert.ok(student1Tasks.length > 0);
    assert.ok(student1Tasks.length < allG1Tasks.length, "Student 1 should only see their own tasks, not the whole team's");
    for (const t of student1Tasks) {
      assert.strictEqual(String(t.assignee), String(student1._id));
    }
  });

  // Cleanup test documents
  console.log("\n==> Cleaning up test records...");
  await Task.deleteMany({ group: { $in: [group1._id] } });
  await Group.deleteMany({ _id: { $in: [group1._id] } });
  await User.deleteMany({ _id: { $in: [guide._id, student1._id, student2._id, outsider._id] } });
  await mongoose.disconnect();

  console.log(`\n=======================================================`);
  console.log(`ALL ${passedCount} COMPREHENSIVE TESTS PASSED SUCCESSFULLY!`);
  console.log(`=======================================================\n`);
}

run().catch((err) => {
  console.error("FATAL ERROR IN TESTS:", err);
  process.exit(1);
});
