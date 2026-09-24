// Tests for Enhanced AI Task Completion & Verification Workflow
process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const {
  verifyTaskRequirements,
  findNextTaskForStudent,
  executeCompletionAndNextTask,
  detectDeliverableType,
  classifyEvidenceQuality,
} = require("../src/services/taskCompletionVerificationService");

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
const { recalcGroupProgress } = require("../src/controllers/groupController");

describe("AI Task Completion & Verification Workflow Upgrade", () => {
  const GROUP_ID = new mongoose.Types.ObjectId("64f000000000000000000001");
  const STUDENT_ID = new mongoose.Types.ObjectId("64f000000000000000000002");
  const GUIDE_ID = new mongoose.Types.ObjectId("64f000000000000000000003");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1. Deliverable Type Detection & Evidence Quality Classification", () => {
    test("detectDeliverableType identifies database, frontend, backend, documentation, ppt, report, and code", () => {
      expect(detectDeliverableType({ task: { title: "Create Database Schema", description: "Design MongoDB tables" } })).toBe("database");
      expect(detectDeliverableType({ task: { title: "Build React Dashboard Page", description: "Create responsive UI components" } })).toBe("frontend");
      expect(detectDeliverableType({ task: { title: "Express Auth Controller", description: "Create backend REST APIs" } })).toBe("backend");
      expect(detectDeliverableType({ task: { title: "Project Presentation", description: "Prepare slide deck for review" } })).toBe("presentation");
      expect(detectDeliverableType({ task: { title: "Audit Report Analysis", description: "Write final evaluation report" } })).toBe("report");
      expect(detectDeliverableType({ task: { title: "API Documentation", description: "Write README and user manual" } })).toBe("documentation");
      expect(detectDeliverableType({ task: { title: "Algorithm Implementation", description: "Write core utilities" } })).toBe("code");
    });

    test("classifyEvidenceQuality classifies NO_EVIDENCE when files and notes are empty", () => {
      const quality = classifyEvidenceQuality({
        task: { deliverableType: "backend" },
        submission: { files: [], note: "" },
        deliverableType: "backend",
      });
      expect(quality).toBe("NO_EVIDENCE");
    });

    test("classifyEvidenceQuality classifies UNREADABLE_EVIDENCE for corrupted or invalid ZIP", () => {
      const quality = classifyEvidenceQuality({
        task: { deliverableType: "backend" },
        submission: {
          files: [{ originalName: "archive.zip" }],
          aiAnalysis: { implementationStatus: "UNREADABLE_ZIP" },
        },
        deliverableType: "backend",
      });
      expect(quality).toBe("UNREADABLE_EVIDENCE");
    });

    test("classifyEvidenceQuality classifies INVALID_EVIDENCE for WRONG_PROJECT or duplicate plagiarism", () => {
      const quality = classifyEvidenceQuality({
        task: { deliverableType: "backend" },
        submission: {
          files: [{ originalName: "app.zip" }],
          aiAnalysis: { implementationStatus: "WRONG_PROJECT", relevance: { isIrrelevant: true } },
        },
        deliverableType: "backend",
      });
      expect(quality).toBe("INVALID_EVIDENCE");
    });

    test("classifyEvidenceQuality classifies VALID_EVIDENCE when files match deliverable expectations", () => {
      const quality = classifyEvidenceQuality({
        task: { deliverableType: "database" },
        submission: {
          files: [{ originalName: "db_schema.zip" }],
          aiAnalysis: {
            implementationStatus: "VALID_SUBMISSION",
            progress: 90,
            relevance: { evidence: { matchedFiles: ["models/User.js", "schema/Task.sql"] } },
          },
        },
        deliverableType: "database",
      });
      expect(quality).toBe("VALID_EVIDENCE");
    });
  });

  describe("2. Canonical 4-Stage Lifecycle & Grounded Verification Outcomes", () => {
    const task = {
      _id: new mongoose.Types.ObjectId(),
      title: "Implement Database Models",
      whatToDo: "Create schema and model definitions for User and Group",
      expectedOutput: "Database schema files and mongoose models",
      deliverableType: "database",
      completionCriteria: ["User model defined", "Group model defined"],
    };

    test("COMPLETE outcome sets progressPercent to 100% and autoCompleteEligible to true", async () => {
      const submission = {
        files: [{ originalName: "db.zip" }],
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "VALID_SUBMISSION",
          progress: 90,
          taskConfidence: 85,
          completedParts: ["Created User schema", "Created Group model"],
          relevance: { status: "RELEVANT", evidence: { matchedFiles: ["models/User.js"] } },
        },
      };

      const result = await verifyTaskRequirements({ task, submission, group: { _id: GROUP_ID } });
      expect(result.status).toBe("PASS");
      expect(result.completionStatus).toBe("COMPLETE");
      expect(result.progressPercent).toBe(100);
      expect(result.autoCompleteEligible).toBe(true);
      expect(result.evidenceQuality).toBe("VALID_EVIDENCE");
    });

    test("PARTIALLY_COMPLETE outcome retains 90% in review with missing criteria listed", async () => {
      const submission = {
        files: [{ originalName: "db_partial.zip" }],
        aiAnalysis: {
          projectRelated: true,
          taskRelated: true,
          implementationStatus: "PARTIAL_PROGRESS",
          progress: 55,
          completedParts: ["User model defined"],
          missingParts: ["Group model missing"],
        },
      };

      const result = await verifyTaskRequirements({ task, submission, group: { _id: GROUP_ID } });
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.completionStatus).toBe("PARTIALLY_COMPLETE");
      expect(result.progressPercent).toBe(90);
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.missingItems).toContain("Group model missing");
    });

    test("INSUFFICIENT_EVIDENCE outcome retains 90% in review and flags unreadable archive", async () => {
      const submission = {
        files: [{ originalName: "corrupt.zip" }],
        aiAnalysis: {
          implementationStatus: "UNREADABLE_ZIP",
        },
      };

      const result = await verifyTaskRequirements({ task, submission, group: { _id: GROUP_ID } });
      expect(result.status).toBe("FAIL");
      expect(result.completionStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.evidenceQuality).toBe("UNREADABLE_EVIDENCE");
      expect(result.autoCompleteEligible).toBe(false);
      expect(result.progressPercent).toBe(90);
    });
  });

  describe("3. executeCompletionAndNextTask Progress & VerifiedBy Stamping", () => {
    test("Sets status completed, progress 100%, and verifiedBy AI on auto-completion", async () => {
      const currentTask = {
        _id: new mongoose.Types.ObjectId(),
        title: "Frontend Navbar",
        assignee: STUDENT_ID,
        save: jest.fn().mockResolvedValue(true),
      };
      const submission = {
        verification: {
          evidenceQuality: "VALID_EVIDENCE",
        },
      };

      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const outcome = await executeCompletionAndNextTask({
        task: currentTask,
        submission,
        group: { _id: GROUP_ID, guide: GUIDE_ID },
        user: { _id: STUDENT_ID, name: "Student Bob" },
        isAuto: true,
      });

      expect(currentTask.status).toBe("completed");
      expect(currentTask.progress).toBe(100);
      expect(currentTask.verifiedBy).toBe("AI");
      expect(currentTask.completionStatus).toBe("COMPLETE");
      expect(currentTask.completedAt).toBeDefined();
      expect(submission.verification.progressPercent).toBe(100);
      expect(submission.verification.completionHandled).toBe(true);
      expect(notifyUsers).toHaveBeenCalled();
    });

    test("Sets verifiedBy GUIDE on guide manual approval override", async () => {
      const currentTask = {
        _id: new mongoose.Types.ObjectId(),
        title: "Backend API Endpoint",
        assignee: STUDENT_ID,
        save: jest.fn().mockResolvedValue(true),
      };
      const submission = {
        verification: {},
      };

      Task.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      await executeCompletionAndNextTask({
        task: currentTask,
        submission,
        group: { _id: GROUP_ID, guide: GUIDE_ID },
        user: { _id: GUIDE_ID, name: "Dr. Guide", role: "guide" },
        isAuto: false,
      });

      expect(currentTask.status).toBe("completed");
      expect(currentTask.progress).toBe(100);
      expect(currentTask.verifiedBy).toBe("GUIDE");
      expect(currentTask.completionReason).toMatch(/Dr\. Guide/);
    });
  });
});
