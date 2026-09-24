/**
 * STEP 19 — AI Project Progress Forecast & Early Intervention System.
 *
 * This module is purely ADDITIVE. It does not replace, alter, or recompute
 * the Team Risk scoring formula in services/teamRiskAnalyzer.js — it reuses
 * that module's exported `gatherGroupEvidence` + `computeTeamRisk` functions
 * as read-only inputs (the team risk level/score/warnings feed into the
 * forecast the same way "current team risk level" is described in the
 * Step 19 spec). No task schema, notification system, or risk engine is
 * duplicated here.
 *
 * ---------------------------------------------------------------------
 * DESIGN — two layers, exactly like teamRiskAnalyzer.js:
 *
 *   1. gatherForecastEvidence(group) — DB access only. Reads real Task and
 *      Group documents (plus the existing Team Risk evidence/score) and
 *      reduces them to a plain evidence object. Never invents a number
 *      that isn't backed by a query result.
 *
 *   2. computeForecast(evidence) / determineForecastTrend(...)
 *      — pure functions. No DB, no I/O, fully deterministic: the same
 *      evidence object always produces the same result. This is what
 *      backend/scripts/testProjectForecast.js exercises directly.
 *
 * ---------------------------------------------------------------------
 * FORECAST FORMULA (transparent, rule-based — explicitly NOT a
 * statistically calibrated probability; see `disclaimer` on every result).
 *
 * probability starts at 100 and loses points for concrete, named evidence:
 *
 *   - Overdue tasks            -8 each   (cap -32)
 *   - Stalled/blocked tasks    -5 each   (cap -20)
 *   - Submission review backlog (awaiting review beyond the first)
 *                               -3 each  (cap -12)
 *   - Current Team Risk level (reused, not recomputed):
 *       LOW / INSUFFICIENT_DATA -> 0, MODERATE -> -10, HIGH -> -25,
 *       CRITICAL -> -40
 *   - Pace deficit: compares actual velocity (tasks/day, lifetime average)
 *     against the velocity required to finish the remaining tasks by the
 *     group's `expectedCompletion` date. A shortfall costs up to -30,
 *     scaled by how large the shortfall is. If the deadline has already
 *     passed with tasks still remaining, this is instead a flat -40 and
 *     the status is forced to CRITICAL regardless of the raw score.
 *   - Elapsed-time-vs-completion gap: if the group is further through its
 *     total timeline (elapsed / total duration) than it is through its
 *     tasks (completed / total), that gap costs up to -15.
 *
 * The result is clamped to [0, 100].
 *
 * THRESHOLDS:
 *   probability >= 75            -> ON_TRACK
 *   50 <= probability < 75       -> AT_RISK
 *   25 <= probability < 50       -> LIKELY_LATE
 *   probability < 25             -> CRITICAL
 *   (deadline passed, work remaining) -> CRITICAL, always
 *   (no tasks recorded at all)   -> INSUFFICIENT_DATA
 * ---------------------------------------------------------------------
 */
const Task = require("../models/Task");
const Group = require("../models/Group");
const ProjectForecastSnapshot = require("../models/ProjectForecastSnapshot");
const { notifyUsers } = require("./notificationService");
const {
  gatherGroupEvidence: gatherTeamRiskEvidence,
  computeTeamRisk,
  OPEN_TASK_STATUSES,
  DONE_STATUSES,
} = require("./teamRiskAnalyzer");

const DAY = 24 * 60 * 60 * 1000;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/* ============================================================
 * LAYER 1 — evidence gathering (DB access)
 * ============================================================ */

/**
 * Reduces real Task/Group data (plus the existing Team Risk evidence) for
 * one group into the plain evidence object consumed by computeForecast.
 * Every field here is a direct count, sum, or list drawn from an existing
 * collection — nothing is fabricated. If a metric genuinely cannot be
 * derived from the schema, it is left `null` and callers must treat that
 * as INSUFFICIENT_DATA for that specific field, never a guess.
 */
