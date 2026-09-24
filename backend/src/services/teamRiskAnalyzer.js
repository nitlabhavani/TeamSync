/**
 * Step 15 — AI Team Risk & Early Warning System.
 *
 * This module is purely ADDITIVE. It does not replace, alter, or read from
 * the existing risk radar (services/riskService.js, model RiskSnapshot) —
 * that system keeps working exactly as before. This is a separate, richer,
 * evidence-based analysis that also considers submission workflow state,
 * guide review outcomes, plagiarism signals and per-student fairness rules
 * that the older radar does not look at.
 *
 * ---------------------------------------------------------------------
 * DESIGN — two layers, like reportService.js / plagiarismAnalyzer.js:
 *
 *   1. gatherGroupEvidence(groupId)   — DB access only. Reads real Task,
 *      Message and Group documents and reduces them to a plain evidence
 *      object. Never invents a number that isn't backed by a query result.
 *
 *   2. computeTeamRisk(evidence) / computeStudentRisk(evidence, studentId)
 *      — pure functions. No DB, no I/O, fully deterministic: the same
 *      evidence object always produces the same result. This is what
 *      backend/scripts/testTeamRiskAnalyzer.js exercises directly, without
 *      a database or the AI engine running.
 *
 * ---------------------------------------------------------------------
 * SCORING FORMULA (transparent, weighted evidence — not random weights).
 *
 * The team risk score is 0 (healthy) to 100 (critical), built from four
 * capped evidence categories that are summed and then clamped:
 *
 *   A. Deadline & task health          — up to 35 points
 *        +7 per overdue task                          (cap 21)
 *        +3 per task due within 2 days with no         (cap 9)
 *           progress recorded (status still todo/backlog)
 *        +10 if completion ratio < 30% (>= 3 tasks total)
 *         +5 if completion ratio < 50% (>= 3 tasks total)
 *        +4 per stalled task (open, not updated in 7+ days) (cap 12)
 *
 *   B. Submission / guide-review health — up to 30 points
 *        +2 per submission awaiting guide review beyond the first (cap 10)
 *        +6 per task with changes requested                    (cap 18)
 *        +8 extra per task sent back for changes 2+ times       (cap 16)
 *        +10 per rejected submission                            (cap 20)
 *        +8 per wrong-project / unreadable-ZIP submission       (cap 16)
 *
 *   C. Collaboration signal              — up to 15 points
 *        +12 if the group has been fully idle (no messages, no
 *            submissions, no task updates) for 5+ days
 *        else +8 if this week's message count dropped 30%+ vs last week
 *        else +4 if this week's message count dropped 10-29%
 *
 *   D. Originality signal                 — up to 10 points
 *        +10 if any submission is DUPLICATE severity
 *        else +6 per HIGH-severity submission (cap 10)
 *        else +3 per POSSIBLE-severity submission (cap 6)
 *        (never treated as proof of misconduct — see buildWarnings)
 *
 * Category subtotals are each capped as noted, then summed and clamped to
 * [0, 100]. Categories are independent (a healthy submission pipeline does
 * not offset overdue tasks) so nothing here is an arbitrary blended weight
 * — every point on the score traces back to a concrete, named signal that
 * also appears in `reasons`/`warnings`/evidence.
 *
 * THRESHOLDS:
 *   0  <= score < 25   -> LOW
 *   25 <= score < 50   -> MODERATE
 *   50 <= score < 75   -> HIGH
 *   75 <= score <= 100 -> CRITICAL
 *   (no tasks recorded at all)          -> INSUFFICIENT_DATA
 * ---------------------------------------------------------------------
 */
const Task = require("../models/Task");
const Message = require("../models/Message");
const Group = require("../models/Group");
const TeamRiskSnapshot = require("../models/TeamRiskSnapshot");
const { notifyUsers } = require("./notificationService");
// STEP 16 — additive evidence categories (COLLABORATION / COMMUNICATION +
// proactive deadline early-warning). Read-only compute here: these two
// functions never notify or persist by themselves (see
// deadlineNudgeService.scanEarlyWarnings / collaborationRiskService.
// scanCollaborationRisk for the scheduler-side notify+dedup versions). The
// existing riskScore/riskLevel/A-D category math below is NOT touched by
// these — they are appended to the result as their own separate fields so
// every Step 15 category/score stays byte-for-byte identical (see
// backend/scripts/testTeamRiskAnalyzer.js, which still passes unmodified).
const { getGroupEarlyWarnings } = require("./deadlineNudgeService");
const { getGroupCollaborationRisks } = require("./collaborationRiskService");

const DAY = 24 * 60 * 60 * 1000;
const OPEN_TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "pending",
  "submitted",
  "ai_review",
  "guide_review",
  "changes_requested",
  "overdue",
];
const DONE_STATUSES = ["done", "completed"];
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/* ============================================================
 * LAYER 1 — evidence gathering (DB access)
 * ============================================================ */

