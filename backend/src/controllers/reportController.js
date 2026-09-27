/**
 * AI reports, recommendations and guide dashboard statistics.
 * Exports to CSV/Excel-friendly and printable formats are included.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Group = require("../models/Group");
const Task = require("../models/Task");
const User = require("../models/User");
const Invitation = require("../models/Invitation");
const AiReport = require("../models/AiReport");
const Message = require("../models/Message");
const FileAsset = require("../models/FileAsset");
const reportService = require("../services/reportService");
const aiSummaryService = require("../services/aiSummaryService");
const aiEngine = require("../services/aiEngineClient");
const planTaskService = require("../services/projectPlanTaskService");
const mlFeatureService = require("../services/mlFeatureService");
const { notifyUsers } = require("../services/notificationService");
const { recalcGroupProgress } = require("./groupController");

const DONE = ["done", "completed"];

/** GET /api/guide/dashboard — the ten dashboard cards. */
exports.guideDashboard = asyncHandler(async (req, res) => {
  const guideId = req.user._id;
  const groups = await Group.find({ guide: guideId, status: "active" }).populate("members", "name email lastSeenAt isActive").lean();
  const groupIds = groups.map((g) => g._id);

  const [tasks, invitations] = await Promise.all([
    Task.find({ group: { $in: groupIds } }).lean(),
    Invitation.find({ group: { $in: groupIds } }).lean(),
  ]);

  const students = new Map();
  groups.forEach((g) => (g.members || []).forEach((m) => students.set(String(m._id), m)));
  const activeWindow = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeStudents = [...students.values()].filter(
    (s) => s.lastSeenAt && new Date(s.lastSeenAt).getTime() > activeWindow
  );

  const completed = tasks.filter((t) => DONE.includes(t.status));
  const collaboration = Math.round(
    groups.reduce((a, g) => a + (g.collaborationScore ?? 0), 0) / (groups.length || 1)
  );

  res.json({
    success: true,
    data: {
      totalGroups: groups.length,
      totalStudents: students.size,
      activeStudents: activeStudents.length,
      inactiveStudents: students.size - activeStudents.length,
      pendingInvitations: invitations.filter((i) => i.status === "pending").length,
      acceptedInvitations: invitations.filter((i) => i.status === "accepted").length,
      rejectedInvitations: invitations.filter((i) => i.status === "rejected").length,
      collaborationScore: collaboration,
      projectCompletion: Math.round(groups.reduce((a, g) => a + (g.progress ?? 0), 0) / (groups.length || 1)),
      pendingTasks: tasks.length - completed.length,
      completedTasks: completed.length,
      overdueTasks: tasks.filter((t) => t.due && !DONE.includes(t.status) && new Date(t.due) < new Date()).length,
    },
  });
});

/** GET /api/groups/:groupId/ai/report */
exports.groupReport = asyncHandler(async (req, res) => {
  const data = await reportService.analyseGroup(req.group._id);
  res.json({ success: true, data });
});

/** GET /api/groups/:groupId/ai/report/:period  (daily | weekly | monthly) */
exports.periodReport = asyncHandler(async (req, res) => {
  const requested = String(req.params.period || "weekly").toLowerCase();
  const period = requested === "monthly" || requested === "daily" ? requested : "weekly";
  const data = await reportService.buildPeriodReport(req.group._id, period);
  res.json({ success: true, data });
});

/** GET /api/groups/:groupId/ai/report/history */
exports.reportHistory = asyncHandler(async (req, res) => {
  const reports = await AiReport.find({ group: req.group._id }).sort("-periodStart").limit(24).lean();
  res.json({ success: true, data: reports });
});

/** GET /api/ai/guide-report — cross-group AI report for the guide. */
exports.guideReport = asyncHandler(async (req, res) => {
  const data = await reportService.guideReport(req.user._id);
  res.json({ success: true, data });
});

/** GET /api/groups/:groupId/ai/performance — per-student scores. */
exports.performance = asyncHandler(async (req, res) => {
  const snapshot = await reportService.analyseGroup(req.group._id);
  res.json({ success: true, data: snapshot.students });
});

/** GET /api/groups/:groupId/ai/recommendations */
exports.recommendations = asyncHandler(async (req, res) => {
  const snapshot = await reportService.analyseGroup(req.group._id);
  res.json({ success: true, data: snapshot.recommendations });
});

