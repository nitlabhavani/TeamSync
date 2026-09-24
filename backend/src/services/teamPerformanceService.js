/**
 * STEP 22 — AI Team Performance Insights.
 *
 * This is an AGGREGATION layer, exactly like services/projectHealthService.js
 * (Step 20) and services/projectExecutionCopilotService.js (Step 21): it
 * NEVER modifies, replaces, or re-derives Team Risk's existing 0-100 risk
 * formula (services/teamRiskAnalyzer.js). Team Performance is a genuinely
 * SEPARATE metric answering a different question:
 *
 *   Team Risk        -> "how likely is this project to miss its goals?"
 *   Team Performance  -> "how is each member doing against their own
 *                         assigned work, on a transparent 0-100 scale?"
 *
 * Wherever real data already exists elsewhere (assigned/completed/overdue/
 * stalled counts, per-student collaboration risk, per-student deadline
 * risk level, plagiarism flags), this module REUSES the existing service
 * that already computed it — see gatherTeamPerformanceEvidence() below —
 * rather than re-querying/re-deriving it a second, possibly-diverging way.
 * The only genuinely NEW evidence gathered here is per-student submission
 * timing (days-to-complete, on-time-vs-due), per-submission review verdict
 * tallies, and average code-review score — none of which any existing
 * service currently aggregates per student.
 *
 * ---------------------------------------------------------------------
 * THREE-LAYER DESIGN (per the Step 22 spec):
 *
 *   1. gatherTeamPerformanceEvidence(group) — DB + existing-service calls.
 *   2. computeTeamPerformance(evidence)     — pure. Produces one
 *      performance result per member (score/level/metrics/strengths/
 *      improvement areas/recommended action). No DB, deterministic.
 *   3. analyzeTeamPerformance(teamResult, history) — pure. Aggregates the
 *      per-member results into the team-level insight payload (overall
 *      score, trend, strongest contributors, members needing attention,
 *      top team strengths/improvement areas, recommended team actions).
 *
 * backend/scripts/testTeamPerformance.js exercises steps 2 and 3 directly
 * with hand-built evidence objects — no DB, no server.
 *
 * ---------------------------------------------------------------------
 * SCORING FORMULA (transparent, weighted, capped — never a black box).
 *
 * A member's performanceScore is 0 (needs improvement) to 100 (exceptional),
 * built from five INDEPENDENTLY-capped categories that are summed:
 *
 *   A. Task Execution            — up to 30 points
 *        30 * (tasksCompleted / tasksAssigned)
 *        Only tasks actually assigned to this member count — a member
 *        with fewer assigned tasks is judged only against THEIR OWN
 *        workload, never against the team's raw task count (fairness).
 *
 *   B. Deadline Reliability      — up to 20 points
 *        baseline = 20 * (onTimeCompletions / completionsWithADueDate)
 *          — tasks with no due date are excluded from the denominator
 *            entirely (never penalized for something that was never set).
 *          — when the member has no completed-with-due-date tasks yet,
 *            baseline defaults to the full 20 (never penalize missing
 *            data — Feature 3 fairness).
 *        minus 4 points per CURRENTLY overdue open task (cap -12)
 *          — reuses teamRiskAnalyzer's already-computed per-student
 *            `overdue` count; not re-derived.
 *        clamped to [0, 20]
 *
 *   C. Submission / Review Quality — up to 20 points
 *        Built only from REVIEWED submissions (verdict already set by a
 *        guide) — a submission still awaiting review is EXCLUDED from
 *        the denominator (Feature 3 fairness: never penalize a pending
 *        review that's waiting on the guide).
 *        weightedSuccess = (approved*1 + changesRequested*0.5 + rejected*0)
 *                           / reviewedCount
 *          — "changes requested" gets half credit: it is normal iterative
 *            feedback, not a failure, so it is never scored the same as
 *            an outright rejection.
 *        score = 20 * weightedSuccess, or the full 20 when reviewedCount
 *        is 0 (no reviewed submissions yet — never penalize missing data).
 *
 *   D. Code Quality              — up to 15 points
 *        15 * (average codeReview.score across this member's submissions
 *              that have one / 100)
 *        Defaults to the full 15 when no submission has a codeReview
 *        score yet (static analysis wasn't run, or nothing submitted —
 *        never penalize missing data).
 *
 *   E. Collaboration             — up to 15 points
 *        15 * (1 - collaborationRiskScore / 100), reusing
 *        collaborationRiskService.scoreStudentCollaboration's existing
 *        0-100 risk score AS-IS for every member (not just the flagged
 *        ones getGroupCollaborationRisks() would normally return) — that
 *        formula already normalizes for drop-in-activity/disengagement
 *        rather than raw message volume, which is what Feature 3
 *        (fairness — never rank by raw activity/message count) requires.
 *        Defaults to the full 15 when the member has no message history
 *        at all yet (brand-new member — never penalize missing data).
 *
 * performanceScore = clamp(A + B + C + D + E, 0, 100).
 *
 * A member with ZERO assigned tasks gets performanceScore: null,
 * performanceLevel: INSUFFICIENT_DATA — not a fabricated "perfect" score
 * for doing no work, and not a penalty either (Feature 3 fairness).
 *
 * THRESHOLDS (documented, transparent):
 *   score >= 85            -> EXCEPTIONAL
 *   70 <= score < 85        -> STRONG
 *   50 <= score < 70        -> ON_TRACK
 *   score < 50              -> NEEDS_IMPROVEMENT
 *   no assigned tasks        -> INSUFFICIENT_DATA
 * ---------------------------------------------------------------------
 */
