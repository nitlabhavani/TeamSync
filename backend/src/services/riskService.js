const Task = require("../models/Task");
const Meeting = require("../models/Meeting");
const Milestone = require("../models/Milestone");
const Message = require("../models/Message");
const Group = require("../models/Group");
const RiskSnapshot = require("../models/RiskSnapshot");
const { notifyUsers } = require("./notificationService");

const DAY = 86400000;

/**
 * Computes an AI risk score (0 = healthy, 100 = critical) from
 * overdue tasks, missed milestones, chat activity and meeting cadence.
 */
async function computeGroupRisk(group, { persist = true } = {}) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * DAY);

  const [tasks, milestones, meetings, recentMessages] = await Promise.all([
    Task.find({ group: group._id }).lean(),
    Milestone.find({ group: group._id }).lean(),
    Meeting.find({ group: group._id }).lean(),
    Message.countDocuments({ group: group._id, createdAt: { $gte: weekAgo } }),
  ]);

  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => t.due && new Date(t.due) < now);
  const dueSoon = openTasks.filter(
    (t) => t.due && new Date(t.due) >= now && new Date(t.due) - now < 3 * DAY
  );
  const missedMilestones = milestones.filter(
    (m) => m.status !== "done" && new Date(m.due) < now
  );
  const lastMeeting = meetings
    .filter((m) => new Date(m.when) <= now && m.status === "completed")
    .sort((a, b) => new Date(b.when) - new Date(a.when))[0];
  const daysSinceMeeting = lastMeeting
    ? Math.floor((now - new Date(lastMeeting.when)) / DAY)
    : 30;

  const doneRatio = tasks.length ? tasks.filter((t) => t.status === "done" || t.status === "completed").length / tasks.length : 0;

  const drivers = [];
  const add = (key, label, impact, detail) => {
    if (impact > 0) drivers.push({ key, label, impact: Math.round(impact), detail });
  };

  add("overdue_tasks", "Overdue tasks", Math.min(30, overdue.length * 8),
    `${overdue.length} task(s) past their due date`);
  add("missed_milestones", "Missed milestones", Math.min(25, missedMilestones.length * 12),
    `${missedMilestones.length} milestone(s) missed`);
  add("low_communication", "Low communication", recentMessages < 5 ? 20 : recentMessages < 15 ? 10 : 0,
    `${recentMessages} message(s) in the last 7 days`);
  add("meeting_cadence", "Meeting cadence", daysSinceMeeting > 14 ? 15 : daysSinceMeeting > 7 ? 8 : 0,
    `Last completed meeting ${daysSinceMeeting} day(s) ago`);
  add("slow_progress", "Slow delivery", doneRatio < 0.25 ? 12 : doneRatio < 0.5 ? 6 : 0,
    `${Math.round(doneRatio * 100)}% of tasks completed`);
  add("crunch", "Deadline crunch", Math.min(10, dueSoon.length * 3),
    `${dueSoon.length} task(s) due within 72 hours`);

  const hasData = tasks.length > 0 || recentMessages > 0;
  const score = hasData ? Math.max(0, Math.min(100, drivers.reduce((s, d) => s + d.impact, 0))) : 0;
  const level = !hasData ? "insufficient_data" : score >= 60 ? "high" : score >= 30 ? "medium" : "low";

  const recommendations = [];
  if (!hasData) {
    recommendations.push("Create and assign tasks to start tracking group risk.");
  } else {
    if (overdue.length) recommendations.push(`Re-plan or split the ${overdue.length} overdue task(s) in the next stand-up.`);
    if (missedMilestones.length) recommendations.push("Reset the milestone plan with the guide — current dates are no longer realistic.");
    if (recentMessages < 5) recommendations.push("Communication has stalled; ask the team for a written status update today.");
    if (daysSinceMeeting > 7) recommendations.push("Schedule a sync — the team has not met for over a week.");
    if (!recommendations.length) recommendations.push("Group is healthy — keep the current cadence.");
  }

  const result = {
    groupId: String(group._id),
    groupName: group.name,
    score,
    level,
    drivers: drivers.sort((a, b) => b.impact - a.impact),
    recommendations,
    stats: {
      totalTasks: tasks.length,
      openTasks: openTasks.length,
      overdueTasks: overdue.length,
      dueSoon: dueSoon.length,
      missedMilestones: missedMilestones.length,
      messagesLast7Days: recentMessages,
      daysSinceMeeting,
      completionPct: Math.round(doneRatio * 100),
    },
  };

  if (persist) {
    const previous = await RiskSnapshot.findOne({ group: group._id }).sort({ createdAt: -1 });

    await RiskSnapshot.create({
      group: group._id,
      score,
      level,
      drivers: result.drivers,
      recommendations,
    });

    // Alert the guide only when the group newly crosses into "high" risk.
    // If the previous snapshot was already "high", this is the same unresolved
    // episode continuing — do not re-notify (this also covers repeated
    // dashboard opens, which call this function with persist:true each time).
    const wasAlreadyHigh = previous?.level === "high";
    result.alerted = false;
    if (level === "high" && !wasAlreadyHigh && group.guide) {
      await notifyUsers([group.guide], {
        title: "AI risk alert",
        body: `${group.name} is now flagged as high risk — ${result.drivers[0]?.detail || "multiple risk signals detected"}.`,
        type: "risk",
        link: "/guide/alerts",
        group: group._id,
      });
      result.alerted = true;
    }
  }

  return result;
}

/**
 * Scans every active group's risk (persisting a snapshot for each, same as a
 * guide opening the risk radar would) so groups nobody is actively viewing
 * still get a proactive AI risk alert. Meant to be called from the existing
 * deadline scheduler's periodic run rather than a separate interval.
 */
async function scanAllGroupsRisk() {
  const groups = await Group.find({ status: "active" });
  let alerted = 0;
  for (const group of groups) {
    try {
      const result = await computeGroupRisk(group, { persist: true });
      if (result.alerted) alerted += 1;
    } catch (err) {
      console.error(`[risk] scan failed for group ${group._id}: ${err.message}`);
    }
  }
  return { groups: groups.length, alerted };
}

/** Combined deadline timeline (tasks + milestones + meetings). */
async function buildDeadlineTimeline(groupIds) {
  const [tasks, milestones, meetings] = await Promise.all([
    Task.find({ group: { $in: groupIds }, status: { $ne: "done" }, due: { $ne: null } })
      .populate("assignee", "name color")
      .populate("group", "name")
      .lean(),
    Milestone.find({ group: { $in: groupIds } }).populate("group", "name").lean(),
    Meeting.find({ group: { $in: groupIds }, status: "scheduled" }).populate("group", "name").lean(),
  ]);

  const items = [
    ...tasks.map((t) => ({
      kind: "task", id: String(t._id), title: t.title, when: t.due,
      group: t.group?.name, owner: t.assignee?.name, priority: t.priority,
    })),
    ...milestones.map((m) => ({
      kind: "milestone", id: String(m._id), title: m.title, when: m.due,
      group: m.group?.name, status: m.status,
    })),
    ...meetings.map((m) => ({
      kind: "meeting", id: String(m._id), title: m.title, when: m.when, group: m.group?.name,
    })),
  ].sort((a, b) => new Date(a.when) - new Date(b.when));

  return items;
}

module.exports = { computeGroupRisk, buildDeadlineTimeline, scanAllGroupsRisk };
