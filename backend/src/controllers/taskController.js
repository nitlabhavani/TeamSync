const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Task = require("../models/Task");
const User = require("../models/User");
const { suggestWorkloadRebalance } = require("../services/aiService");
const { notifyUsers } = require("../services/notificationService");
const { logActivity } = require("../services/activityService");
const { recalcGroupProgress } = require("./groupController");
const { getRecommendation, canRequestRecommendation } = require("../services/smartTaskAssignmentService");
const { expandTask } = require("../services/taskExpansionService");
const { buildPlanningSummary, sanitizeStringList, sanitizeText } = require("../services/taskPlanService");
const { shouldResetStatusOnReassignment, shapeTaskForViewer, studentOwnSubmissions } = require("../utils/taskSubmissionScope");
const {
  verifyTaskRequirements,
  executeCompletionAndNextTask,
} = require("../services/taskCompletionVerificationService");
const {
  orchestrateTaskCreation,
  previewTask: orchestratePreviewTask,
} = require("../services/aiTaskOrchestrationService");

exports.list = asyncHandler(async (req, res) => {
  const filter = { group: req.group._id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.assignee) filter.assignee = req.query.assignee;
  if (req.query.priority) filter.priority = req.query.priority;
  if (req.user.role === "student" && !req.isGuide) {
    filter.assignee = req.user._id;
  }
  const tasks = await Task.find(filter)
    .populate("assignee", "name color avatar")
    .populate("group", "name project description")
    // Step 11 — the Guide Review UI (and the student Task Page) both read
    // submission.student straight off this same list endpoint, so populate
    // it here too (submissionController.list already did this for the
    // single-task submissions endpoint).
    // Step 12 — submission history also needs to show "Reviewed by <name>"
    // for every past version, so populate the reviewer too.
    .populate("submissions.student", "name email avatar")
    .populate("submissions.reviewedBy", "name email avatar")
    .sort({ order: 1, createdAt: -1 });
  // STEP 33 — a student must only ever receive THEIR OWN submissions, even
  // for a task that was previously assigned to someone else (see
  // taskSubmissionScope.js). Guides/team leaders are returned unchanged.
  const shaped = tasks.map((t) => shapeTaskForViewer(t.toJSON(), req));
  res.json({ success: true, data: shaped });
});

/** Kanban board grouped by status column. */
exports.board = asyncHandler(async (req, res) => {
  const filter = { group: req.group._id };
  if (req.user.role === "student" && !req.isGuide) {
    filter.assignee = req.user._id;
  }
  const tasks = await Task.find(filter)
    .populate("assignee", "name color avatar")
    .populate("group", "name project description")
    .populate("submissions.student", "name email avatar")
    .sort({ order: 1, createdAt: -1 });
  // STEP 33 — same student-submission-ownership shaping as list() above.
  const shapedTasks = tasks.map((t) => shapeTaskForViewer(t.toJSON(), req));
  const columns = Task.TASK_STATUSES.map((status) => ({
    status,
    tasks: shapedTasks.filter((t) => t.status === status),
  }));
  res.json({ success: true, data: { columns, total: shapedTasks.length } });
});

exports.previewTask = asyncHandler(async (req, res) => {
  if (!req.isGuide && String(req.group.leader) !== String(req.user._id))
    throw ApiError.forbidden("Only the guide or team leader can preview AI task generation");

  const rawTitle = String(req.body?.title || "").trim();
  if (!rawTitle) throw ApiError.badRequest("Task title is required");

  const preview = await orchestratePreviewTask({
    title: rawTitle,
    description: req.body?.description || "",
    group: req.group,
  });

  res.json({ success: true, data: preview });
});

exports.create = asyncHandler(async (req, res) => {
  if (!req.isGuide && String(req.group.leader) !== String(req.user._id))
    throw ApiError.forbidden("Only the guide or team leader can create tasks");

  const rawTitle = String(req.body?.title || "").trim();
  if (!rawTitle) throw ApiError.badRequest("Task title is required");

  // Client-supplied control fields (assignee, due, priority, status, progress, criteria)
  // are ignored and overridden by AI orchestration.
  const task = await orchestrateTaskCreation({
    title: rawTitle,
    description: req.body?.description || "",
    group: req.group,
    createdBy: req.user,
  });

  if (task.assignee)
    await notifyUsers([task.assignee], {
      title: "Task assigned",
      body: task.title,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    }, { exclude: req.user._id });

  await recalcGroupProgress(req.group._id);
  const populated = await task.populate("assignee", "name color avatar");
  res.status(201).json({ success: true, data: shapeTaskForViewer(populated.toJSON(), req) });
});

