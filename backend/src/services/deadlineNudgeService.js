/**
 * STEP 16 — Feature 2: Proactive Deadline Nudges (early warning).
 *
 * Purely additive alongside services/deadlineService.js, which already owns
 * the existing "due soon" reminder (5/2/1/0 day) and "overdue" logic — this
 * module NEVER marks a task overdue and never touches remindersSent /
 * overdueNotifiedAt. It only looks at tasks that are NOT yet overdue and
 * decides whether they are trending towards missing their deadline, using a
 * separate, transparent status:
 *
 *   ON_TRACK              — progress is keeping pace with time elapsed
 *   DEADLINE_APPROACHING  — due date is approaching, progress is somewhat
 *                           behind the expected pace
 *   AT_RISK               — progress is significantly behind pace, or the
 *                           task has been stalled (no update) for 5+ days
 *   (OVERDUE is left entirely to the existing deadlineService.js logic.)
 *
 * FORMULA (deterministic, no ML/AI-engine dependency — so this can never be
 * affected by the AI engine being unavailable):
 *   expectedProgress% = elapsed time / (due - createdAt) time, clamped 0-100
 *   actualProgress%   = estimateProgress(task)  (see below)
 *   gap               = expectedProgress - actualProgress
 *
 *   gap > 35, or task stalled 5+ days with no update -> AT_RISK
 *   gap > 15, or <=2 days left with < 70% progress   -> DEADLINE_APPROACHING
 *   otherwise                                        -> ON_TRACK
 *
 * `estimateProgress` uses existing task data only:
 *   - done/completed status                       -> 100
 *   - latest submission's AI-analyzed progress (%) -> that value, if present
 *   - otherwise a transparent status->progress map (see below)
 * No number here is invented per-task beyond what the existing status/
 * submission data already implies.
 */
const Task = require("../models/Task");
const Group = require("../models/Group");
const { notifyUsers } = require("./notificationService");

const DAY = 24 * 60 * 60 * 1000;
const DONE_STATUSES = ["done", "completed"];
const OPEN_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "pending",
  "submitted",
  "ai_review",
  "guide_review",
  "changes_requested",
  "rejected",
];