const Task = require("../models/Task");
const User = require("../models/User");
const TeamPerformanceSnapshot = require("../models/TeamPerformanceSnapshot");
const { notifyUsers } = require("./notificationService");
const { gatherGroupEvidence, analyzeGroupRisk } = require("./teamRiskAnalyzer");
const { gatherStudentMessageStats, scoreStudentCollaboration } = require("./collaborationRiskService");

const DAY = 24 * 60 * 60 * 1000;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

const LEVEL_RANK = { EXCEPTIONAL: 4, STRONG: 3, ON_TRACK: 2, NEEDS_IMPROVEMENT: 1, INSUFFICIENT_DATA: 5 };

function classifyPerformanceLevel(score) {
  if (score >= 85) return "EXCEPTIONAL";
  if (score >= 70) return "STRONG";
  if (score >= 50) return "ON_TRACK";
  return "NEEDS_IMPROVEMENT";
}

/* ============================================================
 * LAYER 1 — evidence gathering (DB + existing services)
 * ============================================================ */

/**
 * The only genuinely new per-student query in this module: submission
 * timing, review verdicts, and code-review scores are not aggregated per
 * student by any existing service. Everything else this module needs
 * (assigned/completed/overdue/stalled counts, plagiarism flags, per-student
 * risk level, per-student collaboration signal) is read from the EXISTING
 * services below instead of being re-derived here.
 */
async function gatherSubmissionEvidence(groupId, memberIds) {
  const tasks = await Task.find({ group: groupId })
    .select("assignee due createdAt completedAt submissions.student submissions.verdict submissions.reviewedAt submissions.codeReview.score")
    .lean();

  const perStudent = {};
  const ensure = (id) => {
    if (!perStudent[id]) {
      perStudent[id] = {
        completionDaysTotal: 0,
        completionDaysCount: 0,
        dueCompletedCount: 0,
        onTimeCount: 0,
        reviewedApproved: 0,
        reviewedRejected: 0,
        reviewedChangesRequested: 0,
        codeReviewScoreTotal: 0,
        codeReviewScoreCount: 0,
      };
    }
    return perStudent[id];
  };
  memberIds.forEach(ensure);

  for (const task of tasks) {
    const assigneeId = task.assignee ? String(task.assignee) : null;
    if (assigneeId && task.completedAt && task.createdAt) {
      const rec = ensure(assigneeId);
      const days = (new Date(task.completedAt) - new Date(task.createdAt)) / DAY;
      if (days >= 0) {
        rec.completionDaysTotal += days;
        rec.completionDaysCount += 1;
      }
      if (task.due) {
        rec.dueCompletedCount += 1;
        if (new Date(task.completedAt) <= new Date(task.due)) rec.onTimeCount += 1;
      }
    }

    for (const sub of task.submissions || []) {
      const sid = sub.student ? String(sub.student) : null;
      if (!sid) continue;
      const rec = ensure(sid);
      if (sub.verdict === "approved") rec.reviewedApproved += 1;
      else if (sub.verdict === "rejected") rec.reviewedRejected += 1;
      else if (sub.verdict === "changes_requested") rec.reviewedChangesRequested += 1;
      if (sub.codeReview?.score != null) {
        rec.codeReviewScoreTotal += sub.codeReview.score;
        rec.codeReviewScoreCount += 1;
      }
    }
  }

  return perStudent;
}