exports.update = asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id });
  if (!task) throw ApiError.notFound("Task not found");
  if (!req.isGuide && String(req.group.leader) !== String(req.user._id))
    throw ApiError.forbidden("Only the guide or team leader can update tasks");

  const previousStatus = task.status;
  const previousAssigneeId = task.assignee ? String(task.assignee) : null;
  const allowed = ["title", "description", "assignee", "status", "priority", "due", "estimate", "tags", "order"];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) task[k] = req.body[k];
  });

  // STEP 33 — root-cause fix for "reassigned task shows old submission
  // state". Submission history is left completely untouched (guides can
  // still see it) — only the task's own `status` resets, so the new
  // assignee starts from "pending" instead of inheriting whatever
  // submitted/reviewed/completed/rejected state the previous assignee left
  // behind. An explicit `status` in the same request always wins instead.
  if (req.body.assignee !== undefined) {
    const nextAssigneeId = task.assignee ? String(task.assignee) : null;
    if (
      shouldResetStatusOnReassignment({
        previousAssigneeId,
        nextAssigneeId,
        currentStatus: previousStatus,
        explicitStatusInBody: req.body.status,
      })
    ) {
      task.status = "pending";
      await logActivity({
        req,
        group: req.group._id,
        action: "task.reassigned",
        summary: `${task.title} was reassigned — submission-workflow status reset to pending for the new assignee`,
        meta: { taskId: String(task._id), previousAssigneeId, nextAssigneeId },
      });
    }
  }

  if (req.body.due && task.assignee) {
    await notifyUsers([task.assignee], {
      title: "Deadline updated",
      body: `Deadline set for ${task.title}`,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    }, { exclude: req.user._id });
  }

  if (req.body.status !== undefined) {
    if (req.body.status === "done" || req.body.status === "completed") {
      task.status = "completed";
      task.progress = 100;
      task.verifiedBy = req.isGuide ? "GUIDE" : "LEADER";
      task.completionReason = `Manually completed by ${req.user.name}.`;
    } else if (req.body.status === "in_progress") {
      task.status = "in_progress";
      task.progress = 10;
    } else if (req.body.status === "in_review" || req.body.status === "review") {
      task.status = "in_review";
      task.progress = 90;
    } else if (req.body.status === "todo" || req.body.status === "pending" || req.body.status === "backlog") {
      task.status = req.body.status;
      task.progress = 0;
    }
  }

  await task.save();
  if (task.status !== previousStatus) {
    await recalcGroupProgress(req.group._id);
  }
  if (req.body.status && task.assignee && task.status !== previousStatus) {
    await notifyUsers([task.assignee], {
      title: `Task ${task.status.replace(/_/g, " ")}`,
      body: `${task.title} is now ${task.status.replace(/_/g, " ")}`,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    }, { exclude: req.user._id });
  }

  const populated = await task.populate("assignee", "name color avatar");
  res.json({ success: true, data: shapeTaskForViewer(populated.toJSON(), req) });
});

/** Drag-and-drop move: change column and/or ordering. */
exports.move = asyncHandler(async (req, res) => {
  const { status, order = 0 } = req.body;
  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id });
  if (!task) throw ApiError.notFound("Task not found");

  const isGuide = Boolean(req.isGuide);
  const isLeader = Boolean(req.group.leader && String(req.group.leader) === String(req.user._id));
  const isPrivileged = isGuide || isLeader;
  const previousStatus = task.status;

  if (status === "done" || status === "completed") {
    if (isPrivileged) {
      task.status = "completed";
      task.progress = 100;
      task.verifiedBy = isGuide ? "GUIDE" : "LEADER";
      task.completionReason = `Manually moved to completed by ${req.user.name}.`;
    } else {
      // Students cannot manually mark Done without verified ZIP submission
      throw ApiError.forbidden(
        "Students cannot manually complete tasks. Tasks are completed automatically by AI when you submit a verified ZIP archive that satisfies all requirements."
      );
    }
  } else if (status === "in_progress") {
    task.status = "in_progress";
    task.progress = 10;
  } else if (status === "review" || status === "in_review") {
    task.status = "in_review";
    task.progress = 90;
  } else {
    task.status = status;
    if (status === "todo" || status === "backlog" || status === "pending") {
      task.progress = 0;
    }
  }

  task.order = order;
  await task.save();
  if (task.status !== previousStatus) await recalcGroupProgress(req.group._id);
  res.json({ success: true, data: shapeTaskForViewer(task.toJSON(), req) });
});

