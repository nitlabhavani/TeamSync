/**
 * AI reporting: per-student performance scores, guide reports, weekly/monthly
 * rollups, project completion prediction and improvement recommendations.
 *
 * The Python AI engine is used when it is reachable; otherwise these
 * deterministic calculations run in Node so the dashboards are never empty.
 *
 * IMPORTANT: only GROUP chat, assigned tasks and uploaded files are analysed.
 * Private (direct) messages are never read.
 */
const Task = require("../models/Task");
const Message = require("../models/Message");
const FileAsset = require("../models/FileAsset");
const Group = require("../models/Group");
const AiReport = require("../models/AiReport");
const aiEngine = require("./aiEngineClient");

const DAY = 24 * 60 * 60 * 1000;
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

const DONE = ["done", "completed"];

/** Collect the raw signals for a group inside a time window. */
async function collectSignals(groupId, { since } = {}) {
  const range = since ? { createdAt: { $gte: since } } : {};
  const [tasks, messages, files] = await Promise.all([
    Task.find({ group: groupId }).populate("assignee", "name email").lean(),
    // group chat only — direct messages have no `group` field
    Message.find({ group: groupId, ...range }).lean(),
    FileAsset.find({ group: groupId, ...range }).lean(),
  ]);
  return { tasks, messages, files };
}

/** Per-student scores: participation, task completion, communication, collaboration. */
function scoreStudents({ members, tasks, messages, files }) {
  const totalMessages = messages.length || 1;
  const totalFiles = files.length || 1;
  const perMemberAvgMsgs = totalMessages / (members.length || 1);

  return members.map((member) => {
    const id = String(member._id || member.id);
    const mine = tasks.filter((t) => String(t.assignee?._id || t.assignee) === id);
    const doneTasks = mine.filter((t) => DONE.includes(t.status));
    const onTime = doneTasks.filter((t) => !t.due || (t.completedAt && new Date(t.completedAt) <= new Date(t.due)));
    const myMessages = messages.filter((m) => String(m.sender) === id);
    const myFiles = files.filter((f) => String(f.uploadedBy) === id);

    const taskCompletion = mine.length ? pct(doneTasks.length, mine.length) : 0;
    const communication = clamp((myMessages.length / (perMemberAvgMsgs || 1)) * 70);
    const participation = clamp(
      (myMessages.length / totalMessages) * 120 + (myFiles.length / totalFiles) * 80 + (mine.length ? 25 : 0)
    );
    const punctuality = doneTasks.length ? pct(onTime.length, doneTasks.length) : 60;
    const collaboration = clamp(communication * 0.4 + participation * 0.35 + punctuality * 0.25);
    const overall = clamp(participation * 0.25 + taskCompletion * 0.35 + communication * 0.15 + collaboration * 0.25);

    return {
      userId: id,
      name: member.name,
      email: member.email,
      participation,
      taskCompletion,
      communication,
      collaboration,
      punctuality,
      overall,
      tasksAssigned: mine.length,
      tasksCompleted: doneTasks.length,
      messages: myMessages.length,
      filesShared: myFiles.length,
      overdue: mine.filter((t) => t.due && !DONE.includes(t.status) && new Date(t.due) < new Date()).length,
    };
  });
}

/** Rule-based recommendations derived from the computed metrics. */
function buildRecommendations({ group, students, tasks, files }) {
  const out = [];
  const overdue = tasks.filter((t) => t.due && !DONE.includes(t.status) && new Date(t.due) < new Date());
  const quiet = students.filter((s) => s.communication < 40);
  const idle = students.filter((s) => s.tasksAssigned === 0);
  const hasDocs = files.some((f) => /\.(pdf|docx?|md|pptx?)$/i.test(f.name || ""));
  const hasTesting = tasks.some((t) => /test|qa|unit/i.test(t.title));

  if (quiet.length) out.push(`Increase communication — ${quiet.map((s) => s.name).join(", ")} posted very little in group chat.`);
  if (!hasDocs) out.push("Complete documentation — no report or design document has been uploaded yet.");
  if (overdue.length) out.push(`Submit remaining modules — ${overdue.length} task(s) are past their deadline.`);
  if (idle.length) out.push(`Increase participation — assign work to ${idle.map((s) => s.name).join(", ")}.`);
  if (!hasTesting) out.push("Assign testing tasks so the project is validated before submission.");
  if ((group.progress ?? 0) < 40) out.push("Break the project into smaller milestones to accelerate progress.");
  out.push("Improve folder structure and keep README files up to date in every submission.");
  return [...new Set(out)].slice(0, 8);
}