/**
 * Gathers everything computeTeamPerformance needs. `persist` is forwarded
 * to analyzeGroupRisk exactly like every other AI aggregation service —
 * viewing Team Performance has the same Team Risk snapshot side effect as
 * viewing the Team Risk / Execution Copilot pages already do, never a new
 * persistence path for Team Risk itself.
 */
async function gatherTeamPerformanceEvidence(group, { persist = true } = {}) {
  const [groupEvidence, teamRisk, history] = await Promise.all([
    gatherGroupEvidence(group),
    analyzeGroupRisk(group, { persist }),
    TeamPerformanceSnapshot.find({ group: group._id }).sort("-createdAt").limit(5).lean(),
  ]);

  const memberIds = groupEvidence.members;
  const submissionEvidence = await gatherSubmissionEvidence(group._id, memberIds);
  // Names are attached only for the guide/leader-facing member cards (the
  // Detail Panel's "Member Name" — see the frontend). shapeForStudent()
  // never surfaces another student's name, only the caller's own record.
  const users = await User.find({ _id: { $in: memberIds } }).select("name").lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.name]));

  const now = new Date();
  const collaboration = {};
  for (const id of memberIds) {
    // eslint-disable-next-line no-await-in-loop -- small (group-sized), mirrors getGroupCollaborationRisks' own loop
    const stats = await gatherStudentMessageStats(group._id, id, now);
    const hasHistory = !(stats.messagesThisWeek === 0 && stats.messagesLastWeek === 0 && stats.daysSinceLastMessage === null);
    collaboration[id] = { ...scoreStudentCollaboration(stats), hasHistory };
  }

  const perStudent = {};
  for (const id of memberIds) {
    const base = groupEvidence.perStudent[id] || {};
    const submission = submissionEvidence[id] || {};
    const plagiarismFlags = (groupEvidence.originality?.flaggedSubmissions || []).filter((f) => String(f.studentId) === id);
    const earlyWarningCount = (teamRisk.earlyWarnings || []).filter(
      (w) => w.assignee && String(w.assignee.id) === id && w.level !== "ON_TRACK"
    ).length;
    const riskStatus = (teamRisk.studentRisks || []).find((s) => String(s.studentId) === id) || null;

    perStudent[id] = {
      studentId: id,
      studentName: nameById.get(id) || null,
      assigned: base.assigned || 0,
      completed: base.completed || 0,
      overdue: base.overdue || 0,
      stalled: base.stalled || 0,
      pendingSubmissionReview: base.pendingSubmissionReview || 0,
      avgCompletionDays: submission.completionDaysCount > 0 ? submission.completionDaysTotal / submission.completionDaysCount : null,
      dueCompletedCount: submission.dueCompletedCount || 0,
      onTimeCount: submission.onTimeCount || 0,
      reviewedApproved: submission.reviewedApproved || 0,
      reviewedRejected: submission.reviewedRejected || 0,
      reviewedChangesRequested: submission.reviewedChangesRequested || 0,
      avgCodeReviewScore: submission.codeReviewScoreCount > 0 ? submission.codeReviewScoreTotal / submission.codeReviewScoreCount : null,
      plagiarismFlagCount: plagiarismFlags.length,
      collaboration: collaboration[id],
      earlyWarningCount,
      riskStatus: riskStatus ? { riskLevel: riskStatus.riskLevel, riskScore: riskStatus.riskScore } : null,
    };
  }

  return {
    groupId: String(group._id),
    groupName: group.name,
    generatedAt: new Date(),
    members: memberIds,
    perStudent,
    history: history.map((h) => ({
      overallPerformanceScore: h.overallPerformanceScore,
      performanceLevel: h.performanceLevel,
      generatedAt: h.createdAt,
    })),
  };
}

