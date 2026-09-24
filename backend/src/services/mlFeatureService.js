/**
 * ML TRAINING STEP 3 — feature extraction (pure functions, no DB access).
 * ------------------------------------------------------------------------
 * Computes per-student and per-project ML features from RAW Mongo documents
 * (plain objects — Task/Message/FileAsset/ActivityLog/Group as returned by
 * `.lean()`). No network access, no fabrication: every number here is a
 * deterministic function of whatever real documents are passed in. If the
 * caller passes zero documents, the output correctly reflects zero
 * evidence (e.g. counts of 0, ratios of null) — it never invents values.
 *
 * Ratio/status formulas intentionally mirror the existing Step 3 engine so
 * the ML features describe the same real-world signal the rule-based
 * engine already uses, rather than a competing definition:
 *   - completion / overdue / workload logic  <- ai-engine/analyzers/taskAnalyzer.py
 *   - deadline proximity / progress          <- ai-engine/analyzers/deadlineAnalyzer.py
 *   - meaningful-message / blocker / progress-update / unanswered-question
 *     heuristics <- ai-engine/analyzers/chatAnalyzer.py (_is_meaningful,
 *     PROGRESS_HINTS, BLOCKER_HINTS, question-reply-window logic), ported
 *     to JS keyword-for-keyword so both engines agree on what "meaningful"
 *     chat evidence means.
 */

const DONE_STATUSES = new Set(["done", "completed"]);

// --- ported verbatim (keyword sets) from ai-engine/analyzers/chatAnalyzer.py ---
const PROGRESS_HINTS = [
  "completed", "finished", "done with", "pushed", "merged", "uploaded",
  "deployed", "implemented", "fixed", "working on", "started", "in progress",
];
const BLOCKER_HINTS = [
  "blocked", "stuck", "can't", "cant", "cannot", "issue with", "error",
  "not working", "waiting on", "waiting for", "need help", "help with",
];
const NOISE = new Set(["hi", "hello", "hey", "ok", "okay", "yes", "no", "thanks", "thank you", "lol", "haha", "k"]);

function isMeaningfulMessage(text) {
  const stripped = String(text || "").trim().toLowerCase().replace(/^[!.]+|[!.]+$/g, "");
  if (!stripped || NOISE.has(stripped)) return false;
  if (stripped.split(/\s+/).filter(Boolean).length >= 3) return true;
  const all = [...PROGRESS_HINTS, ...BLOCKER_HINTS];
  return all.some((h) => stripped.includes(h));
}