exports.remove = asyncHandler(async (req, res) => {
  if (!req.isGuide && String(req.group.leader) !== String(req.user._id))
    throw ApiError.forbidden("Only the guide or team leader can delete tasks");

  const task = await Task.findOneAndDelete({ _id: req.params.taskId, group: req.group._id });
  if (!task) throw ApiError.notFound("Task not found");
  if (task.assignee)
    await notifyUsers([task.assignee], {
      title: "Task removed",
      body: `${task.title} was deleted by ${req.user.name}`,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    }, { exclude: req.user._id });
  await recalcGroupProgress(req.group._id);
  res.json({ success: true, message: "Task deleted" });
});

/** AI workload balance + rebalancing suggestions. */
exports.workload = asyncHandler(async (req, res) => {
  const memberIdList = [
    ...new Set([
      ...(req.group.members || []).map((m) => String(m._id || m)),
      req.group.leader ? String(req.group.leader._id || req.group.leader) : null,
    ].filter(Boolean)),
  ];
  const [tasks, members] = await Promise.all([
    Task.find({ group: req.group._id }).lean(),
    User.find({ _id: { $in: memberIdList } }).select("name color").lean(),
  ]);
  res.json({ success: true, data: suggestWorkloadRebalance(tasks, members) });
});

/**
 * STEP 17 — Feature 1: AI Smart Task Auto-Assignment.
 * Recommendation ONLY — never writes to the task. The guide/leader still
 * uses the existing PATCH/POST .../tasks endpoints to actually assign
 * someone (Accept Recommendation / Select Another Student / Cancel all
 * just set the frontend's own assignee field before that same existing
 * create/update call).
 */
exports.recommendAssignment = asyncHandler(async (req, res) => {
  // Same authorization rule as task creation: guide or team leader only.
  // requireGroupAccess already rejects non-members and cross-group access.
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id }))
    throw ApiError.forbidden("Only the guide or team leader can request assignment recommendations");

  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id });
  if (!task) throw ApiError.notFound("Task not found");

  const members = await User.find({ _id: { $in: req.group.members } }).select("name").lean();
  const recommendation = await getRecommendation(req.group, task, members);
  res.json({ success: true, data: recommendation });
});

/**
 * Same recommendation, but for a task that does not exist yet — the
 * frontend's "New task" form collects title + assignee together, so the
 * recommendation has to be requestable from just a draft title/description
 * before the task is created. Purely additive alongside the taskId-based
 * endpoint above (used for re-assigning an existing task); both call the
 * exact same scoring service.
 */
exports.recommendAssignmentDraft = asyncHandler(async (req, res) => {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id }))
    throw ApiError.forbidden("Only the guide or team leader can request assignment recommendations");

  const title = String(req.body.title || "").trim();
  if (!title) throw ApiError.badRequest("title is required");

  const members = await User.find({ _id: { $in: req.group.members } }).select("name").lean();
  const recommendation = await getRecommendation(
    req.group,
    { title, description: req.body.description || "" },
    members
  );
  res.json({ success: true, data: recommendation });
});

/**
 * STEP 17 — Feature 2: AI-Expanded Task Description.
 * Suggestion only — never writes to a task. Same guide/leader-only
 * authorization rule as the other AI helpers on this controller.
 */
exports.expandTask = asyncHandler(async (req, res) => {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id }))
    throw ApiError.forbidden("Only the guide or team leader can request an AI task expansion");

  const title = String(req.body.title || "").trim();
  if (!title) throw ApiError.badRequest("title is required");

  const expansion = await expandTask({ title, description: req.body.description || "" });
  res.json({ success: true, data: expansion });
});

/**
 * STEP 18 — AI Task Intelligence / Smart Planning.
 * Loads planning context reused by all three endpoints below: group
 * members (for the recommended-assignee call) and, for an EXISTING task
 * only, its real dependency data — Task.dependencies (tasks this one
 * depends on) and any other task in the group that depends on THIS one —
 * both genuine DB-backed data, never AI-invented.
 */