/* ============================================================
 * LAYER 2 — computeTeamPerformance: pure, per-member scoring
 * ============================================================ */

/** Category A — see file docstring. */
function scoreTaskExecution(s) {
  if (!s.assigned) return null;
  return clamp(30 * (s.completed / s.assigned), 0, 30);
}

/** Category B — see file docstring. */
function scoreDeadlineReliability(s) {
  const baseline = s.dueCompletedCount > 0 ? 20 * (s.onTimeCount / s.dueCompletedCount) : 20;
  const deduction = Math.min(12, s.overdue * 4);
  return clamp(baseline - deduction, 0, 20);
}

/** Category C — see file docstring. changesRequested counts half credit. */
function scoreSubmissionQuality(s) {
  const reviewedCount = s.reviewedApproved + s.reviewedRejected + s.reviewedChangesRequested;
  if (reviewedCount === 0) return 20;
  const weighted = s.reviewedApproved * 1 + s.reviewedChangesRequested * 0.5;
  return clamp(20 * (weighted / reviewedCount), 0, 20);
}

/** Category D — see file docstring. */
function scoreCodeQuality(s) {
  if (s.avgCodeReviewScore == null) return 15;
  return clamp(15 * (s.avgCodeReviewScore / 100), 0, 15);
}

/** Category E — see file docstring. */
function scoreCollaboration(s) {
  if (!s.collaboration || !s.collaboration.hasHistory) return 15;
  return clamp(15 * (1 - s.collaboration.riskScore / 100), 0, 15);
}

/**
 * Feature 6 — evidence-based strengths only. Every threshold below traces
 * to a concrete metric already on `s`/`categories`; nothing is asserted
 * without the minimum sample size noted per rule (so one lucky data point
 * never becomes a permanent-sounding "strength").
 */
function detectStrengths(s) {
  const strengths = [];
  if (s.assigned >= 3 && s.completed / s.assigned >= 0.8) strengths.push("CONSISTENT_TASK_COMPLETION");
  if (s.dueCompletedCount >= 2 && s.onTimeCount / s.dueCompletedCount >= 0.85 && s.overdue === 0) strengths.push("DEADLINE_RELIABILITY");
  if (s.avgCodeReviewScore != null && s.avgCodeReviewScore >= 85) strengths.push("STRONG_CODE_QUALITY");
  const reviewedCount = s.reviewedApproved + s.reviewedRejected + s.reviewedChangesRequested;
  if (reviewedCount >= 2 && s.reviewedApproved / reviewedCount >= 0.85) strengths.push("HIGH_REVIEW_SUCCESS");
  if (s.collaboration?.hasHistory && s.collaboration.riskLevel === "LOW") strengths.push("GOOD_COLLABORATION");
  if (s.completed >= 1 && s.overdue === 0 && s.stalled === 0 && s.reviewedRejected === 0) strengths.push("TASK_OWNERSHIP");
  if (s.avgCompletionDays != null && s.avgCompletionDays <= 3) strengths.push("QUICK_TURNAROUND");
  return strengths;
}

/**
 * Feature 7 — neutral, evidence-based improvement areas only. Never an
 * insulting or psychological label — every entry names a workflow
 * dimension, not the person.
 */