/**
 * STEP 25 — WHAT-IF SIMULATOR SUPPORT (additive, no behavior change).
 *
 * Same split as teamRiskAnalyzer.js: fetchForecastRawData does the DB reads
 * (tasks + snapshot history + the Team Risk evidence needed to score it);
 * reduceForecastEvidence is the PURE reduction, unchanged line-for-line
 * from the original gatherForecastEvidence body, just taking `raw` (and an
 * already-computed `teamRisk`/`teamRiskEvidence` pair, so a caller — i.e.
 * projectWhatIfSimulatorService — can pass in a HYPOTHETICAL team-risk
 * result instead of the real one) rather than awaiting them inline.
 * gatherForecastEvidence(group) is now a thin wrapper of the two — byte-
 * for-byte identical output for every existing caller.
 */
async function fetchForecastRawData(group) {
  const now = new Date();

  const tasks = await Task.find({ group: group._id })
    .select("title status due assignee estimate createdAt updatedAt completedAt")
    .lean();

  // Reuse the existing Team Risk evidence/score — never recomputed here.
  let teamRisk = { riskLevel: "INSUFFICIENT_DATA", riskScore: 0, warnings: [], perStudent: {} };
  let teamRiskEvidence = null;
  try {
    teamRiskEvidence = await gatherTeamRiskEvidence(group);
    teamRisk = computeTeamRisk(teamRiskEvidence);
  } catch (err) {
    console.error(`[project-forecast] team-risk evidence failed for group ${group._id}: ${err.message}`);
  }

  const history = await ProjectForecastSnapshot.find({ group: group._id })
    .sort("-createdAt")
    .limit(5)
    .lean();

  return { now, tasks, teamRisk, teamRiskEvidence, history };
}

