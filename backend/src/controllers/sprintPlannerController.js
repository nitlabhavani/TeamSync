/**
 * STEP 23 — AI Sprint Planner endpoints.
 *
 * Additive: does not touch taskController.js, teamRiskController.js,
 * projectHealthController.js, projectExecutionCopilotController.js, or
 * teamPerformanceController.js. requireGroupAccess has already verified the
 * caller is a member/guide/admin of req.group (see routes/index.js +
 * middleware/auth.js) before any of these run.
 *
 * Authorization mirrors taskController.js exactly: generating and applying
 * a sprint plan are guide/team-leader-only operations, using the SAME
 * canRequestRecommendation({ isGuide, groupLeaderId, userId }) helper
 * already used for manual task creation/reassignment/AI task plans — no
 * second authorization system.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Task = require("../models/Task");
const SprintPlan = require("../models/SprintPlan");
const { canRequestRecommendation } = require("../services/smartTaskAssignmentService");
const { notifyUsers } = require("../services/notificationService");
const {
  buildSprintPreview,
  findStaleTasks,
  shapeForStudent,
} = require("../services/sprintPlannerService");

function requireGuideOrLeader(req) {
  if (!canRequestRecommendation({ isGuide: req.isGuide, groupLeaderId: req.group.leader, userId: req.user._id })) {
    throw ApiError.forbidden("Only the guide or team leader can use the AI Sprint Planner");
  }
}

/** POST /groups/:groupId/sprint-planner/preview — generates a DRAFT plan. Never mutates tasks. */
exports.preview = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);

  const body = req.body || {};
  const result = await buildSprintPreview(req.group, {
    startDate: body.startDate,
    endDate: body.endDate,
    durationDays: body.durationDays,
    maxTasks: body.maxTasks,
  });

  if (result.error) throw ApiError.badRequest(result.error);

  const plan = await SprintPlan.create({
    group: req.group._id,
    title: body.title || "Sprint Plan",
    sprintStart: result.sprintStart,
    sprintEnd: result.sprintEnd,
    planningHorizonDays: result.planningHorizonDays,
    status: "DRAFT",
    plannedTasks: result.plannedTasks.map((p) => ({
      task: p.taskId,
      title: p.title,
      priority: p.priority,
      currentStatus: p.currentStatus,
      currentAssignee: p.currentAssignee,
      recommendedOrder: p.recommendedOrder,
      recommendedStart: p.recommendedStart,
      recommendedDue: p.recommendedDue,
      estimatedEffort: p.estimatedEffort,
      dependencyTaskIds: p.dependencyTaskIds,
      blockedBy: p.blockedBy,
      riskLevel: p.riskLevel,
      reason: p.reason,
      recommendation: p.recommendation,
      statusAtGeneration: p.statusAtGeneration,
      dueAtGeneration: p.dueAtGeneration,
      assigneeAtGeneration: p.assigneeAtGeneration,
      updatedAtAtGeneration: p.updatedAtAtGeneration,
    })),
    workloadSummary: result.workloadSummary,
    dependencySummary: result.dependencySummary,
    riskSummary: result.riskSummary,
    recommendations: result.recommendations,
    baselineMetrics: result.baselineMetrics,
    generatedBy: req.user._id,
  });

  res.json({
    success: true,
    data: {
      plan,
      insufficient: result.insufficient,
      insufficientReason: result.insufficientReason,
      dateReasons: result.dateReasons,
    },
  });
});