/**
 * STEP 25 — WHAT-IF SIMULATOR SUPPORT (additive, no behavior change).
 *
 * gatherGroupEvidence used to do the DB reads AND the reduction in one
 * function, which meant nothing could build an evidence object for a
 * hypothetical (in-memory) task list without a second DB round trip that
 * still only returns the REAL tasks. Split into:
 *
 *   fetchTeamRiskRawData(group)        — DB access only, returns the exact
 *                                          same plain query results as before.
 *   reduceTeamRiskEvidence(raw, group) — PURE. Every line of the original
 *                                          reduction loop, unchanged, just
 *                                          taking `raw` instead of awaiting
 *                                          it inline.
 *
 * gatherGroupEvidence(group) below is now a two-line wrapper of the two —
 * byte-for-byte identical output/behavior for every existing caller
 * (analyzeGroupRisk, projectForecastService, projectHealthService,
 * projectExecutionCopilotService, backend/scripts/testTeamRiskAnalyzer.js).
 * projectWhatIfSimulatorService is the only new caller of the two split
 * halves directly.
 */
async function fetchTeamRiskRawData(group) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * DAY);
  const twoWeeksAgo = new Date(now - 14 * DAY);

  const [tasks, messagesThisWeek, messagesLastWeek, lastMessage, history] = await Promise.all([
    Task.find({ group: group._id }).select("+submissions._plagiarismFingerprint").lean(),
    Message.countDocuments({ group: group._id, createdAt: { $gte: weekAgo } }),
    Message.countDocuments({ group: group._id, createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } }),
    Message.findOne({ group: group._id }).sort("-createdAt").select("createdAt").lean(),
    TeamRiskSnapshot.find({ group: group._id }).sort("-createdAt").limit(5).lean(),
  ]);

  return { now, tasks, messagesThisWeek, messagesLastWeek, lastMessage, history };
}

/**
 * Reduces real (or hypothetical, plain-object) Task/Message/Group data for
 * one group into the plain evidence object consumed by
 * computeTeamRisk/computeStudentRisk. Every field here is a direct count or
 * list drawn from `raw` — nothing is fabricated. PURE — no DB, no I/O.
 */
