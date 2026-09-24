/**
 * STEP 29 — AI Actionable Project Insights & Recommendation Engine.
 *
 * An ORCHESTRATION layer, not a new scoring engine. This module never
 * recomputes a risk/health/forecast/sprint score — it reads the outputs of
 * the systems that already compute those (Team Risk, Project Forecast,
 * Project Health, Execution Copilot, Sprint Planner, Conflict Detection,
 * Meeting Intelligence, Project Knowledge/Decision Memory) plus real Task
 * documents, and turns them into a short, deduplicated, ranked list of
 * "what needs attention / why / what to do / evidence" recommendation
 * cards. No external LLM/API is used or required — every rule below is
 * plain, deterministic JavaScript over already-persisted data.
 *
 * ------------------------------------------------------------------------
 * REUSE, NOT DUPLICATION (mirrors projectMemoryAssistantService.js /
 * projectExecutionCopilotService.js conventions exactly):
 *
 *   - Team Risk        -> teamRiskAnalyzer.analyzeGroupRisk(group, {persist:false})
 *   - Project Forecast  -> projectForecastService.runProjectForecast(group, {persist:false})
 *   - Project Health    -> projectHealthService.getProjectHealth(group, {persist:false})
 *   - Execution Copilot -> projectExecutionCopilotService.getExecutionCopilot(group, {persist:false})
 *   - Sprint Planner    -> latest persisted SprintPlan.riskSummary (never re-run)
 *   - Dependency graph  -> sprintPlannerService.computeBlockingCounts (reused, unchanged)
 *   - Conflicts         -> ConflictSnapshot (already-detected, read-only)
 *   - Meeting follow-up -> MeetingIntelligenceSnapshot (already-analyzed, read-only)
 *   - Decisions         -> ProjectKnowledge (already-extracted, read-only)
 *   - Tasks             -> Task (existing model; overdue/stalled/due-soon
 *                          thresholds are the SAME thresholds already used
 *                          by teamRiskAnalyzer.js / projectExecutionCopilotService.js
 *                          / interventionRecommendationService.js — 7 days
 *                          stalled, 14 days "blocked" severity, 2 days
 *                          due-soon-no-progress, review backlog > 2 — not
 *                          reinvented here, just applied.
 *
 * ------------------------------------------------------------------------
 * TWO LAYERS, exactly like every other AI module in this codebase:
 *
 *   1. gatherActionableInsightsEvidence(group, opts) — DB access only.
 *      Reads real documents; never invents a fact. Guide/team-leader gets
 *      the full evidence bundle; a plain student gets a narrow bundle
 *      (their own tasks + conflicts they're involved in) — see PRIVACY.
 *
 *   2. buildActionableInsights(evidence, opts) — pure, deterministic.
 *      No DB, no I/O. Same evidence -> same recommendation list, always.
 *      This is what backend/scripts/testActionableInsights.js exercises
 *      directly (30+ checks, no database required).
 *
 * ------------------------------------------------------------------------
 * PRIVACY / GROUP ISOLATION
 *
 * Every query is scoped by `group: group._id` (an ObjectId), never a
 * group name — two same-name groups can never see each other's insights.
 * This module never reads chat Message documents (conflicts/meeting
 * intelligence already store only message *references*, never text), so
 * private/direct chat can never leak through it. A plain student only
 * ever receives OVERDUE_TASK/BLOCKED_TASK recommendations for tasks
 * assigned to them, and OPEN_CONFLICT recommendations for conflicts that
 * involve them (via conflictDetectionService.shapeForStudent, unchanged)
 * — never guide-only team risk/forecast/health/execution/sprint/meeting/
 * knowledge data, mirroring the existing convention that Execution
 * Copilot and full Meeting Intelligence have no student-facing shape at
 * all (see projectExecutionCopilotController.js / meetingIntelligenceController.js).
 *
 * ------------------------------------------------------------------------
 * NO AUTOMATIC ACTIONS
 *
 * `automaticAction` is hardcoded `false` on every recommendation. This
 * module only ever reads existing collections — it never creates,
 * updates, or deletes a Task/Conflict/ProjectKnowledge/Meeting/SprintPlan/
 * snapshot document.
 */
const Task = require("../models/Task");
const ConflictSnapshot = require("../models/ConflictSnapshot");
const MeetingIntelligenceSnapshot = require("../models/MeetingIntelligenceSnapshot");
const ProjectKnowledge = require("../models/ProjectKnowledge");
const SprintPlan = require("../models/SprintPlan");
const { OPEN_TASK_STATUSES, DONE_STATUSES } = require("./teamRiskAnalyzer");
const { computeBlockingCounts } = require("./sprintPlannerService");
const { shapeForStudent: shapeConflictForStudent } = require("./conflictDetectionService");

const DAY = 24 * 60 * 60 * 1000;

/* ============================================================
 * CONSTANTS — categories, priority ranks, thresholds
 * ============================================================ */