const STATUS_PROGRESS_MAP = {
  backlog: 0,
  todo: 0,
  pending: 0,
  in_progress: 35,
  review: 55,
  submitted: 55,
  ai_review: 55,
  guide_review: 65,
  changes_requested: 50,
  rejected: 20,
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const LEVEL_RANK = { ON_TRACK: 0, DEADLINE_APPROACHING: 1, AT_RISK: 2 };

/** Uses only existing task/submission data — never fabricates a number. */
function estimateProgress(task) {
  if (DONE_STATUSES.includes(task.status)) return 100;
  const submissions = task.submissions || [];
  const latest = submissions[submissions.length - 1];
  if (latest?.aiAnalysis?.progress != null && !Number.isNaN(Number(latest.aiAnalysis.progress))) {
    return clamp(Number(latest.aiAnalysis.progress));
  }
  return STATUS_PROGRESS_MAP[task.status] ?? 0;
}

/**
 * Pure function: given a task (plain object or Mongoose doc) and `now`,
 * returns the early-warning classification, or null when there is nothing
 * to warn about (no due date, task finished, or task already overdue —
 * overdue is the existing deadlineService.js's job, not this one's).
 */
function classifyEarlyWarning(task, now = new Date()) {
  if (!task.due) return null;
  if (DONE_STATUSES.includes(task.status)) return null;

  const due = new Date(task.due);
  if (due <= now) return null; // already overdue — leave to existing logic

  const created = new Date(task.createdAt || now);
  const totalMs = Math.max(due - created, DAY);
  const elapsedMs = Math.max(now - created, 0);
  const elapsedRatio = Math.min(1, elapsedMs / totalMs);
  const expectedProgress = Math.round(elapsedRatio * 100);
  const actualProgress = estimateProgress(task);
  const gap = expectedProgress - actualProgress;
  const daysLeft = Math.round(((due - now) / DAY) * 10) / 10;

  const lastUpdate = task.updatedAt ? new Date(task.updatedAt) : created;
  const stalled = OPEN_STATUSES.includes(task.status) && now - lastUpdate >= 5 * DAY;

  let level = "ON_TRACK";
  if (stalled || gap > 35) {
    level = "AT_RISK";
  } else if (gap > 15 || (daysLeft <= 2 && actualProgress < 70)) {
    level = "DEADLINE_APPROACHING";
  }

  if (level === "ON_TRACK") {
    return { level, severity: null, reason: null, recommendedAction: null, progress: actualProgress, daysLeft };
  }

  const severity = level === "AT_RISK" ? (daysLeft <= 1 ? "CRITICAL" : "HIGH") : daysLeft <= 2 ? "HIGH" : "MEDIUM";
  const reason = stalled
    ? `No progress update in ${Math.floor((now - lastUpdate) / DAY)}+ day(s), with ${daysLeft} day(s) remaining.`
    : `Only ${actualProgress}% progress with ${daysLeft} day(s) remaining.`;
  const recommendedAction =
    level === "AT_RISK"
      ? "Increase progress urgently or update the task plan with the guide."
      : "Increase progress or update the task plan.";

  return { level, severity, reason, recommendedAction, progress: actualProgress, daysLeft };
}

/** Read-only, no notifications/persistence — used by the ai-risk API/UI. */
async function getGroupEarlyWarnings(group) {
  const tasks = await Task.find({
    group: group._id,
    due: { $ne: null },
    status: { $in: OPEN_STATUSES },
  })
    .populate("assignee", "name")
    .lean();

  const now = new Date();
  const warnings = [];
  for (const task of tasks) {
    const result = classifyEarlyWarning(task, now);
    if (result && result.level !== "ON_TRACK") {
      warnings.push({
        taskId: String(task._id),
        title: task.title,
        assignee: task.assignee ? { id: String(task.assignee._id), name: task.assignee.name } : null,
        ...result,
      });
    }
  }
  return warnings;
}

/**
 * Scheduler entry point (called from deadlineService.js runOnce alongside
 * the existing due-soon/overdue scans). Computes early warnings for every
 * open, due-dated task across active groups and notifies only when a task's
 * level first appears or meaningfully worsens (dedup via task.earlyWarning),
 * exactly like the existing overdue/reminder logic in deadlineService.js.
 */
async function scanEarlyWarnings() {
  const groups = await Group.find({ status: "active" }).select("_id name guide");
  const groupById = new Map(groups.map((g) => [String(g._id), g]));

  const tasks = await Task.find({
    group: { $in: groups.map((g) => g._id) },
    due: { $ne: null },
    status: { $in: OPEN_STATUSES },
    assignee: { $ne: null },
  })
    .populate("assignee", "name email")
    .populate("group", "name guide");

  const now = new Date();
  let notified = 0;

  for (const task of tasks) {
    const result = classifyEarlyWarning(task, now);
    const newLevel = result ? result.level : "ON_TRACK";
    const previousLevel = task.earlyWarning?.level || "ON_TRACK";
    const lastNotifiedLevel = task.earlyWarning?.lastNotifiedLevel || "ON_TRACK";

    // Always keep the stored level fresh (informational, for the UI/API),
    // even when we don't send a new notification for it.
    task.earlyWarning = {
      level: newLevel,
      reason: result?.reason || "",
      recommendedAction: result?.recommendedAction || "",
      updatedAt: now,
      lastNotifiedLevel: task.earlyWarning?.lastNotifiedLevel || null,
      lastNotifiedAt: task.earlyWarning?.lastNotifiedAt || null,
    };

    const worseThanBefore = LEVEL_RANK[newLevel] > LEVEL_RANK[previousLevel];
    const worseThanLastNotified = LEVEL_RANK[newLevel] > LEVEL_RANK[lastNotifiedLevel];
    const shouldNotify = newLevel !== "ON_TRACK" && worseThanBefore && worseThanLastNotified;

    if (shouldNotify && task.assignee) {
      await notifyUsers([task.assignee._id], {
        title: "⏰ Deadline Nudge",
        body:
          `Your task "${task.title}" may fall behind schedule.\n` +
          `You are currently at ${result.progress}% progress with ${result.daysLeft} day(s) remaining.\n\n` +
          `Recommended action:\n${result.recommendedAction}`,
        type: "task",
        link: "/app/tasks",
        group: task.group?._id,
        task: task._id,
      });

      const guideId = task.group?.guide;
      if (guideId && newLevel === "AT_RISK") {
        await notifyUsers([guideId], {
          title: "⚠️ Team Deadline Risk",
          body:
            `"${task.title}" may miss its deadline.\n` +
            `Current progress: ${result.progress}%\n` +
            `Time remaining: ${result.daysLeft} day(s)\n` +
            `Assigned to: ${task.assignee.name}`,
          type: "risk",
          link: "/guide/team-analytics",
          group: task.group?._id,
          task: task._id,
        });
      }

      task.earlyWarning.lastNotifiedLevel = newLevel;
      task.earlyWarning.lastNotifiedAt = now;
      notified += 1;
    }

    await task.save();
  }

  void groupById;
  return { scanned: tasks.length, notified };
}

module.exports = {
  estimateProgress,
  classifyEarlyWarning,
  getGroupEarlyWarnings,
  scanEarlyWarnings,
};