function detectImprovementAreas(s) {
  const areas = [];
  if (s.assigned >= 3 && s.completed / s.assigned < 0.4) areas.push("TASK_COMPLETION");
  const dueRateLow = s.dueCompletedCount >= 2 && s.onTimeCount / s.dueCompletedCount < 0.5;
  if (dueRateLow || s.overdue >= 2) areas.push("DEADLINE_CONSISTENCY");
  if (s.avgCodeReviewScore != null && s.avgCodeReviewScore < 60) areas.push("CODE_QUALITY");
  const reviewedCount = s.reviewedApproved + s.reviewedRejected + s.reviewedChangesRequested;
  const reviewRateLow = reviewedCount >= 2 && s.reviewedApproved / reviewedCount < 0.5;
  if (reviewRateLow || s.reviewedRejected >= 1) areas.push("REVIEW_QUALITY");
  if (s.collaboration?.hasHistory && (s.collaboration.riskLevel === "HIGH" || s.collaboration.riskLevel === "CRITICAL")) {
    areas.push("COLLABORATION");
  }
  // Heuristic, evidence-based: repeated stalling (no update in 7+ days on
  // 2+ tasks) is treated as a sign the task's scope/estimate wasn't well
  // understood up front, not as a personality trait.
  if (s.stalled >= 2) areas.push("TASK_ESTIMATION");
  return areas;
}

/** Feature 8 — one concrete recommended action, chosen by a fixed,
 * documented priority order so the same evidence always yields the same
 * recommendation (deterministic). */
function recommendAction(areas, level, s) {
  if (areas.includes("DEADLINE_CONSISTENCY")) return "Improve deadline planning — break the task into smaller milestones with earlier checkpoints.";
  if (areas.includes("REVIEW_QUALITY")) return "Review the guide's feedback carefully and address every requested change before resubmitting.";
  if (areas.includes("CODE_QUALITY")) return "Address the repeated code-review issues before starting new work.";
  if (areas.includes("TASK_COMPLETION")) return "Consider taking a smaller task next sprint to rebuild momentum.";
  if (areas.includes("TASK_ESTIMATION")) return "Break larger tasks into smaller subtasks for steadier, trackable progress.";
  if (areas.includes("COLLABORATION")) return "Check in with the team more regularly and flag blockers early.";
  if (s.pendingSubmissionReview > 0) return "A submission is awaiting guide review — no action needed on your end yet.";
  if (level === "EXCEPTIONAL" || level === "STRONG") return "Consider taking a more challenging task next sprint.";
  return "Keep up the current pace — no specific action needed right now.";
}

/**
 * Pure, per-member scoring. `s` is one entry of evidence.perStudent.
 * QUICK_TURNAROUND uses a fixed, documented absolute threshold (<=3 days)
 * rather than a team comparison, so this function stays self-contained
 * and deterministic given only the member's own evidence.
 */
function computeMemberPerformance(s) {
  if (!s.assigned) {
    return {
      studentId: s.studentId,
      performanceScore: null,
      performanceLevel: "INSUFFICIENT_DATA",
      metrics: {
        tasksAssigned: 0,
        tasksCompleted: 0,
        completionRate: null,
        onTimeRate: null,
        overdueTasks: 0,
        avgCompletionDays: null,
        reviewSuccessRate: null,
        rejectedSubmissions: 0,
        avgCodeReviewScore: null,
        plagiarismFlagCount: s.plagiarismFlagCount || 0,
        collaborationLevel: s.collaboration?.hasHistory ? s.collaboration.riskLevel : "INSUFFICIENT_DATA",
        earlyWarningCount: s.earlyWarningCount || 0,
        riskStatus: s.riskStatus?.riskLevel || null,
      },
      strengths: [],
      improvementAreas: [],
      recommendedAction: "No tasks are currently assigned.",
    };
  }

  const categories = {
    taskExecution: scoreTaskExecution(s),
    deadlineReliability: scoreDeadlineReliability(s),
    submissionQuality: scoreSubmissionQuality(s),
    codeQuality: scoreCodeQuality(s),
    collaboration: scoreCollaboration(s),
  };
  const performanceScore = clamp(
    (categories.taskExecution || 0) + categories.deadlineReliability + categories.submissionQuality + categories.codeQuality + categories.collaboration,
    0,
    100
  );
  const performanceLevel = classifyPerformanceLevel(performanceScore);

  const strengths = detectStrengths(s);
  const improvementAreas = detectImprovementAreas(s);
  const recommendedAction = recommendAction(improvementAreas, performanceLevel, s);

  const reviewedCount = s.reviewedApproved + s.reviewedRejected + s.reviewedChangesRequested;

  return {
    studentId: s.studentId,
    performanceScore,
    performanceLevel,
    categories,
    metrics: {
      tasksAssigned: s.assigned,
      tasksCompleted: s.completed,
      completionRate: Math.round((s.completed / s.assigned) * 100),
      onTimeRate: s.dueCompletedCount > 0 ? Math.round((s.onTimeCount / s.dueCompletedCount) * 100) : null,
      overdueTasks: s.overdue,
      avgCompletionDays: s.avgCompletionDays != null ? Math.round(s.avgCompletionDays * 10) / 10 : null,
      reviewSuccessRate: reviewedCount > 0 ? Math.round((s.reviewedApproved / reviewedCount) * 100) : null,
      rejectedSubmissions: s.reviewedRejected,
      avgCodeReviewScore: s.avgCodeReviewScore != null ? Math.round(s.avgCodeReviewScore) : null,
      plagiarismFlagCount: s.plagiarismFlagCount || 0,
      collaborationLevel: s.collaboration?.hasHistory ? s.collaboration.riskLevel : "INSUFFICIENT_DATA",
      earlyWarningCount: s.earlyWarningCount || 0,
      riskStatus: s.riskStatus?.riskLevel || null,
    },
    strengths,
    improvementAreas,
    recommendedAction,
  };
}

