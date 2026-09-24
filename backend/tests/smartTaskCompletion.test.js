// Tests for Smart Task Completion → Next Task Flow
process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const {
  verifyTaskRequirements,
  findNextTaskForStudent,
  executeCompletionAndNextTask,
} = require("../src/services/taskCompletionVerificationService");

// Mock dependencies
jest.mock("../src/models/Task");
jest.mock("../src/services/notificationService", () => ({
  notifyUsers: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/activityService", () => ({
  logActivity: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/controllers/groupController", () => ({
  recalcGroupProgress: jest.fn().mockResolvedValue({ progress: 50 }),
}));

const Task = require("../src/models/Task");
const { notifyUsers } = require("../src/services/notificationService");
const { logActivity } = require("../src/services/activityService");
const { recalcGroupProgress } = require("../src/controllers/groupController");

describe("Smart Task Completion → Next Task Flow", () => {
  const GROUP_ID = new mongoose.Types.ObjectId("64f000000000000000000001");
  const OTHER_GROUP_ID = new mongoose.Types.ObjectId("64f000000000000000000099");
  const STUDENT_ID = new mongoose.Types.ObjectId("64f000000000000000000002");
  const OTHER_STUDENT_ID = new mongoose.Types.ObjectId("64f000000000000000000003");
  const GUIDE_ID = new mongoose.Types.ObjectId("64f000000000000000000004");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1. verifyTaskRequirements (Grounded AI Verification)", () => {
    const baseTask = {
      _id: new mongoose.Types.ObjectId(),
      title: "Build Authentication Controller",
      description: "Implement login, signup, and token generation in backend",
      module: "Backend",
      aiPlan: {
        acceptanceCriteria: ["Valid token generated on login", "Password hash comparison"],
        subtasks: [{ title: "Implement login" }, { title: "Implement signup" }],
      },
    };

    test("PASS: High-confidence on-task implementation without blockers", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "VALID_SUBMISSION",
          progress: 90,
          taskConfidence: 85,
          completedParts: ["Implemented login endpoint", "Added bcrypt password check"],
          missingParts: [],
          plagiarism: { detected: false, severity: "NONE" },
          codeReview: { score: 92, issues: [] },
          relevance: { status: "RELEVANT", isIrrelevant: false },
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID, project: "TeamSync AI" },
      });

      expect(result.status).toBe("PASS");
      expect(result.autoCompleteEligible).toBe(true);
      expect(result.score).toBe(90);
      expect(result.requirementsPassed).toContain("Project Alignment");
      expect(result.requirementsPassed).toContain("Task Implementation Scope");
      expect(result.requirementsPassed).toContain("Originality & Authorship");
      expect(result.missingItems).toHaveLength(0);
    });

    test("FAIL: Irrelevant submission from different project", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: false,
          implementationStatus: "WRONG_PROJECT",
          relevance: { status: "IRRELEVANT", isIrrelevant: true },
          progress: 10,
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID, project: "TeamSync AI" },
      });

      expect(result.status).toBe("FAIL");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.requirementsFailed).toContain("Project Alignment");
      expect(result.feedback).toMatch(/unrelated project/i);
    });

    test("FAIL: Project related but task features not implemented", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: false,
          implementationStatus: "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
          progress: 20,
          missingParts: ["Authentication logic missing"],
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID, project: "TeamSync AI" },
      });

      expect(result.status).toBe("FAIL");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.requirementsFailed).toContain("Task Implementation Scope");
      expect(result.feedback).toMatch(/assigned task features were not implemented/i);
    });

    test("FAIL: Unreadable or corrupted ZIP archive", async () => {
      const submission = {
        aiAnalysis: {
          implementationStatus: "UNREADABLE_ZIP",
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("FAIL");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.requirementsFailed).toContain("Archive Integrity");
      expect(result.feedback).toMatch(/could not be read/i);
    });

    test("FAIL: Duplicate code detected (Plagiarism DUPLICATE)", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "VALID_SUBMISSION",
          progress: 85,
          plagiarism: { detected: true, severity: "DUPLICATE", similarityScore: 98 },
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("FAIL");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.requirementsFailed).toContain("Originality & Authorship");
      expect(result.feedback).toMatch(/duplicate submission detected/i);
    });

    test("FAIL: Placeholder-only submission (progressLabel 'Not Started')", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          progressLabel: "Not Started",
          progress: 15,
          missingParts: ["Everything is TODO"],
          completedParts: [],
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("FAIL");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.feedback).toMatch(/placeholder or incomplete/i);
    });

    test("FAIL: Critical code review blockers with incomplete progress (< 80%)", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "PARTIAL_PROGRESS",
          progress: 60,
          codeReview: {
            issues: [{ severity: "CRITICAL", message: "Unhandled crash in auth handler" }],
          },
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("FAIL");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.requirementsFailed).toContain("Code Quality & Blocker Check");
      expect(result.missingItems).toContain("Unhandled crash in auth handler");
    });

    test("NEEDS_REVIEW: Critical code review blockers with otherwise complete progress (>= 80%)", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "VALID_SUBMISSION",
          progress: 85,
          codeReview: {
            issues: [{ severity: "CRITICAL", message: "Sensitive credential logged to console" }],
          },
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.feedback).toMatch(/guide approval/i);
    });

    test("NEEDS_REVIEW: High plagiarism similarity (HIGH)", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "VALID_SUBMISSION",
          progress: 85,
          plagiarism: { detected: true, severity: "HIGH", similarityScore: 78 },
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.feedback).toMatch(/guide review is required/i);
    });

    test("NEEDS_REVIEW: Partial progress (VALID_BUT_NEEDS_IMPROVEMENT)", async () => {
      const submission = {
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "VALID_BUT_NEEDS_IMPROVEMENT",
          progress: 65,
          missingParts: ["Token refresh logic missing"],
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.feedback).toMatch(/partially implemented/i);
    });

    test("NEEDS_REVIEW: Non-ZIP generic document submission (PDF / DOCX)", async () => {
      const submission = {
        aiAnalysis: {
          summary: "Architecture document uploaded",
          score: 75,
        },
      };

      const result = await verifyTaskRequirements({
        task: baseTask,
        submission,
        group: { _id: GROUP_ID },
      });

      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.feedback).toMatch(/document submission received/i);
    });
  });

  describe("2. findNextTaskForStudent (Dependency-Ready & Group-Isolated)", () => {
    test("Prioritizes dependency-ready task already assigned to the student", async () => {
      const completedTaskId = new mongoose.Types.ObjectId();
      const nextTaskId = new mongoose.Types.ObjectId();
      const blockedTaskId = new mongoose.Types.ObjectId();
      const depTaskId = new mongoose.Types.ObjectId();

      const mockTasks = [
        {
          _id: completedTaskId,
          title: "Setup Database",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "completed",
          dependencies: [],
        },
        {
          _id: depTaskId,
          title: "Build Base Auth",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "todo",
          priority: "medium",
          dependencies: [],
        },
        {
          _id: blockedTaskId,
          title: "Build OAuth Google Login",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "todo",
          priority: "critical",
          dependencies: [depTaskId], // BLOCKED by depTaskId
        },
      ];

      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTasks),
      });
      Task.findById = jest.fn().mockImplementation((id) => {
        const found = mockTasks.find((t) => String(t._id) === String(id));
        return Promise.resolve({ ...found, save: jest.fn().mockResolvedValue(found) });
      });

      const result = await findNextTaskForStudent({
        group: { _id: GROUP_ID },
        studentId: STUDENT_ID,
        completedTaskId,
      });

      expect(result.task).toBeDefined();
      expect(String(result.task._id)).toBe(String(depTaskId));
      expect(result.isAssigned).toBe(true);
      expect(result.autoAssigned).toBe(false);
    });

    test("Falls back to unassigned ready task and auto-assigns it", async () => {
      const completedTaskId = new mongoose.Types.ObjectId();
      const unassignedTaskId = new mongoose.Types.ObjectId();

      const mockTasks = [
        {
          _id: completedTaskId,
          title: "Setup Database",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "completed",
        },
        {
          _id: unassignedTaskId,
          title: "Setup Redis Cache",
          group: GROUP_ID,
          assignee: null,
          status: "backlog",
          priority: "high",
          dependencies: [],
        },
      ];

      const saveMock = jest.fn().mockResolvedValue({});
      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTasks),
      });
      Task.findById = jest.fn().mockImplementation((id) => {
        const found = mockTasks.find((t) => String(t._id) === String(id));
        return Promise.resolve({
          ...found,
          save: saveMock,
        });
      });

      const result = await findNextTaskForStudent({
        group: { _id: GROUP_ID },
        studentId: STUDENT_ID,
        completedTaskId,
      });

      expect(result.task).toBeDefined();
      expect(String(result.task._id)).toBe(String(unassignedTaskId));
      expect(result.isAssigned).toBe(true);
      expect(result.autoAssigned).toBe(true);
      expect(saveMock).toHaveBeenCalled();
    });

    test("Group Isolation: Never selects tasks from a different group", async () => {
      const completedTaskId = new mongoose.Types.ObjectId();

      Task.find = jest.fn().mockImplementation((query) => {
        expect(String(query.group)).toBe(String(GROUP_ID));
        return {
          lean: jest.fn().mockResolvedValue([]),
        };
      });

      const result = await findNextTaskForStudent({
        group: { _id: GROUP_ID },
        studentId: STUDENT_ID,
        completedTaskId,
      });

      expect(result.task).toBeNull();
      expect(result.allCompleted).toBe(true);
    });

    test("Student Isolation: Never selects tasks assigned to other students", async () => {
      const completedTaskId = new mongoose.Types.ObjectId();
      const otherStudentTaskId = new mongoose.Types.ObjectId();

      const mockTasks = [
        {
          _id: completedTaskId,
          title: "Setup Database",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "completed",
        },
        {
          _id: otherStudentTaskId,
          title: "Design Frontend Theme",
          group: GROUP_ID,
          assignee: OTHER_STUDENT_ID,
          status: "in_progress",
          priority: "high",
          dependencies: [],
        },
      ];

      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTasks),
      });

      const result = await findNextTaskForStudent({
        group: { _id: GROUP_ID },
        studentId: STUDENT_ID,
        completedTaskId,
      });

      expect(result.task).toBeNull();
      expect(result.allCompletedForStudent).toBe(true);
      expect(result.message).toMatch(/completed all your assigned tasks/i);
    });

    test("All blocked: Returns allBlocked: true when all student tasks wait on dependencies", async () => {
      const completedTaskId = new mongoose.Types.ObjectId();
      const depTaskId = new mongoose.Types.ObjectId();
      const blockedTaskId = new mongoose.Types.ObjectId();

      const mockTasks = [
        {
          _id: completedTaskId,
          title: "Task 1",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "completed",
        },
        {
          _id: depTaskId,
          title: "Upstream Task (Other Student)",
          group: GROUP_ID,
          assignee: OTHER_STUDENT_ID,
          status: "in_progress",
        },
        {
          _id: blockedTaskId,
          title: "Student Task 2",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "todo",
          dependencies: [depTaskId],
        },
      ];

      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTasks),
      });

      const result = await findNextTaskForStudent({
        group: { _id: GROUP_ID },
        studentId: STUDENT_ID,
        completedTaskId,
      });

      expect(result.task).toBeNull();
      expect(result.allBlocked).toBe(true);
      expect(result.message).toMatch(/waiting on incomplete dependencies/i);
    });
  });

  describe("3. executeCompletionAndNextTask (Workflow & Idempotency)", () => {
    test("Executes completion, updates status, saves next task, notifies student and guide", async () => {
      const taskId = new mongoose.Types.ObjectId();
      const nextTaskId = new mongoose.Types.ObjectId();

      const task = {
        _id: taskId,
        title: "Task Under Completion",
        group: GROUP_ID,
        assignee: { _id: STUDENT_ID, name: "Alice" },
        status: "submitted",
        save: jest.fn().mockResolvedValue(true),
      };

      const submission = {
        verification: {
          status: "PASS",
          score: 95,
        },
      };

      const mockGroupTasks = [
        {
          _id: taskId,
          title: "Task Under Completion",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "completed",
        },
        {
          _id: nextTaskId,
          title: "Next Priority Task",
          group: GROUP_ID,
          assignee: STUDENT_ID,
          status: "todo",
          priority: "high",
          dependencies: [],
        },
      ];

      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockGroupTasks),
      });
      Task.findById = jest.fn().mockImplementation((id) => {
        const found = mockGroupTasks.find((t) => String(t._id) === String(id));
        return Promise.resolve({ ...found, save: jest.fn().mockResolvedValue(found) });
      });

      const outcome = await executeCompletionAndNextTask({
        task,
        submission,
        group: { _id: GROUP_ID, guide: GUIDE_ID },
        user: { name: "Alice" },
        isAuto: true,
      });

      expect(task.status).toBe("completed");
      expect(task.completedAt).toBeDefined();
      expect(task.nextTask).toBeDefined();
      expect(String(task.nextTask.id)).toBe(String(nextTaskId));
      expect(submission.verification.completionHandled).toBe(true);
      expect(task.save).toHaveBeenCalled();

      // Notifications sent to student and guide
      expect(notifyUsers).toHaveBeenCalledTimes(2);
      expect(recalcGroupProgress).toHaveBeenCalledWith(GROUP_ID);
      expect(logActivity).toHaveBeenCalled();
      expect(outcome.nextTask).toBeDefined();
    });

    test("Idempotency: Repeated calls do not duplicate completions or notifications", async () => {
      const task = {
        _id: new mongoose.Types.ObjectId(),
        title: "Already Completed Task",
        status: "completed",
        save: jest.fn(),
      };

      const submission = {
        verification: {
          completionHandled: true,
          nextTask: { id: new mongoose.Types.ObjectId(), title: "Existing Next Task" },
        },
      };

      const outcome = await executeCompletionAndNextTask({
        task,
        submission,
        group: { _id: GROUP_ID },
        user: { name: "Alice" },
        isAuto: true,
      });

      expect(outcome.alreadyHandled).toBe(true);
      expect(task.save).not.toHaveBeenCalled();
      expect(notifyUsers).not.toHaveBeenCalled();
      expect(recalcGroupProgress).not.toHaveBeenCalled();
    });
  });
});
