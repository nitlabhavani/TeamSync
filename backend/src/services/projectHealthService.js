/**
 * STEP 20 — AI Project Health Command Center.
 *
 * This is an AGGREGATION / ORCHESTRATION layer only. It computes NO new
 * risk score, forecast, plagiarism, or code-quality verdicts of its own —
 * every number here is read from (or a documented, deterministic
 * combination of) the outputs already produced by:
 *
 *   - services/teamRiskAnalyzer.js        (Team Risk & Early Warning — Step 15/16)
 *   - services/projectForecastService.js  (Project Completion Forecast — Step 19)
 *   - services/interventionRecommendationService.js (Recommendations — Step 19)
 *   - services/deadlineNudgeService.js    (Deadline Early Warnings — Step 16, via teamRiskAnalyzer)
 *   - services/collaborationRiskService.js (Collaboration Risk — Step 16, via teamRiskAnalyzer)
 *   - Task.submissions[].plagiarism / codeReview (Step 14 / Step 17 stored fields)
 *
 * The existing Team Risk formula (teamRiskAnalyzer.computeTeamRisk) and the
 * existing Project Forecast formula (projectForecastService.computeForecast)
 * are NEVER modified or recomputed differently here.
 *
 * Layer 1 (gatherProjectHealthEvidence) does all DB/service calls.
 * Layer 2 (computeProjectHealth) is a PURE, deterministic function of the
 * evidence bundle — no DB, no I/O — exactly like computeTeamRisk/
 * computeForecast, and it is what backend/scripts/testProjectHealth.js
 * exercises directly with hand-built evidence objects.
 */
const Task = require("../models/Task");
const ProjectHealthSnapshot = require("../models/ProjectHealthSnapshot");
const { notifyUsers } = require("./notificationService");
const { analyzeGroupRisk, gatherGroupEvidence } = require("./teamRiskAnalyzer");
const { runProjectForecast } = require("./projectForecastService");

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Dashboard health status ranks, most-to-least healthy. Used both for the
 * score->status thresholds and for the notification escalation check
 * (mirrors ProjectForecastSnapshot's STATUS_RANK pattern). */
const HEALTH_RANK = { HEALTHY: 4, STABLE: 3, NEEDS_ATTENTION: 2, AT_RISK: 1, CRITICAL: 0 };

/** teamRiskAnalyzer warning `type` -> Command Center issue bucket. Purely a
 * relabeling for display grouping; the underlying warning is untouched. */
const WARNING_TYPE_BUCKET = {
  DEADLINE_RISK: "DEADLINE",
  TASK_STALL: "DEADLINE",
  LOW_PROGRESS: "DEADLINE",
  SUBMISSION_REVIEW_BACKLOG: "SUBMISSION",
  REPEATED_CHANGES_REQUESTED: "SUBMISSION",
  REPEATED_REJECTION: "SUBMISSION",
  LOW_COLLABORATION: "COLLABORATION",
  TEAM_IDLE: "COLLABORATION",
  DUPLICATE_SUBMISSION_RISK: "ORIGINALITY",
  STUDENT_OVERLOAD: "WORKLOAD",
};

/** Deterministic priority order for issue buckets when severities tie. */
const TYPE_PRIORITY = ["DEADLINE", "SUBMISSION", "ORIGINALITY", "CODE_QUALITY", "COLLABORATION", "WORKLOAD", "FORECAST"];

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, MODERATE: 2, LOW: 1 };

/** Known, template-generated teamRiskAnalyzer.positiveSignals strings ->
 * a short display title. Falls back to a generic-but-truthful title for any
 * string that doesn't match a known pattern (never fabricates content —
 * the reason shown is always the real string produced by teamRiskAnalyzer). */
function titleForTeamRiskPositive(text) {
  if (/tasks completed with no overdue/i.test(text)) return "Task completion is on pace";
  if (/no submissions are stuck/i.test(text)) return "Submission pipeline is clear";
  if (/collaboration activity is steady/i.test(text)) return "Team collaboration is steady";
  return "Positive signal detected";
}

/* ============================================================
 * LAYER 1 — evidence gathering (DB + existing services)
 * ============================================================ */

/**
 * Counts CRITICAL-severity code review issues from each task's LATEST
 * submission only (mirrors how teamRiskAnalyzer.gatherGroupEvidence reads
 * `latest = submissions[submissions.length - 1]` for originality). Reuses
 * the codeReview.issues already stored by services/codeReviewAnalyzer.js —
 * never re-runs static analysis here.
 */