/** GET /api/groups/:groupId/ai/prediction */
exports.prediction = asyncHandler(async (req, res) => {
  const snapshot = await reportService.analyseGroup(req.group._id);
  res.json({ success: true, data: snapshot.prediction });
});

/** GET /api/ai/engine-status */
exports.engineStatus = asyncHandler(async (req, res) => {
  const health = await aiEngine.health();
  res.json({
    success: true,
    data: { url: aiEngine.AI_ENGINE_URL, online: health.ok, detail: health.ok ? health.data : health.reason },
  });
});

exports.groupAiSummary = asyncHandler(async (req, res) => {
  const data = await aiSummaryService.generateGroupAiSummary(req.group, req.user);
  res.json({ success: true, data });
});

/**
 * GET /api/groups/:groupId/ai/report/export?format=csv|json|html|pdf
 * CSV opens directly in Excel; JSON is used by client-side tools; HTML provides a clean printable document.
 */
exports.exportReport = asyncHandler(async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  const snapshot = await reportService.analyseGroup(req.group._id);

  if (format === "json") {
    res.setHeader("Content-Disposition", `attachment; filename="${snapshot.group.name}-report.json"`);
    res.json({ success: true, data: snapshot });
    return;
  }

  if (format === "html" || format === "pdf") {
    const studentRows = snapshot.students
      .map(
        (s) => `<tr>
        <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 500;">${s.name}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">${s.overall}%</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">${s.taskCompletion}%</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">${s.tasksAssigned}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">${s.tasksCompleted}</td>
        <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; color: ${s.overdue > 0 ? '#ef4444' : '#10b981'}; font-weight: 600;">${s.overdue}</td>
      </tr>`
      )
      .join("");

    const recItems = (snapshot.recommendations || [])
      .map((r) => `<li style="margin-bottom: 6px;">${r}</li>`)
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>TeamSync AI Report - ${snapshot.group.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; padding: 32px; max-width: 900px; margin: 0 auto; line-height: 1.5; }
    h1 { margin-bottom: 4px; color: #0f172a; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    .card-label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .card-val { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 24px; font-size: 14px; }
    th { background: #f1f5f9; padding: 10px 8px; border: 1px solid #cbd5e1; text-align: left; font-size: 12px; text-transform: uppercase; color: #475569; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: right; margin-bottom: 16px;">
    <button onclick="window.print()" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500;">Print / Save as PDF</button>
  </div>
  <h1>${snapshot.group.name}</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()} | Project: ${snapshot.group.project || "TeamSync AI"}</div>
  
  <div class="grid">
    <div class="card">
      <div class="card-label">Completion</div>
      <div class="card-val">${snapshot.summary?.completion || 0}%</div>
    </div>
    <div class="card">
      <div class="card-label">Total Tasks</div>
      <div class="card-val">${snapshot.summary?.tasksTotal || 0}</div>
    </div>
    <div class="card">
      <div class="card-label">Completed Tasks</div>
      <div class="card-val">${snapshot.summary?.tasksCompleted || 0}</div>
    </div>
    <div class="card">
      <div class="card-label">Overdue Tasks</div>
      <div class="card-val" style="color: ${(snapshot.summary?.tasksOverdue || 0) > 0 ? '#ef4444' : '#0f172a'}">${snapshot.summary?.tasksOverdue || 0}</div>
    </div>
  </div>

  <h3 style="margin-bottom: 8px;">Student Contributions & Performance</h3>
  <table>
    <thead>
      <tr>
        <th>Student</th>
        <th style="text-align: center;">Overall Score</th>
        <th style="text-align: center;">Task Completion</th>
        <th style="text-align: center;">Assigned</th>
        <th style="text-align: center;">Completed</th>
        <th style="text-align: center;">Overdue</th>
      </tr>
    </thead>
    <tbody>
      ${studentRows || '<tr><td colspan="6" style="padding: 16px; text-align: center; color: #94a3b8;">No student metrics available</td></tr>'}
    </tbody>
  </table>

  <h3 style="margin-bottom: 8px;">Recommendations</h3>
  <ul style="padding-left: 20px; font-size: 14px; color: #334155;">
    ${recItems || '<li>No immediate interventions needed. Maintain current project pace.</li>'}
  </ul>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
    return;
  }

  const rows = [
    ["Student", "Participation", "Task completion", "Communication", "Collaboration", "Overall", "Assigned", "Completed", "Overdue"],
    ...snapshot.students.map((s) => [
      s.name,
      s.participation,
      s.taskCompletion,
      s.communication,
      s.collaboration,
      s.overall,
      s.tasksAssigned,
      s.tasksCompleted,
      s.overdue,
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${snapshot.group.name}-performance.csv"`);
  res.send(csv);
});

/**
 * POST /api/groups/:groupId/ai/project-plan
 *
 * STEP 1 of the project-planning AI: the guide (or the team leader) asks
 * the Python AI engine to turn this group's own project title/description/
 * deadline/members into a structured plan. Read-only — this does NOT create
 * any Task documents (that is an explicitly separate next step).
 */
exports.projectPlan = asyncHandler(async (req, res) => {
  // Any member of the group, group leader, guide, or admin (verified by requireGroupAccess) can generate the plan

  const group = await req.group.populate("members", "name email");
  if (group.leader) {
    await group.populate("leader", "name email");
  }

  // Support receiving custom projectTitle, projectDescription, and deadline
  const projectTitle = (req.body?.projectTitle && String(req.body.projectTitle).trim()) || group.project;
  const projectDescription = req.body?.projectDescription !== undefined
    ? String(req.body.projectDescription).trim()
    : (group.description || "");
  const deadline = req.body?.deadline || group.expectedCompletion || null;

  let groupChanged = false;
  if (req.body?.projectTitle && req.body.projectTitle.trim() && req.body.projectTitle.trim() !== group.project) {
    group.project = req.body.projectTitle.trim();
    groupChanged = true;
  }
  if (req.body?.projectDescription !== undefined && req.body.projectDescription.trim() !== group.description) {
    group.description = req.body.projectDescription.trim();
    groupChanged = true;
  }
  if (req.body?.deadline) {
    const parsedDue = new Date(req.body.deadline);
    if (!Number.isNaN(parsedDue.getTime()) && parsedDue.toISOString() !== new Date(group.expectedCompletion || 0).toISOString()) {
      group.expectedCompletion = parsedDue;
      groupChanged = true;
    }
  }
  if (groupChanged) {
    await group.save();
  }

  // Gather all distinct active members including the team leader
  const memberMap = new Map();
  if (group.leader && group.leader._id) {
    memberMap.set(String(group.leader._id), {
      id: String(group.leader._id),
      name: group.leader.name,
      email: group.leader.email,
      role: "leader",
    });
  }
  for (const m of group.members || []) {
    if (m && m._id && !memberMap.has(String(m._id))) {
      memberMap.set(String(m._id), {
        id: String(m._id),
        name: m.name,
        email: m.email,
        role: "member",
      });
    }
  }
  const members = Array.from(memberMap.values());

  const engine = await aiEngine.analyzeProjectPlan({
    projectTitle,
    projectDescription,
    deadline,
    members,
  });

  if (!engine.ok) {
    throw new ApiError(503, `AI engine unavailable: ${engine.reason}`);
  }

  res.json({ success: true, data: engine.data });
});

/**
 * POST /api/groups/:groupId/ai/project-plan/create-tasks
 *
 * STEP 2 of the project-planning AI: turns a guide-reviewed AI project plan
 * (the same shape returned by POST .../ai/project-plan, echoed back by the
 * frontend after the guide clicks "Create Tasks") into real Task documents
 * using the EXISTING Task model/creation conventions — no new task system,
 * no duplicate-storage of the plan.
 *
 * The AI only ever produced a *suggestion*; this handler is what actually
 * authorizes, validates, maps assignments to real user ids, computes
 * per-task due dates and persists — nothing from the AI payload is trusted
 * blindly (see planTaskService.sanitizeTasks / resolveAssignments).
 */
exports.createProjectPlanTasks = asyncHandler(async (req, res) => {
  // Any member of the group, group leader, guide, or admin (verified by requireGroupAccess) can create tasks from the plan

  const plan = req.body?.plan;
  if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw ApiError.badRequest(
      "A generated AI project plan with at least one task is required — generate and review a plan first."
    );
  }

  const tasks = planTaskService.sanitizeTasks(plan.tasks);
  if (!tasks.length) {
    throw ApiError.badRequest("None of the AI-generated tasks had a usable title.");
  }

  const group = await req.group.populate("members", "name email");
  if (group.leader) {
    await group.populate("leader", "name email");
  }

  const memberByEmail = new Map();
  const memberById = new Map();

  if (group.leader && group.leader._id) {
    memberById.set(String(group.leader._id), group.leader);
    if (group.leader.email) {
      memberByEmail.set(String(group.leader.email).toLowerCase().trim(), group.leader);
    }
  }
  for (const m of group.members || []) {
    if (m && m._id) {
      memberById.set(String(m._id), m);
      if (m.email) {
        memberByEmail.set(String(m.email).toLowerCase().trim(), m);
      }
    }
  }

  const knownTitleKeys = new Set(tasks.map((t) => t.title.toLowerCase()));
  const { assignmentsByTitle, unresolvedEmail } = planTaskService.resolveAssignments(
    plan.suggestedAssignments,
    knownTitleKeys,
    memberByEmail
  );

  // Only throw for unresolved email if a task actually depends on that suggested assignment without an explicit assigneeId
  if (unresolvedEmail) {
    const hasUnresolved = tasks.some(
      (t) =>
        !t.assigneeId &&
        (plan.suggestedAssignments || []).some(
          (a) =>
            String(a?.taskTitle || "").trim().toLowerCase() === t.title.toLowerCase() &&
            String(a?.studentEmail || "").trim().toLowerCase() === unresolvedEmail.toLowerCase()
        )
    );
    if (hasUnresolved) {
      throw ApiError.badRequest(`Unable to map AI assignment to group member: ${unresolvedEmail}`);
    }
  }

  const dueDateByTitle = planTaskService.computeTaskDueDates(tasks, group.expectedCompletion || null);
  const ordered = planTaskService.topoSortTasks(tasks);

  // Duplicate protection: an AI task with a title that already exists as an
  // "ai"-sourced task in this group is skipped rather than re-created. This
  // reuses the existing Task collection as the source of truth (no second
  // duplicate-protection system) and makes clicking "Create Tasks" twice a
  // no-op the second time.
  const existing = await Task.find({ group: group._id, source: "ai" }).select("title").lean();
  const idByTitle = new Map(); // lowercase title -> Task._id, seeded with pre-existing ai tasks
  for (const t of existing) {
    idByTitle.set(String(t.title).trim().toLowerCase(), t._id);
  }
  const existingTitleKeys = new Set(idByTitle.keys());

  const createdDocs = [];
  const duplicates = [];

  // Query existing active tasks per student in this group to enforce only 1 active task at a time
  const existingActiveTasks = await Task.find({
    group: group._id,
    status: { $in: ["todo", "in_progress", "in_review", "guide_review"] },
  }).select("assignee").lean();
  const studentHasActiveTask = new Set(
    existingActiveTasks.filter((t) => t.assignee).map((t) => String(t.assignee))
  );
  const studentAssignedCount = new Map(); // studentId -> total tasks assigned in this plan

  for (const task of ordered) {
    const key = task.title.toLowerCase();
    if (existingTitleKeys.has(key)) {
      duplicates.push(task.title);
      continue;
    }

    let member = null;
    if (task.assigneeId) {
      member = memberById.get(String(task.assigneeId)) || memberByEmail.get(String(task.assigneeId).toLowerCase());
      if (!member) {
        throw ApiError.badRequest("Selected assignee does not belong to this project group");
      }
    } else if (task.assignedTo?.id) {
      member = memberById.get(String(task.assignedTo.id)) || memberByEmail.get(String(task.assignedTo.email || "").toLowerCase());
    }
    if (!member) {
      member = assignmentsByTitle.get(key);
    }

    const sId = member ? String(member._id) : null;
    const priorCount = sId ? (studentAssignedCount.get(sId) || 0) : 0;
    if (sId) {
      studentAssignedCount.set(sId, priorCount + 1);
    }

    // RULE: Give only 1 active task at a time per student.
    // If the student doesn't have an active task yet, activate this one ("todo").
    // If they already have an active task, put subsequent tasks in "backlog" (queued).
    let initialStatus = "todo";
    if (sId) {
      if (studentHasActiveTask.has(sId)) {
        initialStatus = "backlog";
      } else {
        initialStatus = "todo";
        studentHasActiveTask.add(sId);
      }
    }

    const explicitDue = (task.due || task.dueDate) ? new Date(task.due || task.dueDate) : null;
    const taskDue = explicitDue && !Number.isNaN(explicitDue.getTime()) ? explicitDue : dueDateByTitle.get(key);

    const dependencyIds = task.dependencies
      .map((depTitle) => idByTitle.get(depTitle.toLowerCase()))
      .filter(Boolean);

    // eslint-disable-next-line no-await-in-loop -- must run in dependency
    // order so each dependency's real _id exists before its dependents
    // reference it; this is a one-off guide action, not a hot path.
    const doc = await Task.create({
      group: group._id,
      title: task.title,
      description: task.description,
      whatToDo: task.whatToDo || task.description,
      expectedOutput: task.expectedOutput || (Array.isArray(task.deliverables) ? task.deliverables.join(", ") : "") || `Deliverable for ${task.title}`,
      deliverableType: planTaskService.normalizeDeliverableType(task.deliverableType) || "",
      completionCriteria: Array.isArray(task.completionCriteria) ? task.completionCriteria : [],
      module: task.module,
      priority: task.priority,
      source: "ai",
      dependencies: dependencyIds,
      assignee: member ? member._id : undefined,
      createdBy: req.user._id,
      status: initialStatus,
      isActiveTask: initialStatus === "todo",
      queueIndex: priorCount,
      progress: 0,
      estimate: Math.max(1, Math.round(task.estimatedDays * 8)), // days -> working hours
      due: taskDue,
      aiAssignment: {
        selectedStudentId: member ? member._id : null,
        studentName: member ? member.name : "",
        assignmentReason: initialStatus === "todo"
          ? `Initial active task assigned by AI from project plan (${task.module || "General"}).`
          : `Queued task #${priorCount + 1} for ${member?.name || "student"}. Unlocks automatically after preceding task is verified.`,
        evidenceUsed: [
          `Module: ${task.module || "General"}`,
          `Queue position: ${initialStatus === "todo" ? "1 (Active Focus Task)" : `${priorCount + 1} (Queued in Backlog)`}`,
          `Estimated effort: ${task.estimatedDays || 2} days`,
          `Project deadline alignment: ${taskDue ? new Date(taskDue).toLocaleDateString() : "Scheduled"}`,
        ],
        confidence: 85,
        eligibilityStatus: member ? (initialStatus === "todo" ? "ACTIVE_ASSIGNED" : "QUEUED_ASSIGNED") : "NO_ELIGIBLE_ASSIGNEE",
        evaluatedMembersCount: (group.members || []).length + (group.leader ? 1 : 0),
        assignedAt: new Date(),
        queueIndex: priorCount,
        isActiveTask: initialStatus === "todo",
      },
      aiAnalysisVersion: "2.0",
    });
    idByTitle.set(key, doc._id);
    createdDocs.push(doc);
  }

  const assigneeIds = createdDocs.filter((t) => t.assignee).map((t) => t.assignee);
  if (assigneeIds.length) {
    await notifyUsers(
      assigneeIds,
      {
        title: "New task from AI project plan",
        body: `${group.project}: ${createdDocs.length} task(s) were created from the AI project plan`,
        type: "task",
        link: "/app/tasks",
        group: group._id,
      },
      { exclude: req.user._id }
    );
  }

  if (createdDocs.length) {
    await recalcGroupProgress(group._id);
  }

  const populated = await Task.populate(createdDocs, { path: "assignee", select: "name color avatar" });

  res.status(201).json({
    success: true,
    data: {
      created: createdDocs.length,
      skipped: duplicates.length,
      duplicates,
      tasks: populated,
    },
  });
});

/**
 * GET /api/groups/:groupId/ai/project-performance
 *
 * STEP 3: evidence-based student work analysis, AI score, performance
 * prediction, project completion prediction, group-chat analysis, per-file
 * evidence, warnings and recommendations — computed by the Python AI engine
 * (see ai-engine/analyzers/performanceAnalyzer.py:analyze_project_performance).
 *
 * Only group-scoped data the requesting guide/member is already authorized
 * to see (via requireGroupAccess) is sent to the engine: group messages
 * (Message.find({ group }) never returns direct/private messages — those
 * use `conversation`, not `group`, see models/Message.js), the group's own
 * tasks/files/members. No private chat is ever included.
 *
 * For duplicate-warning suppression (STEP 3I) this reuses the existing
 * AiReport collection instead of introducing a new "Warning" model: the
 * most recent stored project-performance snapshot's warnings are passed
 * back to the engine as `previousWarnings` so it can detect repeats.
 * Manual guide-entered warnings are not yet a modeled feature in this
 * project, so `manualWarnings` is empty for now (documented limitation —
 * see implementation report).
 */
exports.projectPerformance = asyncHandler(async (req, res) => {
  const group = await req.group.populate("members", "name email");

  // STEP 4L — student isolation: a non-guide caller may only ever request
  // their own analysis. A student-supplied `studentId` query param is
  // ignored/overridden here rather than trusted, so one student can never
  // pull another student's (or the whole team's) AI analysis by editing
  // the query string. Guides (and admins) may request any student in the
  // group, or omit studentId to get the full team.
  const requestedStudentId = req.isGuide ? req.query.studentId || undefined : String(req.user._id);

  const [tasks, messages, files, lastSnapshot] = await Promise.all([
    Task.find({ group: group._id }).select("title description module assignee status priority estimate due completedAt").lean(),
    Message.find({ group: group._id, deleted: { $ne: true } })
      .select("sender text createdAt")
      .sort("createdAt")
      .limit(500)
      .lean(),
    FileAsset.find({ group: group._id }).select("name originalName size uploadedBy createdAt").lean(),
    AiReport.findOne({ group: group._id, period: "daily" }).sort("-periodStart").lean(),
  ]);

  const payload = {
    groupId: String(group._id),
    projectTitle: group.project,
    projectDescription: group.description || "",
    startDate: group.createdAt,
    expectedCompletion: group.expectedCompletion || null,
    members: (group.members || []).map((m) => ({ userId: String(m._id), name: m.name, email: m.email })),
    tasks: tasks.map((t) => ({
      id: String(t._id),
      title: t.title,
      description: t.description,
      module: t.module,
      assignee: t.assignee ? String(t.assignee) : null,
      status: t.status,
      priority: t.priority,
      estimate: t.estimate,
      due: t.due,
      completedAt: t.completedAt,
    })),
    messages: messages.map((m) => ({ sender: String(m.sender), text: m.text, createdAt: m.createdAt, private: false })),
    files: files.map((f) => ({
      filename: f.originalName || f.name,
      uploadedBy: f.uploadedBy ? String(f.uploadedBy) : null,
      size: f.size,
      uploadedAt: f.createdAt,
    })),
    previousWarnings: lastSnapshot?.payload?.warnings || [],
    manualWarnings: [],
    studentId: requestedStudentId,
  };

  const engine = await aiEngine.analyzeProjectPerformance(payload);
  if (!engine.ok) {
    throw new ApiError(503, `AI engine unavailable: ${engine.reason}`);
  }

  // Enrich with Random Forest ML hybrid predictions (15-feature TeamSync schema)
  try {
    const targetMembers = (group.members || []).filter(
      (m) => !requestedStudentId || String(m._id) === requestedStudentId
    );
    const hybridList = await Promise.all(
      targetMembers.map(async (m) => {
        const sid = String(m._id);
        const sTasks = tasks.filter((t) => String(t.assignee) === sid);
        const sMessages = messages.filter((msg) => String(msg.sender) === sid);
        const sFiles = files.filter((f) => String(f.uploadedBy) === sid);
        const mlFeatures = mlFeatureService.computeStudentFeatures({
          tasks: sTasks,
          messages: sMessages,
          files: sFiles,
        });
        const hybridRes = await aiEngine.analyzePerformanceHybrid({
          ...payload,
          studentId: sid,
          mlFeatures,
        });
        return hybridRes.ok ? hybridRes.data : null;
      })
    );
    engine.data.hybrid_predictions = hybridList.filter(Boolean);
  } catch {
    /* Graceful fallback: Rule-based analysis remains authoritative */
  }

  res.json({ success: true, data: engine.data });
});