function reduceTeamRiskEvidence(raw, group) {
  const { now, tasks, messagesThisWeek, messagesLastWeek, lastMessage, history } = raw;
  const memberIds = (group.members || []).map((m) => String(m));

  const perStudent = {};
  const ensure = (id) => {
    if (!perStudent[id]) {
      perStudent[id] = {
        assigned: 0,
        completed: 0,
        overdue: 0,
        inProgress: 0,
        stalled: 0,
        pendingSubmissionReview: 0,
        changesRequested: 0,
        rejected: 0,
        lastActivityAt: null,
      };
    }
    return perStudent[id];
  };
  memberIds.forEach(ensure);

  let overdue = 0;
  let dueSoonNoProgress = 0;
  let completed = 0;
  let stalled = 0;
  let awaitingReview = 0;
  let changesRequestedCount = 0;
  let repeatedChangesTasks = 0;
  let rejectedCount = 0;
  let wrongProjectOrUnreadable = 0;
  const flaggedSubmissions = [];
  let duplicateCount = 0;
  let highSeverityCount = 0;
  let possibleSeverityCount = 0;
  let lastTaskActivity = null;
  /** Feature 14 — per-task reasons a task contributes to team risk, for the
   * Submission Review contextual indicator. Never duplicates the whole risk
   * system — just a short pointer back to which evidence this task added. */
  const riskyTasks = [];
  const flagTask = (task, reason) => {
    let entry = riskyTasks.find((t) => t.taskId === String(task._id));
    if (!entry) {
      entry = { taskId: String(task._id), title: task.title, reasons: [] };
      riskyTasks.push(entry);
    }
    entry.reasons.push(reason);
  };

  for (const task of tasks) {
    const finished = DONE_STATUSES.includes(task.status);
    const assigneeId = task.assignee ? String(task.assignee) : null;
    if (assigneeId) ensure(assigneeId).assigned += 1;

    if (task.updatedAt && (!lastTaskActivity || task.updatedAt > lastTaskActivity)) {
      lastTaskActivity = task.updatedAt;
    }
    if (assigneeId && task.updatedAt) {
      const rec = ensure(assigneeId);
      if (!rec.lastActivityAt || task.updatedAt > rec.lastActivityAt) rec.lastActivityAt = task.updatedAt;
    }

    if (finished) {
      completed += 1;
      if (assigneeId) ensure(assigneeId).completed += 1;
      continue; // eslint-disable-line no-continue
    }

    const isOverdue = Boolean(task.due && new Date(task.due) < now);
    if (isOverdue) {
      overdue += 1;
      if (assigneeId) ensure(assigneeId).overdue += 1;
      flagTask(task, "This task is overdue.");
    } else if (task.status === "in_progress") {
      if (assigneeId) ensure(assigneeId).inProgress += 1;
    }

    if (task.due) {
      const daysLeft = (new Date(task.due) - now) / DAY;
      const hasNoProgress = ["backlog", "todo"].includes(task.status);
      if (daysLeft >= 0 && daysLeft <= 2 && hasNoProgress) dueSoonNoProgress += 1;
    }

    const isStalled =
      OPEN_TASK_STATUSES.includes(task.status) &&
      task.updatedAt &&
      now - new Date(task.updatedAt) >= 7 * DAY;
    if (isStalled) {
      stalled += 1;
      if (assigneeId) ensure(assigneeId).stalled += 1;
      flagTask(task, "No update on this task in over a week.");
    }

    if (task.status === "guide_review") {
      awaitingReview += 1;
      if (assigneeId) ensure(assigneeId).pendingSubmissionReview += 1;
    }

    const submissions = task.submissions || [];
    const changeRounds = submissions.filter((s) => s.verdict === "changes_requested").length;
    if (changeRounds >= 1) {
      changesRequestedCount += 1;
      if (assigneeId) ensure(assigneeId).changesRequested += changeRounds;
    }
    if (changeRounds >= 2) {
      repeatedChangesTasks += 1;
      flagTask(task, "Repeated changes requested on this task.");
    }

    const rejectedHere = submissions.filter((s) => s.verdict === "rejected").length;
    if (rejectedHere >= 1) {
      rejectedCount += rejectedHere;
      if (assigneeId) ensure(assigneeId).rejected += rejectedHere;
      flagTask(task, "A submission on this task was rejected.");
    }

    const latest = submissions[submissions.length - 1];
    if (latest?.aiAnalysis) {
      if (
        latest.aiAnalysis.implementationStatus === "WRONG_PROJECT" ||
        latest.aiAnalysis.implementationStatus === "UNREADABLE_ZIP"
      ) {
        wrongProjectOrUnreadable += 1;
        flagTask(task, "Latest submission was flagged as wrong-project or unreadable.");
      }
      const severity = latest.aiAnalysis.plagiarism?.severity;
      if (severity && severity !== "NONE") {
        flaggedSubmissions.push({
          taskId: String(task._id),
          taskTitle: task.title,
          studentId: assigneeId,
          severity,
        });
        if (severity === "DUPLICATE") duplicateCount += 1;
        else if (severity === "HIGH") highSeverityCount += 1;
        else if (severity === "POSSIBLE") possibleSeverityCount += 1;
        flagTask(task, `Originality check flagged this submission (${severity}).`);
      }
    }
  }

  const totalTasks = tasks.length;
  const completionRatio = totalTasks ? completed / totalTasks : null;

  const lastActivityAt = [lastMessage?.createdAt, lastTaskActivity]
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  const daysSinceActivity = lastActivityAt ? (now - new Date(lastActivityAt)) / DAY : null;

  return {
    groupId: String(group._id),
    groupName: group.name,
    generatedAt: now,
    members: memberIds,
    tasks: {
      total: totalTasks,
      completed,
      overdue,
      dueSoonNoProgress,
      stalled,
      completionRatio,
    },
    submissions: {
      awaitingReview,
      changesRequestedTasks: changesRequestedCount,
      repeatedChangesTasks,
      rejected: rejectedCount,
      wrongProjectOrUnreadable,
    },
    collaboration: {
      messagesThisWeek,
      messagesLastWeek,
      daysSinceActivity,
    },
    originality: {
      duplicateCount,
      highSeverityCount,
      possibleSeverityCount,
      flaggedSubmissions,
    },
    perStudent,
    riskyTasks,
    history: history.map((h) => ({
      score: h.riskScore,
      level: h.riskLevel,
      generatedAt: h.createdAt,
    })),
  };
}

/** Original entry point — unchanged behavior/signature for every existing
 * caller. Just DB fetch + pure reduce, composed. */
async function gatherGroupEvidence(group) {
  const raw = await fetchTeamRiskRawData(group);
  return reduceTeamRiskEvidence(raw, group);
}

/* ============================================================
 * LAYER 2 — pure scoring (no DB, deterministic)
 * ============================================================ */

function classifyTeamLevel(score, hasData) {
  if (!hasData) return "INSUFFICIENT_DATA";
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MODERATE";
  return "LOW";
}