async function countCriticalCodeIssues(groupId) {
  const tasks = await Task.find({ group: groupId })
    .select("submissions.codeReview.issues")
    .lean();

  let critical = 0;
  for (const task of tasks) {
    const submissions = task.submissions || [];
    const latest = submissions[submissions.length - 1];
    const issues = latest?.codeReview?.issues || [];
    critical += issues.filter((i) => i.severity === "CRITICAL").length;
  }
  return critical;
}

/**
 * Gathers everything computeProjectHealth needs, by calling the EXISTING
 * services rather than re-deriving anything. `persist` controls whether the
 * underlying Team Risk / Forecast snapshots are written (same side effects
 * as a guide opening the AI Team Risk / AI Project Forecast pages — this
 * does not introduce a new persistence path for those two systems).
 */
async function gatherProjectHealthEvidence(group, { persist = true } = {}) {
  const [teamRisk, forecast, evidence, criticalCodeIssues, history] = await Promise.all([
    analyzeGroupRisk(group, { persist }),
    runProjectForecast(group, { persist }),
    gatherGroupEvidence(group),
    countCriticalCodeIssues(group._id),
    ProjectHealthSnapshot.find({ group: group._id }).sort("-createdAt").limit(5).lean(),
  ]);

  return {
    groupId: String(group._id),
    groupName: group.name,
    generatedAt: new Date(),
    teamRisk,
    forecast,
    originality: evidence.originality,
    submissions: evidence.submissions,
    criticalCodeIssues,
    history: history.map((h) => ({
      healthScore: h.healthScore,
      health: h.health,
      generatedAt: h.createdAt,
    })),
  };
}

/* ============================================================
 * LAYER 2 — pure aggregation (no DB, deterministic)
 * ============================================================ */

/** Feature 2 — score -> status thresholds, with a floor so a CRITICAL Team
 * Risk or CRITICAL Forecast can never be averaged away into a healthy-
 * looking dashboard tile. */
function classifyHealth(healthScore, { teamRiskLevel, forecastStatus }) {
  let status;
  if (healthScore >= 85) status = "HEALTHY";
  else if (healthScore >= 70) status = "STABLE";
  else if (healthScore >= 50) status = "NEEDS_ATTENTION";
  else if (healthScore >= 30) status = "AT_RISK";
  else status = "CRITICAL";

  const anyCritical = teamRiskLevel === "CRITICAL" || forecastStatus === "CRITICAL";
  if (anyCritical && HEALTH_RANK[status] > HEALTH_RANK.AT_RISK) {
    status = "AT_RISK";
  }
  return status;
}

/** Feature 6 — trend vs. the most recent persisted snapshot only. Never
 * invents a trend when there is no prior history (mirrors
 * determineForecastTrend/determineTrend). */
function determineHealthTrend(currentScore, history) {
  const previous = (history || []).find((h) => typeof h.healthScore === "number");
  if (currentScore == null || !previous) {
    return { trend: "INSUFFICIENT_DATA", previousScore: previous?.healthScore ?? null };
  }
  const delta = currentScore - previous.healthScore;
  if (delta >= 5) return { trend: "IMPROVING", previousScore: previous.healthScore };
  if (delta <= -5) return { trend: "WORSENING", previousScore: previous.healthScore };
  return { trend: "STABLE", previousScore: previous.healthScore };
}

/** Feature 3 — top issues, deterministic priority order: severity first,
 * then a fixed type order, then insertion order (stable sort). Every entry
 * traces back to a real warning/early-warning/count already computed
 * elsewhere; nothing is invented. */
function buildTopIssues(evidence) {
  const { teamRisk, criticalCodeIssues } = evidence;
  const candidates = [];

  // Per-task deadline early warnings (Step 16) — most specific, includes a
  // real taskId.
  for (const w of teamRisk.earlyWarnings || []) {
    if (!w || w.level === "ON_TRACK") continue;
    candidates.push({
      type: "DEADLINE",
      severity: w.severity || "MEDIUM",
      title:
        w.level === "AT_RISK"
          ? `${w.title} is at risk of missing its deadline`
          : `${w.title} deadline is approaching`,
      reason: w.reason,
      taskId: w.taskId,
    });
  }

  // Group-level Team Risk warnings (Step 15/16) — already severity-labeled.
  for (const w of teamRisk.warnings || []) {
    candidates.push({
      type: WARNING_TYPE_BUCKET[w.type] || "OTHER",
      severity: w.severity,
      title: w.title,
      reason: w.description,
    });
  }

  // Code review — Step 17, tallied only (no new analysis).
  if (criticalCodeIssues > 0) {
    candidates.push({
      type: "CODE_QUALITY",
      severity: criticalCodeIssues >= 3 ? "CRITICAL" : "HIGH",
      title: "Critical code issues detected",
      reason: `${criticalCodeIssues} critical-severity code review issue${criticalCodeIssues === 1 ? "" : "s"} in the latest submissions.`,
    });
  }

  candidates.sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (sevDiff !== 0) return sevDiff;
    const typeDiff = TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type);
    if (typeDiff !== 0) return typeDiff;
    return 0; // stable sort keeps insertion order for ties
  });

  return candidates.slice(0, 5);
}