/** Predict project completion from current velocity vs the expected date. */
function predictCompletion({ group, tasks }) {
  const total = tasks.length || 1;
  const done = tasks.filter((t) => DONE.includes(t.status)).length;
  const completion = pct(done, total);
  const created = new Date(group.createdAt).getTime();
  const elapsedDays = Math.max(1, (Date.now() - created) / DAY);
  const velocity = done / elapsedDays; // tasks per day
  const remaining = total - done;
  const daysNeeded = velocity > 0 ? Math.ceil(remaining / velocity) : null;
  const predictedDate = daysNeeded ? new Date(Date.now() + daysNeeded * DAY) : null;
  const target = group.expectedCompletion ? new Date(group.expectedCompletion) : null;

  return {
    completion,
    velocityPerWeek: Number((velocity * 7).toFixed(2)),
    predictedDate,
    expectedCompletion: target,
    onTrack: target && predictedDate ? predictedDate <= target : completion >= 50,
    confidence: done >= 3 ? "high" : done > 0 ? "medium" : "low",
  };
}

/**
 * Step 14, Feature 7/8 — submission-quality signals derived only from the
 * real Task/submission documents already loaded for this group (the same
 * `tasks` array `collectSignals` fetched above — nothing is re-fetched or
 * invented). Used by the weekly AI narrative report; never persisted
 * anywhere else, so it costs nothing when the narrative isn't requested.
 */