function scoreDeadlineCategory(evidence, reasons, positives) {
  const { total, completed, overdue, dueSoonNoProgress, stalled, completionRatio } = evidence.tasks;
  let pts = 0;

  if (overdue > 0) {
    pts += Math.min(21, overdue * 7);
    reasons.push(`${overdue} task${overdue === 1 ? " is" : "s are"} overdue`);
  }
  if (dueSoonNoProgress > 0) {
    pts += Math.min(9, dueSoonNoProgress * 3);
    reasons.push(
      `${dueSoonNoProgress} task${dueSoonNoProgress === 1 ? "" : "s"} due within 2 days with no progress started`
    );
  }
  if (total >= 3 && completionRatio !== null) {
    if (completionRatio < 0.3) {
      pts += 10;
      reasons.push(`Only ${Math.round(completionRatio * 100)}% of tasks are completed`);
    } else if (completionRatio < 0.5) {
      pts += 5;
      reasons.push(`Task completion is at ${Math.round(completionRatio * 100)}%, below halfway`);
    }
  }
  if (stalled > 0) {
    pts += Math.min(12, stalled * 4);
    reasons.push(`${stalled} task${stalled === 1 ? "" : "s"} have had no update in over a week`);
  }
  if (overdue === 0 && stalled === 0 && total > 0 && (completionRatio ?? 0) >= 0.5) {
    positives.push(`${completed} of ${total} tasks completed with no overdue work`);
  }
  return Math.min(35, pts);
}

function scoreSubmissionCategory(evidence, reasons, positives) {
  const { awaitingReview, changesRequestedTasks, repeatedChangesTasks, rejected, wrongProjectOrUnreadable } =
    evidence.submissions;
  let pts = 0;

  if (awaitingReview > 1) {
    pts += Math.min(10, (awaitingReview - 1) * 2);
    reasons.push(`${awaitingReview} submissions are awaiting guide review`);
  } else if (awaitingReview === 1) {
    reasons.push("1 submission is awaiting guide review");
  }
  if (changesRequestedTasks > 0) {
    pts += Math.min(18, changesRequestedTasks * 6);
    reasons.push(`${changesRequestedTasks} task${changesRequestedTasks === 1 ? "" : "s"} sent back for changes`);
  }
  if (repeatedChangesTasks > 0) {
    pts += Math.min(16, repeatedChangesTasks * 8);
    reasons.push(
      `${repeatedChangesTasks} task${repeatedChangesTasks === 1 ? " has" : "s have"} been sent back for changes more than once`
    );
  }
  if (rejected > 0) {
    pts += Math.min(20, rejected * 10);
    reasons.push(`${rejected} submission${rejected === 1 ? "" : "s"} rejected by the guide`);
  }
  if (wrongProjectOrUnreadable > 0) {
    pts += Math.min(16, wrongProjectOrUnreadable * 8);
    reasons.push(
      `${wrongProjectOrUnreadable} submission${wrongProjectOrUnreadable === 1 ? " was" : "s were"} flagged as wrong-project or unreadable`
    );
  }
  if (pts === 0 && (awaitingReview + changesRequestedTasks + rejected) === 0) {
    positives.push("No submissions are stuck in review, changes-requested, or rejected");
  }
  return Math.min(30, pts);
}

function scoreCollaborationCategory(evidence, reasons, positives) {
  const { messagesThisWeek, messagesLastWeek, daysSinceActivity } = evidence.collaboration;
  let pts = 0;
  const isIdle = daysSinceActivity !== null && daysSinceActivity >= 5;

  if (isIdle) {
    pts = 12;
    reasons.push(`No group activity (messages, submissions or task updates) for ${Math.floor(daysSinceActivity)} days`);
  } else if (messagesLastWeek > 0) {
    const dropRatio = (messagesLastWeek - messagesThisWeek) / messagesLastWeek;
    if (dropRatio >= 0.3) {
      pts = 8;
      reasons.push(
        `Collaboration activity decreased ${Math.round(dropRatio * 100)}% compared with last week (${messagesThisWeek} vs ${messagesLastWeek} messages)`
      );
    } else if (dropRatio >= 0.1) {
      pts = 4;
      reasons.push(
        `Collaboration activity decreased ${Math.round(dropRatio * 100)}% compared with last week`
      );
    }
  }
  if (pts === 0 && !isIdle) {
    positives.push("Team collaboration activity is steady or increasing");
  }
  return Math.min(15, pts);
}

function scoreOriginalityCategory(evidence, reasons) {
  const { duplicateCount, highSeverityCount, possibleSeverityCount } = evidence.originality;
  let pts = 0;
  if (duplicateCount > 0) {
    pts = 10;
    reasons.push(
      `${duplicateCount} submission${duplicateCount === 1 ? " is" : "s are"} flagged as a likely duplicate — requires guide review, not automatic misconduct`
    );
  } else if (highSeverityCount > 0) {
    pts = Math.min(10, highSeverityCount * 6);
    reasons.push(
      `${highSeverityCount} submission${highSeverityCount === 1 ? "" : "s"} show high similarity to another submission — flagged for review only`
    );
  } else if (possibleSeverityCount > 0) {
    pts = Math.min(6, possibleSeverityCount * 3);
    reasons.push(`${possibleSeverityCount} submission${possibleSeverityCount === 1 ? "" : "s"} show possible similarity worth a look`);
  }
  return Math.min(10, pts);
}