async function loadPlanningContext(group, task) {
  const members = await User.find({ _id: { $in: group.members } }).select("name").lean();
  let openDependencyTasks = [];
  let blockingTasks = [];
  if (task?._id) {
    const OPEN = { $nin: ["done", "completed"] };
    const [deps, blockers] = await Promise.all([
      task.dependencies?.length
        ? Task.find({ _id: { $in: task.dependencies }, status: OPEN }).select("title status").lean()
        : Promise.resolve([]),
      Task.find({ group: group._id, dependencies: task._id, status: OPEN }).select("title status").lean(),
    ]);
    openDependencyTasks = deps;
    blockingTasks = blockers;
  }
  return { members, openDependencyTasks, blockingTasks };
}

/** Draft mode — planning for a task that doesn't exist yet (the "New task" form). */
exports.generateTaskPlan = asyncHandler(async (req, res) => {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id }))
    throw ApiError.forbidden("Only the guide or team leader can request an AI task plan");

  const title = String(req.body.title || "").trim();
  if (!title) throw ApiError.badRequest("title is required");

  const { members } = await loadPlanningContext(req.group, null);
  const summary = await buildPlanningSummary({
    group: req.group,
    task: { title, description: req.body.description || "", due: req.body.due || null },
    members,
  });
  res.json({ success: true, data: summary });
});

/** Existing-task mode — planning/re-planning a task that already exists. */
exports.generateTaskPlanForTask = asyncHandler(async (req, res) => {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id }))
    throw ApiError.forbidden("Only the guide or team leader can request an AI task plan");

  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id });
  if (!task) throw ApiError.notFound("Task not found");

  const { members, openDependencyTasks, blockingTasks } = await loadPlanningContext(req.group, task);
  const summary = await buildPlanningSummary({
    group: req.group,
    task: { title: task.title, description: task.description, due: task.due, dependencies: task.dependencies },
    members,
    openDependencyTasks,
    blockingTasks,
  });
  res.json({ success: true, data: summary });
});

/**
 * Persists ONLY the student-safe subset of a plan onto the task — never
 * the guide-only reasoning (priority reasons, recommended assignee,
 * risk data). Re-sanitizes everything the client sends rather than
 * trusting it just because it likely came from our own generate response
 * moments earlier — the same defensive posture as every other AI-backed
 * write in this codebase.
 */
exports.applyTaskPlan = asyncHandler(async (req, res) => {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id }))
    throw ApiError.forbidden("Only the guide or team leader can apply an AI task plan");

  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id });
  if (!task) throw ApiError.notFound("Task not found");

  const body = req.body || {};
  const subtasks = Array.isArray(body.subtasks)
    ? body.subtasks
        .slice(0, 7)
        .map((s) => ({
          title: sanitizeText(s?.title),
          difficulty: ["LOW", "MEDIUM", "HIGH"].includes(s?.difficulty) ? s.difficulty : "MEDIUM",
          estimatedHours:
            Number.isFinite(Number(s?.estimatedHours)) && Number(s.estimatedHours) > 0
              ? Math.min(200, Math.round(Number(s.estimatedHours)))
              : null,
        }))
        .filter((s) => s.title)
    : [];
  if (subtasks.length < 3) throw ApiError.badRequest("A plan needs at least 3 valid subtasks to apply");

  task.aiPlan = {
    subtasks,
    acceptanceCriteria: sanitizeStringList(body.acceptanceCriteria),
    testingChecklist: sanitizeStringList(body.testingChecklist),
    estimatedTotalEffort: sanitizeText(body.estimatedTotalEffort) || "",
    generatedAt: task.aiPlan?.generatedAt || new Date(),
    appliedAt: new Date(),
    appliedBy: req.user._id,
  };
  await task.save();
  res.json({ success: true, data: task.aiPlan });
});

exports.stats = asyncHandler(async (req, res) => {
  const tasks = await Task.find({ group: req.group._id }).lean();
  const now = new Date();
  res.json({
    success: true,
    data: {
      total: tasks.length,
      byStatus: Task.TASK_STATUSES.reduce(
        (acc, s) => ({ ...acc, [s]: tasks.filter((t) => t.status === s).length }),
        {}
      ),
      byPriority: Task.TASK_PRIORITIES.reduce(
        (acc, p) => ({ ...acc, [p]: tasks.filter((t) => t.priority === p).length }),
        {}
      ),
      overdue: tasks.filter((t) => t.status !== "done" && t.due && new Date(t.due) < now).length,
      completionPct: tasks.length
        ? Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100)
        : 0,
    },
  });
});