function daysBetween(a, b) {
  return (new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

/** Mean of an array, or null if empty — never fabricates a value for no data. */
function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Population standard deviation, or null if fewer than 2 points (undefined for n<2). */
function stdDev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

/**
 * Per-student features, computed as of `referenceDate` (defaults to now).
 * `tasks` = tasks assigned to this student in this group (real Task docs).
 * `messages` = group-chat messages authored by this student (private/DM
 * excluded — same rule the engine already enforces).
 * `files` = FileAsset docs uploaded by this student in this group.
 * `activityLogs` = ActivityLog docs for this actor in this group.
 */
function computeStudentFeatures({ tasks = [], messages = [], files = [], activityLogs = [], referenceDate = new Date() } = {}) {
  const now = new Date(referenceDate);
  const totalAssigned = tasks.length;

  let completed = 0, onTime = 0, overdue = 0, remaining = 0, inProgress = 0;
  let estimatedEffortAssigned = 0, completedEffortPlanned = 0;
  const upcomingDueDeltas = [];

  for (const t of tasks) {
    const status = String(t.status || "todo");
    const estimate = Number.isFinite(t.estimate) ? t.estimate : 0;
    estimatedEffortAssigned += estimate;
    const due = t.due ? new Date(t.due) : null;
    const completedAt = t.completedAt ? new Date(t.completedAt) : null;

    if (DONE_STATUSES.has(status)) {
      completed += 1;
      completedEffortPlanned += estimate; // planned hours of completed tasks — NOT actual hours spent (no time-tracking field exists in Task schema)
      if (!due || (completedAt && completedAt <= due)) onTime += 1;
    } else {
      if (due && due < now) overdue += 1;
      else remaining += 1;
      if (status === "in_progress" || status === "submitted" || status === "ai_review" || status === "guide_review") inProgress += 1;
      if (due) upcomingDueDeltas.push(daysBetween(due, now));
    }
  }

  const meaningfulMsgs = messages.filter((m) => isMeaningfulMessage(m.text));
  let blockerMentionCount = 0;
  let progressUpdateCount = 0;
  for (const m of meaningfulMsgs) {
    const low = String(m.text || "").toLowerCase();
    if (BLOCKER_HINTS.some((h) => low.includes(h))) blockerMentionCount += 1;
    if (PROGRESS_HINTS.some((h) => low.includes(h))) progressUpdateCount += 1;
  }

  // Activity consistency: coefficient of variation of per-day activity counts.
  // Requires >=2 distinct active days to be meaningful; otherwise null (not 0 — 0 would
  // falsely imply "perfectly consistent" when there simply isn't enough history).
  const dayCounts = {};
  for (const a of activityLogs) {
    if (!a.createdAt) continue;
    const day = new Date(a.createdAt).toISOString().slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  const counts = Object.values(dayCounts);
  const activeDays = counts.length;
  const sd = stdDev(counts);
  const m = mean(counts);
  const activityConsistency = sd !== null && m ? 1 - Math.min(1, sd / m) : null; // 1 = perfectly steady, 0 = highly bursty

  return {
    taskCompletionRatio: totalAssigned ? completed / totalAssigned : null,
    onTimeCompletionRate: completed ? onTime / completed : null,
    overdueTaskCount: overdue,
    remainingTaskCount: remaining,
    inProgressTaskCount: inProgress,
    estimatedEffortAssignedHours: estimatedEffortAssigned,
    completedEffortPlannedHours: completedEffortPlanned, // labeled "planned", see comment above
    deadlineProximityDays: upcomingDueDeltas.length ? Math.min(...upcomingDueDeltas) : null,
    relevantFileCount: files.length,
    meaningfulChatMessageCount: meaningfulMsgs.length,
    blockerMentionCount,
    progressUpdateMentionCount: progressUpdateCount,
    activeChatDays: activeDays,
    activityConsistency,
    totalTasksAssigned: totalAssigned,
  };
}

/**
 * Per-project features, computed as of `referenceDate`.
 * `tasks` = all Task docs for the group. `messages` = group-chat messages
 * for the group (private/DM already excluded upstream). `group` = Group doc.
 */
function computeProjectFeatures({ tasks = [], messages = [], group = {}, referenceDate = new Date() } = {}) {
  const now = new Date(referenceDate);
  const total = tasks.length;
  let completed = 0, overdue = 0, remaining = 0;
  let remainingEffortHours = 0;
  const perAssignee = new Map();

  for (const t of tasks) {
    const status = String(t.status || "todo");
    const estimate = Number.isFinite(t.estimate) ? t.estimate : 0;
    const uid = String(t.assignee || "unassigned");
    perAssignee.set(uid, (perAssignee.get(uid) || 0) + 1);

    if (DONE_STATUSES.has(status)) {
      completed += 1;
    } else {
      remainingEffortHours += estimate;
      const due = t.due ? new Date(t.due) : null;
      if (due && due < now) overdue += 1;
      else remaining += 1;
    }
  }

  const loads = [...perAssignee.values()];
  const workloadImbalance = loads.length ? Math.max(...loads) - Math.min(...loads) : null;

  const meaningfulMsgs = messages.filter((m) => isMeaningfulMessage(m.text));
  const blockerCount = meaningfulMsgs.filter((m) => {
    const low = String(m.text || "").toLowerCase();
    return BLOCKER_HINTS.some((h) => low.includes(h));
  }).length;

  // recent activity: meaningful messages + task completions in the trailing 7 days
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const recentMeaningfulMsgs = meaningfulMsgs.filter((m) => m.createdAt && new Date(m.createdAt) >= sevenDaysAgo).length;
  const recentCompletions = tasks.filter((t) => t.completedAt && new Date(t.completedAt) >= sevenDaysAgo).length;

  const expectedCompletion = group.expectedCompletion ? new Date(group.expectedCompletion) : null;

  return {
    teamCompletionRatio: total ? completed / total : null,
    completedTaskCount: completed,
    remainingTaskCount: remaining,
    overdueTaskCountTeamWide: overdue,
    remainingProjectEffortHours: remainingEffortHours,
    daysToExpectedCompletion: expectedCompletion ? daysBetween(expectedCompletion, now) : null,
    workloadImbalance,
    groupChatMeaningfulMessageCount: meaningfulMsgs.length,
    blockerCountTeamWide: blockerCount,
    recentMeaningfulMessageCount7d: recentMeaningfulMsgs,
    recentTaskCompletionCount7d: recentCompletions,
    totalTasks: total,
  };
}

module.exports = {
  isMeaningfulMessage,
  computeStudentFeatures,
  computeProjectFeatures,
  PROGRESS_HINTS,
  BLOCKER_HINTS,
};