const WARNING_RECOMMENDATIONS = {
  DEADLINE_RISK: "Review the overdue tasks and redistribute work if necessary.",
  TASK_STALL: "Check in with the assignee(s) — these tasks haven't moved in over a week.",
  LOW_PROGRESS: "Discuss blockers with the team; consider re-scoping tasks that are lagging.",
  SUBMISSION_REVIEW_BACKLOG: "Review pending submissions before assigning additional work.",
  REPEATED_CHANGES_REQUESTED: "Ask the student to fully address the guide feedback before resubmitting.",
  REPEATED_REJECTION: "Meet with the student to clarify expectations before the next submission.",
  LOW_COLLABORATION: "Check whether the team is blocked and encourage a written status update.",
  TEAM_IDLE: "Check whether the team is blocked and discuss pending tasks in the group chat.",
  DUPLICATE_SUBMISSION_RISK: "Manually review and compare the flagged submissions before making an academic-integrity decision.",
  STUDENT_OVERLOAD: "Consider redistributing upcoming tasks from heavily loaded members.",
};

/** Builds the Feature 6 warning list, each backed by a concrete count from `evidence`. */
function buildWarnings(evidence) {
  const warnings = [];
  const add = (type, severity, title, description, evidence_) =>
    warnings.push({ type, severity, title, description, evidence: evidence_, recommendation: WARNING_RECOMMENDATIONS[type] });

  const { overdue, dueSoonNoProgress, stalled, completionRatio, total } = evidence.tasks;
  if (overdue > 0) {
    add(
      "DEADLINE_RISK",
      overdue >= 4 ? "CRITICAL" : overdue >= 2 ? "HIGH" : "MEDIUM",
      "Overdue tasks",
      `${overdue} task${overdue === 1 ? " is" : "s are"} past their due date.`,
      [`${overdue} overdue task(s)`]
    );
  }
  if (stalled > 0) {
    add(
      "TASK_STALL",
      stalled >= 3 ? "HIGH" : "MEDIUM",
      "Stalled tasks",
      `${stalled} task${stalled === 1 ? " has" : "s have"} not been updated in over a week.`,
      [`${stalled} stalled task(s)`]
    );
  }
  if (total >= 3 && completionRatio !== null && completionRatio < 0.3) {
    add(
      "LOW_PROGRESS",
      "HIGH",
      "Low overall progress",
      `Only ${Math.round(completionRatio * 100)}% of tasks are completed.`,
      [`${Math.round(completionRatio * 100)}% completion across ${total} tasks`]
    );
  }
  if (dueSoonNoProgress > 0) {
    add(
      "DEADLINE_RISK",
      "MEDIUM",
      "Tasks due soon with no progress",
      `${dueSoonNoProgress} task${dueSoonNoProgress === 1 ? "" : "s"} due within 2 days ${dueSoonNoProgress === 1 ? "hasn't" : "haven't"} been started.`,
      [`${dueSoonNoProgress} task(s) due soon, not started`]
    );
  }

  const { awaitingReview, changesRequestedTasks, repeatedChangesTasks, rejected, wrongProjectOrUnreadable } =
    evidence.submissions;
  if (awaitingReview > 2) {
    add(
      "SUBMISSION_REVIEW_BACKLOG",
      awaitingReview >= 5 ? "HIGH" : "MEDIUM",
      "Submission review backlog",
      `${awaitingReview} submissions are waiting for guide review.`,
      [`${awaitingReview} submission(s) awaiting review`]
    );
  }
  if (repeatedChangesTasks > 0) {
    add(
      "REPEATED_CHANGES_REQUESTED",
      "HIGH",
      "Repeated changes requested",
      `${repeatedChangesTasks} task${repeatedChangesTasks === 1 ? " has" : "s have"} been sent back for changes more than once.`,
      [`${repeatedChangesTasks} task(s) with 2+ change requests`]
    );
  }
  if (rejected > 0) {
    add(
      "REPEATED_REJECTION",
      rejected >= 2 ? "HIGH" : "MEDIUM",
      "Rejected submissions",
      `${rejected} submission${rejected === 1 ? " was" : "s were"} rejected by the guide.`,
      [`${rejected} rejected submission(s)`]
    );
  }
  if (wrongProjectOrUnreadable > 0) {
    add(
      "SUBMISSION_REVIEW_BACKLOG",
      "MEDIUM",
      "Invalid submissions detected",
      `${wrongProjectOrUnreadable} submission${wrongProjectOrUnreadable === 1 ? " was" : "s were"} flagged as wrong-project or unreadable.`,
      [`${wrongProjectOrUnreadable} invalid submission(s)`]
    );
  }

  const { messagesThisWeek, messagesLastWeek, daysSinceActivity } = evidence.collaboration;
  if (daysSinceActivity !== null && daysSinceActivity >= 5) {
    add(
      "TEAM_IDLE",
      daysSinceActivity >= 10 ? "CRITICAL" : "HIGH",
      "Team is idle",
      `No group activity for ${Math.floor(daysSinceActivity)} days.`,
      [`${Math.floor(daysSinceActivity)} day(s) since last activity`]
    );
  } else if (messagesLastWeek > 0 && (messagesLastWeek - messagesThisWeek) / messagesLastWeek >= 0.3) {
    const pctDrop = Math.round(((messagesLastWeek - messagesThisWeek) / messagesLastWeek) * 100);
    add(
      "LOW_COLLABORATION",
      pctDrop >= 60 ? "HIGH" : "MEDIUM",
      "Collaboration activity decreased",
      `Team activity decreased ${pctDrop}% compared with last week.`,
      [`${messagesThisWeek} messages this week vs ${messagesLastWeek} last week`]
    );
  }

  const { duplicateCount, highSeverityCount, possibleSeverityCount } = evidence.originality;
  if (duplicateCount + highSeverityCount + possibleSeverityCount > 0) {
    add(
      "DUPLICATE_SUBMISSION_RISK",
      duplicateCount > 0 ? "HIGH" : highSeverityCount > 0 ? "MEDIUM" : "LOW",
      "Originality check flagged submissions",
      "One or more submissions show similarity to another submission and need manual review. This is a signal for review, not proof of misconduct.",
      [`${duplicateCount} duplicate, ${highSeverityCount} high, ${possibleSeverityCount} possible`]
    );
  }

  // STUDENT_OVERLOAD — a member carrying significantly more open work than
  // the group average, computed only from real assigned-task counts.
  const perStudentEntries = Object.entries(evidence.perStudent || {});
  if (perStudentEntries.length >= 2) {
    const openCounts = perStudentEntries.map(([, s]) => Math.max(0, s.assigned - s.completed));
    const avgOpen = openCounts.reduce((a, b) => a + b, 0) / openCounts.length;
    const overloaded = perStudentEntries.filter(
      ([, s]) => Math.max(0, s.assigned - s.completed) >= Math.max(3, avgOpen * 2)
    );
    if (avgOpen > 0 && overloaded.length > 0) {
      add(
        "STUDENT_OVERLOAD",
        "MEDIUM",
        "Uneven workload distribution",
        `${overloaded.length} member${overloaded.length === 1 ? " has" : "s have"} significantly more open tasks than the team average.`,
        [`Average open tasks per member: ${avgOpen.toFixed(1)}`]
      );
    }
  }

  return warnings;
}