/** Feature 5 — positive signals, only ever built from real, already-true
 * conditions. Capped at 5, deterministic order. */
function buildPositiveSignals(evidence) {
  const { teamRisk, forecast, originality } = evidence;
  const out = [];

  for (const text of teamRisk.positiveSignals || []) {
    out.push({ type: "TEAM_RISK", title: titleForTeamRiskPositive(text), reason: text });
  }

  if (forecast.status !== "INSUFFICIENT_DATA" && forecast.trend === "IMPROVING") {
    out.push({
      type: "FORECAST",
      title: "Completion forecast is improving",
      reason: forecast.trendMessage || "The forecast has improved since the previous snapshot.",
    });
  }

  if (teamRisk.riskLevel !== "INSUFFICIENT_DATA" && teamRisk.riskTrend === "IMPROVING") {
    out.push({
      type: "RISK",
      title: "Team risk is improving",
      reason: teamRisk.trendMessage || "Team risk has decreased since the previous snapshot.",
    });
  }

  const originalityFlags =
    (originality?.duplicateCount || 0) + (originality?.highSeverityCount || 0) + (originality?.possibleSeverityCount || 0);
  if (originalityFlags === 0 && forecast.totalTasks > 0) {
    out.push({
      type: "ORIGINALITY",
      title: "No originality concerns",
      reason: "No submissions are currently flagged for similarity.",
    });
  }

  if (forecast.status !== "INSUFFICIENT_DATA" && forecast.evidence?.completionRate >= 70) {
    out.push({
      type: "PROGRESS",
      title: "Task completion is high",
      reason: `${forecast.evidence.completionRate}% of tasks are complete.`,
    });
  }

  return out.slice(0, 5);
}

/**
 * Feature 1/2/3/4/5/6 — the pure aggregation. Given a fully-gathered
 * evidence bundle (see gatherProjectHealthEvidence), returns the exact
 * Command Center payload. Deterministic: the same evidence always produces
 * the same output.
 */
function computeProjectHealth(evidence) {
  const { teamRisk, forecast, originality, submissions, criticalCodeIssues, groupId, groupName, generatedAt } = evidence;

  const teamHasData = teamRisk.riskLevel !== "INSUFFICIENT_DATA";
  const forecastHasData = forecast.status !== "INSUFFICIENT_DATA";

  const summary = {
    completedTasks: forecast.completedTasks ?? 0,
    totalTasks: forecast.totalTasks ?? 0,
    overdueTasks: forecast.evidence?.overdueTasks ?? 0,
    earlyWarnings: (teamRisk.earlyWarnings || []).length,
    collaborationAlerts: (teamRisk.collaborationRisks || []).length,
    pendingReviews: forecast.evidence?.pendingReviews ?? submissions?.awaitingReview ?? 0,
    originalityAlerts:
      (originality?.duplicateCount || 0) + (originality?.highSeverityCount || 0) + (originality?.possibleSeverityCount || 0),
    criticalCodeIssues,
  };

  if (!teamHasData && !forecastHasData) {
    return {
      groupId,
      groupName,
      health: "INSUFFICIENT_DATA",
      healthScore: null,
      trend: "INSUFFICIENT_DATA",
      forecast: { probability: null, status: "INSUFFICIENT_DATA" },
      teamRisk: { level: "INSUFFICIENT_DATA", trend: "INSUFFICIENT_DATA" },
      summary,
      topIssues: [],
      positiveSignals: [],
      recommendedActions: [],
      disclaimer: "healthScore is an aggregated dashboard indicator, not a replacement for Team Risk.",
      generatedAt,
    };
  }

  // Feature 1/2 — healthScore is an AVERAGE of already-computed final
  // signals (never a re-derivation from raw evidence): the forecast
  // probability, (100 - team risk score), and the forecast's own
  // completion rate, when each is available. A small, capped deduction is
  // then applied for signals the average doesn't fully reflect (critical
  // code issues, flagged-for-review originality matches).
  const components = [];
  if (forecastHasData && typeof forecast.probability === "number") components.push(forecast.probability);
  if (teamHasData && typeof teamRisk.riskScore === "number") components.push(100 - teamRisk.riskScore);
  if (forecastHasData && typeof forecast.evidence?.completionRate === "number") components.push(forecast.evidence.completionRate);

  const base = components.length ? components.reduce((a, b) => a + b, 0) / components.length : 50;
  const codeDeduction = Math.min(15, criticalCodeIssues * 5);
  const originalityDeduction = Math.min(10, (originality?.duplicateCount || 0) * 10 + (originality?.highSeverityCount || 0) * 5);
  const healthScore = clamp(base - codeDeduction - originalityDeduction);

  const health = classifyHealth(healthScore, {
    teamRiskLevel: teamRisk.riskLevel,
    forecastStatus: forecast.status,
  });

  const { trend } = determineHealthTrend(healthScore, evidence.history);

  return {
    groupId,
    groupName,
    health,
    healthScore,
    trend,
    forecast: { probability: forecast.probability, status: forecast.status },
    teamRisk: { level: teamRisk.riskLevel, trend: teamHasData ? teamRisk.riskTrend : "INSUFFICIENT_DATA" },
    summary,
    topIssues: buildTopIssues(evidence),
    positiveSignals: buildPositiveSignals(evidence),
    // Feature 4 — reuse interventionRecommendationService's output as-is
    // (already produced inside runProjectForecast). No second engine.
    recommendedActions: (forecast.recommendations || []).slice(0, 3),
    disclaimer: "healthScore is an aggregated dashboard indicator, not a replacement for Team Risk.",
    generatedAt,
  };
}

