const Task = require("../models/Task");
const User = require("../models/User");
const Group = require("../models/Group");
const Invitation = require("../models/Invitation");
const planTaskService = require("./projectPlanTaskService");
const aiEngine = require("./aiEngineClient");
const { notifyUsers } = require("./notificationService");
const { logActivity } = require("./activityService");

/**
 * Builds deterministic structured tasks for a project when AI engine is unavailable
 * or as a fallback. Contextualized to project title and description.
 */
function buildDeterministicTasks(projectTitle, projectDescription) {
  const pName = String(projectTitle || "Project").trim();
  return [
    {
      title: `Architecture & Database Schema Design`,
      description: `Establish the foundational architecture, database schema models, and data validation rules for ${pName}.`,
      whatToDo: `1. Analyze project requirements for ${pName}.\n2. Define MongoDB schemas with validations and indexes.\n3. Create data flow diagrams and mock datasets.`,
      expectedOutput: `Mongoose schemas, ER diagram, and initial database migration/seed scripts.`,
      deliverableType: "database",
      completionCriteria: [
        "Database models are defined with appropriate schema validations.",
        "Indexes are placed on frequently queried foreign keys.",
        "Initial seed data scripts execute cleanly.",
      ],
      module: "Database & Architecture",
      priority: "high",
      estimatedDays: 3,
      dependencies: [],
    },
    {
      title: `Authentication & Core Backend APIs`,
      description: `Implement secure authentication, authorization middlewares, and core CRUD business logic endpoints for ${pName}.`,
      whatToDo: `1. Implement JWT/role-based route protection.\n2. Write REST controllers and service methods for core domain models.\n3. Add input validation and error handling.`,
      expectedOutput: `Tested REST API endpoints with status codes, error responses, and Swagger/Postman documentation.`,
      deliverableType: "backend",
      completionCriteria: [
        "Authentication endpoints return valid tokens and enforce permissions.",
        "Core controllers validate incoming request payloads.",
        "Error handler catches uncaught errors and returns consistent JSON.",
      ],
      module: "Backend Services",
      priority: "high",
      estimatedDays: 4,
      dependencies: [`Architecture & Database Schema Design`],
    },
    {
      title: `Frontend UI Design & Layouts`,
      description: `Develop responsive user interface components, navigation layout, and design system elements for ${pName}.`,
      whatToDo: `1. Build modern responsive layouts with Tailwind CSS.\n2. Create reusable UI components (forms, tables, cards, modals).\n3. Set up client-side routing and navigation.`,
      expectedOutput: `Interactive frontend views with theme styling, loading indicators, and empty states.`,
      deliverableType: "frontend",
      completionCriteria: [
        "All key views are responsive across desktop and mobile screen sizes.",
        "Component states (idle, loading, error, success) are implemented.",
        "Navigation is functional and follows role-based access rules.",
      ],
      module: "Frontend & UI",
      priority: "medium",
      estimatedDays: 4,
      dependencies: [`Architecture & Database Schema Design`],
    },
    {
      title: `API Integration & Interactive Workflows`,
      description: `Connect frontend interfaces to backend services, implement state management, and handle async operations for ${pName}.`,
      whatToDo: `1. Wire frontend forms and tables to backend API endpoints.\n2. Implement reactive client state management and caching.\n3. Handle validation errors, toasts, and loading states.`,
      expectedOutput: `Fully functional end-to-end user workflows connecting UI directly to database records.`,
      deliverableType: "code",
      completionCriteria: [
        "Client forms submit data and reflect changes immediately in UI.",
        "Network errors display user-friendly notification messages.",
        "Protected client routes redirect unauthorized requests.",
      ],
      module: "Integration",
      priority: "high",
      estimatedDays: 5,
      dependencies: [`Authentication & Core Backend APIs`, `Frontend UI Design & Layouts`],
    },
    {
      title: `Quality Assurance, Testing & Validation`,
      description: `Execute comprehensive integration tests, verify edge cases, and validate performance and security for ${pName}.`,
      whatToDo: `1. Write automated test cases for primary user flows.\n2. Verify input sanitation and authorization checks.\n3. Perform cross-browser testing and performance audits.`,
      expectedOutput: `Test report documentation with passing test suites and bug resolution notes.`,
      deliverableType: "documentation",
      completionCriteria: [
        "Unit and integration tests pass without regression.",
        "Boundary and edge cases are validated.",
        "Zero high-severity vulnerabilities or broken routes.",
      ],
      module: "Testing & QA",
      priority: "medium",
      estimatedDays: 3,
      dependencies: [`API Integration & Interactive Workflows`],
    },
    {
      title: `Deployment Preparation & Project Documentation`,
      description: `Prepare production deployment configuration, environment setup guide, and comprehensive user documentation for ${pName}.`,
      whatToDo: `1. Configure build pipelines and deployment configurations.\n2. Write user guide and developer setup instructions.\n3. Prepare final presentation slides and project report.`,
      expectedOutput: `Complete project documentation, deployment configuration, and presentation package.`,
      deliverableType: "report",
      completionCriteria: [
        "Setup instructions can be executed cleanly from a fresh environment.",
        "Production build succeeds with zero compile errors.",
        "Final project presentation and report are ready for guide review.",
      ],
      module: "Documentation & Release",
      priority: "medium",
      estimatedDays: 2,
      dependencies: [`Quality Assurance, Testing & Validation`],
    },
  ];
}