const CATEGORIES = [
  "OVERDUE_TASK",
  "BLOCKED_TASK",
  "DEADLINE_RISK",
  "WORKLOAD_IMBALANCE",
  "TEAM_RISK",
  "PROJECT_FORECAST_RISK",
  "PROJECT_HEALTH_RISK",
  "REVIEW_BACKLOG",
  "COLLABORATION_RISK",
  "OPEN_CONFLICT",
  "UNRESOLVED_MEETING_ACTION",
  "UNRESOLVED_DECISION",
  "STALE_KNOWLEDGE",
  "SPRINT_RISK",
  "EXECUTION_RISK",
  "PRIORITY_MISMATCH",
  "DEPENDENCY_RISK",
];

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const CONFIDENCE_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// Section 15 — deterministic priority mapping, documented in STEP29_REPORT.md.
// Reused thresholds (not reinvented): 3-day-overdue "critical" split mirrors
// projectExecutionCopilotService.buildActionCandidates; 14-day "blocked"
// split mirrors the same file + interventionRecommendationService.js;
// review-backlog > 2 mirrors teamRiskAnalyzer.buildWarnings.
const OVERDUE_CRITICAL_DAYS = 3;
const BLOCKED_HIGH_DAYS = 14;
const STALLED_DAYS = 7;
const DUE_SOON_DAYS = 2;
const REVIEW_BACKLOG_THRESHOLD = 2;
const STALE_KNOWLEDGE_DAYS = 14;
const REVIEW_STATUSES = ["submitted", "ai_review", "guide_review"];
const MAX_PER_CATEGORY = 5;

/* ============================================================
 * LAYER 1 — evidence gathering (DB access only)
 * ============================================================ */

/**
 * Fetches every real, group-scoped source this engine is allowed to read.
 * `isGuideOrLeader=false` skips every guide-only source entirely (never
 * fetched, so it can never leak) and further scopes tasks/conflicts to the
 * caller. Nothing here computes a score — it only reads existing results.
 */
async function gatherActionableInsightsEvidence(group, { isGuideOrLeader = false, userId = null } = {}) {
  const now = new Date();
  const groupId = String(group._id);

  const taskQuery = { group: group._id };
  if (!isGuideOrLeader) taskQuery.assignee = userId;
  const tasks = await Task.find(taskQuery)
    .select("title status priority assignee due dependencies updatedAt createdAt")
    .lean();

  const conflictQuery = { group: group._id, status: { $in: ["OPEN", "ACKNOWLEDGED"] } };
  if (!isGuideOrLeader) conflictQuery.involvedUserIds = userId;
  const conflicts = await ConflictSnapshot.find(conflictQuery).sort("-lastEvidenceAt").limit(50).lean();

  const evidence = {
    now,
    groupId,
    groupName: group.name,
    isGuideOrLeader,
    userId: userId ? String(userId) : null,
    tasks,
    conflicts,
    // Guide-only sources below — left null for a plain student so
    // buildActionableInsights never has a chance to read guide-only data
    // for them (defense in depth, on top of the controller's own check).
    teamRisk: null,
    forecast: null,
    health: null,
    executionCopilot: null,
    sprintPlan: null,
    meetingIntelligence: null,
    knowledge: [],
  };

  if (!isGuideOrLeader) return evidence;

  // Lazy requires — same reason projectMemoryAssistantService/
  // projectHealthService use lazy requires for these: avoids a circular
  // dependency at module-load time between the AI orchestration modules.
  const { analyzeGroupRisk } = require("./teamRiskAnalyzer");
  const { runProjectForecast } = require("./projectForecastService");
  const { getProjectHealth } = require("./projectHealthService");
  const { getExecutionCopilot } = require("./projectExecutionCopilotService");

  try {
    evidence.teamRisk = await analyzeGroupRisk(group, { persist: false });
  } catch (err) {
    console.error(`[actionable-insights] team-risk evidence failed for group ${groupId}: ${err.message}`);
  }
  try {
    evidence.forecast = await runProjectForecast(group, { persist: false });
  } catch (err) {
    console.error(`[actionable-insights] forecast evidence failed for group ${groupId}: ${err.message}`);
  }
  try {
    evidence.health = await getProjectHealth(group, { persist: false });
  } catch (err) {
    console.error(`[actionable-insights] health evidence failed for group ${groupId}: ${err.message}`);
  }
  try {
    evidence.executionCopilot = await getExecutionCopilot(group, { persist: false });
  } catch (err) {
    console.error(`[actionable-insights] execution-copilot evidence failed for group ${groupId}: ${err.message}`);
  }

  try {
    evidence.sprintPlan = await SprintPlan.findOne({ group: group._id }).sort("-createdAt").lean();
  } catch (err) {
    console.error(`[actionable-insights] sprint-plan evidence failed for group ${groupId}: ${err.message}`);
  }
  try {
    evidence.meetingIntelligence = await MeetingIntelligenceSnapshot.findOne({ group: group._id })
      .sort("-createdAt")
      .lean();
  } catch (err) {
    console.error(`[actionable-insights] meeting-intelligence evidence failed for group ${groupId}: ${err.message}`);
  }
  try {
    evidence.knowledge = await ProjectKnowledge.find({
      group: group._id,
      status: { $in: ["ACTIVE", "CANDIDATE"] },
    })
      .sort("-lastEvidenceAt")
      .limit(200)
      .lean();
  } catch (err) {
    console.error(`[actionable-insights] project-knowledge evidence failed for group ${groupId}: ${err.message}`);
  }

  return evidence;
}

/* ============================================================
 * LAYER 2 — pure computation (no DB, deterministic)
 * ============================================================ */

function daysBetween(a, b) {
  return Math.floor(Math.abs(new Date(a) - new Date(b)) / DAY);
}

function isOpenTask(task) {
  return OPEN_TASK_STATUSES.includes(task.status);
}

function isDoneTask(task) {
  return DONE_STATUSES.includes(task.status);
}

/** Deterministic recommendation "fingerprint" (spec §16) — groupId +
 * category + sorted related-source ids. Group-level categories (no
 * specific related item) naturally collapse to one card per generation. */