function buildRecommendations(warnings) {
  const seen = new Set();
  const out = [];
  for (const w of warnings) {
    if (w.recommendation && !seen.has(w.recommendation)) {
      seen.add(w.recommendation);
      out.push(w.recommendation);
    }
  }
  if (!out.length) out.push("Team is healthy — keep the current cadence.");
  return out;
}

/** Feature 8 — trend vs the most recent persisted snapshot. Never invents a
 * trend when there is no prior history. */
function determineTrend(currentScore, history) {
  if (!history || !history.length) {
    return { trend: "INSUFFICIENT_DATA", previousScore: null, message: "Insufficient historical data to determine a trend." };
  }
  const previous = history[0].score;
  const delta = currentScore - previous;
  if (Math.abs(delta) <= 5) {
    return { trend: "STABLE", previousScore: previous, message: "Team risk has remained stable." };
  }
  if (delta < 0) {
    return {
      trend: "IMPROVING",
      previousScore: previous,
      message: `Team risk decreased from ${previous} to ${currentScore} this week.`,
    };
  }
  return {
    trend: "WORSENING",
    previousScore: previous,
    message: `Team risk increased from ${previous} to ${currentScore} this week.`,
  };
}

/**
 * Feature 1/2/3 — computes the full team risk result from a gathered
 * evidence object. Pure and deterministic (Feature 18 test #18).
 */