/**
 * Resolves active student members for a group.
 * Ensures we only assign to active, real students belonging to this group.
 */
async function resolveGroupStudentMembers(group, enrolledMembers = []) {
  if (Array.isArray(enrolledMembers) && enrolledMembers.length > 0) {
    const fromPayload = enrolledMembers.map((m) => ({
      _id: m.id || m._id || m.userId,
      name: m.name,
      email: m.email,
      avatar: m.avatar || "",
    })).filter((m) => m._id);
    if (fromPayload.length > 0) return fromPayload;
  }

  const memberIds = Array.isArray(group.members) ? group.members.map((m) => String(m._id || m)) : [];

  // Query active students in group.members
  let students = await User.find({
    _id: { $in: memberIds },
    isActive: { $ne: false },
    role: "student",
  }).select("_id name email avatar").lean();

  // Check if group.leader is a student
  if (group.leader) {
    const leaderId = String(group.leader._id || group.leader);
    if (!students.some((s) => String(s._id) === leaderId)) {
      const leaderUser = await User.findOne({
        _id: leaderId,
        isActive: { $ne: false },
        role: "student",
      }).select("_id name email avatar").lean();
      if (leaderUser) {
        students.push(leaderUser);
      }
    }
  }

  // If no members are populated yet (e.g. brand new group created with invitations),
  // check if invited students exist in the system and can be attached
  if (students.length === 0) {
    const invitations = await Invitation.find({
      group: group._id,
      status: { $in: ["pending", "accepted"] },
    }).select("email").lean();

    const emails = invitations.map((i) => String(i.email || "").toLowerCase().trim()).filter(Boolean);
    if (group.leaderEmail) emails.push(String(group.leaderEmail).toLowerCase().trim());

    if (emails.length > 0) {
      const foundRegistered = await User.find({
        email: { $in: emails },
        isActive: { $ne: false },
        role: "student",
      }).select("_id name email avatar");

      if (foundRegistered.length > 0) {
        // Add them to group.members so they are formally in the team
        const newIds = foundRegistered.map((u) => u._id);
        await Group.findByIdAndUpdate(group._id, {
          $addToSet: { members: { $each: newIds } },
        });
        students = foundRegistered.map((u) => u.toObject());
      }
    }
  }

  return students;
}

/**
 * Core service: Automatically plans project tasks and creates them in MongoDB.
 *
 * @param {Object} options
 * @param {Object|string} options.group - Group document or Group ObjectId
 * @param {Object} [options.reqUser] - Requesting User (Guide or Team Leader)
 * @param {string} [options.projectTitle] - Project title override
 * @param {string} [options.projectDescription] - Project description override
 * @param {Date|string} [options.deadline] - Target deadline override
 * @param {boolean} [options.force] - Force re-generation even if AI tasks exist
 * @returns {Promise<Object>} Result object with count, tasks, skipped info
 */