/** PURE — no DB, no I/O. See fetchForecastRawData doc above. */
function reduceForecastEvidence(raw, group) {
  const { now, tasks, teamRisk, teamRiskEvidence, history } = raw;
  const total = tasks.length;
  const completedTasks = tasks.filter((t) => DONE_STATUSES.includes(t.status));
  const completed = completedTasks.length;
  const remaining = total - completed;
  const completionPercentage = total > 0 ? Math.round((completed / total) * 100) : null;

  const overdueTasks = [];
  const stalledTasks = [];
  const pendingReviewTasks = [];
  const largeUnstartedTasks = [];

  for (const task of tasks) {
    if (DONE_STATUSES.includes(task.status)) continue;

    const isOverdue = Boolean(task.due && new Date(task.due) < now);
    if (isOverdue) {
      overdueTasks.push({
        taskId: String(task._id),
        title: task.title,
        assigneeId: task.assignee ? String(task.assignee) : null,
        due: task.due,
        daysOverdue: Math.max(1, Math.floor((now - new Date(task.due)) / DAY)),
      });
    }

    const isStalled =
      OPEN_TASK_STATUSES.includes(task.status) &&
      task.updatedAt &&
      now - new Date(task.updatedAt) >= 7 * DAY;
    if (isStalled) {
      stalledTasks.push({
        taskId: String(task._id),
        title: task.title,
        assigneeId: task.assignee ? String(task.assignee) : null,
        status: task.status,
        daysSinceUpdate: Math.floor((now - new Date(task.updatedAt)) / DAY),
      });
    }

    if (task.status === "guide_review") {
      pendingReviewTasks.push({ taskId: String(task._id), title: task.title });
    }

    // Candidate for BREAK_DOWN_LARGE_TASK — a real `estimate` (hours) field
    // that is unusually large and has not been started or is stalled.
    if (
      typeof task.estimate === "number" &&
      task.estimate >= 8 &&
      ["backlog", "todo"].includes(task.status)
    ) {
      largeUnstartedTasks.push({ taskId: String(task._id), title: task.title, estimate: task.estimate });
    } else if (typeof task.estimate === "number" && task.estimate >= 8 && isStalled) {
      largeUnstartedTasks.push({ taskId: String(task._id), title: task.title, estimate: task.estimate });
    }
  }

  // Velocity: lifetime average tasks completed per elapsed day since the
  // group was created. Deliberately the same methodology already used by
  // reportService.js#predictCompletion, computed independently here since
  // this is a distinct evidence field feeding a distinct (rule-based)
  // forecast — not a duplicate of that endpoint.
  const createdAt = group.createdAt ? new Date(group.createdAt) : null;
  const elapsedDays = createdAt ? Math.max(1, (now - createdAt) / DAY) : null;
  const velocityPerDay = createdAt ? Number((completed / elapsedDays).toFixed(3)) : null;

  const expectedCompletion = group.expectedCompletion ? new Date(group.expectedCompletion) : null;
  const daysRemaining = expectedCompletion ? Math.ceil((expectedCompletion - now) / DAY) : null;
  const totalDurationDays =
    createdAt && expectedCompletion ? Math.max(1, (expectedCompletion - createdAt) / DAY) : null;

  return {
    groupId: String(group._id),
    groupName: group.name,
    generatedAt: now,
    tasks: {
      total,
      completed,
      remaining,
      completionPercentage,
    },
    overdueTasks,
    stalledTasks,
    pendingReviewTasks,
    largeUnstartedTasks,
    velocity: {
      completed,
      elapsedDays,
      velocityPerDay,
    },
    deadline: {
      expectedCompletion,
      daysRemaining,
      totalDurationDays,
      elapsedDays,
    },
    teamRisk: {
      level: teamRisk.riskLevel,
      score: teamRisk.riskScore,
      warnings: teamRisk.warnings || [],
    },
    // Passed through only so interventionRecommendationService can look at
    // per-student stats (assigned/completed/lastActivityAt) — never a
    // second query, and never persisted beyond this in-memory object.
    perStudent: teamRiskEvidence?.perStudent || {},
    history: history.map((h) => ({
      probability: h.probability,
      status: h.forecastStatus,
      generatedAt: h.forecastDate,
    })),
  };
}

/** Original entry point — unchanged behavior/signature for every existing
 * caller. Just DB fetch + pure reduce, composed. */
async function gatherForecastEvidence(group) {
  const raw = await fetchForecastRawData(group);
  return reduceForecastEvidence(raw, group);
}

/* ============================================================
 * LAYER 2 — pure computation (no DB, deterministic)
 * ============================================================ */

const RISK_LEVEL_DEDUCTION = { LOW: 0, INSUFFICIENT_DATA: 0, MODERATE: 10, HIGH: 25, CRITICAL: 40 };

function classifyForecastStatus(probability, deadlinePassedWithWork) {
  if (deadlinePassedWithWork) return "CRITICAL";
  if (probability >= 75) return "ON_TRACK";
  if (probability >= 50) return "AT_RISK";
  if (probability >= 25) return "LIKELY_LATE";
  return "CRITICAL";
}

/**
 * Feature 1/2 — computes the full forecast result from a gathered evidence
 * object. Pure and deterministic.
 */
