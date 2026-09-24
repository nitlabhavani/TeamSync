/**
 * Deadline monitor.
 *
 * Runs on an interval (default every 30 minutes) and:
 *  - sends "N days remaining" reminders at 5 / 2 / 1 / 0 days before the due date
 *  - sends an overdue warning to the student once the deadline passes
 *  - alerts the guide about every overdue task
 *
 * Each reminder is recorded on the task (`remindersSent`) so it is sent once.
 */
const Task = require("../models/Task");
const Group = require("../models/Group");
const User = require("../models/User");
const { notifyUsers } = require("./notificationService");
const { scanAllGroupsRisk } = require("./riskService");
const { scanAllGroupsTeamRisk } = require("./teamRiskAnalyzer");
// STEP 16 — additive proactive-intelligence scans. Each is isolated in its
// own try/catch inside runOnce() below, exactly like teamRisk already is,
// so a failure here can never break the existing soon/overdue/risk scans.
const { scanEarlyWarnings } = require("./deadlineNudgeService");
const { scanCollaborationRisk } = require("./collaborationRiskService");
// STEP 19 — additive, isolated exactly like the Step 16 scans above. Failure
// here never affects any existing scan result.
const { scanAllGroupsForecast } = require("./projectForecastService");
// STEP 21 — additive, isolated exactly like the scans above. Failure here
// never affects any existing scan result (see runOnce()'s own try/catch).
const { scanAllGroupsExecutionCopilot } = require("./projectExecutionCopilotService");
// STEP 22 — additive, isolated exactly like the scans above. Failure here
// never affects any existing scan result.
const { scanAllGroupsTeamPerformance } = require("./teamPerformanceService");
const {
  sendDeadlineReminderEmail,
  sendOverdueWarningEmail,
  sendGuideAlertEmail,
} = require("./emailTemplates");

const REMINDER_DAYS = [5, 2, 1, 0];
const OPEN_STATUSES = ["backlog", "todo", "in_progress", "review", "pending", "submitted", "ai_review", "guide_review", "rejected"];
const DAY = 24 * 60 * 60 * 1000;

const daysUntil = (date) => Math.ceil((new Date(date).getTime() - Date.now()) / DAY);

async function processDueSoon() {
  const horizon = new Date(Date.now() + 5 * DAY + 60 * 1000);
  const tasks = await Task.find({
    due: { $gte: new Date(Date.now() - 60 * 1000), $lte: horizon },
    status: { $in: OPEN_STATUSES },
    assignee: { $ne: null },
  })
    .populate("assignee", "name email")
    .populate("group", "name project guide");

  for (const task of tasks) {
    const left = Math.max(0, daysUntil(task.due));
    // Smallest reminder bucket that still covers the remaining days (5/2/1/0).
    const bucket = REMINDER_DAYS.filter((d) => left <= d).pop() ?? 0;
    const marker = `d${bucket}`;
    if (task.remindersSent.includes(marker)) continue;

    const message = left > 0 ? `${left} day${left === 1 ? "" : "s"} remaining` : "Deadline is today";
    await notifyUsers([task.assignee._id], {
      title: message,
      body: `Please complete your assigned task: ${task.title}`,
      type: "task",
      link: `/app/tasks`,
      group: task.group?._id,
      task: task._id,
    });
    await sendDeadlineReminderEmail({
      to: task.assignee.email,
      name: task.assignee.name,
      taskTitle: task.title,
      groupName: task.group?.name || "your team",
      daysLeft: left,
      due: task.due,
    });

    task.remindersSent.push(marker);
    await task.save();
  }
  return tasks.length;
}

