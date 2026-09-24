const path = require("path");
const backendRoot = path.resolve(__dirname, "..");
require(path.join(backendRoot, "node_modules", "dotenv")).config({ path: path.join(backendRoot, ".env") });
const mongoose = require(path.join(backendRoot, "node_modules", "mongoose"));
const assert = require("assert");

const User = require(path.join(backendRoot, "src/models/User"));
const Group = require(path.join(backendRoot, "src/models/Group"));
const Task = require(path.join(backendRoot, "src/models/Task"));
const { signAccessToken } = require(path.join(backendRoot, "src/utils/token"));

async function request(urlPath, options = {}) {
  const url = `http://127.0.0.1:5000/api${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log("==> Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai");

  console.log("\n=======================================================");
  console.log("HTTP ENDPOINTS & AUTHORIZATION VERIFICATION");
  console.log("=======================================================\n");

  const timestamp = Date.now();
  const guide = await User.create({
    name: "Dr. Guide HTTP",
    email: `guide_http_${timestamp}@example.com`,
    role: "guide",
    password: "Password123!",
    isActive: true,
  });

  const leader = await User.create({
    name: "Leader HTTP",
    email: `leader_http_${timestamp}@example.com`,
    role: "student",
    password: "Password123!",
    isActive: true,
  });

  const student = await User.create({
    name: "Student HTTP",
    email: `student_http_${timestamp}@example.com`,
    role: "student",
    password: "Password123!",
    isActive: true,
  });

  const outsider = await User.create({
    name: "Outsider HTTP",
    email: `outsider_http_${timestamp}@example.com`,
    role: "student",
    password: "Password123!",
    isActive: true,
  });

  const guideToken = signAccessToken(guide);
  const leaderToken = signAccessToken(leader);
  const studentToken = signAccessToken(student);
  const outsiderToken = signAccessToken(outsider);

  console.log("--- TEST 1: Guide creates group with title and description -> Auto tasks generated ---");
  const createRes = await request("/groups", {
    method: "POST",
    headers: { Authorization: `Bearer ${guideToken}` },
    body: JSON.stringify({
      name: `Team Quantum HTTP ${timestamp}`,
      project: "Autonomous Drone Navigation",
      description: "Computer vision and path planning system for autonomous aerial drones in GPS-denied environments.",
      category: "Machine Learning",
      expectedCompletion: new Date(Date.now() + 30 * 86400000).toISOString(),
      memberEmails: [leader.email, student.email],
      autoGenerateTasks: true,
    }),
  });

  assert.strictEqual(createRes.status, 201, `Group creation failed: ${JSON.stringify(createRes.data)}`);
  const createdGroup = createRes.data.data;
  console.log(`Created group: ${createdGroup.name} (ID: ${createdGroup._id || createdGroup.id})`);
  const groupId = createdGroup._id || createdGroup.id;

  assert.ok(createRes.data.meta?.autoTasksCreated >= 4, `Expected >= 4 auto tasks, got ${createRes.data.meta?.autoTasksCreated}`);
  console.log(`[PASS] Group creation returned ${createRes.data.meta.autoTasksCreated} automatically planned tasks!`);

  const dbTasks = await Task.find({ group: groupId });
  assert.strictEqual(dbTasks.length, createRes.data.meta.autoTasksCreated);
  console.log(`[PASS] Real Task documents created in MongoDB: ${dbTasks.length}`);

  console.log("\n--- TEST 2: Ordinary student forbidden from creating groups ---");
  const studentCreateRes = await request("/groups", {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({
      name: "Rogue Student Group",
      project: "Hack Attempt",
      description: "Should fail immediately.",
    }),
  });
  assert.strictEqual(studentCreateRes.status, 403, "Student must be forbidden from creating group");
  console.log("[PASS] Ordinary student received 403 Forbidden on group creation");

  console.log("\n--- TEST 3: Ordinary student forbidden from triggering AI auto-plan ---");
  const studentPlanRes = await request(`/groups/${groupId}/ai/auto-plan-tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({ force: true }),
  });
  assert.strictEqual(studentPlanRes.status, 403, "Student must be forbidden from triggering auto-plan");
  console.log("[PASS] Ordinary student received 403 Forbidden on auto-plan endpoint");

  console.log("\n--- TEST 4: Outsider student forbidden from group endpoints ---");
  const outsiderPlanRes = await request(`/groups/${groupId}/ai/auto-plan-tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${outsiderToken}` },
    body: JSON.stringify({ force: true }),
  });
  assert.strictEqual(outsiderPlanRes.status, 403, "Outsider must be forbidden");
  console.log("[PASS] Outsider student received 403 Forbidden");

  console.log("\n--- TEST 5: Team Leader CAN trigger auto-planning ---");
  const leaderPlanRes = await request(`/groups/${groupId}/ai/auto-plan-tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${leaderToken}` },
    body: JSON.stringify({ force: false }),
  });
  assert.strictEqual(leaderPlanRes.status, 200);
  assert.strictEqual(leaderPlanRes.data.data.skipped, true, "Duplicate protection should report skipped when force=false");
  console.log("[PASS] Team Leader authorized and duplicate protection reported skipped=true");

  console.log("\n--- TEST 6: Student sees only their assigned tasks on /groups/:groupId/tasks ---");
  const studentListRes = await request(`/groups/${groupId}/tasks`, {
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.strictEqual(studentListRes.status, 200);
  const studentVisibleTasks = studentListRes.data.data;
  assert.ok(studentVisibleTasks.length > 0, "Student must have tasks");
  assert.ok(studentVisibleTasks.length < dbTasks.length, "Student must only see their own assigned tasks");
  for (const t of studentVisibleTasks) {
    assert.strictEqual(String(t.assignee?.id || t.assignee?._id || t.assignee), String(student._id));
  }
  console.log(`[PASS] Student privacy preserved: Student sees ${studentVisibleTasks.length} assigned tasks out of ${dbTasks.length} total team tasks!`);

  console.log("\n--- TEST 7: Guide sees all team tasks on /groups/:groupId/tasks ---");
  const guideListRes = await request(`/groups/${groupId}/tasks`, {
    method: "GET",
    headers: { Authorization: `Bearer ${guideToken}` },
  });
  assert.strictEqual(guideListRes.status, 200);
  assert.strictEqual(guideListRes.data.data.length, dbTasks.length, "Guide must see all group tasks");
  console.log(`[PASS] Guide sees all ${guideListRes.data.data.length} tasks!`);

  console.log("\n==> Cleaning up test records...");
  await Task.deleteMany({ group: groupId });
  await Group.deleteMany({ _id: groupId });
  await User.deleteMany({ _id: { $in: [guide._id, leader._id, student._id, outsider._id] } });
  await mongoose.disconnect();

  console.log("\n=======================================================");
  console.log("ALL HTTP & AUTHORIZATION TESTS PASSED PERFECTLY!");
  console.log("=======================================================\n");
}

run().catch((err) => {
  console.error("FATAL HTTP TEST ERROR:", err);
  process.exit(1);
});