function computeForecast(evidence) {
  const { tasks, deadline, velocity, overdueTasks, stalledTasks, pendingReviewTasks, teamRisk } = evidence;

  if (!tasks || tasks.total === 0) {
    return {
      probability: null,
      status: "INSUFFICIENT_DATA",
      projectedCompletionDate: null,
      disclaimer:
        "This is an AI/rule-based estimate, not a statistically calibrated probability.",
      explanation:
        "No tasks have been assigned to this group yet, so a completion forecast cannot be produced.",
      evidence: {
        completionRate: null,
        velocityPerDay: null,
        remainingTasks: null,
        daysRemaining: deadline?.daysRemaining ?? null,
        overdueTasks: 0,
        stalledTasks: 0,
        pendingReviews: 0,
        teamRisk: teamRisk?.level || "INSUFFICIENT_DATA",
      },
      generatedAt: evidence.generatedAt,
    };
  }

  const overdueCount = overdueTasks.length;
  const stalledCount = stalledTasks.length;
  const reviewCount = pendingReviewTasks.length;
  const velocityPerDay = velocity.velocityPerDay;
  const remaining = tasks.remaining;
  const daysRemaining = deadline.daysRemaining;

  const overdueDeduction = Math.min(32, overdueCount * 8);
  const stalledDeduction = Math.min(20, stalledCount * 5);
  const reviewDeduction = reviewCount > 1 ? Math.min(12, (reviewCount - 1) * 3) : 0;
  const riskDeduction = RISK_LEVEL_DEDUCTION[teamRisk.level] ?? 0;

  const deadlinePassedWithWork = daysRemaining != null && daysRemaining <= 0 && remaining > 0;

  let paceDeduction = 0;
  if (deadlinePassedWithWork) {
    paceDeduction = 40;
  } else if (daysRemaining != null && daysRemaining > 0 && velocityPerDay != null) {
    const requiredVelocity = remaining / daysRemaining;
    if (velocityPerDay < requiredVelocity && requiredVelocity > 0) {
      const deficitRatio = (requiredVelocity - velocityPerDay) / requiredVelocity;
      paceDeduction = Math.min(30, Math.round(deficitRatio * 30));
    }
  }

  let elapsedGapDeduction = 0;
  if (deadline.totalDurationDays && deadline.elapsedDays != null && tasks.completionPercentage != null) {
    const elapsedRatio = Math.min(1, deadline.elapsedDays / deadline.totalDurationDays);
    const completionRatio = tasks.completionPercentage / 100;
    const gap = elapsedRatio - completionRatio;
    if (gap > 0.15) elapsedGapDeduction = Math.min(15, Math.round(gap * 40));
  }

  const probability = clamp(
    100 - overdueDeduction - stalledDeduction - reviewDeduction - riskDeduction - paceDeduction - elapsedGapDeduction
  );
  const status = classifyForecastStatus(probability, deadlinePassedWithWork);

  const projectedCompletionDate =
    velocityPerDay && velocityPerDay > 0 && remaining > 0
      ? new Date(evidence.generatedAt.getTime() + Math.ceil(remaining / velocityPerDay) * DAY)
      : remaining === 0
      ? evidence.generatedAt
      : null;

  return {
    probability,
    status,
    projectedCompletionDate,
    disclaimer: "This is an AI/rule-based estimate, not a statistically calibrated probability.",
    evidence: {
      completionRate: tasks.completionPercentage,
      velocityPerDay,
      remainingTasks: remaining,
      daysRemaining,
      overdueTasks: overdueCount,
      stalledTasks: stalledCount,
      pendingReviews: reviewCount,
      teamRisk: teamRisk.level,
    },
    generatedAt: evidence.generatedAt,
  };
}

/** Feature 5 — trend vs the most recent persisted snapshot. Never invents a
 * trend when there is no prior history. */
function determineForecastTrend(currentProbability, history) {
  if (currentProbability == null || !history || !history.length || history[0].probability == null) {
    return {
      trend: "INSUFFICIENT_DATA",
      previousProbability: null,
      message: "Insufficient historical data to determine a trend.",
    };
  }
  const previous = history[0].probability;
  const delta = currentProbability - previous;
  if (Math.abs(delta) <= 5) {
    return { trend: "STABLE", previousProbability: previous, message: "Forecast has remained stable." };
  }
  if (delta > 0) {
    return {
      trend: "IMPROVING",
      previousProbability: previous,
      message: `On-time probability increased from ${previous}% to ${currentProbability}%.`,
    };
  }
  return {
    trend: "WORSENING",
    previousProbability: previous,
    message: `On-time probability decreased from ${previous}% to ${currentProbability}%.`,
  };
}