function buildFingerprint(groupId, category, relatedItems) {
  const ids = (relatedItems || [])
    .map((r) => `${r.type}:${r.id}`)
    .sort()
    .join("|");
  return `${groupId}:${category}${ids ? `:${ids}` : ""}`;
}

function makeRecommendation({
  groupId,
  category,
  priority,
  title,
  recommendation,
  reason,
  evidence,
  relatedItems,
  confidence,
  actionType,
  consequenceIfIgnored = null,
  generatedAt,
}) {
  const id = buildFingerprint(groupId, category, relatedItems);
  return {
    id,
    category,
    priority,
    title,
    recommendation,
    reason,
    evidence,
    relatedItems: relatedItems || [],
    confidence,
    actionType,
    automaticAction: false,
    consequenceIfIgnored,
    generatedAt,
  };
}

/* ---------------- category builders (each returns an array) ---------------- */

function buildOverdueTaskInsights(evidence) {
  const { tasks, now, groupId } = evidence;
  const overdue = tasks
    .filter((t) => t.due && new Date(t.due) < now && isOpenTask(t))
    .map((t) => ({ ...t, daysOverdue: daysBetween(t.due, now) }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, MAX_PER_CATEGORY);

  return overdue.map((t) => {
    const priority =
      t.daysOverdue >= OVERDUE_CRITICAL_DAYS || ["high", "critical"].includes(t.priority) ? "HIGH" : "MEDIUM";
    const relatedItems = [{ type: "TASK", id: String(t._id) }];
    return makeRecommendation({
      groupId,
      category: "OVERDUE_TASK",
      priority,
      title: `Review overdue task: ${t.title}`,
      recommendation:
        "Review the task deadline and reassign or update the execution plan if the current assignee cannot complete it.",
      reason: `The task is ${t.daysOverdue} day${t.daysOverdue === 1 ? "" : "s"} overdue and remains incomplete.`,
      evidence: [
        {
          sourceType: "TASK",
          sourceId: String(t._id),
          label: t.title,
          snippet: `Due ${new Date(t.due).toISOString().slice(0, 10)}, status "${t.status}", ${t.daysOverdue} day(s) overdue.`,
        },
      ],
      relatedItems,
      confidence: "HIGH",
      actionType: "REVIEW",
      generatedAt: now,
    });
  });
}

function buildBlockedTaskInsights(evidence) {
  const { tasks, now, groupId, meetingIntelligence } = evidence;
  const stalled = tasks
    .filter((t) => isOpenTask(t) && t.updatedAt && now - new Date(t.updatedAt) >= STALLED_DAYS * DAY)
    .map((t) => ({ ...t, daysSinceUpdate: daysBetween(t.updatedAt, now) }))
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, MAX_PER_CATEGORY);

  // Real meeting-intelligence blockers that reference one of these tasks —
  // merged in as extra evidence on the SAME card (spec §16 — never a
  // second card for the same underlying task).
  const meetingBlockersByTask = new Map();
  for (const b of meetingIntelligence?.blockers || []) {
    if (b.status === "OPEN" && b.relatedTaskId) {
      meetingBlockersByTask.set(String(b.relatedTaskId), b);
    }
  }

  return stalled.map((t) => {
    const priority = t.daysSinceUpdate >= BLOCKED_HIGH_DAYS ? "HIGH" : "MEDIUM";
    const relatedItems = [{ type: "TASK", id: String(t._id) }];
    const evidenceList = [
      {
        sourceType: "TASK",
        sourceId: String(t._id),
        label: t.title,
        snippet: `No update in ${t.daysSinceUpdate} day(s), status "${t.status}".`,
      },
    ];
    const meetingBlocker = meetingBlockersByTask.get(String(t._id));
    if (meetingBlocker) {
      evidenceList.push({
        sourceType: "MEETING_INTELLIGENCE",
        sourceId: String(meetingIntelligence._id),
        label: "Meeting Intelligence blocker",
        snippet: meetingBlocker.text,
      });
    }
    return makeRecommendation({
      groupId,
      category: "BLOCKED_TASK",
      priority,
      title: `Unblock stalled task: ${t.title}`,
      recommendation: "Review the blocker and identify the next unblock action.",
      reason: `No progress update has been recorded on this task in ${t.daysSinceUpdate}+ day(s).`,
      evidence: evidenceList,
      relatedItems,
      confidence: meetingBlocker ? "HIGH" : "MEDIUM",
      actionType: "REVIEW",
      generatedAt: now,
    });
  });
}