/**
 * Layer 2 entry point. Pure, deterministic given `evidence`.
 */
function computeTeamPerformance(evidence) {
  const members = (evidence.members || []).map((id) => computeMemberPerformance(evidence.perStudent[id]));
  return {
    groupId: evidence.groupId,
    groupName: evidence.groupName,
    generatedAt: evidence.generatedAt,
    members,
  };
}

/* ============================================================
 * LAYER 3 — analyzeTeamPerformance: pure, team-level aggregation
 * ============================================================ */

/** Feature 11 — trend vs. the most recent persisted snapshot only, ±5
 * tolerance, exactly like Team Risk / Forecast / Health / Execution
 * Copilot's own trend functions. Never invents a trend without history. */
function determinePerformanceTrend(currentScore, history) {
  const previous = (history || []).find((h) => typeof h.overallPerformanceScore === "number");
  if (currentScore == null || !previous) {
    return { trend: "INSUFFICIENT_DATA", previousScore: previous?.overallPerformanceScore ?? null };
  }
  const delta = currentScore - previous.overallPerformanceScore;
  if (delta >= 5) return { trend: "IMPROVING", previousScore: previous.overallPerformanceScore };
  if (delta <= -5) return { trend: "DECLINING", previousScore: previous.overallPerformanceScore };
  return { trend: "STABLE", previousScore: previous.overallPerformanceScore };
}

const TEAM_ACTION_BY_AREA = {
  DEADLINE_CONSISTENCY: "Several members would benefit from earlier deadline check-ins — consider a mid-sprint progress review.",
  TASK_COMPLETION: "A few members have a low task-completion rate — check whether their current tasks are appropriately scoped.",
  CODE_QUALITY: "Code-review scores are trending low for multiple members — consider a short code-quality walkthrough session.",
  REVIEW_QUALITY: "Several submissions are being sent back or rejected — clarify submission requirements with the team.",
  COLLABORATION: "A few members show reduced chat activity — encourage more frequent async check-ins.",
  TASK_ESTIMATION: "Repeated task stalls suggest tasks may be larger than expected — consider breaking work into smaller units.",
};

/**
 * Layer 3 entry point. Pure, deterministic given `teamResult` (from
 * computeTeamPerformance) and `history` (already-persisted snapshots).
 */