async function processOverdue() {
  const tasks = await Task.find({
    due: { $lt: new Date() },
    status: { $in: OPEN_STATUSES },
    assignee: { $ne: null },
    $or: [{ overdueNotifiedAt: null }, { overdueNotifiedAt: { $lt: new Date(Date.now() - 1 * DAY) } }],
  })
    .populate("assignee", "name email")
    .populate("group", "name project guide");

  const guideAlerts = new Map();

  for (const task of tasks) {
    await notifyUsers([task.assignee._id], {
      title: "Warning — task overdue",
      body: `Your assigned task "${task.title}" is overdue.`,
      type: "task",
      link: "/app/tasks",
      group: task.group?._id,
      task: task._id,
    });
    await sendOverdueWarningEmail({
      to: task.assignee.email,
      name: task.assignee.name,
      taskTitle: task.title,
      groupName: task.group?.name || "your team",
      due: task.due,
    });

    const guideId = String(task.group?.guide || "");
    if (guideId) {
      if (!guideAlerts.has(guideId)) guideAlerts.set(guideId, []);
      guideAlerts
        .get(guideId)
        .push(`${task.assignee.name} has not completed "${task.title}" in ${task.group?.name}. Deadline exceeded.`);
    }

    task.overdueNotifiedAt = new Date();
    await task.save();
  }

  for (const [guideId, lines] of guideAlerts.entries()) {
    const guide = await User.findById(guideId).select("name email");
    if (!guide) continue;
    await notifyUsers([guideId], {
      title: "Deadline missed",
      body: lines[0],
      type: "risk",
      link: "/guide/alerts",
    });
    await sendGuideAlertEmail({
      to: guide.email,
      guideName: guide.name,
      subject: `${lines.length} overdue task${lines.length === 1 ? "" : "s"}`,
      lines,
    });
  }

  return tasks.length;
}

async function runOnce() {
  try {
    const soon = await processDueSoon();
    const overdue = await processOverdue();
    const risk = await scanAllGroupsRisk();
    // Step 15 — additive, separate team-risk snapshot/alert scan. Failures
    // here are isolated per-group (see scanAllGroupsTeamRisk) and never
    // affect the existing risk/deadline scan above.
    const teamRisk = await scanAllGroupsTeamRisk();

    // STEP 16 — additive, isolated so a failure here never affects the
    // existing soon/overdue/risk/teamRisk results computed above.
    let earlyWarnings = null;
    let collaborationRisk = null;
    try {
      earlyWarnings = await scanEarlyWarnings();
    } catch (err) {
      console.error(`[deadlines] early-warning scan failed: ${err.message}`);
      earlyWarnings = { error: err.message };
    }
    try {
      collaborationRisk = await scanCollaborationRisk();
    } catch (err) {
      console.error(`[deadlines] collaboration-risk scan failed: ${err.message}`);
      collaborationRisk = { error: err.message };
    }

    // STEP 19 — additive, isolated so a failure here never affects any of
    // the existing results computed above.
    let projectForecast = null;
    try {
      projectForecast = await scanAllGroupsForecast();
    } catch (err) {
      console.error(`[deadlines] project-forecast scan failed: ${err.message}`);
      projectForecast = { error: err.message };
    }

    // STEP 21 — additive, isolated so a failure here never affects any of
    // the existing results computed above, and never breaks the scheduler.
    let executionCopilot = null;
    try {
      executionCopilot = await scanAllGroupsExecutionCopilot();
    } catch (err) {
      console.error(`[deadlines] execution-copilot scan failed: ${err.message}`);
      executionCopilot = { error: err.message };
    }

    // STEP 22 — additive, isolated so a failure here never affects Team
    // Risk, Deadline Nudges, Collaboration Risk, Project Forecast, Project
    // Health, or Execution Copilot above, and never breaks the scheduler.
    let teamPerformance = null;
    try {
      teamPerformance = await scanAllGroupsTeamPerformance();
    } catch (err) {
      console.error(`[deadlines] team-performance scan failed: ${err.message}`);
      teamPerformance = { error: err.message };
    }

    return { soon, overdue, risk, teamRisk, earlyWarnings, collaborationRisk, projectForecast, executionCopilot, teamPerformance };
  } catch (err) {
    console.error(`[deadlines] scan failed: ${err.message}`);
    return { error: err.message };
  }
}

let timer = null;

function startDeadlineScheduler() {
  if (timer) return timer;
  const minutes = Number(process.env.DEADLINE_SCAN_MINUTES || 30);
  console.log(`[deadlines] monitor active — scanning every ${minutes} minute(s)`);
  // First pass shortly after boot, then on the interval.
  setTimeout(runOnce, 15_000);
  timer = setInterval(runOnce, minutes * 60 * 1000);
  return timer;
}

function stopDeadlineScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startDeadlineScheduler, stopDeadlineScheduler, runOnce, REMINDER_DAYS };