function buildDeadlineRiskInsights(evidence) {
  const { tasks, now, groupId } = evidence;
  const dueSoon = tasks
    .filter((t) => {
      if (!t.due || isDoneTask(t)) return false;
      const daysLeft = (new Date(t.due) - now) / DAY;
      return daysLeft >= 0 && daysLeft <= DUE_SOON_DAYS && ["backlog", "todo"].includes(t.status);
    })
    .slice(0, MAX_PER_CATEGORY);

  const taskInsights = dueSoon.map((t) => {
    const relatedItems = [{ type: "TASK", id: String(t._id) }];
    return makeRecommendation({
      groupId,
      category: "DEADLINE_RISK",
      priority: "MEDIUM",
      title: `Review upcoming deadline: ${t.title}`,
      recommendation: "Review the remaining workload and current execution plan for this task.",
      reason: `This task is due within ${DUE_SOON_DAYS} day(s) and has not been started.`,
      evidence: [
        {
          sourceType: "TASK",
          sourceId: String(t._id),
          label: t.title,
          snippet: `Due ${new Date(t.due).toISOString().slice(0, 10)}, status "${t.status}".`,
        },
      ],
      relatedItems,
      confidence: "MEDIUM",
      actionType: "PRIORITIZE",
      generatedAt: now,
    });
  });

  // Group-level deadline risk — reuse forecast.status directly (no second
  // deadline-risk score). AT_RISK is intentionally softer than the
  // dedicated PROJECT_FORECAST_RISK category (which fires on LIKELY_LATE/
  // CRITICAL only), so the two never describe the same severity band.
  const groupInsights = [];
  if (evidence.forecast && evidence.forecast.status === "AT_RISK") {
    const { daysRemaining, remainingTasks } = evidence.forecast.evidence || {};
    groupInsights.push(
      makeRecommendation({
        groupId,
        category: "DEADLINE_RISK",
        priority: "MEDIUM",
        title: "Review project deadline risk",
        recommendation: "Review the remaining workload and current execution plan.",
        reason: `The project forecast is AT_RISK with ${remainingTasks ?? "an unknown number of"} task(s) remaining${
          daysRemaining != null ? ` and ${daysRemaining} day(s) left` : ""
        }.`,
        evidence: [
          {
            sourceType: "PROJECT_FORECAST",
            sourceId: `${groupId}:forecast:${evidence.forecast.generatedAt?.toISOString?.() || now.toISOString()}`,
            label: "Project Forecast",
            snippet: `Status AT_RISK, on-time probability ${evidence.forecast.probability}%.`,
          },
        ],
        relatedItems: [],
        confidence: "MEDIUM",
        actionType: "PRIORITIZE",
        generatedAt: now,
      })
    );
  }

  return [...taskInsights, ...groupInsights];
}

function buildWorkloadImbalanceInsights(evidence) {
  const { teamRisk, groupId, now } = evidence;
  const warning = (teamRisk?.warnings || []).find((w) => w.type === "STUDENT_OVERLOAD");
  if (!warning) return [];
  return [
    makeRecommendation({
      groupId,
      category: "WORKLOAD_IMBALANCE",
      priority: "MEDIUM",
      title: "Review uneven workload distribution",
      recommendation: "Review current task assignments and consider redistributing open work more evenly.",
      reason: warning.description,
      evidence: [
        {
          sourceType: "TEAM_RISK",
          sourceId: `${groupId}:team-risk:STUDENT_OVERLOAD`,
          label: "Team Risk — uneven workload distribution",
          snippet: (warning.evidence || []).join("; "),
        },
      ],
      relatedItems: [],
      confidence: "MEDIUM",
      actionType: "REASSIGN",
      generatedAt: now,
    }),
  ];
}

function buildTeamRiskInsights(evidence) {
  const { teamRisk, groupId, now } = evidence;
  if (!teamRisk || !["HIGH", "CRITICAL"].includes(teamRisk.riskLevel)) return [];
  const priority = teamRisk.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH";
  return [
    makeRecommendation({
      groupId,
      category: "TEAM_RISK",
      priority,
      title: `Review ${teamRisk.riskLevel.toLowerCase()} team risk`,
      recommendation:
        "Review the highest-impact risk signals and address the underlying overdue, blocked, review, or collaboration issues.",
      reason: teamRisk.reasons?.[0] || `Team risk score is ${teamRisk.riskScore}/100 (${teamRisk.riskLevel}).`,
      evidence: [
        {
          sourceType: "TEAM_RISK",
          sourceId: `${groupId}:team-risk:${teamRisk.riskLevel}`,
          label: "Team Risk assessment",
          snippet: `Score ${teamRisk.riskScore}/100 — ${(teamRisk.reasons || []).slice(0, 2).join("; ")}`,
        },
      ],
      relatedItems: [],
      confidence: "HIGH",
      actionType: "REVIEW",
      consequenceIfIgnored:
        "If unaddressed, unresolved overdue/blocked/collaboration issues typically compound and further increase team risk.",
      generatedAt: now,
    }),
  ];
}

function buildForecastInsights(evidence) {
  const { forecast, groupId, now } = evidence;
  if (!forecast || !["LIKELY_LATE", "CRITICAL"].includes(forecast.status)) return [];
  const priority = forecast.status === "CRITICAL" ? "CRITICAL" : "HIGH";
  return [
    makeRecommendation({
      groupId,
      category: "PROJECT_FORECAST_RISK",
      priority,
      title: `Address ${forecast.status === "CRITICAL" ? "critical" : "likely-late"} project forecast`,
      recommendation: "Review the AI Project Forecast and address the highest-priority intervention recommendations.",
      reason:
        forecast.trendMessage ||
        `On-time completion probability is ${forecast.probability}% (${forecast.status}).`,
      evidence: [
        {
          sourceType: "PROJECT_FORECAST",
          sourceId: `${groupId}:forecast:${forecast.status}`,
          label: "Project Forecast",
          snippet: `Probability ${forecast.probability}%, ${forecast.evidence?.remainingTasks ?? "?"} task(s) remaining, ${
            forecast.evidence?.daysRemaining ?? "?"
          } day(s) left.`,
        },
      ],
      relatedItems: [],
      confidence: "HIGH",
      actionType: "REVIEW",
      consequenceIfIgnored:
        forecast.status === "CRITICAL"
          ? "At the current pace, the deadline is projected to be missed."
          : "At the current pace, the deadline is at meaningful risk of being missed.",
      generatedAt: now,
    }),
  ];
}

