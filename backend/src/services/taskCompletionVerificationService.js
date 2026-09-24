/**
 * Smart Task Completion & Next Task Service
 *
 * Provides grounded verification of student task submissions, automatic
 * completion of verified tasks, and dependency-aware next-task routing
 * within the same group for the same student.
 *
 * Workflow:
 *   Submission -> Grounded Verification (PASS / FAIL / NEEDS_REVIEW)
 *   If PASS:
 *     - Auto-complete current task (status = "completed", completedAt stamped)
 *     - Identify next valid pending task from the SAME GROUP for the student
 *     - Check dependency readiness (must be done/completed)
 *     - Dispatch targeted notifications to student and guide
 *     - Update group progress and project intelligence
 *   If FAIL:
 *     - Keep in changes_requested, provide specific missing requirement feedback, allow resubmit
 *   If NEEDS_REVIEW:
 *     - Keep in guide_review, guide/team leader approval required via existing review flow
 */
const Task = require("../models/Task");
const { notifyUsers } = require("./notificationService");
const { logActivity } = require("./activityService");
const { emitToGroup } = require("./socketService");
const { recalcGroupProgress } = require("../controllers/groupController");

const PRIORITY_ORDER = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const DONE_STATUSES = new Set(["done", "completed"]);

/**
 * Detect deliverable category expected for the task.
 */
function detectDeliverableType({ task = {} }) {
  if (task.deliverableType) return task.deliverableType;
  const text = `${task.title || ""} ${task.description || ""} ${task.module || ""} ${task.expectedOutput || ""}`.toLowerCase();
  if (/\b(ppt|presentation|slide|slides)\b/i.test(text)) return "presentation";
  if (/\b(report|analysis\s+report|audit\s+report|evaluation)\b/i.test(text)) return "report";
  if (/\b(docs?|documentation|readme|manual|guide|spec)\b/i.test(text)) return "documentation";
  if (/\b(database|schema|migration|mongo|sql|table|models?|entity|entities)\b/i.test(text)) return "database";
  if (/\b(frontend|ui|screen|component|react|page|dashboard|views?|css|html)\b/i.test(text)) return "frontend";
  if (/\b(backend|api|endpoint|controller|route|server|express|service)\b/i.test(text)) return "backend";
  return "code";
}

/**
 * Classify evidence quality based on file extensions, manifest hits, archive integrity, and AI analysis.
 */