function analyzeTeamPerformance(teamResult, history) {
  const scored = teamResult.members.filter((m) => m.performanceScore != null);

  if (!scored.length) {
    return {
      groupId: teamResult.groupId,
      groupName: teamResult.groupName,
      overallPerformanceScore: null,
      performanceLevel: "INSUFFICIENT_DATA",
      trend: "INSUFFICIENT_DATA",
      memberSummaries: teamResult.members.map((m) => ({ studentId: m.studentId, performanceScore: m.performanceScore, performanceLevel: m.performanceLevel })),
      // Full per-member detail (guide/leader view — Feature 15's member
      // cards; never sent to a student beyond their own record via
      // shapeForStudent below).
      members: teamResult.members,
      strongestContributors: [],
      membersNeedingAttention: [],
      topStrengths: [],
      topImprovementAreas: [],
      recommendedTeamActions: [],
      narrative: "Not enough completed work yet to generate team performance insights.",
      generatedAt: teamResult.generatedAt,
    };
  }

  const overallPerformanceScore = clamp(scored.reduce((sum, m) => sum + m.performanceScore, 0) / scored.length, 0, 100);
  const performanceLevel = classifyPerformanceLevel(overallPerformanceScore);
  const { trend } = determinePerformanceTrend(overallPerformanceScore, history);

  const strongestContributors = [...scored]
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, 3)
    .map((m) => ({ studentId: m.studentId, performanceScore: m.performanceScore, performanceLevel: m.performanceLevel, topStrength: m.strengths[0] || null }));

  const membersNeedingAttention = scored
    .filter((m) => m.performanceLevel === "NEEDS_IMPROVEMENT")
    .sort((a, b) => a.performanceScore - b.performanceScore)
    .slice(0, 5)
    .map((m) => ({ studentId: m.studentId, performanceScore: m.performanceScore, topImprovementArea: m.improvementAreas[0] || null }));

  const tally = (list, key) => {
    const counts = {};
    for (const m of list) for (const item of m[key]) counts[item] = (counts[item] || 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);
  };
  const topStrengths = tally(scored, "strengths");
  const topImprovementAreas = tally(scored, "improvementAreas");

  const recommendedTeamActions = topImprovementAreas.map((area) => TEAM_ACTION_BY_AREA[area]).filter(Boolean);

  const narrativeParts = [`Team performance is ${performanceLevel.replace("_", " ").toLowerCase()} at ${overallPerformanceScore}/100.`];
  if (membersNeedingAttention.length) narrativeParts.push(`${membersNeedingAttention.length} member(s) may need attention.`);
  if (topStrengths.length) narrativeParts.push(`Most common strength: ${topStrengths[0].replace(/_/g, " ").toLowerCase()}.`);

  return {
    groupId: teamResult.groupId,
    groupName: teamResult.groupName,
    overallPerformanceScore,
    performanceLevel,
    trend,
    memberSummaries: teamResult.members.map((m) => ({ studentId: m.studentId, performanceScore: m.performanceScore, performanceLevel: m.performanceLevel })),
    // Full per-member detail (guide/leader view — Feature 15's member
    // cards; never sent to a student beyond their own record via
    // shapeForStudent below).
    members: teamResult.members,
    strongestContributors,
    membersNeedingAttention,
    topStrengths,
    topImprovementAreas,
    recommendedTeamActions,
    narrative: narrativeParts.join(" "),
    generatedAt: teamResult.generatedAt,
  };
}

/* ============================================================
 * ORCHESTRATION — gather -> compute -> analyze -> persist -> notify
 * ============================================================ */

/** Feature 13 — notify only for a meaningful level change or a newly
 * appeared serious improvement need, mirroring the escalation pattern used
 * throughout Steps 15/19/20/21. Pure and exported for direct unit testing. */
function shouldNotifyPerformanceChange(result, previousSnapshot) {
  const lastNotified = previousSnapshot?.lastNotifiedLevel ?? null;
  const lastRank = lastNotified != null ? LEVEL_RANK[lastNotified] : undefined;
  const newRank = LEVEL_RANK[result.performanceLevel];
  const isEscalation = lastRank !== undefined && newRank !== undefined && newRank < lastRank && newRank <= LEVEL_RANK.ON_TRACK;
  const firstEscalation = lastNotified === null && newRank !== undefined && newRank <= LEVEL_RANK.NEEDS_IMPROVEMENT;

  const previousAttentionCount = previousSnapshot?.membersNeedingAttentionCount ?? 0;
  const newAttentionAppeared = result.membersNeedingAttention.length > 0 && previousAttentionCount === 0;

  return isEscalation || firstEscalation || newAttentionAppeared;
}

/** Removes anything about other students before a student sees the
 * response (Feature 10 — same discipline as teamRiskController.js's
 * shapeForStudent). */