function buildHealthInsights(evidence) {
  const { health, groupId, now } = evidence;
  if (!health || !["AT_RISK", "CRITICAL"].includes(health.health)) return [];
  const priority = health.health === "CRITICAL" ? "CRITICAL" : "HIGH";
  const topIssue = (health.topIssues || [])[0];
  return [
    makeRecommendation({
      groupId,
      category: "PROJECT_HEALTH_RISK",
      priority,
      title: `Address ${health.health === "CRITICAL" ? "critical" : "at-risk"} project health`,
      recommendation: "Review the Project Health Command Center's top issues and address them in priority order.",
      reason: topIssue?.reason || `Project health score is ${health.healthScore}/100 (${health.health}).`,
      evidence: [
        {
          sourceType: "PROJECT_HEALTH",
          sourceId: `${groupId}:health:${health.health}`,
          label: "Project Health",
          snippet: `Score ${health.healthScore}/100 — ${(health.topIssues || []).slice(0, 2).map((i) => i.title).join("; ")}`,
        },
      ],
      relatedItems: [],
      confidence: "HIGH",
      actionType: "REVIEW",
      generatedAt: now,
    }),
  ];
}

function buildReviewBacklogInsights(evidence) {
  const { tasks, groupId, now } = evidence;
  const pending = tasks.filter((t) => REVIEW_STATUSES.includes(t.status));
  if (pending.length <= REVIEW_BACKLOG_THRESHOLD) return [];
  const relatedItems = pending.slice(0, MAX_PER_CATEGORY).map((t) => ({ type: "TASK", id: String(t._id) }));
  return [
    makeRecommendation({
      groupId,
      category: "REVIEW_BACKLOG",
      priority: pending.length >= 5 ? "HIGH" : "MEDIUM",
      title: `Review ${pending.length} pending submission${pending.length === 1 ? "" : "s"}`,
      recommendation: "Review and approve or request changes on the pending submission(s).",
      reason: `${pending.length} submission(s) are awaiting review and may be blocking downstream progress.`,
      evidence: pending.slice(0, MAX_PER_CATEGORY).map((t) => ({
        sourceType: "TASK",
        sourceId: String(t._id),
        label: t.title,
        snippet: `Status "${t.status}", awaiting review.`,
      })),
      relatedItems,
      confidence: "HIGH",
      actionType: "REVIEW",
      generatedAt: now,
    }),
  ];
}

function buildCollaborationRiskInsights(evidence) {
  const { teamRisk, groupId, now } = evidence;
  const flagged = (teamRisk?.collaborationRisks || []).filter((c) => c.riskLevel !== "LOW").slice(0, 2);
  return flagged.map((c) =>
    makeRecommendation({
      groupId,
      category: "COLLABORATION_RISK",
      priority: c.riskLevel === "HIGH" ? "HIGH" : "MEDIUM",
      title: "Review a team member's collaboration signal",
      recommendation: c.recommendation || "Check in with this member to confirm they aren't blocked or overloaded.",
      reason: c.flags?.[0]?.reason || "A collaboration/communication signal was detected for this member.",
      evidence: [
        {
          sourceType: "TEAM_RISK",
          sourceId: `${groupId}:collaboration:${c.studentId}`,
          label: "Collaboration risk signal",
          snippet: c.flags?.[0]?.reason || "Collaboration signal detected.",
        },
      ],
      relatedItems: [{ type: "USER", id: String(c.studentId) }],
      confidence: "MEDIUM",
      actionType: "REVIEW",
      generatedAt: now,
    })
  );
}

const CONFLICT_TITLE_BY_TYPE = {
  TASK_OWNERSHIP: "Review the task ownership conflict and confirm the intended owner.",
  CONFLICTING_INSTRUCTIONS: "Review the conflicting instructions and confirm the current requirement.",
  DEADLINE_DISAGREEMENT: "Review the deadline disagreement and confirm the authoritative due date.",
};

function buildOpenConflictInsights(evidence) {
  const { conflicts, groupId, now, isGuideOrLeader, userId } = evidence;
  const list = isGuideOrLeader
    ? conflicts
    : conflicts.map((c) => shapeConflictForStudent(c, userId)).filter(Boolean);

  return list.slice(0, MAX_PER_CATEGORY).map((c) => {
    const id = String(c.conflictId || c._id);
    const severity = c.severity || "LOW";
    const relatedItems = [{ type: "CONFLICT", id }];
    if (c.relatedTaskId) relatedItems.push({ type: "TASK", id: String(c.relatedTaskId) });
    return makeRecommendation({
      groupId,
      category: "OPEN_CONFLICT",
      priority: severity,
      title: c.title,
      recommendation:
        CONFLICT_TITLE_BY_TYPE[c.type] || c.nextAction || "Review the open conflict and confirm the current requirement.",
      reason: c.summary,
      evidence: [
        {
          sourceType: "CONFLICT",
          sourceId: id,
          label: c.title,
          snippet: c.summary,
        },
      ],
      relatedItems,
      confidence: "HIGH",
      actionType: "CONFIRM",
      generatedAt: now,
    });
  });
}