function computeTeamRisk(evidence) {
  const hasData = evidence.tasks.total > 0 || evidence.collaboration.messagesThisWeek > 0;
  const reasons = [];
  const positiveSignals = [];

  if (!hasData) {
    return {
      riskScore: 0,
      riskLevel: "INSUFFICIENT_DATA",
      confidence: "low",
      reasons: ["No tasks or activity have been recorded for this group yet."],
      criticalRisks: [],
      warnings: [],
      positiveSignals: [],
      recommendations: ["Create and assign tasks to start tracking team risk."],
      affectedStudents: [],
      riskTrend: "INSUFFICIENT_DATA",
      trendMessage: "Insufficient historical data to determine a trend.",
      generatedAt: evidence.generatedAt,
    };
  }

  const a = scoreDeadlineCategory(evidence, reasons, positiveSignals);
  const b = scoreSubmissionCategory(evidence, reasons, positiveSignals);
  const c = scoreCollaborationCategory(evidence, reasons, positiveSignals);
  const d = scoreOriginalityCategory(evidence, reasons);

  const riskScore = clamp(a + b + c + d);
  const riskLevel = classifyTeamLevel(riskScore, hasData);
  const warnings = buildWarnings(evidence);
  const recommendations = buildRecommendations(warnings);
  const criticalRisks = warnings.filter((w) => w.severity === "CRITICAL").map((w) => w.title);
  const { trend, previousScore, message } = determineTrend(riskScore, evidence.history);

  // Confidence reflects how much real evidence backs the score, not the
  // score itself — a handful of tasks with no submissions/chat history is
  // "low confidence" even if the score happens to be low.
  const evidenceVolume =
    evidence.tasks.total + evidence.collaboration.messagesThisWeek + evidence.collaboration.messagesLastWeek;
  const confidence = evidenceVolume >= 15 ? "high" : evidenceVolume >= 5 ? "medium" : "low";

  return {
    riskScore,
    riskLevel,
    confidence,
    reasons,
    criticalRisks,
    warnings,
    positiveSignals,
    recommendations,
    affectedStudents: [], // filled in by analyzeGroupRisk (needs computeStudentRisk)
    riskTrend: trend,
    previousScore,
    trendMessage: message,
    generatedAt: evidence.generatedAt,
  };
}

/* ---------------- Feature 4/5 — individual student risk ---------------- */

function classifyStudentLevel(score) {
  if (score >= 70) return "CRITICAL";
  if (score >= 45) return "AT_RISK";
  if (score >= 20) return "NEEDS_ATTENTION";
  return "ON_TRACK";
}

/**
 * Feature 4/5 — one student's risk, judged only against THEIR OWN assigned
 * workload and outcomes (never against raw chat/file activity counts, and
 * never penalized for having fewer tasks because fewer were assigned to
 * them — Feature 5 fairness rules).
 */
function computeStudentRisk(evidence, studentId) {
  const s = evidence.perStudent?.[studentId];
  const base = {
    studentId,
    riskScore: 0,
    riskLevel: "ON_TRACK",
    reasons: [],
    overdueTasks: 0,
    pendingSubmissions: 0,
    changesRequested: 0,
    recommendations: [],
  };

  if (!s || s.assigned === 0) {
    // Feature 5: no assigned work (new member, or simply fewer tasks were
    // assigned) is never treated as risk.
    return {
      ...base,
      reasons: ["No tasks are currently assigned."],
      recommendations: [],
    };
  }

  let score = 0;
  const reasons = [];
  if (s.overdue > 0) {
    score += Math.min(60, s.overdue * 20);
    reasons.push(`${s.overdue} overdue task${s.overdue === 1 ? "" : "s"}`);
  }
  if (s.changesRequested > 0) {
    score += Math.min(30, s.changesRequested * 15);
    reasons.push(`${s.changesRequested} submission${s.changesRequested === 1 ? "" : "s"} sent back for changes`);
  }
  if (s.rejected > 0) {
    score += Math.min(50, s.rejected * 25);
    reasons.push(`${s.rejected} submission${s.rejected === 1 ? "" : "s"} rejected`);
  }
  if (s.stalled > 0) {
    score += Math.min(20, s.stalled * 10);
    reasons.push(`${s.stalled} task${s.stalled === 1 ? " has" : "s have"} not been updated in over a week`);
  }
  if (s.pendingSubmissionReview > 0) {
    // Awaiting review is not the student's fault — informational only, no
    // score impact (avoids penalizing a student for the guide's backlog).
    reasons.push(`${s.pendingSubmissionReview} submission${s.pendingSubmissionReview === 1 ? " is" : "s are"} awaiting guide review`);
  }

  score = clamp(score);
  const riskLevel = classifyStudentLevel(score);

  const recommendations = [];
  if (s.overdue > 0) recommendations.push("Prioritize completing the overdue task(s) before starting new work.");
  if (s.changesRequested > 0) recommendations.push("Address the guide's feedback fully before resubmitting.");
  if (s.rejected > 0) recommendations.push("Discuss the rejected submission with the guide to realign on requirements.");
  if (!reasons.length) reasons.push("Assigned tasks are progressing normally.");

  return {
    studentId,
    riskScore: score,
    riskLevel,
    reasons,
    overdueTasks: s.overdue,
    pendingSubmissions: s.pendingSubmissionReview,
    changesRequested: s.changesRequested,
    recommendations,
  };
}

function computeAllStudentRisks(evidence) {
  return (evidence.members || []).map((id) => computeStudentRisk(evidence, id));
}

/* ============================================================
 * ORCHESTRATION — DB + pure computation + persistence + notify
 * ============================================================ */

/**
 * Runs the full Step 15 analysis for one group: gathers evidence, computes
 * team + per-student risk, optionally persists a TeamRiskSnapshot, and
 * (only on a significant new HIGH/CRITICAL episode) notifies the guide —
 * mirroring the existing riskService.js notification-throttling pattern so
 * this never spams on every dashboard open (Feature 15).
 */