function summarizeSubmissions(tasks) {
  const stats = {
    valid: 0,
    wrongProject: 0,
    incomplete: 0,
    similarityWarnings: 0,
    awaitingReview: 0,
    changesRequested: 0,
    rejected: 0,
    approved: 0,
    studentsWithRepeatedIssues: [],
  };
  const changeCounts = new Map();

  for (const t of tasks) {
    const submissions = t.submissions || [];
    const latest = submissions[submissions.length - 1];
    if (!latest) continue;
    const analysis = latest.aiAnalysis || {};

    if (analysis.implementationStatus === "VALID_SUBMISSION") stats.valid += 1;
    else if (analysis.implementationStatus === "WRONG_PROJECT") stats.wrongProject += 1;
    else if (analysis.implementationStatus && analysis.implementationStatus !== "UNREADABLE_ZIP") stats.incomplete += 1;

    if (analysis.plagiarism?.detected) stats.similarityWarnings += 1;
    if (t.status === "guide_review") stats.awaitingReview += 1;

    if (latest.verdict === "changes_requested") {
      stats.changesRequested += 1;
      const id = String(latest.student);
      changeCounts.set(id, (changeCounts.get(id) || 0) + 1);
    } else if (latest.verdict === "rejected") stats.rejected += 1;
    else if (latest.verdict === "approved") stats.approved += 1;
  }

  stats.studentsWithRepeatedIssues = [...changeCounts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
  return stats;
}

/**
 * Step 14, Feature 7/9 — deterministic, rule-based weekly narrative. Every
 * sentence is assembled from fields already present on `snapshot` (itself
 * built entirely from real Task/Message/FileAsset data in analyseGroup) —
 * nothing here is invented, and `previousSnapshot` (optional, last week's
 * persisted AiReport payload) is only ever used to compute a same/up/down
 * delta, never to fabricate history that doesn't exist.
 */
function buildWeeklyNarrative(snapshot, previousSnapshot = null) {
  const {
    group,
    students = [],
    collaborationScore,
    delayedTasks = [],
    completedTasks = 0,
    totalTasks = 0,
    prediction = {},
    submissionStats = summarizeSubmissions([]),
  } = snapshot;

  const hasAnyActivity = totalTasks > 0 || students.some((s) => s.messages > 0 || s.filesShared > 0);
  if (!hasAnyActivity) {
    return {
      period: "weekly",
      summary: `No task, chat, or file activity has been recorded for ${group.name} yet this week.`,
      highlights: [],
      concerns: [],
      recommendations: ["Assign initial tasks and encourage the team to start using group chat."],
      teamTrend: "insufficient_data",
      generatedAt: new Date(),
    };
  }

  const completionDelta =
    previousSnapshot?.prediction?.completion != null && prediction.completion != null
      ? prediction.completion - previousSnapshot.prediction.completion
      : null;
  const collabDelta =
    previousSnapshot?.collaborationScore != null && collaborationScore != null
      ? collaborationScore - previousSnapshot.collaborationScore
      : null;

  const sortedByOverall = [...students].sort((a, b) => b.overall - a.overall);
  const topContributors = sortedByOverall.filter((s) => s.overall > 0).slice(0, 2);
  const needsAttention = students.filter((s) => s.overdue > 0 || s.overall < 35);

  const highlights = [];
  const concerns = [];
  const recommendations = [];

  if (completionDelta != null && Math.abs(completionDelta) >= 1) {
    (completionDelta > 0 ? highlights : concerns).push(
      `Task completion ${completionDelta > 0 ? "improved" : "declined"} to ${prediction.completion}% this week (${completionDelta > 0 ? "up" : "down"} ${Math.abs(completionDelta)} point(s)).`
    );
  } else {
    highlights.push(`Task completion is holding steady at ${prediction.completion ?? 0}%.`);
  }

  if (submissionStats.valid) highlights.push(`${submissionStats.valid} submission(s) passed AI validation as a correct, task-related implementation.`);
  if (collabDelta != null && Math.abs(collabDelta) >= 1) {
    (collabDelta > 0 ? highlights : concerns).push(
      `Collaboration activity ${collabDelta > 0 ? "increased" : "decreased"} ${Math.abs(collabDelta)} point(s) compared with last week.`
    );
  }

  if (delayedTasks.length) concerns.push(`${delayedTasks.length} task(s) are overdue.`);
  if (submissionStats.awaitingReview) concerns.push(`${submissionStats.awaitingReview} submission(s) are awaiting guide review.`);
  if (submissionStats.similarityWarnings)
    concerns.push(`${submissionStats.similarityWarnings} submission(s) triggered a similarity/originality warning.`);
  if (submissionStats.wrongProject) concerns.push(`${submissionStats.wrongProject} submission(s) did not match the assigned project.`);

  const repeatOffenderNames = submissionStats.studentsWithRepeatedIssues
    .map((id) => students.find((s) => s.userId === id)?.name)
    .filter(Boolean);
  if (repeatOffenderNames.length) concerns.push(`${repeatOffenderNames.join(", ")} had repeated changes requested on submissions.`);

  if (delayedTasks.length) recommendations.push("Follow up on overdue tasks.");
  if (submissionStats.awaitingReview) recommendations.push("Review pending submissions.");
  if (submissionStats.similarityWarnings) recommendations.push("Investigate flagged similarity warnings before approving those submissions.");
  if (repeatOffenderNames.length)
    recommendations.push(`Ask ${repeatOffenderNames.join(", ")} to update their implementation before the next submission.`);
  if (!recommendations.length) recommendations.push("Keep up the current pace — no urgent action items this week.");

  let teamTrend = "steady";
  if ((completionDelta != null && completionDelta > 0) || (collabDelta != null && collabDelta > 0)) teamTrend = "improving";
  if ((completionDelta != null && completionDelta < 0) && (collabDelta == null || collabDelta <= 0)) teamTrend = "declining";
  if (completionDelta == null && collabDelta == null) teamTrend = "steady";

  const trendPhrase = teamTrend === "improving" ? "progressing well" : teamTrend === "declining" ? "showing some slowdown" : "progressing steadily";
  const sentences = [
    `${group.name} is ${trendPhrase} this week.`,
    `Overall task completion is ${prediction.completion ?? 0}%${
      completionDelta != null && Math.abs(completionDelta) >= 1
        ? ` (${completionDelta > 0 ? "up" : "down"} ${Math.abs(completionDelta)} point${Math.abs(completionDelta) === 1 ? "" : "s"} from last week)`
        : ""
    }, with ${completedTasks} of ${totalTasks} task(s) completed.`,
  ];
  if (delayedTasks.length) sentences.push(`${delayedTasks.length} assignment${delayedTasks.length === 1 ? "" : "s"} remain overdue.`);
  if (topContributors.length)
    sentences.push(`${topContributors.map((s) => s.name).join(" and ")} contributed consistently through task completion and chat activity.`);
  if (needsAttention.length)
    sentences.push(
      `${needsAttention.map((s) => s.name).join(", ")} ${needsAttention.length === 1 ? "has" : "have"} overdue work or low activity and may be worth a check-in.`
    );
  if (collabDelta != null && Math.abs(collabDelta) >= 1)
    sentences.push(`Collaboration activity ${collabDelta > 0 ? "increased" : "decreased"} slightly compared with last week.`);
  const focusAreas = [
    submissionStats.awaitingReview ? "reviewing pending submissions" : null,
    delayedTasks.length ? "completing overdue tasks" : null,
  ].filter(Boolean);
  if (focusAreas.length) sentences.push(`The team should focus on ${focusAreas.join(" and ")}.`);

  return {
    period: "weekly",
    summary: sentences.join(" "),
    highlights: highlights.slice(0, 8),
    concerns: concerns.slice(0, 8),
    recommendations: recommendations.slice(0, 8),
    teamTrend,
    generatedAt: new Date(),
  };
}

/** Full AI snapshot for one group. */
async function analyseGroup(groupId, { since } = {}) {
  const group = await Group.findById(groupId).populate("members", "name email").populate("guide", "name email").lean();
  if (!group) throw new Error("Group not found");

  const { tasks, messages, files } = await collectSignals(groupId, { since });
  const members = group.members || [];
  const students = scoreStudents({ members, tasks, messages, files });

  const engine = await aiEngine.analyzeCollaboration({
    group: { id: String(group._id), name: group.name, project: group.project },
    students,
    tasks: tasks.map((t) => ({
      id: String(t._id),
      title: t.title,
      status: t.status,
      due: t.due,
      assignee: String(t.assignee?._id || t.assignee || ""),
      completedAt: t.completedAt,
    })),
    messages: messages.map((m) => ({ sender: String(m.sender), createdAt: m.createdAt, length: (m.text || "").length })),
    files: files.map((f) => ({ name: f.name, uploadedBy: String(f.uploadedBy), size: f.size })),
  });

  const collaborationScore = engine.ok && engine.data?.collaborationScore != null
    ? clamp(engine.data.collaborationScore)
    : clamp(students.reduce((a, s) => a + s.collaboration, 0) / (students.length || 1));

  if (group.collaborationScore !== collaborationScore) {
    await Group.findByIdAndUpdate(groupId, { collaborationScore }, { new: true });
  }

  const sorted = [...students].sort((a, b) => b.overall - a.overall);
  const overdueTasks = tasks.filter((t) => t.due && !DONE.includes(t.status) && new Date(t.due) < new Date());
  const pendingTasks = tasks.filter((t) => !DONE.includes(t.status));

  const recommendations = engine.ok && engine.data?.recommendations?.length
    ? engine.data.recommendations
    : buildRecommendations({ group, students, tasks, files });

  const snapshot = {
    group: { id: String(group._id), name: group.name, project: group.project, category: group.category },
    generatedAt: new Date(),
    engine: engine.ok ? "ai-engine" : "node-heuristics",
    students,
    collaborationScore,
    mostActive: sorted[0] || null,
    leastActive: sorted[sorted.length - 1] || null,
    delayedTasks: overdueTasks.map((t) => ({ id: String(t._id), title: t.title, due: t.due, assignee: t.assignee?.name })),
    pendingTasks: pendingTasks.map((t) => ({ id: String(t._id), title: t.title, status: t.status, due: t.due })),
    completedTasks: tasks.filter((t) => DONE.includes(t.status)).length,
    totalTasks: tasks.length,
    messagesAnalyzed: messages.length,
    filesAnalyzed: files.length,
    prediction: predictCompletion({ group, tasks }),
    recommendations,
    // Step 14, Feature 7/8 — additive. Powers the weekly AI narrative report
    // below; every other field on this snapshot is untouched.
    submissionStats: summarizeSubmissions(tasks),
    note: "Private chat is never analysed. Only group chat, assigned tasks and uploaded files are used.",
  };

  try {
    await persistPeriodReport(groupId, "daily", snapshot);
  } catch (err) {
    console.error(`[reports] failed to persist daily report for group ${groupId}: ${err.message}`);
  }

  return snapshot;
}

function periodDays(period) {
  if (period === "monthly") return 30;
  if (period === "weekly") return 7;
  return 1;
}

function normalizePeriodStart(date) {
  return new Date(date.toDateString());
}

function periodStartFrom(periodEnd, period) {
  const days = periodDays(period);
  return normalizePeriodStart(new Date(periodEnd.getTime() - days * DAY));
}

/**
 * STEP 19, Feature 10 — additive weekly forecast section. Never modifies
 * buildWeeklyNarrative()/the existing narrative object above; this is a
 * separate `forecast` field on the payload, built from the same
 * projectForecastService used by the guide dashboard/API, so the numbers
 * always agree. Failure here must never break the existing weekly report.
 */
async function buildForecastSection(groupId) {
  try {
    // Lazy require avoids a circular dependency at module-load time
    // (projectForecastService never requires reportService).
    const { runProjectForecast } = require("./projectForecastService");
    const group = await Group.findById(groupId);
    if (!group) return null;
    const forecast = await runProjectForecast(group, { persist: false });
    if (forecast.status === "INSUFFICIENT_DATA") {
      return { status: "INSUFFICIENT_DATA", narrative: forecast.explanation || "Not enough task data yet to forecast completion." };
    }
    const concernParts = [];
    if (forecast.evidence?.overdueTasks) concernParts.push(`${forecast.evidence.overdueTasks} overdue task${forecast.evidence.overdueTasks === 1 ? "" : "s"}`);
    if (forecast.evidence?.pendingReviews) concernParts.push(`${forecast.evidence.pendingReviews} pending review${forecast.evidence.pendingReviews === 1 ? "" : "s"}`);
    const dateStr = forecast.projectedCompletionDate ? new Date(forecast.projectedCompletionDate).toLocaleDateString() : null;
    const trendWord = forecast.trend === "IMPROVING" ? "improving" : forecast.trend === "WORSENING" ? "declining" : "steady";

    const narrative = `${forecast.groupName} is currently ${forecast.probability}% likely to finish on time. Progress is ${trendWord}${
      concernParts.length ? `, but ${concernParts.join(" and ")} may affect the projected completion date` : ""
    }.${dateStr ? ` Projected completion: ${dateStr}.` : ""}`;

    return {
      probability: forecast.probability,
      status: forecast.status,
      projectedCompletionDate: forecast.projectedCompletionDate,
      trend: forecast.trend,
      disclaimer: forecast.disclaimer,
      narrative,
    };
  } catch (err) {
    console.error(`[reports] weekly forecast section failed for group ${groupId}: ${err.message}`);
    return null;
  }
}

/**
 * STEP 20, Feature 11 — additive weekly-report section. Reuses
 * projectHealthService.getProjectHealth (persist: false, so viewing a
 * weekly report never itself writes a ProjectHealthSnapshot or fires a
 * notification — only the guide opening the Command Center does that,
 * exactly like buildForecastSection above does for the forecast).
 */
async function buildProjectHealthSection(groupId) {
  try {
    const { getProjectHealth } = require("./projectHealthService");
    const group = await Group.findById(groupId);
    if (!group) return null;
    const health = await getProjectHealth(group, { persist: false });
    if (health.health === "INSUFFICIENT_DATA") {
      return { status: "INSUFFICIENT_DATA", score: null, trend: "INSUFFICIENT_DATA" };
    }
    return {
      status: health.health,
      score: health.healthScore,
      trend: health.trend,
    };
  } catch (err) {
    console.error(`[reports] weekly project-health section failed for group ${groupId}: ${err.message}`);
    return null;
  }
}

/**
 * STEP 21, additive weekly-report section. Reuses
 * projectExecutionCopilotService.getExecutionCopilot (persist: false, so
 * viewing a weekly report never itself writes a ProjectExecutionSnapshot or
 * fires a notification — only the guide opening the Copilot, or the
 * scheduler, does that), exactly like buildForecastSection/
 * buildProjectHealthSection above.
 */
async function buildExecutionCopilotSection(groupId) {
  try {
    const { getExecutionCopilot } = require("./projectExecutionCopilotService");
    const group = await Group.findById(groupId);
    if (!group) return null;
    const copilot = await getExecutionCopilot(group, { persist: false });
    if (copilot.overallStatus === "INSUFFICIENT_DATA") {
      return { status: "INSUFFICIENT_DATA", executionScore: null, topPriority: null, criticalActions: [], completedActions: 0, nextActions: [] };
    }
    return {
      status: copilot.overallStatus,
      executionScore: copilot.executionScore,
      topPriority: copilot.topPriority,
      criticalActions: copilot.criticalActions,
      // "completedActions" — no separate completion-tracking system exists
      // for Copilot actions (they are recommendations, not tasks), so this
      // is always 0 rather than a fabricated count.
      completedActions: 0,
      nextActions: copilot.todayActions,
    };
  } catch (err) {
    console.error(`[reports] weekly execution-copilot section failed for group ${groupId}: ${err.message}`);
    return null;
  }
}

/**
 * STEP 22, additive weekly-report section. Reuses
 * teamPerformanceService.getTeamPerformance (persist: false, so viewing a
 * weekly report never itself writes a TeamPerformanceSnapshot or fires a
 * notification — only the guide opening Team Performance, or the
 * scheduler, does that), exactly like buildExecutionCopilotSection above.
 */
async function buildTeamPerformanceSection(groupId) {
  try {
    const { getTeamPerformance } = require("./teamPerformanceService");
    const group = await Group.findById(groupId);
    if (!group) return null;
    const perf = await getTeamPerformance(group, { persist: false });
    if (perf.performanceLevel === "INSUFFICIENT_DATA") {
      return { overallScore: null, trend: "INSUFFICIENT_DATA", strongestAreas: [], improvementAreas: [], membersNeedingAttention: [], narrative: perf.narrative };
    }
    return {
      overallScore: perf.overallPerformanceScore,
      trend: perf.trend,
      strongestAreas: perf.topStrengths,
      improvementAreas: perf.topImprovementAreas,
      // Counts only, no per-member reasons — the weekly report is guide-
      // facing but still avoids duplicating private per-student detail
      // beyond what the Team Performance page itself already shows.
      membersNeedingAttention: perf.membersNeedingAttention.length,
      narrative: perf.narrative,
    };
  } catch (err) {
    console.error(`[reports] weekly team-performance section failed for group ${groupId}: ${err.message}`);
    return null;
  }
}

async function persistPeriodReport(groupId, period, snapshot) {
  const periodEnd = new Date();
  const periodStart = period === "daily" ? normalizePeriodStart(periodEnd) : periodStartFrom(periodEnd, period);
  const group = await Group.findById(groupId).select("guide").lean();

  let narrative = null;
  let forecast = null;
  let projectHealth = null;
  let executionCopilot = null;
  let teamPerformance = null;
  if (period === "weekly") {
    // Step 14, Feature 7/8/10 — compare against last week's *already
    // persisted* snapshot (if any) purely for the improving/declining
    // trend language; never fabricated when there is none.
    const previousPeriodStart = periodStartFrom(periodStart, "weekly");
    // eslint-disable-next-line no-use-before-define -- buildPeriodReport
    // isn't needed here; we read the raw persisted payload directly.
    const previousReport = await AiReport.findOne({ group: groupId, period: "weekly", periodStart: previousPeriodStart }).lean();
    narrative = buildWeeklyNarrative(snapshot, previousReport?.payload || null);
    // STEP 19, Feature 10 — additive only. Never replaces `narrative` above.
    forecast = await buildForecastSection(groupId);
    // STEP 20, Feature 11 — additive only. Never replaces `narrative`,
    // `forecast`, or any existing weekly report field.
    projectHealth = await buildProjectHealthSection(groupId);
    // STEP 21 — additive only. Never replaces `narrative`, `forecast`,
    // `projectHealth`, or any existing weekly report field.
    executionCopilot = await buildExecutionCopilotSection(groupId);
    // STEP 22 — additive only. Never replaces `narrative`, `forecast`,
    // `projectHealth`, `executionCopilot`, or any existing weekly report field.
    teamPerformance = await buildTeamPerformanceSection(groupId);
  }

  const payload = {
    ...snapshot,
    period,
    periodStart,
    periodEnd,
    headline: `${snapshot.group.name}: ${snapshot.prediction.completion}% complete, collaboration ${snapshot.collaborationScore}%`,
    // Step 14, Feature 7 — additive, weekly-only. Daily/monthly payloads are
    // completely unchanged (narrative stays null, as before Step 14).
    narrative,
    // STEP 19, Feature 10 — additive, weekly-only, separate section.
    forecast,
    // STEP 20, Feature 11 — additive, weekly-only, separate section.
    projectHealth,
    // STEP 21 — additive, weekly-only, separate section.
    executionCopilot,
    // STEP 22 — additive, weekly-only, separate section.
    teamPerformance,
  };

  await AiReport.findOneAndUpdate(
    { group: groupId, period, periodStart },
    { group: groupId, guide: group?.guide, period, periodStart, periodEnd, payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return payload;
}

/** Daily / weekly / monthly report, cached in the AiReport collection. */
async function buildPeriodReport(groupId, period = "weekly") {
  const start = period === "daily" ? new Date(new Date().toDateString()) : periodStartFrom(new Date(), period);
  const snapshot = await analyseGroup(groupId, { since: start });
  return persistPeriodReport(groupId, period, snapshot);
}

/** Guide-wide overview across every group they supervise. */
async function guideReport(guideId) {
  const groups = await Group.find({ guide: guideId, status: "active" }).select("_id name project").lean();
  const reports = [];
  for (const g of groups) {
    // eslint-disable-next-line no-await-in-loop
    reports.push(await analyseGroup(g._id));
  }
  const allStudents = reports.flatMap((r) => r.students);
  const sorted = [...allStudents].sort((a, b) => b.overall - a.overall);

  return {
    generatedAt: new Date(),
    groups: reports.map((r) => ({
      id: r.group.id,
      name: r.group.name,
      collaborationScore: r.collaborationScore,
      completion: r.prediction.completion,
      onTrack: r.prediction.onTrack,
      delayed: r.delayedTasks.length,
      pending: r.pendingTasks.length,
    })),
    mostActiveStudent: sorted[0] || null,
    leastActiveStudent: sorted[sorted.length - 1] || null,
    teamCollaborationScore: Math.round(
      reports.reduce((a, r) => a + r.collaborationScore, 0) / (reports.length || 1)
    ),
    delayedTasks: reports.flatMap((r) => r.delayedTasks),
    pendingTasks: reports.flatMap((r) => r.pendingTasks),
    recommendations: [...new Set(reports.flatMap((r) => r.recommendations))].slice(0, 10),
  };
}

async function buildReportsForAllGroups() {
  const groups = await Group.find({ status: "active" }).select("_id").lean();
  for (const group of groups) {
    try {
      await buildPeriodReport(group._id, "daily");
    } catch (err) {
      console.error(`[reports] daily report build failed for group ${group._id}: ${err.message}`);
    }
    try {
      await buildPeriodReport(group._id, "weekly");
    } catch (err) {
      console.error(`[reports] weekly report build failed for group ${group._id}: ${err.message}`);
    }
    try {
      await buildPeriodReport(group._id, "monthly");
    } catch (err) {
      console.error(`[reports] monthly report build failed for group ${group._id}: ${err.message}`);
    }
  }
}

let reportTimer = null;

function startReportScheduler() {
  if (reportTimer) return reportTimer;
  const hours = Number(process.env.REPORT_SCAN_HOURS || 24);
  console.log(`[reports] scheduler active — generating weekly/monthly reports every ${hours} hour(s)`);
  setTimeout(buildReportsForAllGroups, 30_000);
  reportTimer = setInterval(buildReportsForAllGroups, hours * 60 * 60 * 1000);
  return reportTimer;
}

function stopReportScheduler() {
  if (reportTimer) clearInterval(reportTimer);
  reportTimer = null;
}

module.exports = {
  analyseGroup,
  buildPeriodReport,
  guideReport,
  scoreStudents,
  predictCompletion,
  buildRecommendations,
  buildReportsForAllGroups,
  startReportScheduler,
  stopReportScheduler,
  // Step 14 — exported for unit testing (backend/scripts/testWeeklyNarrativeReport.js)
  summarizeSubmissions,
  buildWeeklyNarrative,
};