async function autoPlanAndAssignTasks({
  group,
  reqUser = null,
  projectTitle = null,
  projectDescription = null,
  deadline = null,
  force = false,
  enrolledMembers = [],
} = {}) {
  // 1. Ensure group doc
  let groupDoc = group;
  if (!groupDoc || typeof groupDoc !== "object" || !groupDoc._id) {
    groupDoc = await Group.findById(group);
  }
  if (!groupDoc) {
    return { success: false, skipped: true, reason: "Group not found", count: 0, tasks: [] };
  }

  // 2. Validate title & description
  const finalTitle = String(projectTitle || groupDoc.project || "").trim();
  const finalDesc = String(projectDescription || groupDoc.description || "").trim();
  const finalDeadline = deadline || groupDoc.expectedCompletion || null;

  if (!finalTitle || finalTitle.length < 3) {
    return {
      success: false,
      skipped: true,
      reason: "Project title must be at least 3 characters",
      count: 0,
      tasks: [],
    };
  }

  if (!finalDesc || finalDesc.length < 5) {
    return {
      success: false,
      skipped: true,
      reason: "Project description must be at least 5 characters to generate meaningful tasks",
      count: 0,
      tasks: [],
    };
  }

  // 3. Duplicate protection: if source="ai" tasks already exist and !force, return existing tasks
  const existingAiCount = await Task.countDocuments({ group: groupDoc._id, source: "ai" });
  if (existingAiCount > 0 && !force) {
    const existingTasks = await Task.find({ group: groupDoc._id, source: "ai" })
      .populate("assignee", "name email color avatar")
      .sort({ order: 1, createdAt: 1 });
    return {
      success: true,
      skipped: true,
      reason: "AI tasks already exist for this project group",
      existingCount: existingAiCount,
      count: existingTasks.length,
      tasks: existingTasks,
    };
  }

  if (force) {
    // When force re-planning is requested, clean up unstarted AI tasks so we can re-generate cleanly
    await Task.deleteMany({
      group: groupDoc._id,
      source: "ai",
      status: { $in: ["pending", "todo", "backlog"] },
      $or: [{ submissions: { $exists: false } }, { submissions: { $size: 0 } }],
    });
  }

  // 4. Resolve eligible active student members
  const students = await resolveGroupStudentMembers(groupDoc, enrolledMembers);
  if (!students || students.length === 0) {
    return {
      success: false,
      skipped: true,
      reason: "No active student members found in group to assign tasks",
      count: 0,
      tasks: [],
    };
  }

  // Format member objects for planner
  const membersPayload = students.map((s) => ({
    id: String(s._id),
    userId: String(s._id),
    name: s.name,
    email: s.email,
  }));

  // 5. Query AI engine for project plan
  let rawTasks = [];
  let suggestedAssignments = [];

  try {
    const aiRes = await aiEngine.analyzeProjectPlan({
      groupId: String(groupDoc._id),
      projectTitle: finalTitle,
      projectDescription: finalDesc,
      deadline: finalDeadline ? new Date(finalDeadline).toISOString().slice(0, 10) : null,
      members: membersPayload,
    });

    if (aiRes.ok && aiRes.data && Array.isArray(aiRes.data.tasks) && aiRes.data.tasks.length > 0) {
      rawTasks = aiRes.data.tasks;
      suggestedAssignments = aiRes.data.suggestedAssignments || [];
    } else {
      console.warn("[autoProjectPlanning] AI Engine returned without tasks, falling back to rule-based planner:", aiRes.reason);
      rawTasks = buildDeterministicTasks(finalTitle, finalDesc);
    }
  } catch (err) {
    console.error("[autoProjectPlanning] AI Engine invocation failed, using deterministic planner:", err.message);
    rawTasks = buildDeterministicTasks(finalTitle, finalDesc);
  }

  // 6. Sanitize, order, and calculate deadlines
  const sanitized = planTaskService.sanitizeTasks(rawTasks);
  if (!sanitized.length) {
    return { success: false, skipped: true, reason: "No valid tasks generated", count: 0, tasks: [] };
  }

  const dueDateByTitle = planTaskService.computeTaskDueDates(sanitized, finalDeadline);
  const ordered = planTaskService.topoSortTasks(sanitized);

  // 7. Check pre-existing AI tasks by title for duplicate protection
  const preExisting = await Task.find({ group: groupDoc._id, source: "ai" }).select("title").lean();
  const idByTitle = new Map();
  for (const t of preExisting) {
    idByTitle.set(String(t.title).trim().toLowerCase(), t._id);
  }

  const memberById = new Map(students.map((s) => [String(s._id), s]));
  const memberByEmail = new Map(students.map((s) => [String(s.email).toLowerCase(), s]));

  // Map suggested assignments from AI
  const aiAssignmentMap = new Map();
  for (const sa of suggestedAssignments) {
    const tKey = String(sa?.taskTitle || "").trim().toLowerCase();
    const email = String(sa?.studentEmail || "").trim().toLowerCase();
    if (tKey && email && memberByEmail.has(email)) {
      aiAssignmentMap.set(tKey, memberByEmail.get(email));
    }
  }

  const createdDocs = [];
  const duplicates = [];
  let roundRobinIdx = 0;
  const studentAssignedCount = new Map(); // studentId -> count of tasks assigned

  for (const task of ordered) {
    const key = task.title.toLowerCase();
    if (idByTitle.has(key)) {
      duplicates.push(task.title);
      continue;
    }

    // Determine assignee:
    // 1. Direct assigneeId / assignedTo if valid student in group
    let assigneeMember = null;
    if (task.assigneeId && memberById.has(String(task.assigneeId))) {
      assigneeMember = memberById.get(String(task.assigneeId));
    } else if (task.assignedTo?.id && memberById.has(String(task.assignedTo.id))) {
      assigneeMember = memberById.get(String(task.assignedTo.id));
    } else if (task.assignedTo?.email && memberByEmail.has(String(task.assignedTo.email).toLowerCase())) {
      assigneeMember = memberByEmail.get(String(task.assignedTo.email).toLowerCase());
    } else if (aiAssignmentMap.has(key)) {
      assigneeMember = aiAssignmentMap.get(key);
    }

    // Round-robin fallback across active students to ensure 100% fair coverage
    if (!assigneeMember && students.length > 0) {
      assigneeMember = students[roundRobinIdx % students.length];
      roundRobinIdx++;
    }

    // Determine single-task-at-a-time status:
    // Only 1 task per student is active ("todo"). All subsequent tasks are placed in "backlog" queue.
    const sId = assigneeMember ? String(assigneeMember._id) : null;
    const currentCount = sId ? (studentAssignedCount.get(sId) || 0) : 0;
    const initialStatus = currentCount === 0 ? "todo" : "backlog";
    if (sId) {
      studentAssignedCount.set(sId, currentCount + 1);
    }

    // Determine due date
    const explicitDue = task.due || task.dueDate ? new Date(task.due || task.dueDate) : null;
    let taskDue = explicitDue && !Number.isNaN(explicitDue.getTime()) ? explicitDue : dueDateByTitle.get(key);
    if (!taskDue || Number.isNaN(new Date(taskDue).getTime())) {
      taskDue = new Date(Date.now() + 7 * 86400000);
    }

    // Resolve dependencies
    const dependencyIds = (task.dependencies || [])
      .map((depTitle) => idByTitle.get(String(depTitle).toLowerCase()))
      .filter(Boolean);

    const doc = await Task.create({
      group: groupDoc._id,
      title: task.title,
      description: task.description,
      whatToDo: task.whatToDo || task.description,
      expectedOutput: task.expectedOutput || `Deliverable for ${task.title}`,
      deliverableType: planTaskService.normalizeDeliverableType(task.deliverableType) || "",
      completionCriteria: Array.isArray(task.completionCriteria) ? task.completionCriteria : [],
      module: task.module || "General",
      priority: task.priority || "medium",
      source: "ai",
      dependencies: dependencyIds,
      assignee: assigneeMember ? assigneeMember._id : undefined,
      createdBy: reqUser?._id || groupDoc.guide,
      status: initialStatus,
      isActiveTask: currentCount === 0,
      queueIndex: currentCount,
      progress: 0,
      estimate: Math.max(1, Math.round((task.estimatedDays || 1) * 8)),
      due: taskDue,
      aiAssignment: {
        selectedStudentId: assigneeMember ? assigneeMember._id : null,
        studentName: assigneeMember ? assigneeMember.name : "",
        assignmentReason: currentCount === 0
          ? `Initial active task assigned by AI based on balanced project workload and module suitability (${task.module || "General"}).`
          : `Queued task #${currentCount + 1} for ${assigneeMember?.name || "student"}. Unlocks automatically after preceding task is verified.`,
        evidenceUsed: [
          `Module: ${task.module || "General"}`,
          `Queue position: ${currentCount === 0 ? "1 (Active Focus Task)" : `${currentCount + 1} (Queued in Backlog)`}`,
          `Estimated effort: ${task.estimatedDays || 2} days`,
          `Project deadline alignment: ${taskDue ? new Date(taskDue).toLocaleDateString() : "Scheduled"}`,
        ],
        confidence: 85,
        eligibilityStatus: assigneeMember ? (currentCount === 0 ? "ACTIVE_ASSIGNED" : "QUEUED_ASSIGNED") : "NO_ELIGIBLE_ASSIGNEE",
        evaluatedMembersCount: students.length,
        assignedAt: new Date(),
        queueIndex: currentCount,
        isActiveTask: currentCount === 0,
      },
      aiAnalysisVersion: "2.0",
    });

    idByTitle.set(key, doc._id);
    createdDocs.push(doc);
  }

  // 8. Notify assignees
  const assigneeIds = [...new Set(createdDocs.filter((t) => t.assignee).map((t) => String(t.assignee)))];
  if (assigneeIds.length > 0) {
    try {
      await notifyUsers(
        assigneeIds,
        {
          title: "New tasks assigned from AI project plan",
          body: `${finalTitle}: ${createdDocs.length} task(s) generated and assigned to team members.`,
          type: "task",
          link: "/app/tasks",
          group: groupDoc._id,
        },
        reqUser ? { exclude: reqUser._id } : {}
      );
    } catch (notifErr) {
      console.warn("[autoProjectPlanning] Notification sending error:", notifErr.message);
    }
  }

  // 9. Recalculate group progress
  try {
    const { recalcGroupProgress } = require("../controllers/groupController");
    await recalcGroupProgress(groupDoc._id);
  } catch (progressErr) {
    console.warn("[autoProjectPlanning] recalcGroupProgress error:", progressErr.message);
  }

  // 10. Audit activity log
  try {
    await logActivity({
      req: reqUser ? { user: reqUser } : null,
      group: groupDoc._id,
      action: "project.ai_auto_planned",
      summary: `AI automatically generated and assigned ${createdDocs.length} tasks for "${finalTitle}"`,
      audit: true,
    });
  } catch (logErr) {
    // Non-fatal
  }

  let tasksToReturn = createdDocs;
  if (tasksToReturn.length === 0) {
    tasksToReturn = await Task.find({ group: groupDoc._id, source: "ai" }).sort({ order: 1, createdAt: 1 });
  }
  const populatedTasks = await Task.populate(tasksToReturn, { path: "assignee", select: "name email avatar color" });

  return {
    success: true,
    count: createdDocs.length,
    tasks: populatedTasks,
    skipped: duplicates.length > 0,
    duplicates,
    assignedMembers: assigneeIds.length,
  };
}

module.exports = {
  autoPlanAndAssignTasks,
  resolveGroupStudentMembers,
  buildDeterministicTasks,
};