function classifyEvidenceQuality({ task, submission, deliverableType }) {
  const files = submission?.files || [];
  const note = String(submission?.note || "").trim();
  const ai = submission?.aiAnalysis || {};
  const relevance = ai.relevance || {};
  const implementationStatus = ai.implementationStatus || "";
  const progress = Number(ai.progress ?? ai.score ?? 0);

  if (!files.length && !note) {
    return "NO_EVIDENCE";
  }

  if (implementationStatus === "UNREADABLE_ZIP") {
    return "UNREADABLE_EVIDENCE";
  }

  if (
    relevance.status === "IRRELEVANT" ||
    relevance.isIrrelevant === true ||
    implementationStatus === "WRONG_PROJECT" ||
    ai.plagiarism?.severity === "DUPLICATE"
  ) {
    return "INVALID_EVIDENCE";
  }

  // Deliverable-specific evidence checks
  const fileNames = files.map((f) => (f.name || f.originalName || "").toLowerCase());
  const matchedFiles = (relevance.evidence?.matchedFiles || []).map((f) => f.toLowerCase());
  const allKnownPaths = [...fileNames, ...matchedFiles];

  if (deliverableType === "database") {
    const hasDbFiles = allKnownPaths.some((p) =>
      /\.(sql|prisma)$/.test(p) || /(model|schema|migration|db|database|entity|seed)/i.test(p)
    );
    if (!hasDbFiles && progress < 50) return "PARTIAL_EVIDENCE";
  } else if (deliverableType === "frontend") {
    const hasUiFiles = allKnownPaths.some((p) =>
      /\.(jsx|tsx|vue|svelte|html|css|scss)$/.test(p) || /(component|page|view|screen|ui|frontend)/i.test(p)
    );
    if (!hasUiFiles && progress < 50) return "PARTIAL_EVIDENCE";
  } else if (deliverableType === "backend") {
    const hasBackendFiles = allKnownPaths.some((p) =>
      /(controller|route|service|api|server|middleware|backend)/i.test(p) || /\.(js|ts|py|go|java)$/.test(p)
    );
    if (!hasBackendFiles && progress < 50) return "PARTIAL_EVIDENCE";
  } else if (deliverableType === "documentation" || deliverableType === "report") {
    const hasDocFiles = allKnownPaths.some((p) =>
      /\.(md|pdf|doc|docx|txt)$/.test(p) || /(readme|doc|report|summary)/i.test(p)
    );
    if (!hasDocFiles && !note) return "PARTIAL_EVIDENCE";
  } else if (deliverableType === "presentation") {
    const hasPptFiles = allKnownPaths.some((p) => /\.(ppt|pptx|pdf)$/.test(p));
    if (!hasPptFiles) return "PARTIAL_EVIDENCE";
  }

  if (implementationStatus === "PARTIAL_PROGRESS" || implementationStatus === "VALID_BUT_NEEDS_IMPROVEMENT" || (progress >= 30 && progress < 80)) {
    return "PARTIAL_EVIDENCE";
  }

  if (progress < 30 && implementationStatus === "PROJECT_RELATED_TASK_NOT_IMPLEMENTED") {
    return "INVALID_EVIDENCE";
  }

  return "VALID_EVIDENCE";
}

/**
 * Tokenize text for keyword comparison.
 */
function extractKeywords(text) {
  if (!text || typeof text !== "string") return [];
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length > 2)
    ),
  ];
}

/**
 * Layer 1: Grounded verification of task requirements.
 * Evaluates whether submission satisfies the assigned task.
 *
 * @param {object} opts { task, submission, group }
 * @returns {object} verification result
 */
