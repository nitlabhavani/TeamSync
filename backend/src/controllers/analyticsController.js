const asyncHandler = require("../utils/asyncHandler");
const Group = require("../models/Group");
const Task = require("../models/Task");
const Message = require("../models/Message");
const Meeting = require("../models/Meeting");
const RiskSnapshot = require("../models/RiskSnapshot");
const { computeGroupRisk, buildDeadlineTimeline } = require("../services/riskService");

/** Risk radar across every group the guide supervises. */
exports.radar = asyncHandler(async (req, res) => {
  const filter = req.user.role === "guide" ? { guide: req.user._id } : { members: req.user._id };
  const groups = await Group.find({ ...filter, status: "active" });
  const results = await Promise.all(groups.map((g) => computeGroupRisk(g, { persist: false })));
  res.json({
    success: true,
    data: {
      groups: results.sort((a, b) => b.score - a.score),
      summary: {
        high: results.filter((r) => r.level === "high").length,
        medium: results.filter((r) => r.level === "medium").length,
        low: results.filter((r) => r.level === "low").length,
        insufficient_data: results.filter((r) => r.level === "insufficient_data").length,
      },
    },
  });
});

exports.groupRisk = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await computeGroupRisk(req.group) });
});

exports.riskHistory = asyncHandler(async (req, res) => {
  const items = await RiskSnapshot.find({ group: req.group._id }).sort("-createdAt").limit(30);
  res.json({ success: true, data: items });
});

exports.timeline = asyncHandler(async (req, res) => {
  const filter = req.user.role === "guide" ? { guide: req.user._id } : { members: req.user._id };
  const groups = await Group.find({ ...filter, status: "active" }).select("_id");
  res.json({ success: true, data: await buildDeadlineTimeline(groups.map((g) => g._id)) });
});

/** Group analytics: activity series + contribution split. */
exports.groupAnalytics = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 14;
  const since = new Date(Date.now() - days * 86400000);

  const group = await req.group.populate("members", "name color email");

  const [messages, tasks, meetings] = await Promise.all([
    Message.find({ group: req.group._id, createdAt: { $gte: since }, deleted: { $ne: true } })
      .populate("sender", "name color")
      .lean(),
    Task.find({ group: req.group._id }).populate("assignee", "name color").lean(),
    Meeting.countDocuments({ group: req.group._id }),
  ]);

  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86400000);
    const key = day.toISOString().slice(0, 10);
    return {
      date: key,
      messages: messages.filter((m) => m.createdAt && new Date(m.createdAt).toISOString().slice(0, 10) === key).length,
      tasksCompleted: tasks.filter(
        (t) =>
          (t.status === "done" || t.status === "completed") &&
          t.completedAt &&
          new Date(t.completedAt).toISOString().slice(0, 10) === key
      ).length,
    };
  });

  const contribution = {};

  // Pre-seed all active group members so each member shows up in contribution breakdown
  for (const m of group.members || []) {
    const uid = String(m._id || m.id);
    contribution[uid] = {
      userId: uid,
      name: m.name || "Member",
      color: m.color,
      tasks: 0,
      done: 0,
      messages: 0,
    };
  }

  tasks.forEach((t) => {
    const uid = t.assignee?._id ? String(t.assignee._id) : (t.assignee ? String(t.assignee) : "unassigned");
    const name = t.assignee?.name || (uid !== "unassigned" ? contribution[uid]?.name : "Unassigned") || "Unassigned";
    contribution[uid] = contribution[uid] || {
      userId: uid,
      name,
      color: t.assignee?.color,
      tasks: 0,
      done: 0,
      messages: 0,
    };
    contribution[uid].tasks += 1;
    if (t.status === "done" || t.status === "completed") {
      contribution[uid].done += 1;
    }
  });

  messages.forEach((m) => {
    const senderId = m.sender?._id ? String(m.sender._id) : (m.sender ? String(m.sender) : "unknown");
    if (contribution[senderId]) {
      contribution[senderId].messages += 1;
    } else if (senderId !== "unknown") {
      const senderName = m.sender?.name || "Member";
      contribution[senderId] = {
        userId: senderId,
        name: senderName,
        color: m.sender?.color,
        tasks: 0,
        done: 0,
        messages: 1,
      };
    }
  });

  const completedCount = tasks.filter((t) => t.status === "done" || t.status === "completed").length;

  res.json({
    success: true,
    data: {
      series,
      contribution: Object.values(contribution),
      totals: {
        messages: messages.length,
        meetings,
        tasks: tasks.length,
        completed: completedCount,
      },
    },
  });
});

/** Guide dashboard rollup. */
exports.guideOverview = asyncHandler(async (req, res) => {
  const Invitation = require("../models/Invitation");
  const groups = await Group.find({ guide: req.user._id, status: "active" }).populate(
    "members",
    "name lastSeenAt isActive"
  );
  const risks = await Promise.all(groups.map((g) => computeGroupRisk(g, { persist: false })));

  const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const memberMap = new Map();
  groups.forEach((g) => g.members.forEach((m) => memberMap.set(String(m._id), m)));
  const members = [...memberMap.values()];
  const activeMembers = members.filter(
    (m) => m.isActive !== false && m.lastSeenAt && now - new Date(m.lastSeenAt).getTime() < ACTIVE_WINDOW_MS
  ).length;

  const groupIds = groups.map((g) => g._id);
  const [pendingInvitations, acceptedInvitations, rejectedInvitations] = await Promise.all([
    Invitation.countDocuments({ group: { $in: groupIds }, status: "pending" }),
    Invitation.countDocuments({ group: { $in: groupIds }, status: "accepted" }),
    Invitation.countDocuments({ group: { $in: groupIds }, status: "rejected" }),
  ]);

  const ranking = groups
    .map((g) => ({
      id: String(g._id),
      name: g.name,
      project: g.project,
      progress: g.progress || 0,
      collaborationScore: g.collaborationScore || 0,
      memberCount: g.members.length,
    }))
    .sort((a, b) => b.collaborationScore - a.collaborationScore);

  const avg = (fn) =>
    groups.length ? Math.round(groups.reduce((s, g) => s + (fn(g) || 0), 0) / groups.length) : 0;

  res.json({
    success: true,
    data: {
      groupCount: groups.length,
      studentCount: members.length,
      activeMembers,
      inactiveMembers: Math.max(members.length - activeMembers, 0),
      pendingInvitations,
      acceptedInvitations,
      rejectedInvitations,
      avgProgress: avg((g) => g.progress),
      avgScore: avg((g) => g.collaborationScore),
      ranking,
      topTeam: ranking[0] || null,
      leastActiveTeam: ranking.length > 1 ? ranking[ranking.length - 1] : null,
      atRisk: risks
        .filter((r) => r.level !== "low")
        .map((r) => ({ group: r.groupName, score: r.score, level: r.level })),
    },
  });
});

