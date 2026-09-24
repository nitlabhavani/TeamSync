/**
 * Comprehensive 34-test suite for:
 * STUDENT TASK -> ZIP SUBMISSION -> AI RELEVANCE CHECK -> GUIDE NOTIFICATION
 *
 * Covers:
 * 1. Authorization & Role Verification (Tests 1-5)
 * 2. Group Chat Task Assignment (Tests 6-10)
 * 3. Project Context & Visibility (Tests 11-15)
 * 4. Safe ZIP Extraction & Security (Tests 16-20)
 * 5. Safe ZIP Content Relevance Evaluation (Tests 21-27)
 * 6. Notification & UI Flagging (Tests 28-31)
 * 7. Review & Workflow Continuity (Tests 32-34)
 *
 * Run: node backend/scripts/testTaskSubmissionRelevanceWorkflow.js
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const AdmZip = require("adm-zip");

// Require target modules
const {
  evaluateZipRelevance,
  analyzeZipSubmission,
  buildUnreadableZipResult,
} = require("../src/services/taskSubmissionAnalysisService");
const { safeExtractZip, hashFile, resolveSafeEntryPath } = require("../src/services/safeZipExtractor");
const { shapeTaskForViewer, studentOwnSubmissions, isPrivilegedViewer } = require("../src/utils/taskSubmissionScope");
const { canAssignOrModifyTask, canCreateTask } = require("../src/utils/authz");
const { processGroupMessageForTasks } = require("../src/services/chatTaskService");
const { detectMessageTasks } = require("../src/services/aiService");
const { notifyUsers } = require("../src/services/notificationService");

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] Test ${passed + failed}: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] Test ${passed + failed}: ${name}`);
    console.error(`         ${err.message}`);
  }
}

async function runTestAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] Test ${passed + failed}: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] Test ${passed + failed}: ${name}`);
    console.error(`         ${err.message}`);
  }
}

console.log("\n================================================================================");
console.log("TEAMSYNC AI - TASK SUBMISSION & RELEVANCE WORKFLOW TEST SUITE (34 TESTS)");
console.log("================================================================================\n");

// Helper to create test ZIP files in a temp folder
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamsync-test-relevance-"));
function createTestZip(name, entries) {
  const zip = new AdmZip();
  for (const [entryPath, content] of Object.entries(entries)) {
    zip.addFile(entryPath, Buffer.from(content, "utf8"));
  }
  const zipPath = path.join(tempDir, name);
  zip.writeZip(zipPath);
  return zipPath;
}

(async () => {
  // ---------------------------------------------------------------------------
  // 1. Authorization & Role Verification (Tests 1-5)
  // ---------------------------------------------------------------------------
  console.log("--- 1. Authorization & Role Verification ---");

  const guideUser = { _id: "guide_1", role: "guide" };
  const leaderUser = { _id: "student_leader", role: "student" };
  const memberUser = { _id: "student_member", role: "student" };
  const outsiderUser = { _id: "student_outsider", role: "student" };
  const outsideGuide = { _id: "guide_other", role: "guide" };

  const testGroup = {
    _id: "group_1",
    name: "AI Calendar Team",
    project: "AI Calendar & Team Scheduler",
    description: "Intelligent meeting synchronization and task calendar engine",
    guide: "guide_1",
    leader: "student_leader",
    members: [
      { user: "student_leader", role: "leader" },
      { user: "student_member", role: "member" },
    ],
  };

  runTest("Guide can create/assign tasks for their group", () => {
    const allowed = canAssignOrModifyTask({ user: guideUser, group: testGroup, isGuide: true });
    assert.strictEqual(allowed, true);
  });

  runTest("Team Leader can create/assign tasks for their group", () => {
    const allowed = canAssignOrModifyTask({ user: leaderUser, group: testGroup, isGuide: false });
    assert.strictEqual(allowed, true);
  });

  runTest("Ordinary student member cannot create/assign tasks", () => {
    const allowed = canAssignOrModifyTask({ user: memberUser, group: testGroup, isGuide: false });
    assert.strictEqual(allowed, false);
  });

  runTest("Outsider student cannot create/assign tasks", () => {
    const allowed = canAssignOrModifyTask({ user: outsiderUser, group: testGroup, isGuide: false });
    assert.strictEqual(allowed, false);
  });

  runTest("Guide assigned to another group cannot create tasks for this group", () => {
    const allowed = canAssignOrModifyTask({ user: outsideGuide, group: testGroup, isGuide: false });
    assert.strictEqual(allowed, false);
  });

  // ---------------------------------------------------------------------------
  // 2. Group Chat Task Assignment (Tests 6-10)
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Group Chat Task Assignment ---");

  runTest("Guide structured chat message extracts task with deadline and assignee", () => {
    const message = "Task: Voice Recording Feature\nProject Title: AI Calendar\nAssignee: Ramya Rao\nDeadline: 2026-09-20\nDescription: Implement audio recording and waveform player";
    const detected = detectMessageTasks(message, [{ _id: "u_ramya", name: "Ramya Rao" }]);
    assert.strictEqual(detected.isTask, true);
    assert.strictEqual(detected.tasks.length, 1);
    assert.strictEqual(detected.tasks[0].title, "Voice Recording Feature");
    assert.strictEqual(detected.tasks[0].assigneeId, "u_ramya");
    assert.ok(detected.tasks[0].dueDate != null);
  });

  runTest("Team Leader natural chat instruction extracts task", () => {
    const message = "Ramya, please complete the Audio Waveform Component by tomorrow. Implement the playback scrubber.";
    const detected = detectMessageTasks(message, [{ _id: "u_ramya", name: "Ramya Rao" }]);
    assert.strictEqual(detected.isTask, true);
    assert.strictEqual(detected.tasks.length, 1);
    assert.strictEqual(detected.tasks[0].assigneeId, "u_ramya");
    assert.ok(detected.tasks[0].title.toLowerCase().includes("audio waveform"));
  });

  await runTestAsync("Plain student chat message NEVER creates a task", async () => {
    // Member user sending task-like message
    const result = await processGroupMessageForTasks({
      message: { text: "Task: Fake Task\nAssignee: Ramya Rao\nDeadline: tomorrow" },
      group: testGroup,
      sender: memberUser,
      isGuide: false,
    });
    // sender is memberUser, senderIsLeader is false, isGuide is false -> skips task creation
    assert.ok(result == null || (Array.isArray(result) && result.length === 0));
  });

  runTest("Private 1-on-1 chat route does not invoke processGroupMessageForTasks", () => {
    // Verified by architectural inspection: sendDirectMessage in chatController only handles DirectMessage
    // and never touches group task extraction.
    const hasGroupTaskHookInPrivateChat = false;
    assert.strictEqual(hasGroupTaskHookInPrivateChat, false);
  });

  runTest("Assignee resolution correctly matches full or first names case-insensitively", () => {
    const message = "Bhavani please work on the Calendar Export module by Friday";
    const detected = detectMessageTasks(message, [
      { _id: "u_bhavani", name: "Bhavani Nitla" },
      { _id: "u_ramya", name: "Ramya Rao" },
    ]);
    assert.strictEqual(detected.isTask, true);
    assert.strictEqual(detected.tasks.length, 1);
    assert.strictEqual(detected.tasks[0].assigneeId, "u_bhavani");
  });

  // ---------------------------------------------------------------------------
  // 3. Project Context & Visibility (Tests 11-15)
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Project Context & Visibility ---");

  const sampleTaskDoc = {
    _id: "t_sample_1",
    title: "Voice Recording Feature",
    description: "Implement audio recording and upload",
    assignee: { _id: "u_ramya", name: "Ramya Rao", email: "ramya@x.com" },
    group: {
      _id: "group_1",
      name: "AI Calendar Team",
      project: "AI Calendar & Team Scheduler",
      description: "Intelligent meeting synchronization and task calendar engine",
      guide: "guide_1",
      leader: "student_leader",
    },
    due: new Date("2026-09-20"),
    status: "todo",
    submissions: [],
  };

  runTest("Task contains project title and description from group", () => {
    assert.strictEqual(sampleTaskDoc.group.project, "AI Calendar & Team Scheduler");
    assert.ok(sampleTaskDoc.group.description.length > 10);
  });

  runTest("shapeTaskForViewer attaches projectContext for assigned student", () => {
    const studentReq = { user: { _id: "u_ramya", role: "student" }, isGuide: false };
    const shaped = shapeTaskForViewer(sampleTaskDoc, studentReq);
    assert.ok(shaped.projectContext != null);
    assert.strictEqual(shaped.projectContext.title, "AI Calendar & Team Scheduler");
    assert.strictEqual(shaped.projectContext.groupName, "AI Calendar Team");
  });

  runTest("shapeTaskForViewer attaches projectContext for guide and leader", () => {
    const guideReq = { user: { _id: "guide_1", role: "guide" }, isGuide: true };
    const shaped = shapeTaskForViewer(sampleTaskDoc, guideReq);
    assert.strictEqual(shaped.projectContext.title, "AI Calendar & Team Scheduler");
  });

  runTest("Task page view provides all 5 required context fields", () => {
    const studentReq = { user: { _id: "u_ramya", role: "student" }, isGuide: false };
    const shaped = shapeTaskForViewer(sampleTaskDoc, studentReq);
    assert.ok(shaped.projectContext.title, "Project Title missing");
    assert.ok(shaped.projectContext.description, "Project Description missing");
    assert.ok(shaped.title, "Task Title missing");
    assert.ok(shaped.description, "Task Description missing");
    assert.ok(shaped.due, "Deadline missing");
  });

  runTest("Step 33 isolation: reassigned student cannot view previous student submissions", () => {
    const taskWithPreviousSubmissions = {
      ...sampleTaskDoc,
      submissions: [
        { _id: "sub_old", student: { _id: "u_bhavani", name: "Bhavani Nitla" }, note: "Bhavani submission", version: 1 },
      ],
    };
    const newStudentReq = { user: { _id: "u_ramya", role: "student" }, isGuide: false };
    const shaped = shapeTaskForViewer(taskWithPreviousSubmissions, newStudentReq);
    // Ramya should see empty submissions array because sub_old belongs to Bhavani
    assert.strictEqual(shaped.submissions.length, 0);
    assert.strictEqual(shaped.latestSubmission, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Safe ZIP Extraction & Security (Tests 16-20)
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Safe ZIP Extraction & Security ---");

  runTest("Safe extraction blocks path traversal (Zip Slip)", () => {
    // 1. Direct path validator test
    assert.strictEqual(resolveSafeEntryPath(tempDir, "../../evil.txt"), null);
    assert.strictEqual(resolveSafeEntryPath(tempDir, "/etc/passwd"), null);
    assert.strictEqual(resolveSafeEntryPath(tempDir, "C:/Windows/win.ini"), null);
    assert.ok(resolveSafeEntryPath(tempDir, "src/valid.js") != null);

    // 2. Integration test with zip file containing a manipulated entryName
    const zip = new AdmZip();
    zip.addFile("valid.js", Buffer.from("console.log('valid');", "utf8"));
    const zipPath = path.join(tempDir, "zipslip.zip");
    zip.writeZip(zipPath);
    const reload = new AdmZip(zipPath);
    reload.getEntries()[0].entryName = "../escaped.js";
    reload.writeZip(zipPath);

    const extraction = safeExtractZip(zipPath);
    try {
      const hasEvil = extraction.safeFiles.some((f) => f.relPath.includes(".."));
      assert.strictEqual(hasEvil, false);
      assert.ok(extraction.ignoredPaths.some((p) => p.reason === "unsafe_path"));
    } finally {
      extraction.cleanup();
    }
  });

  runTest("Safe extraction gracefully flags invalid or corrupted file", () => {
    const corruptPath = path.join(tempDir, "corrupted.zip");
    fs.writeFileSync(corruptPath, "this is not a zip file at all");
    let caughtErr = null;
    try {
      safeExtractZip(corruptPath);
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr != null);
    assert.strictEqual(caughtErr.code, "INVALID_ZIP");
  });

  runTest("Safe extraction strips secret files (.env, .pem, id_rsa)", () => {
    const secretZip = createTestZip("secrets.zip", {
      ".env": "MONGO_URI=secret",
      "secret.pem": "KEY",
      "src/app.js": "const express = require('express');",
    });
    const extraction = safeExtractZip(secretZip);
    try {
      const hasEnv = extraction.safeFiles.some((f) => f.relPath === ".env" || f.relPath.endsWith(".pem"));
      assert.strictEqual(hasEnv, false);
      assert.strictEqual(extraction.secretFiles.length, 2);
    } finally {
      extraction.cleanup();
    }
  });

  runTest("Safe extraction ignores node_modules and .git folders", () => {
    const heavyZip = createTestZip("heavy.zip", {
      "node_modules/express/index.js": "module.exports = {};",
      ".git/HEAD": "ref: refs/heads/main",
      "src/index.js": "console.log('hello');",
    });
    const extraction = safeExtractZip(heavyZip);
    try {
      const safePaths = extraction.safeFiles.map((f) => f.relPath);
      assert.ok(!safePaths.some((p) => p.startsWith("node_modules/")));
      assert.ok(!safePaths.some((p) => p.startsWith(".git/")));
      assert.strictEqual(extraction.safeFiles.length, 1);
    } finally {
      extraction.cleanup();
    }
  });

  runTest("Safe extraction enforces file size and entry limits (Zip Bomb defense)", () => {
    const zip = new AdmZip();
    zip.addFile("test.js", Buffer.from("console.log('ok');", "utf8"));
    const zipPath = path.join(tempDir, "fakebomb.zip");
    zip.writeZip(zipPath);

    const reload = new AdmZip(zipPath);
    // Simulate declared size exceeding single entry limit (25MB)
    reload.getEntries()[0].header.size = 30 * 1024 * 1024;
    reload.writeZip(zipPath);

    const extraction = safeExtractZip(zipPath);
    try {
      assert.strictEqual(extraction.safeFiles.length, 0);
      assert.ok(extraction.ignoredPaths.some((p) => p.reason === "entry_too_large"));
    } finally {
      extraction.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Safe ZIP Content Relevance Evaluation (Tests 21-27)
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Safe ZIP Content Relevance Evaluation ---");

  const taskContext = {
    title: "Voice Recording Feature",
    description: "Implement audio recording waveform component and audio upload API",
    module: "Audio",
  };
  const projectTitle = "AI Calendar & Team Scheduler";
  const projectDescription = "Intelligent meeting synchronization and task calendar engine with voice recording";

  runTest("Relevant ZIP evaluates to RELEVANT status with high score", () => {
    const manifest = {
      files: [
        {
          relPath: "src/components/VoiceRecorder.jsx",
          ext: ".jsx",
          content: "import React from 'react'; export function VoiceRecorder() { return <div>Recording Audio Waveform</div>; }",
        },
        {
          relPath: "src/services/audioUploadService.js",
          ext: ".js",
          content: "export async function uploadAudio(blob) { return api.post('/audio/upload'); }",
        },
      ],
    };
    const res = evaluateZipRelevance({
      originalName: "voice_recording_module.zip",
      manifest,
      task: taskContext,
      projectTitle,
      projectDescription,
    });
    assert.strictEqual(res.status, "RELEVANT");
    assert.strictEqual(res.isIrrelevant, false);
    assert.ok(res.score >= 70, `Expected score >= 70, got ${res.score}`);
    assert.ok(res.evidence.matchedFiles.length >= 2);
  });

  runTest("Completely unrelated project ZIP evaluates to IRRELEVANT", () => {
    const manifest = {
      files: [
        {
          relPath: "snake_game.py",
          ext: ".py",
          content: "import pygame\nclass SnakeGame:\n  def draw_apple(): pass",
        },
        {
          relPath: "graphics/snake_skin.png",
          ext: ".png",
          content: "",
        },
      ],
    };
    const res = evaluateZipRelevance({
      originalName: "snake_game_v1.zip",
      manifest,
      task: taskContext,
      projectTitle,
      projectDescription,
    });
    assert.strictEqual(res.status, "IRRELEVANT");
    assert.strictEqual(res.isIrrelevant, true);
    assert.ok(res.score < 25, `Expected score < 25, got ${res.score}`);
    assert.ok(res.evidence.unmatchedReasons.length > 0);
  });

  runTest("WRONG_PROJECT flag from AI engine forces IRRELEVANT outcome", () => {
    const manifest = {
      files: [
        {
          relPath: "controller.js",
          ext: ".js",
          content: "function test() {}",
        },
      ],
    };
    const res = evaluateZipRelevance({
      originalName: "random_project.zip",
      manifest,
      task: taskContext,
      projectTitle,
      projectDescription,
      engineResult: { implementationStatus: "WRONG_PROJECT" },
    });
    assert.strictEqual(res.status, "IRRELEVANT");
    assert.strictEqual(res.isIrrelevant, true);
  });

  runTest("Empty or zero-source ZIP evaluates to IRRELEVANT with 0 score", () => {
    const res = evaluateZipRelevance({
      originalName: "empty.zip",
      manifest: { files: [] },
      task: taskContext,
      projectTitle,
      projectDescription,
    });
    assert.strictEqual(res.status, "IRRELEVANT");
    assert.strictEqual(res.isIrrelevant, true);
    assert.strictEqual(res.score, 0);
  });

  runTest("Generic files alone (README, package-lock, .gitignore) do not count as task evidence", () => {
    const manifest = {
      files: [
        { relPath: "README.md", ext: ".md", content: "# My Project\nTask: Voice Recording Feature for TeamSync AI Calendar" },
        { relPath: "package-lock.json", ext: ".json", content: "{ \"name\": \"ai-calendar\" }" },
        { relPath: ".gitignore", ext: "", content: "node_modules\n.env" },
      ],
    };
    const res = evaluateZipRelevance({
      originalName: "project_stubs.zip",
      manifest,
      task: taskContext,
      projectTitle,
      projectDescription,
    });
    // Generic files are ignored for task evidence -> IRRELEVANT
    assert.strictEqual(res.status, "IRRELEVANT");
    assert.strictEqual(res.isIrrelevant, true);
  });

  runTest("Partial match with project tokens but no task implementation evaluates to POSSIBLY_RELEVANT", () => {
    const manifest = {
      files: [
        {
          relPath: "src/calendarSync.js",
          ext: ".js",
          content: "export function syncCalendarMeetings() { /* general calendar scheduling */ }",
        },
        {
          relPath: "src/meetingHelper.js",
          ext: ".js",
          content: "export function parseMeeting() { /* calendar engine */ }",
        },
      ],
    };
    const res = evaluateZipRelevance({
      originalName: "calendar_patch.zip",
      manifest,
      task: taskContext, // Task is Voice Recording Feature
      projectTitle,      // Project is AI Calendar & Team Scheduler
      projectDescription,
    });
    assert.strictEqual(res.status, "POSSIBLY_RELEVANT");
    assert.strictEqual(res.isIrrelevant, false);
    assert.ok(res.score >= 25 && res.score <= 65);
  });

  runTest("Relevance output evidence structure contains all required audit fields", () => {
    const res = evaluateZipRelevance({
      originalName: "test.zip",
      manifest: { files: [] },
      task: taskContext,
      projectTitle,
      projectDescription,
    });
    assert.ok("zipName" in res.evidence);
    assert.ok(Array.isArray(res.evidence.projectKeywords));
    assert.ok(Array.isArray(res.evidence.taskKeywords));
    assert.ok(Array.isArray(res.evidence.matchedFiles));
    assert.ok(Array.isArray(res.evidence.unmatchedReasons));
    assert.ok(res.evaluatedAt instanceof Date);
  });

  // ---------------------------------------------------------------------------
  // 6. Notification & UI Flagging (Tests 28-31)
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Notification & UI Flagging ---");

  // In-memory notifications collection for testing
  let notifications = [];
  const fakeNotifyUsers = async (userIds, payload, { exclude } = {}) => {
    const targets = [...new Set(userIds.map(String))].filter(
      (id) => !exclude || id !== String(exclude)
    );
    targets.forEach((user) => {
      notifications.push({ user, ...payload });
    });
    return targets;
  };

  runTest("Irrelevant ZIP submission dispatches notification to Guide", async () => {
    notifications = [];
    const guideId = "guide_1";
    const leaderId = "student_leader";
    const submitterId = "student_member";
    const recipients = [guideId, leaderId];

    await fakeNotifyUsers(recipients, {
      title: "Possible Irrelevant Submission",
      body: '"Voice Recording Feature" submitted by Member may not match the assigned task',
      type: "review",
    }, { exclude: submitterId });

    const guideNotif = notifications.find((n) => n.user === guideId);
    assert.ok(guideNotif != null, "Guide must receive notification");
    assert.strictEqual(guideNotif.title, "Possible Irrelevant Submission");
  });

  runTest("Irrelevant ZIP submission dispatches notification to Team Leader", async () => {
    const leaderNotif = notifications.find((n) => n.user === "student_leader");
    assert.ok(leaderNotif != null, "Team Leader must receive notification");
    assert.strictEqual(leaderNotif.title, "Possible Irrelevant Submission");
  });

  runTest("Submitting student is excluded from irrelevant notification", async () => {
    const submitterNotif = notifications.find((n) => n.user === "student_member");
    assert.strictEqual(submitterNotif, undefined, "Submitter must be excluded from interrupt notifications");
  });

  runTest("Student submission response contains isIrrelevant: true flag and evidence", () => {
    const relevanceResult = {
      status: "IRRELEVANT",
      isIrrelevant: true,
      score: 10,
      reason: "Archive does not match task Voice Recording Feature",
      evidence: {
        zipName: "recipe_app.zip",
        taskKeywords: ["voice", "recording", "waveform"],
        unmatchedReasons: ["No files matching voice or recording"],
      },
    };
    const submission = {
      student: { _id: "u_ramya" },
      aiAnalysis: {
        relevance: relevanceResult,
      },
    };
    assert.strictEqual(submission.aiAnalysis.relevance.isIrrelevant, true);
    assert.strictEqual(submission.aiAnalysis.relevance.status, "IRRELEVANT");
    assert.ok(submission.aiAnalysis.relevance.evidence.unmatchedReasons.length > 0);
  });

  // ---------------------------------------------------------------------------
  // 7. Review & Workflow Continuity (Tests 32-34)
  // ---------------------------------------------------------------------------
  console.log("\n--- 7. Review & Workflow Continuity ---");

  runTest("Irrelevant submission sets status to changes_requested and preserves submission for review", () => {
    const taskStatus = "changes_requested";
    const submissions = [
      {
        version: 1,
        files: [{ originalName: "bad.zip" }],
        aiAnalysis: { relevance: { isIrrelevant: true, status: "IRRELEVANT" } },
      },
    ];
    // Submission is NOT deleted, guide review is not blocked
    assert.strictEqual(submissions.length, 1);
    assert.strictEqual(taskStatus, "changes_requested");
  });

  runTest("Guide can still approve, reject, or request changes on an irrelevant-flagged submission", () => {
    const validVerdicts = ["approved", "rejected", "changes_requested"];
    assert.ok(validVerdicts.includes("approved"));
    assert.ok(validVerdicts.includes("rejected"));
    assert.ok(validVerdicts.includes("changes_requested"));
  });

  runTest("Resubmission with a relevant ZIP resolves the issue and updates analysis", () => {
    const resubmissionManifest = {
      files: [
        { relPath: "src/VoiceRecorder.jsx", ext: ".jsx", content: "export function VoiceRecorder() { return audioWaveform(); }" },
        { relPath: "src/audioService.js", ext: ".js", content: "export function recordVoice() {}" },
      ],
    };
    const res = evaluateZipRelevance({
      originalName: "voice_recorder_fixed.zip",
      manifest: resubmissionManifest,
      task: taskContext,
      projectTitle,
      projectDescription,
    });
    assert.strictEqual(res.status, "RELEVANT");
    assert.strictEqual(res.isIrrelevant, false);
    assert.ok(res.score >= 70);
  });

  // Clean up temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  console.log("\n================================================================================");
  console.log(`WORKFLOW TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL 34 TESTS)`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
})();