function shapeForStudent(result, userId) {
  const full = result.members?.find((m) => String(m.studentId) === String(userId));
  if (!full) {
    return {
      myPerformance: {
        performanceScore: null,
        performanceLevel: "INSUFFICIENT_DATA",
        strengths: [],
        improvementAreas: [],
        recommendedAction: "No tasks are currently assigned.",
        trend: "INSUFFICIENT_DATA",
      },
    };
  }
  return {
    myPerformance: {
      performanceScore: full.performanceScore,
      performanceLevel: full.performanceLevel,
      metrics: full.metrics,
      strengths: full.strengths,
      improvementAreas: full.improvementAreas,
      recommendedAction: full.recommendedAction,
      trend: result.trend,
    },
  };
}

async function getTeamPerformance(group, { persist = true } = {}) {
  const evidence = await gatherTeamPerformanceEvidence(group, { persist });
  const teamResult = computeTeamPerformance(evidence);
  const result = analyzeTeamPerformance(teamResult, evidence.history);

  if (persist && result.performanceLevel !== "INSUFFICIENT_DATA") {
    const previous = await TeamPerformanceSnapshot.findOne({ group: group._id }).sort({ createdAt: -1 });

    const snapshot = await TeamPerformanceSnapshot.create({
      group: group._id,
      overallPerformanceScore: result.overallPerformanceScore,
      performanceLevel: result.performanceLevel,
      memberSummaries: result.memberSummaries.filter((m) => m.performanceScore != null),
      topStrengths: result.topStrengths,
      topImprovementAreas: result.topImprovementAreas,
      trend: result.trend,
      membersNeedingAttentionCount: result.membersNeedingAttention.length,
      lastNotifiedLevel: previous?.lastNotifiedLevel || null,
    });

    result.alerted = false;
    if (shouldNotifyPerformanceChange(result, previous) && group.guide) {
      const recipients = [group.guide];
      if (group.leader && String(group.leader) !== String(group.guide)) recipients.push(group.leader);
      await notifyUsers(recipients, {
        title: "Team Performance update",
        body:
          result.membersNeedingAttention.length > 0
            ? `${group.name}: ${result.membersNeedingAttention.length} member(s) may need attention. Review AI Team Performance for details.`
            : `${group.name}'s team performance is now ${result.performanceLevel.replace("_", " ")}.`,
        type: "risk",
        link: "/guide/dashboard",
        group: group._id,
      });
      snapshot.lastNotifiedLevel = result.performanceLevel;
      await snapshot.save();
      result.alerted = true;
    }
  }

  return result;
}

async function getTeamPerformanceHistory(groupId, limit = 30) {
  return TeamPerformanceSnapshot.find({ group: groupId }).sort("-createdAt").limit(limit);
}

/* ============================================================
 * SCHEDULER — isolated call alongside the existing scans
 * ============================================================ */

async function scanAllGroupsTeamPerformance() {
  const Group = require("../models/Group");
  const groups = await Group.find({ status: "active" });
  let alerted = 0;
  let scanned = 0;
  for (const group of groups) {
    try {
      // eslint-disable-next-line no-await-in-loop -- mirrors every other scanAllGroups* scheduler function
      const result = await getTeamPerformance(group, { persist: true });
      scanned += 1;
      if (result.alerted) alerted += 1;
    } catch (err) {
      console.error(`[team-performance] scan failed for group ${group._id}: ${err.message}`);
    }
  }
  return { groups: groups.length, scanned, alerted };
}

module.exports = {
  gatherTeamPerformanceEvidence,
  computeTeamPerformance,
  analyzeTeamPerformance,
  computeMemberPerformance,
  determinePerformanceTrend,
  shouldNotifyPerformanceChange,
  shapeForStudent,
  classifyPerformanceLevel,
  scoreTaskExecution,
  scoreDeadlineReliability,
  scoreSubmissionQuality,
  scoreCodeQuality,
  scoreCollaboration,
  detectStrengths,
  detectImprovementAreas,
  recommendAction,
  getTeamPerformance,
  getTeamPerformanceHistory,
  scanAllGroupsTeamPerformance,
  LEVEL_RANK,
};