/** POST /groups/:groupId/sprint-planner/:planId/apply — the ONLY action that mutates real tasks. */
exports.apply = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);

  const plan = await SprintPlan.findOne({ _id: req.params.planId, group: req.group._id });
  if (!plan) throw ApiError.notFound("Sprint plan not found");
  if (plan.status === "APPLIED") throw ApiError.badRequest("This sprint plan has already been applied");
  if (plan.status === "CANCELLED") throw ApiError.badRequest("This sprint plan was cancelled and cannot be applied");

  const taskIds = plan.plannedTasks.map((p) => p.task);
  const currentTasks = await Task.find({ _id: { $in: taskIds } }).lean();
  const currentTasksById = new Map(currentTasks.map((t) => [String(t._id), t]));
  // Tasks that vanished from the DB entirely are represented as null so
  // findStaleTasks can report TASK_DELETED distinctly from TASK_CHANGED.
  taskIds.forEach((id) => {
    if (!currentTasksById.has(String(id))) currentTasksById.set(String(id), null);
  });

  const stale = findStaleTasks(plan.plannedTasks, currentTasksById, req.group._id);
  if (stale.length > 0) {
    return res.status(409).json({
      success: false,
      error: "SPRINT_PLAN_STALE",
      message: "One or more tasks changed since this plan was generated. Regenerate the plan and review before applying.",
      staleTasks: stale,
    });
  }

  // Only fields the existing Task system already supports are touched, and
  // only for tasks explicitly part of this plan. No reassignment, no
  // deletion, no new tasks — matches spec §13 exactly.
  const selectedByAssignee = new Map();
  await Promise.all(
    plan.plannedTasks.map(async (p) => {
      const task = await Task.findById(p.task);
      if (!task) return;
      task.order = p.recommendedOrder;
      if (p.recommendedDue) task.due = task.due || p.recommendedDue; // never overwrite an existing due date
      await task.save();
      if (task.assignee) {
        const key = String(task.assignee);
        selectedByAssignee.set(key, (selectedByAssignee.get(key) || 0) + 1);
      }
    })
  );

  plan.status = "APPLIED";
  plan.appliedAt = new Date();
  plan.appliedBy = req.user._id;
  await plan.save();

  // Notify only affected students, only after a successful apply (spec §22).
  const affectedUserIds = Array.from(selectedByAssignee.keys());
  await Promise.all(
    affectedUserIds.map((uid) =>
      notifyUsers([uid], {
        type: "task",
        title: "New sprint plan applied",
        body: `You have ${selectedByAssignee.get(uid)} sprint task(s) in "${plan.title}".`,
        group: req.group._id,
      }).catch(() => {}) // notification failure must not fail the apply (spec §34)
    )
  );

  res.json({ success: true, data: plan });
});

/** GET /groups/:groupId/sprint-planner/current — any group member. Latest
 * APPLIED plan only; student-safe shaping (spec §21) — never exposes
 * team-wide workload/risk reasoning to a student. */
exports.current = asyncHandler(async (req, res) => {
  const plan = await SprintPlan.findOne({ group: req.group._id, status: "APPLIED" }).sort("-appliedAt");
  if (!plan) return res.json({ success: true, data: null });

  if (!req.isGuide && String(req.group.leader) !== String(req.user._id)) {
    return res.json({ success: true, data: shapeForStudent(plan, req.user._id) });
  }
  res.json({ success: true, data: plan });
});

/** GET /groups/:groupId/sprint-planner/history — guide/leader only. */
exports.history = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const items = await SprintPlan.find({ group: req.group._id }).sort("-createdAt").limit(20);
  res.json({ success: true, data: items });
});

/** GET /groups/:groupId/sprint-planner/:planId — student-safe if not guide/leader. */
exports.getOne = asyncHandler(async (req, res) => {
  const plan = await SprintPlan.findOne({ _id: req.params.planId, group: req.group._id });
  if (!plan) throw ApiError.notFound("Sprint plan not found");

  if (!req.isGuide && String(req.group.leader) !== String(req.user._id)) {
    return res.json({ success: true, data: shapeForStudent(plan, req.user._id) });
  }
  res.json({ success: true, data: plan });
});

/** POST /groups/:groupId/sprint-planner/:planId/cancel — guide/leader only, never mutates tasks. */
exports.cancel = asyncHandler(async (req, res) => {
  requireGuideOrLeader(req);
  const plan = await SprintPlan.findOne({ _id: req.params.planId, group: req.group._id });
  if (!plan) throw ApiError.notFound("Sprint plan not found");
  if (plan.status === "APPLIED") throw ApiError.badRequest("An already-applied sprint plan cannot be cancelled");
  plan.status = "CANCELLED";
  plan.cancelledAt = new Date();
  await plan.save();
  res.json({ success: true, data: plan });
});
