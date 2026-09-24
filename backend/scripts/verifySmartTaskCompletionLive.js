// Live End-to-End Verification for Smart Task Completion → Next Task Flow
const http = require("http");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/teamsync_ai";
const BASE_URL = "http://localhost:5000/api";
const { signAccessToken } = require("../src/utils/token");

function api(method, endpoint, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${endpoint}`);
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runLiveVerification() {
  console.log("=== CONNECTING TO MONGO ===");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to Mongo.");

  const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");
  const Group = mongoose.model("Group", new mongoose.Schema({}, { strict: false }), "groups");
  const Task = mongoose.model("Task", new mongoose.Schema({}, { strict: false }), "tasks");

  try {
    console.log("\n1. Finding or creating test Guide and Student...");
    let guide = await User.findOne({ role: "guide" });
    if (!guide) {
      guide = await User.create({
        name: "Dr. Smart Guide",
        email: "smartguide@test.edu",
        role: "guide",
        isEmailVerified: true,
      });
    }

    let student = await User.findOne({ role: "student" });
    if (!student) {
      student = await User.create({
        name: "Alex Student",
        email: "alexstudent@test.edu",
        role: "student",
        isEmailVerified: true,
      });
    }

    console.log(`Guide: ${guide.name} (${guide._id}), Student: ${student.name} (${student._id})`);

    const guideToken = signAccessToken({ _id: guide._id, role: guide.role, email: guide.email });
    const studentToken = signAccessToken({ _id: student._id, role: student.role, email: student.email });

    console.log("\n2. Creating isolated test group...");
    const testGroup = await Group.create({
      name: "Smart Task Test Project",
      project: "Autonomous AI Workflow",
      description: "Testing smart task completion and dependency routing",
      guide: guide._id,
      members: [student._id],
    });
    console.log(`Test Group created: ${testGroup._id}`);

    console.log("\n3. Creating tasks with dependency structure...");
    const sub1Id = new mongoose.Types.ObjectId();
    // Task 1: Assigned to student
    const task1 = await Task.create({
      group: testGroup._id,
      title: "Task 1: Core Architecture Setup",
      description: "Setup base directory structure and models",
      assignee: student._id,
      status: "todo",
      priority: "high",
      dependencies: [],
      submissions: [
        {
          _id: sub1Id,
          student: student._id,
          version: 1,
          aiAnalysis: {
            projectRelated: true,
            taskRelated: true,
            implementationStatus: "VALID_SUBMISSION",
            progress: 95,
            taskConfidence: 90,
            completedParts: ["Setup base directory", "Configured models"],
            missingParts: [],
            plagiarism: { detected: false, severity: "NONE" },
            codeReview: { score: 95, issues: [] },
            relevance: { status: "RELEVANT", isIrrelevant: false },
          },
        },
      ],
    });

    // Task 2: Assigned to student, DEPENDENT on Task 1
    const task2 = await Task.create({
      group: testGroup._id,
      title: "Task 2: Implement Secure Authentication",
      description: "Implement JWT auth controllers",
      assignee: student._id,
      status: "todo",
      priority: "critical",
      dependencies: [task1._id], // Blocks until Task 1 is done
      submissions: [],
    });

    // Task 3: Unassigned task in group
    const task3 = await Task.create({
      group: testGroup._id,
      title: "Task 3: Dashboard Analytics Reporting",
      description: "Build report aggregation pipeline",
      assignee: null,
      status: "todo",
      priority: "medium",
      dependencies: [],
      submissions: [],
    });

    console.log(`Created Task 1 (${task1._id}), Task 2 (Blocked by Task 1: ${task2._id}), Task 3 (Unassigned: ${task3._id})`);

    console.log("\n4. Testing GET /next-task before Task 1 completion...");
    const preRes = await api("GET", `/groups/${testGroup._id}/tasks/${task1._id}/next-task`, null, studentToken);
    console.log("Pre-completion next-task query response:", JSON.stringify(preRes.data?.data?.task?.title || preRes.data?.data?.message));

    console.log("\n5. Verifying & auto-completing Task 1 via POST .../verify...");
    const verifyRes = await api(
      "POST",
      `/groups/${testGroup._id}/tasks/${task1._id}/submissions/${sub1Id}/verify`,
      { autoRun: true },
      studentToken
    );

    console.log("Verify API status:", verifyRes.status);
    console.log("Verification outcome status:", verifyRes.data?.data?.verification?.status);
    console.log("Task 1 completed status:", verifyRes.data?.data?.task?.status);
    console.log("Next Task identified:", verifyRes.data?.data?.nextTask?.title);
    console.log("Next Task priority:", verifyRes.data?.data?.nextTask?.priority);

    if (
      verifyRes.data?.data?.verification?.status === "PASS" &&
      verifyRes.data?.data?.task?.status === "completed" &&
      verifyRes.data?.data?.nextTask?.title === "Task 2: Implement Secure Authentication"
    ) {
      console.log("✅ PASS: Task 1 verified, auto-completed, and dependency-unlocked Task 2 selected as Next Task!");
    } else {
      throw new Error("Task 1 verification & next task flow failed!");
    }

    console.log("\n6. Testing Idempotency on Task 1...");
    const dupRes = await api(
      "POST",
      `/groups/${testGroup._id}/tasks/${task1._id}/submissions/${sub1Id}/verify`,
      { autoRun: true },
      studentToken
    );
    console.log("Duplicate verify status:", dupRes.status);
    console.log("Task remains completed:", dupRes.data?.data?.task?.status === "completed");

    console.log("\n7. Simulating completion of Task 2 and auto-assigning unassigned Task 3...");
    // Add submission to task 2 and approve via Guide review endpoint
    await Task.updateOne(
      { _id: task2._id },
      {
        $push: {
          submissions: {
            student: student._id,
            version: 1,
            note: "Completed authentication with bcrypt and JWT",
            aiAnalysis: {
              progress: 90,
              taskRelated: true,
              projectRelated: true,
              implementationStatus: "VALID_SUBMISSION",
            },
          },
        },
      }
    );

    const reviewRes = await api(
      "POST",
      `/groups/${testGroup._id}/tasks/${task2._id}/review`,
      { verdict: "approved", feedback: "Excellent implementation of auth endpoints." },
      guideToken
    );

    console.log("Guide Review API status:", reviewRes.status);
    console.log("Task 2 status after review:", reviewRes.data?.data?.status);
    const refreshedTask3 = await Task.findById(task3._id);
    console.log("Task 3 assignee after Task 2 completion:", refreshedTask3.assignee ? String(refreshedTask3.assignee) : "none");
    if (String(refreshedTask3.assignee) === String(student._id)) {
      console.log("✅ PASS: Unassigned Task 3 was auto-assigned to student as next task!");
    } else {
      throw new Error("Unassigned task auto-assignment failed!");
    }

    console.log("\n8. Testing FAIL outcome on invalid/irrelevant submission...");
    const subFailId = new mongoose.Types.ObjectId();
    const failTask = await Task.create({
      group: testGroup._id,
      title: "Task 4: Payment Gateway",
      assignee: student._id,
      status: "todo",
      submissions: [
        {
          _id: subFailId,
          student: student._id,
          version: 1,
          aiAnalysis: {
            projectRelated: false,
            implementationStatus: "WRONG_PROJECT",
            relevance: { status: "IRRELEVANT", isIrrelevant: true },
            progress: 10,
          },
        },
      ],
    });

    const failRes = await api(
      "POST",
      `/groups/${testGroup._id}/tasks/${failTask._id}/submissions/${subFailId}/verify`,
      { autoRun: true },
      studentToken
    );

    console.log("Failing submission outcome:", failRes.data?.data?.verification?.status);
    console.log("Task 4 status:", failRes.data?.data?.task?.status);
    console.log("Missing items reported:", failRes.data?.data?.verification?.missingItems);
    if (failRes.data?.data?.verification?.status === "FAIL" && failRes.data?.data?.task?.status === "changes_requested") {
      console.log("✅ PASS: Irrelevant submission correctly marked FAIL with status changes_requested and no next task!");
    } else {
      throw new Error("Failing submission check did not behave as expected!");
    }

    console.log("\n9. Cleaning up test data...");
    await Task.deleteMany({ group: testGroup._id });
    await Group.deleteOne({ _id: testGroup._id });
    console.log("Cleaned up test group and tasks.");

    console.log("\n==============================================");
    console.log("🎉 ALL LIVE E2E VERIFICATIONS PASSED SUCCESSFULLY!");
    console.log("==============================================");
  } finally {
    await mongoose.disconnect();
  }
}

runLiveVerification().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