/* ============================================================
 * ORCHESTRATION — DB + pure computation + persistence + notify
 * ============================================================ */

const STATUS_RANK = { ON_TRACK: 0, AT_RISK: 1, LIKELY_LATE: 2, CRITICAL: 3 };

/**
 * Runs the full Step 19 forecast for one group: gathers evidence, computes
 * the forecast + trend, optionally persists a ProjectForecastSnapshot, and
 * (only on a genuine escalation — Feature 9) notifies the guide/leader.
 * Never notifies students (Feature 9 — "Do NOT spam students").
 */
async function runProjectForecast(group, { persist = true } = {}) {
  const evidence = await gatherForecastEvidence(group);
  const forecast = computeForecast(evidence);
  const { trend, previousProbability, message } = determineForecastTrend(forecast.probability, evidence.history);

  // Lazy require to avoid a circular dependency at module-load time
  // (interventionRecommendationService never imports this file back).
  const { generateRecommendations } = require("./interventionRecommendationService");
  const recommendations = generateRecommendations(evidence, forecast);

  const result = {
    groupId: evidence.groupId,
    groupName: evidence.groupName,
    ...forecast,
    completedTasks: evidence.tasks.completed,
    totalTasks: evidence.tasks.total,
    trend,
    previousProbability,
    trendMessage: message,
    recommendations,
  };

  if (persist && forecast.status !== "INSUFFICIENT_DATA") {
    const previous = await ProjectForecastSnapshot.findOne({ group: group._id }).sort({ createdAt: -1 });

    await ProjectForecastSnapshot.create({
      group: group._id,
      forecastDate: evidence.generatedAt,
      probability: forecast.probability,
      forecastStatus: forecast.status,
      projectedCompletionDate: forecast.projectedCompletionDate,
      completionPercentage: evidence.tasks.completionPercentage,
      remainingTasks: evidence.tasks.remaining,
      riskLevel: evidence.teamRisk.level,
      majorRecommendationTypes: recommendations.slice(0, 5).map((r) => r.type),
    });

    result.alerted = false;
    const prevRank = previous ? STATUS_RANK[previous.forecastStatus] : undefined;
    const newRank = STATUS_RANK[forecast.status];
    const isEscalation = prevRank != null && newRank != null && newRank > prevRank;

    if (isEscalation && group.guide) {
      const recipients = [group.guide];
      if (group.leader && String(group.leader) !== String(group.guide)) recipients.push(group.leader);
      await notifyUsers(recipients, {
        title:
          forecast.status === "CRITICAL"
            ? "Project forecast: CRITICAL"
            : `Project forecast changed to ${forecast.status.replace("_", " ")}`,
        body: `${group.name} is now ${forecast.probability}% likely to finish on time (${forecast.status.replace("_", " ")}). Review the AI Project Forecast for recommended actions.`,
        type: "risk",
        link: "/guide/dashboard",
        group: group._id,
      });
      result.alerted = true;
    }
  }

  return result;
}

async function scanAllGroupsForecast() {
  const groups = await Group.find({ status: "active" });
  let alerted = 0;
  let scanned = 0;
  for (const group of groups) {
    try {
      const result = await runProjectForecast(group, { persist: true });
      scanned += 1;
      if (result.alerted) alerted += 1;
    } catch (err) {
      console.error(`[project-forecast] scan failed for group ${group._id}: ${err.message}`);
    }
  }
  return { groups: groups.length, scanned, alerted };
}

module.exports = {
  gatherForecastEvidence,
  // STEP 25 — split halves of gatherForecastEvidence, for projectWhatIfSimulatorService.
  fetchForecastRawData,
  reduceForecastEvidence,
  computeForecast,
  determineForecastTrend,
  classifyForecastStatus,
  runProjectForecast,
  scanAllGroupsForecast,
};