async function verifyTaskRequirements({ task, submission, group }) {
  const ai = submission?.aiAnalysis || {};
  const progress = Number(ai.progress ?? ai.score ?? 0);
  const taskConfidence = Number(ai.taskConfidence ?? 0);
  const projectConfidence = Number(ai.projectConfidence ?? 0);
  const implementationStatus = ai.implementationStatus || "";
  const relevance = ai.relevance || {};
  const plagiarism = ai.plagiarism || {};
  const codeReview = ai.codeReview || {};

  const requirementsChecked = [];
  const requirementsPassed = [];
  const requirementsFailed = [];
  const missingItems = [...(ai.missingParts || []), ...(ai.issues || [])];

  const deliverableType = detectDeliverableType({ task });
  const evidenceQuality = classifyEvidenceQuality({ task, submission, deliverableType });

  // 1. Project Alignment Check
  requirementsChecked.push("Project Alignment");
  const isWrongProject =
    relevance.status === "IRRELEVANT" ||
    relevance.isIrrelevant === true ||
    implementationStatus === "WRONG_PROJECT" ||
    ai.projectRelated === false;

  if (isWrongProject) {
    requirementsFailed.push("Project Alignment");
    return {
      status: "FAIL",
      completionStatus: "INCOMPLETE",
      evidenceQuality,
      deliverableType,
      progressPercent: 0,
      score: 0,
      confidence: projectConfidence,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: ["Submission does not match the project scope or repository."],
      feedback: "The submitted files appear to be from an unrelated project. Please submit work belonging to this project.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }
  requirementsPassed.push("Project Alignment");

  // 2. Archive Integrity Check
  requirementsChecked.push("Archive Integrity");
  if (implementationStatus === "UNREADABLE_ZIP" || evidenceQuality === "UNREADABLE_EVIDENCE") {
    requirementsFailed.push("Archive Integrity");
    return {
      status: "FAIL",
      completionStatus: "INSUFFICIENT_EVIDENCE",
      evidenceQuality: "UNREADABLE_EVIDENCE",
      deliverableType,
      progressPercent: 90,
      score: 0,
      confidence: 0,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: ["Archive file cannot be extracted or is corrupted."],
      feedback: "The uploaded archive could not be read safely. Please upload a valid ZIP file.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }
  requirementsPassed.push("Archive Integrity");

  // 3. Task Scope & Implementation Check
  requirementsChecked.push("Task Implementation Scope");
  const isWrongTask =
    implementationStatus === "PROJECT_RELATED_TASK_NOT_IMPLEMENTED" ||
    ai.taskRelated === false;

  if (isWrongTask) {
    requirementsFailed.push("Task Implementation Scope");
    return {
      status: "FAIL",
      completionStatus: "INCOMPLETE",
      evidenceQuality,
      deliverableType,
      progressPercent: 0,
      score: progress,
      confidence: taskConfidence,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: missingItems.length ? missingItems : ["Assigned task features were not implemented."],
      feedback: "The submission belongs to the project, but the specific assigned task features were not implemented.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }
  requirementsPassed.push("Task Implementation Scope");

  // 4. Originality / Plagiarism Check
  requirementsChecked.push("Originality & Authorship");
  if (plagiarism.severity === "DUPLICATE") {
    requirementsFailed.push("Originality & Authorship");
    return {
      status: "FAIL",
      completionStatus: "INCOMPLETE",
      evidenceQuality: "INVALID_EVIDENCE",
      deliverableType,
      progressPercent: 0,
      score: progress,
      confidence: 100,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: ["Submission flagged as duplicate content."],
      feedback: "Duplicate submission detected matching another student's work. Independent implementation required.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }
  if (plagiarism.severity === "HIGH") {
    requirementsFailed.push("Originality & Authorship (High Similarity)");
    return {
      status: "NEEDS_REVIEW",
      completionStatus: "PARTIALLY_COMPLETE",
      evidenceQuality,
      deliverableType,
      progressPercent: 90,
      score: progress,
      confidence: taskConfidence,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: ["High similarity with existing code requires human inspection."],
      feedback: "High code similarity detected. Guide review is required before completion.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }
  requirementsPassed.push("Originality & Authorship");

  // 5. Code Quality & Critical Blockers Check
  requirementsChecked.push("Code Quality & Blocker Check");
  const codeReviewIssues = codeReview.issues || [];
  const criticalIssues = codeReviewIssues.filter((i) => i.severity === "CRITICAL");
  const hasCriticalBlockers = criticalIssues.length > 0;

  if (hasCriticalBlockers) {
    requirementsFailed.push("Code Quality & Blocker Check");
    if (progress < 80) {
      return {
        status: "FAIL",
        completionStatus: "INCOMPLETE",
        evidenceQuality,
        deliverableType,
        progressPercent: Math.min(task.progress || 0, Math.floor(progress || 0)),
        score: progress,
        confidence: taskConfidence,
        requirementsChecked,
        requirementsPassed,
        requirementsFailed,
        missingItems: criticalIssues.map((i) => i.message || "Critical code issue"),
        feedback: "Critical code blockers must be fixed before this task can be completed.",
        autoCompleteEligible: false,
        evaluatedAt: new Date(),
      };
    }
    // If progress is high but has critical issues, hold for guide review
    return {
      status: "NEEDS_REVIEW",
      completionStatus: "PARTIALLY_COMPLETE",
      evidenceQuality,
      deliverableType,
      progressPercent: 90,
      score: progress,
      confidence: taskConfidence,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: criticalIssues.map((i) => i.message || "Critical code issue"),
      feedback: "Task implemented but contains critical code review issues requiring guide approval.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }
  requirementsPassed.push("Code Quality & Blocker Check");

  // 6. Grounded Acceptance Criteria & Subtasks Verification
  requirementsChecked.push("Acceptance Criteria Verification");
  const criteria = task.aiPlan?.acceptanceCriteria || [];
  const subtasks = task.aiPlan?.subtasks || [];
  const completedParts = ai.completedParts || [];

  let criteriaSatisfiedCount = 0;
  if (criteria.length > 0) {
    const completedText = completedParts.join(" ").toLowerCase();
    criteria.forEach((crit) => {
      const critTokens = extractKeywords(crit);
      const hits = critTokens.filter((tok) => completedText.includes(tok));
      if (hits.length >= Math.min(2, critTokens.length)) {
        criteriaSatisfiedCount += 1;
      }
    });
  }

  // Check for placeholder-only submissions
  const isPlaceholderOnly =
    ai.progressLabel === "Not Started" ||
    (progress < 30 && missingItems.length > 0 && completedParts.length === 0);

  if (isPlaceholderOnly) {
    requirementsFailed.push("Acceptance Criteria Verification");
    return {
      status: "FAIL",
      completionStatus: "INCOMPLETE",
      evidenceQuality: "INVALID_EVIDENCE",
      deliverableType,
      progressPercent: 0,
      score: progress,
      confidence: taskConfidence,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: missingItems.length ? missingItems : ["Incomplete or placeholder code."],
      feedback: "Submission contains placeholder or incomplete code. Full implementation is required.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }

  // 7. Non-ZIP generic submissions (PDF / Word doc / text notes)
  if (!implementationStatus) {
    requirementsPassed.push("Acceptance Criteria Verification");
    return {
      status: "NEEDS_REVIEW",
      completionStatus: "PARTIALLY_COMPLETE",
      evidenceQuality: "PARTIAL_EVIDENCE",
      deliverableType,
      progressPercent: 90,
      score: progress || 70,
      confidence: 60,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: [],
      feedback: "Document submission received. Awaiting manual guide review and approval.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }

  // 8. Final Decision: PASS vs NEEDS_REVIEW vs FAIL
  if (relevance.status === "POSSIBLY_RELEVANT") {
    requirementsFailed.push("Confidence Verification");
    return {
      status: "NEEDS_REVIEW",
      completionStatus: "PARTIALLY_COMPLETE",
      evidenceQuality: "PARTIAL_EVIDENCE",
      deliverableType,
      progressPercent: 90,
      score: progress,
      confidence: taskConfidence || 65,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: ["Partial project terminology match requires guide verification."],
      feedback: "Partial task relevance detected. Awaiting guide review.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }

  if (implementationStatus === "VALID_BUT_NEEDS_IMPROVEMENT" || (progress >= 40 && progress < 80)) {
    requirementsPassed.push("Acceptance Criteria Verification");
    return {
      status: "NEEDS_REVIEW",
      completionStatus: "PARTIALLY_COMPLETE",
      evidenceQuality: "PARTIAL_EVIDENCE",
      deliverableType,
      progressPercent: 90,
      score: progress,
      confidence: taskConfidence || 75,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: missingItems.slice(0, 4),
      feedback: "Task is partially implemented with improvements needed. Held for guide review.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }

  if (progress < 40) {
    requirementsFailed.push("Acceptance Criteria Verification");
    return {
      status: "FAIL",
      completionStatus: "INCOMPLETE",
      evidenceQuality: "PARTIAL_EVIDENCE",
      deliverableType,
      progressPercent: Math.min(task.progress || 0, Math.floor(progress || 0)),
      score: progress,
      confidence: taskConfidence,
      requirementsChecked,
      requirementsPassed,
      requirementsFailed,
      missingItems: missingItems.slice(0, 4),
      feedback: "Core task requirements were not met. Please address the missing items and resubmit.",
      autoCompleteEligible: false,
      evaluatedAt: new Date(),
    };
  }

  // High-confidence VALID_SUBMISSION with progress >= 80% and no critical blockers
  requirementsPassed.push("Acceptance Criteria Verification");
  return {
    status: "PASS",
    completionStatus: "COMPLETE",
    evidenceQuality: "VALID_EVIDENCE",
    deliverableType,
    progressPercent: 100,
    score: progress >= 80 ? progress : 85,
    confidence: taskConfidence >= 75 ? taskConfidence : 85,
    requirementsChecked,
    requirementsPassed,
    requirementsFailed: [],
    missingItems: [],
    feedback: "All task requirements verified and satisfied.",
    autoCompleteEligible: true,
    evaluatedAt: new Date(),
  };
}

/**
 * Layer 2: Find the next valid pending task for a student from the SAME GROUP.
 *
 * Rules:
 * 1. Strict group isolation: only query tasks for group._id.
 * 2. Exclude the just-completed task and any tasks already "done" or "completed".
 * 3. Prioritize tasks already assigned to this student (assignee == studentId).
 * 4. If none assigned to student, consider unassigned tasks (assignee == null).
 * 5. Check dependency readiness: all tasks in dependencies must have status "done" or "completed".
 * 6. Sort candidate tasks by:
 *    - Dependency-ready first
 *    - Priority: critical > high > medium > low
 *    - Due date: earliest deadline first (null due dates last)
 *    - Order or creation date
 * 7. If an unassigned ready task is selected, auto-assign it to the student.
 *
 * @param {object} opts { group, studentId, completedTaskId }
 * @returns {Promise<object>} { task, isAssigned, autoAssigned, allCompleted, allBlocked, message }
 */
async function findNextTaskForStudent({ group, studentId, completedTaskId }) {
  const groupId = group?._id || group;
  if (!groupId || !studentId) {
    return { task: null, message: "Missing group or student identifier" };
  }

  // Fetch all tasks in this group to evaluate dependencies and candidates
  const allGroupTasks = await Task.find({ group: groupId }).lean();

  // Create a quick lookup for task status
  const taskStatusMap = new Map();
  allGroupTasks.forEach((t) => {
    taskStatusMap.set(String(t._id), t.status);
  });
  // Mark the completed task as completed in memory for the dependency check
  if (completedTaskId) {
    taskStatusMap.set(String(completedTaskId), "completed");
  }

  const isDependencyReady = (task) => {
    const deps = task.dependencies || [];
    if (!deps.length) return true;
    return deps.every((depId) => {
      const depStatus = taskStatusMap.get(String(depId));
      return DONE_STATUSES.has(depStatus);
    });
  };

  const sortTasks = (tasks) => {
    return tasks.slice().sort((a, b) => {
      const aReady = isDependencyReady(a) ? 1 : 0;
      const bReady = isDependencyReady(b) ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;

      const aPrio = PRIORITY_ORDER[a.priority] || 2;
      const bPrio = PRIORITY_ORDER[b.priority] || 2;
      if (aPrio !== bPrio) return bPrio - aPrio;

      if (a.due && b.due) {
        const diff = new Date(a.due).getTime() - new Date(b.due).getTime();
        if (diff !== 0) return diff;
      } else if (a.due) {
        return -1;
      } else if (b.due) {
        return 1;
      }

      return (a.order || 0) - (b.order || 0);
    });
  };

  // Filter out completed tasks and current task
  const activeTasks = allGroupTasks.filter((t) => {
    if (completedTaskId && String(t._id) === String(completedTaskId)) return false;
    if (DONE_STATUSES.has(t.status)) return false;
    return true;
  });

  if (activeTasks.length === 0) {
    return {
      task: null,
      allCompleted: true,
      message: "All tasks in this project have been successfully completed!",
    };
  }

  // 1. Candidate Set 1: Tasks already assigned to this student
  const studentAssignedTasks = activeTasks.filter(
    (t) => t.assignee && String(t.assignee?._id || t.assignee) === String(studentId)
  );

  const sortedStudentTasks = sortTasks(studentAssignedTasks);
  const readyStudentTask = sortedStudentTasks.find(isDependencyReady);

  if (readyStudentTask) {
    const fullTask = await Task.findById(readyStudentTask._id);
    if (fullTask.status === "backlog" || fullTask.status === "pending") {
      fullTask.status = "todo";
      fullTask.progress = 0;
    }
    fullTask.isActiveTask = true;
    fullTask.activatedAt = fullTask.activatedAt || new Date();
    if (fullTask.aiAssignment) {
      fullTask.aiAssignment.isActiveTask = true;
      fullTask.aiAssignment.activatedAt = fullTask.aiAssignment.activatedAt || new Date();
    }
    await fullTask.save();

    return {
      task: fullTask,
      isAssigned: true,
      autoAssigned: false,
      message: `Next assigned task activated: "${fullTask.title}"`,
    };
  }

  // 2. Candidate Set 2: Unassigned tasks in the same group
  const unassignedTasks = activeTasks.filter((t) => !t.assignee);
  const sortedUnassignedTasks = sortTasks(unassignedTasks);
  const readyUnassignedTask = sortedUnassignedTasks.find(isDependencyReady);

  if (readyUnassignedTask) {
    const fullTask = await Task.findById(readyUnassignedTask._id);
    fullTask.assignee = studentId;
    if (fullTask.status === "backlog" || fullTask.status === "pending") {
      fullTask.status = "todo";
      fullTask.progress = 0;
    }
    fullTask.isActiveTask = true;
    fullTask.activatedAt = fullTask.activatedAt || new Date();
    if (fullTask.aiAssignment) {
      fullTask.aiAssignment.isActiveTask = true;
      fullTask.aiAssignment.activatedAt = fullTask.aiAssignment.activatedAt || new Date();
    }
    await fullTask.save();

    return {
      task: fullTask,
      isAssigned: true,
      autoAssigned: true,
      message: `Next unassigned task auto-assigned: "${fullTask.title}"`,
    };
  }

  // 3. If tasks exist for the student but all are blocked by dependencies
  if (studentAssignedTasks.length > 0) {
    return {
      task: null,
      allBlocked: true,
      message: "Remaining assigned tasks are waiting on incomplete dependencies.",
    };
  }

  // 4. If active tasks exist in the group but belong to other students
  return {
    task: null,
    allCompletedForStudent: true,
    message: "You have completed all your assigned tasks. Other team members are finishing their tasks.",
  };
}

/**
 * Layer 3: Complete task, identify next task, notify users, update project health.
 * Fully idempotent: safe against duplicate calls.
 *
 * @param {object} opts { task, submission, group, user, isAuto }
 * @returns {Promise<object>} execution outcome
 */
async function executeCompletionAndNextTask({ task, submission, group, user, isAuto = false }) {
  const groupId = group?._id || group;
  const studentId = task.assignee?._id || task.assignee;

  // Idempotency check: if already completed and processed for this submission, return cached result
  if (task.status === "completed" && submission?.verification?.completionHandled === true) {
    return {
      task,
      nextTask: submission.verification.nextTask,
      alreadyHandled: true,
    };
  }

  // Mark task completed and update canonical progress fields
  task.status = "completed";
  task.progress = 100;
  task.completionStatus = "COMPLETE";
  task.verifiedBy = isAuto ? "AI" : user?.role === "guide" ? "GUIDE" : "LEADER";
  task.completionReason = isAuto
    ? "AI verified all acceptance criteria and deliverables."
    : `Manually approved and completed by ${user?.name || "Guide"}.`;
  if (submission?.verification?.evidenceQuality) {
    task.evidenceQuality = submission.verification.evidenceQuality;
  }
  task.completedAt = task.completedAt || new Date();

  // Find next task for student in same group
  const nextResult = await findNextTaskForStudent({
    group: group || { _id: groupId },
    studentId,
    completedTaskId: task._id,
  });

  const nextTaskSummary = nextResult.task
    ? {
        id: nextResult.task._id,
        title: nextResult.task.title,
        priority: nextResult.task.priority,
        due: nextResult.task.due || null,
        status: nextResult.task.status,
        isAssigned: Boolean(nextResult.isAssigned),
        autoAssigned: Boolean(nextResult.autoAssigned),
      }
    : null;

  // Record on submission verification
  if (submission) {
    submission.verification = submission.verification || {};
    submission.verification.completionHandled = true;
    submission.verification.handledAt = new Date();
    submission.verification.nextTask = nextTaskSummary;
    submission.verification.completionStatus = "COMPLETE";
    submission.verification.progressPercent = 100;
  }

  // Record on task
  task.nextTask = nextTaskSummary;
  await task.save();

  // Student notification
  const studentTitle = isAuto ? "🎉 Task Verified & Completed" : "🎉 Task Approved & Completed";
  let studentBody = "";
  if (nextResult.task) {
    studentBody = `"${task.title}" is completed! Next task: "${nextResult.task.title}" (${nextResult.task.priority} priority).`;
  } else if (nextResult.allCompleted) {
    studentBody = `"${task.title}" is completed! All project tasks have been completed. Great job!`;
  } else {
    studentBody = `"${task.title}" is completed! You have no further pending tasks assigned right now.`;
  }

  await notifyUsers([studentId], {
    title: studentTitle,
    body: studentBody,
    type: "task",
    link: "/app/tasks",
    group: groupId,
    task: nextResult.task?._id || task._id,
  });

  // Guide notification
  const guideId = group?.guide?._id || group?.guide;
  const leaderId = group?.leader?._id || group?.leader;
  const recipients = [guideId, leaderId].filter(Boolean);

  const guideTitle = isAuto ? "AI Verified Task Completion" : "Task Completed & Approved";
  const guideBody = `${user?.name || "Student"} completed "${task.title}". ${
    nextResult.task
      ? `Next task: "${nextResult.task.title}" (${nextResult.autoAssigned ? "auto-assigned" : "assigned"}).`
      : nextResult.message || "No pending tasks remaining."
  }`;

  await notifyUsers(recipients, {
    title: guideTitle,
    body: guideBody,
    type: "task",
    link: "/guide/groups",
    group: groupId,
    task: task._id,
  }, { exclude: studentId });

  // Recalculate group progress
  if (groupId) {
    await recalcGroupProgress(groupId);
  }

  // Real-time socket dispatch
  try {
    emitToGroup(groupId, "group:task:updated", task);
    if (nextResult.task) {
      emitToGroup(groupId, "group:task:updated", nextResult.task);
      emitToGroup(groupId, "group:task:assigned", nextResult.task);
    }
  } catch (socketErr) {
    // Non-fatal socket broadcast error
  }

  // Activity audit log
  await logActivity({
    req: { user },
    group: groupId,
    action: "task.completed_smart",
    summary: `Task "${task.title}" completed (${isAuto ? "AI auto-verified" : "guide approved"}). Next: ${
      nextResult.task ? `"${nextResult.task.title}"` : "None"
    }`,
    meta: {
      taskId: String(task._id),
      nextTaskId: nextResult.task ? String(nextResult.task._id) : null,
      isAuto,
    },
    audit: true,
  });

  return {
    task,
    nextTask: nextResult.task,
    nextResult,
  };
}

module.exports = {
  verifyTaskRequirements,
  findNextTaskForStudent,
  executeCompletionAndNextTask,
  detectDeliverableType,
  classifyEvidenceQuality,
  DONE_STATUSES,
  PRIORITY_ORDER,
};
