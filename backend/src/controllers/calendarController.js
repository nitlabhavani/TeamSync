const asyncHandler = require("../utils/asyncHandler");
const Task = require("../models/Task");
const Meeting = require("../models/Meeting");
const SprintPlan = require("../models/SprintPlan");
const Milestone = require("../models/Milestone");

/**
 * CALENDAR — a read-only aggregation/visualization layer over data that
 * already exists elsewhere in the app (Tasks, Meetings, SprintPlans,
 * Milestones, and each Group's own `expectedCompletion`). This file does
 * not own any data and does not create a second task/meeting/sprint system
 * — it only queries the same collections the existing Tasks/Meetings/
 * Sprint Planner controllers already query, and normalizes the results
 * into one shape for the calendar UI.
 *
 * Authorization: `requireGroupAccess` (already applied on the route) is
 * the source of truth for "is this user allowed to see this group at
 * all" — it populates `req.group` and `req.isGuide`. On top of that, this
 * controller applies the exact same per-student task visibility rule
 * `taskController.list` already uses (`filter.assignee = req.user._id`
 * for a student who isn't the group's guide/leader), so a student's
 * calendar can never show another student's task. Meetings, sprints,
 * milestones and the project deadline are visible to every group member
 * exactly as they already are on the existing Meetings page and Milestones
 * list (i.e. this introduces no new restriction and no new leak — group
 * membership, enforced by requireGroupAccess, is and was already the
 * access boundary for those).
 */