async function analyzeGroupRisk(group, { persist = true } = {}) {
  const evidence = await gatherGroupEvidence(group);
  const team = computeTeamRisk(evidence);
  const studentRisks = computeAllStudentRisks(evidence);

  team.affectedStudents = studentRisks
    .filter((s) => s.riskLevel !== "ON_TRACK")
    .map((s) => ({
      studentId: s.studentId,
      riskLevel: s.riskLevel,
      riskScore: s.riskScore,
      reasons: s.reasons,
    }));

  // STEP 16 — additive evidence, appended after the existing score/level are
  // already final. Failures here must never break the Step 15 result above.
  let earlyWarnings = [];
  let collaborationRisks = [];
  try {
    earlyWarnings = await getGroupEarlyWarnings(group);
  } catch (err) {
    console.error(`[team-risk] early-warning evidence failed for group ${group._id}: ${err.message}`);
  }
  try {
    collaborationRisks = await getGroupCollaborationRisks(group);
  } catch (err) {
    console.error(`[team-risk] collaboration evidence failed for group ${group._id}: ${err.message}`);
  }

  const result = {
    ...team,
    groupId: evidence.groupId,
    groupName: evidence.groupName,
    studentRisks,
    riskyTasks: evidence.riskyTasks || [],
    // STEP 16 additive fields — see comment near the requires above.
    earlyWarnings,
    collaborationRisks,
  };

  if (persist) {
    const previous = await TeamRiskSnapshot.findOne({ group: group._id }).sort({ createdAt: -1 });
    await TeamRiskSnapshot.create({
      group: group._id,
      riskScore: team.riskScore,
      riskLevel: team.riskLevel,
      confidence: team.confidence,
      reasons: team.reasons,
      criticalRisks: team.criticalRisks,
      warnings: team.warnings,
      positiveSignals: team.positiveSignals,
      recommendations: team.recommendations,
      affectedStudents: team.affectedStudents,
    });

    // Feature 15 — only alert on a genuinely new HIGH/CRITICAL episode, not
    // every time this function runs (deadline scheduler + dashboard opens).
    const wasAlreadySevere = previous && ["HIGH", "CRITICAL"].includes(previous.riskLevel);
    const isSevere = ["HIGH", "CRITICAL"].includes(team.riskLevel);
    result.alerted = false;
    if (isSevere && !wasAlreadySevere && group.guide) {
      const topReason = team.reasons[0] || "multiple risk signals detected";
      await notifyUsers([group.guide], {
        title: team.riskLevel === "CRITICAL" ? "Critical team risk detected" : "AI Team Risk increased",
        body:
          team.riskLevel === "CRITICAL"
            ? `Critical team risk detected in ${group.name}. Multiple overdue tasks and unresolved submissions require review.`
            : `AI Team Risk increased to HIGH in ${group.name} — ${topReason}.`,
        type: "risk",
        link: "/guide/team-analytics",
        group: group._id,
      });
      result.alerted = true;
    }

    // Students only ever get a notification about THEMSELVES (Feature 15).
    for (const s of studentRisks) {
      if (s.riskLevel === "AT_RISK" || s.riskLevel === "CRITICAL") {
        const wasAlreadyAtRisk = previous?.affectedStudents?.some(
          (p) => String(p.studentId) === String(s.studentId) && ["AT_RISK", "CRITICAL"].includes(p.riskLevel)
        );
        if (!wasAlreadyAtRisk) {
          await notifyUsers([s.studentId], {
            title: "Attention needed on your tasks",
            body: s.reasons[0] || "Some of your assigned work needs attention.",
            type: "risk",
            link: "/app/tasks",
            group: group._id,
          });
        }
      }
    }
  }

  return result;
}

async function scanAllGroupsTeamRisk() {
  const groups = await Group.find({ status: "active" });
  let alerted = 0;
  for (const group of groups) {
    try {
      const result = await analyzeGroupRisk(group, { persist: true });
      if (result.alerted) alerted += 1;
    } catch (err) {
      console.error(`[team-risk] scan failed for group ${group._id}: ${err.message}`);
    }
  }
  return { groups: groups.length, alerted };
}

module.exports = {
  gatherGroupEvidence,
  // STEP 25 — split halves of gatherGroupEvidence, for projectWhatIfSimulatorService.
  fetchTeamRiskRawData,
  reduceTeamRiskEvidence,
  computeTeamRisk,
  computeStudentRisk,
  computeAllStudentRisks,
  buildWarnings,
  buildRecommendations,
  determineTrend,
  classifyTeamLevel,
  classifyStudentLevel,
  analyzeGroupRisk,
  scanAllGroupsTeamRisk,
  // STEP 19 — additive exports only (no formula change). Shared status-list
  // constants so projectForecastService.js never has to redefine/duplicate
  // "what counts as open vs done", keeping both systems in agreement.
  OPEN_TASK_STATUSES,
  DONE_STATUSES,
};