/* ============================================================
 * LAYER 3 — orchestration: gather -> compute -> persist -> notify
 * ============================================================ */

/**
 * Feature 1-6, 12 — the single entry point the controller calls.
 * `persist=true` (guide/leader viewing the Command Center) also writes a
 * ProjectHealthSnapshot and notifies the guide when `health` crosses a
 * meaningful boundary (Feature 12), reusing notificationService exactly
 * like teamRiskAnalyzer/projectForecastService already do — no second
 * notification mechanism.
 */
async function getProjectHealth(group, { persist = true } = {}) {
  const evidence = await gatherProjectHealthEvidence(group, { persist });
  const result = computeProjectHealth(evidence);

  if (persist && result.health !== "INSUFFICIENT_DATA") {
    const previous = await ProjectHealthSnapshot.findOne({ group: group._id }).sort({ createdAt: -1 });

    const snapshot = await ProjectHealthSnapshot.create({
      group: group._id,
      healthScore: result.healthScore,
      health: result.health,
      trend: result.trend,
      forecastProbability: result.forecast.probability,
      teamRiskLevel: result.teamRisk.level,
      majorIssueTypes: result.topIssues.map((i) => i.type),
      lastNotifiedHealth: previous?.lastNotifiedHealth || null,
    });

    // Feature 12 — only notify on a genuine escalation (health got worse),
    // and never repeat for the same unresolved state, mirroring the
    // wasAlreadySevere / isEscalation patterns in teamRiskAnalyzer.js and
    // projectForecastService.js.
    result.alerted = false;
    const lastNotified = previous?.lastNotifiedHealth || null;
    const lastNotifiedRank = lastNotified != null ? HEALTH_RANK[lastNotified] : undefined;
    const newRank = HEALTH_RANK[result.health];
    const isEscalation =
      lastNotifiedRank !== undefined && newRank !== undefined && newRank < lastNotifiedRank && newRank <= HEALTH_RANK.NEEDS_ATTENTION;
    // Also cover the very first time a group crosses into NEEDS_ATTENTION+
    // when nothing has ever been notified before.
    const firstEscalation = lastNotified === null && newRank !== undefined && newRank <= HEALTH_RANK.NEEDS_ATTENTION;

    if ((isEscalation || firstEscalation) && group.guide) {
      const recipients = [group.guide];
      if (group.leader && String(group.leader) !== String(group.guide)) recipients.push(group.leader);
      await notifyUsers(recipients, {
        title: result.health === "CRITICAL" ? "Project health: CRITICAL" : `Project health changed to ${result.health.replace("_", " ")}`,
        body: `${group.name}'s overall project health is now ${result.health.replace("_", " ")} (${result.healthScore}/100). Review the AI Project Health Command Center for details.`,
        type: "risk",
        link: "/guide/dashboard",
        group: group._id,
      });
      snapshot.lastNotifiedHealth = result.health;
      await snapshot.save();
      result.alerted = true;
    }
  }

  return result;
}

async function getProjectHealthHistory(groupId, limit = 30) {
  return ProjectHealthSnapshot.find({ group: groupId }).sort("-createdAt").limit(limit);
}

module.exports = {
  gatherProjectHealthEvidence,
  computeProjectHealth,
  classifyHealth,
  determineHealthTrend,
  buildTopIssues,
  buildPositiveSignals,
  countCriticalCodeIssues,
  getProjectHealth,
  getProjectHealthHistory,
};