/** Parses a query-string date param into a Date, or null if absent/invalid. */
function parseDateParam(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Builds a Mongo range filter for a single Date field, or {} if no bounds given. */
function rangeFilter(field, start, end) {
  if (!start && !end) return {};
  const cond = {};
  if (start) cond.$gte = start;
  if (end) cond.$lte = end;
  return { [field]: cond };
}

/** Builds an "overlaps [start,end]" filter for a [fieldStart, fieldEnd] span. */
function overlapFilter(fieldStart, fieldEnd, start, end) {
  if (!start && !end) return {};
  const cond = {};
  if (end) cond[fieldStart] = { $lte: end };
  if (start) cond[fieldEnd] = { $gte: start };
  return cond;
}

exports.getEvents = asyncHandler(async (req, res) => {
  const groupId = req.group._id;
  const start = parseDateParam(req.query.start);
  const end = parseDateParam(req.query.end);
  const isLeader = Boolean(req.isLeader);
  const isStudentOnly = req.user.role === "student" && !req.isGuide;

  const taskFilter = {
    group: groupId,
    due: { $ne: null },
    ...rangeFilter("due", start, end),
  };
  // Strict student isolation: A student must ONLY see tasks assigned to them,
  // never tasks assigned to other team members on their calendar.
  if (isStudentOnly) {
    taskFilter.assignee = req.user._id;
  }

  const meetingFilter = {
    group: groupId,
    ...rangeFilter("when", start, end),
  };

  const sprintFilter = {
    group: groupId,
    status: { $ne: "CANCELLED" },
    ...overlapFilter("sprintStart", "sprintEnd", start, end),
  };

  const milestoneFilter = {
    group: groupId,
    ...rangeFilter("due", start, end),
  };

  let taskQuery = Task.find(taskFilter).select(
    "title due priority status assignee group source whatToDo expectedOutput deliverableType completionCriteria earlyWarning aiPlan module nextTask verifiedBy estimate progress"
  );
  if (typeof taskQuery.populate === "function") {
    taskQuery = taskQuery.populate("assignee", "name color avatar role dept");
  }

  const [tasks, meetings, sprints, milestones] = await Promise.all([
    taskQuery.lean(),
    Meeting.find(meetingFilter).select("title when durationMins status group meetingLink link").lean(),
    SprintPlan.find(sprintFilter).select("title sprintStart sprintEnd status group").lean(),
    Milestone.find(milestoneFilter).select("title due status group").lean(),
  ]);

  const events = [];

  for (const t of tasks) {
    if (isStudentOnly) {
      const aId = t.assignee ? String(t.assignee._id || t.assignee.id || t.assignee) : null;
      if (aId !== String(req.user._id)) continue;
    }

    const isAi = Boolean(
      t.source === "ai" ||
      t.source === "ai_chat" ||
      t.verifiedBy === "AI" ||
      (t.aiPlan && (t.aiPlan.subtasks?.length > 0 || t.aiPlan.acceptanceCriteria?.length > 0)) ||
      (t.whatToDo && t.whatToDo.trim().length > 0)
    );

    events.push({
      id: `task-${t._id}`,
      type: "task",
      isAiDeadline: isAi,
      title: t.title,
      start: t.due,
      end: t.due,
      allDay: true,
      groupId: String(t.group),
      sourceId: String(t._id),
      metadata: {
        priority: t.priority,
        status: t.status,
        source: t.source || "manual",
        isAiDeadline: isAi,
        whatToDo: t.whatToDo || "",
        expectedOutput: t.expectedOutput || "",
        deliverableType: t.deliverableType || "",
        completionCriteria: t.completionCriteria || [],
        aiPlan: t.aiPlan || null,
        nextTask: t.nextTask || null,
        verifiedBy: t.verifiedBy || null,
        earlyWarning: t.earlyWarning || null,
        module: t.module || "",
        estimate: t.estimate || 1,
        progress: t.progress || 0,
        assignee: t.assignee
          ? {
              id: String(t.assignee._id || t.assignee.id || t.assignee),
              name: t.assignee.name || "Assigned Student",
              color: t.assignee.color || "#5B5FEF",
              avatar: t.assignee.avatar || "",
            }
          : null,
        assigneeId: t.assignee ? String(t.assignee._id || t.assignee.id || t.assignee) : null,
        isMine: t.assignee
          ? String(t.assignee._id || t.assignee.id || t.assignee) === String(req.user._id)
          : false,
      },
    });
  }

  for (const m of meetings) {
    const startsAt = m.when;
    const endsAt = new Date(new Date(m.when).getTime() + (m.durationMins || 30) * 60000);
    events.push({
      id: `meeting-${m._id}`,
      type: "meeting",
      title: m.title,
      start: startsAt,
      end: endsAt,
      allDay: false,
      groupId: String(m.group),
      sourceId: String(m._id),
      metadata: {
        status: m.status,
        durationMins: m.durationMins,
        meetingLink: m.meetingLink || m.link || null,
      },
    });
  }

  for (const s of sprints) {
    events.push({
      id: `sprint-${s._id}`,
      type: "sprint",
      title: s.title || "Sprint",
      start: s.sprintStart,
      end: s.sprintEnd,
      allDay: true,
      groupId: String(s.group),
      sourceId: String(s._id),
      metadata: { status: s.status },
    });
  }

  for (const ms of milestones) {
    events.push({
      id: `milestone-${ms._id}`,
      type: "milestone",
      title: ms.title,
      start: ms.due,
      end: ms.due,
      allDay: true,
      groupId: String(ms.group),
      sourceId: String(ms._id),
      metadata: { status: ms.status },
    });
  }

  // Project deadline: the existing real source of truth is Group.expectedCompletion
  // (see models/Group.js). Never fabricated — only shown when the group
  // actually has one set, and only when it falls in the requested range (if
  // a range was given).
  const deadline = req.group.expectedCompletion;
  if (deadline) {
    const inRange = (!start || deadline >= start) && (!end || deadline <= end);
    if (inRange) {
      events.push({
        id: `deadline-${req.group._id}`,
        type: "deadline",
        title: `${req.group.project || req.group.name} — project deadline`,
        start: deadline,
        end: deadline,
        allDay: true,
        groupId: String(req.group._id),
        sourceId: String(req.group._id),
        metadata: {},
      });
    }
  }

  res.json({ success: true, data: { events } });
});