function buildUnresolvedMeetingActionInsights(evidence) {
  const { meetingIntelligence, groupId, now } = evidence;
  if (!meetingIntelligence) return [];
  const snapshotId = String(meetingIntelligence._id);

  const unresolvedActionItems = (meetingIntelligence.actionItems || [])
    .filter((a) => a.assigneeStatus === "UNRESOLVED" || a.deadlineStatus === "UNRESOLVED")
    .slice(0, 3);

  const knownTaskIds = new Set(
    (evidence.tasks || [])
      .filter((t) => (t.updatedAt && now - new Date(t.updatedAt) >= STALLED_DAYS * DAY) || (t.due && new Date(t.due) < now))
      .map((t) => String(t._id))
  );

  const actionInsights = unresolvedActionItems
    // Skip items already covered by a real, already-flagged BLOCKED_TASK/
    // OVERDUE_TASK card for the same task (spec §16 — no duplicate cards).
    .filter((a) => !(a.relatedTaskId && knownTaskIds.has(String(a.relatedTaskId))))
    .map((a) => {
      const relatedItems = a.relatedTaskId ? [{ type: "TASK", id: String(a.relatedTaskId) }] : [];
      return makeRecommendation({
        groupId,
        category: "UNRESOLVED_MEETING_ACTION",
        priority: "MEDIUM",
        title: `Review unresolved meeting action item: ${a.title}`,
        recommendation: "Review the unresolved meeting action item and confirm ownership and a deadline.",
        reason:
          a.assigneeStatus === "UNRESOLVED"
            ? "This action item has no confirmed owner."
            : "This action item has no confirmed deadline.",
        evidence: [
          {
            sourceType: "MEETING_INTELLIGENCE",
            sourceId: snapshotId,
            label: a.title,
            snippet: a.description || a.title,
          },
        ],
        relatedItems,
        confidence: "MEDIUM",
        actionType: "CONFIRM",
        generatedAt: now,
      });
    });

  const unresolvedGeneric = (meetingIntelligence.unresolvedItems || []).slice(0, 2).map((u, i) =>
    makeRecommendation({
      groupId,
      category: "UNRESOLVED_MEETING_ACTION",
      priority: "LOW",
      title: "Review unresolved meeting item",
      recommendation: "Review the unresolved item raised in the meeting.",
      reason: u.text,
      evidence: [
        {
          sourceType: "MEETING_INTELLIGENCE",
          sourceId: snapshotId,
          label: `Unresolved item ${i + 1}`,
          snippet: u.text,
        },
      ],
      relatedItems: [],
      confidence: "LOW",
      actionType: "REVIEW",
      generatedAt: now,
    })
  );

  const openBlockersNoTask = (meetingIntelligence.blockers || [])
    .filter((b) => b.status === "OPEN" && !b.relatedTaskId)
    .slice(0, 2)
    .map((b) =>
      makeRecommendation({
        groupId,
        category: "UNRESOLVED_MEETING_ACTION",
        priority: "MEDIUM",
        title: "Review meeting blocker",
        recommendation: "Review the blocker raised in the meeting and identify the next unblock action.",
        reason: b.text,
        evidence: [
          {
            sourceType: "MEETING_INTELLIGENCE",
            sourceId: snapshotId,
            label: "Meeting blocker",
            snippet: b.text,
          },
        ],
        relatedItems: [],
        confidence: "MEDIUM",
        actionType: "REVIEW",
        generatedAt: now,
      })
    );

  return [...actionInsights, ...openBlockersNoTask, ...unresolvedGeneric];
}

function buildUnresolvedDecisionInsights(evidence) {
  const { knowledge, groupId, now } = evidence;
  const flagged = knowledge
    .filter((k) => k.type === "DECISION" && k.status === "ACTIVE" && k.potentialConflict?.flagged)
    .slice(0, 3);

  return flagged.map((k) =>
    makeRecommendation({
      groupId,
      category: "UNRESOLVED_DECISION",
      priority: "MEDIUM",
      title: `Review follow-up on decision: ${k.title}`,
      recommendation: "Review the flagged decision and confirm which version is currently authoritative.",
      reason: k.potentialConflict?.note || "This active decision has a flagged potential conflict with other stored knowledge.",
      evidence: [
        {
          sourceType: "PROJECT_KNOWLEDGE",
          sourceId: String(k._id),
          label: k.title,
          snippet: k.content?.slice(0, 200) || "",
        },
      ],
      relatedItems: [{ type: "KNOWLEDGE", id: String(k._id) }],
      confidence: "MEDIUM",
      actionType: "CONFIRM",
      generatedAt: now,
    })
  );
}

function buildStaleKnowledgeInsights(evidence) {
  const { knowledge, groupId, now } = evidence;
  const stale = knowledge
    .filter(
      (k) => k.status === "CANDIDATE" && k.lastEvidenceAt && now - new Date(k.lastEvidenceAt) >= STALE_KNOWLEDGE_DAYS * DAY
    )
    .slice(0, 3);

  return stale.map((k) =>
    makeRecommendation({
      groupId,
      category: "STALE_KNOWLEDGE",
      priority: "LOW",
      title: `Review unconfirmed knowledge: ${k.title}`,
      recommendation: "Confirm this candidate as project knowledge, or archive it if it's no longer relevant.",
      reason: `This candidate has not been confirmed or archived in ${daysBetween(k.lastEvidenceAt, now)} day(s).`,
      evidence: [
        {
          sourceType: "PROJECT_KNOWLEDGE",
          sourceId: String(k._id),
          label: k.title,
          snippet: k.content?.slice(0, 200) || "",
        },
      ],
      relatedItems: [{ type: "KNOWLEDGE", id: String(k._id) }],
      confidence: "LOW",
      actionType: "REVIEW",
      generatedAt: now,
    })
  );
}

