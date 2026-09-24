/**
 * STEP 19 — AI Project Progress Forecast & Early Intervention System
 * endpoints.
 *
 * Additive: does not touch teamRiskController.js or any existing route.
 * requireGroupAccess has already verified the caller is a member/guide/
 * admin of req.group before any of these run (see routes/index.js +
 * middleware/auth.js), so cross-group access is impossible here.
 *
 * Guide/Team Leader gets the full forecast + intervention recommendations.
 * Students only ever see their OWN progress — never team-wide forecast
 * numbers, other students' status, workload comparisons, or guide-only
 * intervention recommendations (Feature 4 — Privacy).
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Task = require("../models/Task");
const ProjectForecastSnapshot = require("../models/ProjectForecastSnapshot");
const { runProjectForecast } = require("../services/projectForecastService");

const DONE_STATUSES = ["done", "completed"];

/** True for the guide/admin (req.isGuide, set by requireGroupAccess) OR the
 * group's student Team Leader — mirrors the existing pattern used across
 * reportController.js / taskController.js / submissionController.js.
 * STEP 31 — consolidated into the single shared implementation (was a
 * verbatim copy across 4 controllers; see utils/authz.js for details). */
const { isGuideOrLeader } = require("../utils/authz");

/**
 * A student's own progress only — no team probability, no other student's
 * data, no workload ranking, no guide-only reasoning (Feature 8/4/17).
 */
async function buildStudentProgress(group, userId) {
  const myTasks = await Task.find({ group: group._id, assignee: userId })
    .select("title status due updatedAt")
    .lean();

  const total = myTasks.length;
  const completed = myTasks.filter((t) => DONE_STATUSES.includes(t.status)).length;
  const now = new Date();
  const open = myTasks.filter((t) => !DONE_STATUSES.includes(t.status));
  const overdue = open.filter((t) => t.due && new Date(t.due) < now);

  // Next priority: the most overdue task, else the soonest-due open task,
  // else the least-recently-updated open task. Always a real task or null.
  let next = null;
  if (overdue.length) {
    next = [...overdue].sort((a, b) => new Date(a.due) - new Date(b.due))[0];
  } else if (open.some((t) => t.due)) {
    next = [...open].filter((t) => t.due).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
  } else if (open.length) {
    next = open[0];
  }

  let status = "ON_TRACK";
  if (overdue.length > 0) status = "NEEDS_ATTENTION";
  else if (total > 0 && completed / total < 0.3 && total >= 3) status = "NEEDS_ATTENTION";

  return {
    status,
    completed,
    total,
    message:
      status === "ON_TRACK"
        ? "Your current progress is aligned with your assigned workload."
        : "Some of your assigned tasks need attention.",
    nextPriority: next ? { taskId: String(next._id), title: next.title, due: next.due } : null,
  };
}

/** GET /groups/:groupId/project-forecast */
exports.getForecast = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    const myProgress = await buildStudentProgress(req.group, req.user._id);
    return res.json({ success: true, data: { myProgress } });
  }

  const result = await runProjectForecast(req.group, { persist: true });
  res.json({ success: true, data: result });
});

/** GET /groups/:groupId/intervention-recommendations — guide/leader only. */
exports.getRecommendations = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view intervention recommendations");
  }
  const result = await runProjectForecast(req.group, { persist: false });
  res.json({
    success: true,
    data: {
      groupId: result.groupId,
      forecastStatus: result.status,
      probability: result.probability,
      recommendations: result.recommendations,
    },
  });
});

/** GET /groups/:groupId/project-forecast/history — guide/leader only. */
exports.getForecastHistory = asyncHandler(async (req, res) => {
  if (!isGuideOrLeader(req)) {
    throw ApiError.forbidden("Only the guide or team leader can view forecast history");
  }
  const items = await ProjectForecastSnapshot.find({ group: req.group._id }).sort("-createdAt").limit(30);
  res.json({ success: true, data: items });
});