function buildSprintRiskInsights(evidence) {
  const { sprintPlan, groupId, now } = evidence;
  const level = sprintPlan?.riskSummary?.sprintRiskLevel;
  if (!sprintPlan || !["HIGH_RISK", "CRITICAL_RISK"].includes(level)) return [];
  const priority = level === "CRITICAL_RISK" ? "CRITICAL" : "HIGH";
  return [
    makeRecommendation({
      groupId,
      category: "SPRINT_RISK",
      priority,
      title: `Review ${level === "CRITICAL_RISK" ? "critical" : "high"} sprint risk`,
      recommendation: "Review the current sprint plan and address the highest-impact risk factors before continuing.",
      reason: (sprintPlan.riskSummary.factors || [])[0] || `Sprint risk is currently ${level}.`,
      evidence: [
        {
          sourceType: "SPRINT_PLAN",
          sourceId: String(sprintPlan._id),
          label: sprintPlan.title || "Sprint Plan",
          snippet: (sprintPlan.riskSummary.factors || []).slice(0, 2).join("; "),
        },
      ],
      relatedItems: [{ type: "SPRINT_PLAN", id: String(sprintPlan._id) }],
      confidence: "HIGH",
      actionType: "REVIEW",
      generatedAt: now,
    }),
  ];
}

function buildExecutionRiskInsights(evidence) {
  const { executionCopilot, groupId, now } = evidence;
  const reassignments = (executionCopilot?.recommendedReassignments || []).slice(0, 2);
  return reassignments
    .filter((r) => r.taskId)
    .map((r) =>
      makeRecommendation({
        groupId,
        category: "EXECUTION_RISK",
        priority: "MEDIUM",
        title: `Consider reassigning: ${r.taskTitle || "task"}`,
        recommendation: r.suggestedAction || "Review this task's assignment against the team's current workload.",
        reason: r.reason || "The Execution Copilot flagged this task as a reassignment candidate.",
        evidence: [
          {
            sourceType: "TASK",
            sourceId: String(r.taskId),
            label: r.taskTitle || "Task",
            snippet: r.reason || "",
          },
        ],
        relatedItems: [{ type: "TASK", id: String(r.taskId) }],
        confidence: "MEDIUM",
        actionType: "REASSIGN",
        generatedAt: now,
      })
    );
}

function buildPriorityMismatchInsights(evidence) {
  const { tasks, now, groupId } = evidence;
  const overdueOrStalled = tasks.filter((t) => {
    if (!isOpenTask(t)) return false;
    const isOverdue = t.due && new Date(t.due) < now;
    const isStalled = t.updatedAt && now - new Date(t.updatedAt) >= STALLED_DAYS * DAY;
    return (isOverdue || isStalled) && t.priority === "low";
  });

  return overdueOrStalled.slice(0, MAX_PER_CATEGORY).map((t) => {
    const isOverdue = t.due && new Date(t.due) < now;
    return makeRecommendation({
      groupId,
      category: "PRIORITY_MISMATCH",
      priority: "MEDIUM",
      title: `Review priority of: ${t.title}`,
      recommendation: "Review the priority of this task against its current deadline/progress risk.",
      reason: `This task is marked "low" priority but is ${isOverdue ? "overdue" : "stalled with no recent progress"}.`,
      evidence: [
        {
          sourceType: "TASK",
          sourceId: String(t._id),
          label: t.title,
          snippet: `Priority "low", status "${t.status}"${isOverdue ? ", overdue" : ", stalled"}.`,
        },
      ],
      relatedItems: [{ type: "TASK", id: String(t._id) }],
      confidence: "MEDIUM",
      actionType: "REVIEW",
      generatedAt: now,
    });
  });
}

function buildDependencyRiskInsights(evidence) {
  const { tasks, groupId, now } = evidence;
  // Reuse sprintPlannerService.computeBlockingCounts verbatim (spec §10 —
  // "reuse existing Task dependency information and Sprint Planner
  // dependency analysis... do not invent dependency relationships").
  const counts = computeBlockingCounts(tasks.map((t) => ({ status: t.status, dependencies: t.dependencies || [] })));
  const byId = new Map(tasks.map((t) => [String(t._id), t]));

  const bottlenecks = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([taskId, count]) => ({ task: byId.get(taskId), blockCount: count }))
    .filter((b) => b.task && !isDoneTask(b.task))
    .sort((a, b) => b.blockCount - a.blockCount)
    .slice(0, 3);

  return bottlenecks.map((b) =>
    makeRecommendation({
      groupId,
      category: "DEPENDENCY_RISK",
      priority: "MEDIUM",
      title: `Review dependency bottleneck: ${b.task.title}`,
      recommendation: "Review this dependency and prioritize finishing it to unblock downstream tasks.",
      reason: `${b.blockCount} other open task(s) depend on this task finishing first.`,
      evidence: [
        {
          sourceType: "TASK",
          sourceId: String(b.task._id),
          label: b.task.title,
          snippet: `Blocks ${b.blockCount} downstream task(s); status "${b.task.status}".`,
        },
      ],
      relatedItems: [{ type: "TASK", id: String(b.task._id) }],
      confidence: "HIGH",
      actionType: "PRIORITIZE",
      generatedAt: now,
    })
  );
}

/* ============================================================
 * DEDUPLICATION + RANKING (spec §16/§17)
 * ============================================================ */

function deduplicate(insights) {
  const seen = new Map();
  for (const item of insights) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

// Section 17 — deterministic ranking: priority, then deadline proximity
// (soonest/most-overdue first — derived from evidence snippets already
// present, never a new date field), then category impact, then evidence
// confidence, then recency of the generating evidence. No randomness, no
// "learned" ordering.
const CATEGORY_IMPACT_RANK = {
  PROJECT_HEALTH_RISK: 0,
  PROJECT_FORECAST_RISK: 1,
  TEAM_RISK: 2,
  SPRINT_RISK: 3,
  OVERDUE_TASK: 4,
  BLOCKED_TASK: 5,
  DEPENDENCY_RISK: 6,
  OPEN_CONFLICT: 7,
  REVIEW_BACKLOG: 8,
  DEADLINE_RISK: 9,
  WORKLOAD_IMBALANCE: 10,
  EXECUTION_RISK: 11,
  COLLABORATION_RISK: 12,
  UNRESOLVED_DECISION: 13,
  UNRESOLVED_MEETING_ACTION: 14,
  PRIORITY_MISMATCH: 15,
  STALE_KNOWLEDGE: 16,
};

function deadlineProximityRank(item) {
  // Smaller is more urgent. Derived deterministically from category —
  // OVERDUE/DEADLINE_RISK/DEPENDENCY items carry a real day count inside
  // their reason text; to stay simple and fully deterministic without a
  // second parser, categories with an inherent deadline component rank
  // ahead of ones without, by category, and ties break on the fields
  // below. (No date is invented — this only orders already-built cards.)
  const DEADLINE_BEARING = ["OVERDUE_TASK", "DEADLINE_RISK", "SPRINT_RISK", "DEPENDENCY_RISK"];
  return DEADLINE_BEARING.includes(item.category) ? 0 : 1;
}

function rankInsights(insights) {
  return [...insights].sort((a, b) => {
    const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pDiff !== 0) return pDiff;

    const dDiff = deadlineProximityRank(a) - deadlineProximityRank(b);
    if (dDiff !== 0) return dDiff;

    const iDiff = (CATEGORY_IMPACT_RANK[a.category] ?? 99) - (CATEGORY_IMPACT_RANK[b.category] ?? 99);
    if (iDiff !== 0) return iDiff;

    const cDiff = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (cDiff !== 0) return cDiff;

    // Recency — newer evidence first.
    const at = new Date(a.generatedAt).getTime();
    const bt = new Date(b.generatedAt).getTime();
    return bt - at;
  });
}

/**
 * Pure aggregation — Layer 2 entry point. Given a fully-gathered evidence
 * bundle, returns the deduplicated, ranked recommendation list. Fully
 * deterministic and directly unit-testable without a database.
 */
function buildActionableInsights(evidence, { limit, priority, category } = {}) {
  const builders = evidence.isGuideOrLeader
    ? [
        buildOverdueTaskInsights,
        buildBlockedTaskInsights,
        buildDeadlineRiskInsights,
        buildWorkloadImbalanceInsights,
        buildTeamRiskInsights,
        buildForecastInsights,
        buildHealthInsights,
        buildReviewBacklogInsights,
        buildCollaborationRiskInsights,
        buildOpenConflictInsights,
        buildUnresolvedMeetingActionInsights,
        buildUnresolvedDecisionInsights,
        buildStaleKnowledgeInsights,
        buildSprintRiskInsights,
        buildExecutionRiskInsights,
        buildPriorityMismatchInsights,
        buildDependencyRiskInsights,
      ]
    : [
        // Student-safe subset only (spec §25) — their own overdue/blocked
        // tasks (tasks were already scoped to assignee=userId in Layer 1)
        // and conflicts that involve them.
        buildOverdueTaskInsights,
        buildBlockedTaskInsights,
        buildOpenConflictInsights,
      ];

  let all = builders.flatMap((fn) => fn(evidence));
  all = deduplicate(all);

  if (category) all = all.filter((r) => r.category === category);
  if (priority) all = all.filter((r) => r.priority === priority);

  const ranked = rankInsights(all);
  const limited = typeof limit === "number" && limit > 0 ? ranked.slice(0, limit) : ranked;

  const summary = {
    total: ranked.length,
    critical: ranked.filter((r) => r.priority === "CRITICAL").length,
    high: ranked.filter((r) => r.priority === "HIGH").length,
    medium: ranked.filter((r) => r.priority === "MEDIUM").length,
    low: ranked.filter((r) => r.priority === "LOW").length,
  };

  return { recommendations: limited, summary };
}

/* ============================================================
 * ORCHESTRATION — gather -> compute (read-only, never persists)
 * ============================================================ */

async function generateActionableInsights(group, { isGuideOrLeader = false, userId = null, limit, priority, category } = {}) {
  const evidence = await gatherActionableInsightsEvidence(group, { isGuideOrLeader, userId });
  const { recommendations, summary } = buildActionableInsights(evidence, { limit, priority, category });
  return {
    success: true,
    groupId: evidence.groupId,
    generatedAt: evidence.now,
    summary,
    recommendations,
  };
}

module.exports = {
  CATEGORIES,
  // Layer 1 (DB)
  gatherActionableInsightsEvidence,
  // Layer 2 (pure — directly unit-testable)
  buildActionableInsights,
  buildFingerprint,
  deduplicate,
  rankInsights,
  buildOverdueTaskInsights,
  buildBlockedTaskInsights,
  buildDeadlineRiskInsights,
  buildWorkloadImbalanceInsights,
  buildTeamRiskInsights,
  buildForecastInsights,
  buildHealthInsights,
  buildReviewBacklogInsights,
  buildCollaborationRiskInsights,
  buildOpenConflictInsights,
  buildUnresolvedMeetingActionInsights,
  buildUnresolvedDecisionInsights,
  buildStaleKnowledgeInsights,
  buildSprintRiskInsights,
  buildExecutionRiskInsights,
  buildPriorityMismatchInsights,
  buildDependencyRiskInsights,
  // Orchestration
  generateActionableInsights,
};
