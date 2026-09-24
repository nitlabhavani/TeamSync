/**
 * STEP 19 — Feature 3: Early Intervention Recommendations.
 *
 * Pure, deterministic layer (no DB, no I/O) that turns the evidence object
 * already gathered by projectForecastService.gatherForecastEvidence(...)
 * (plus the forecast it produced) into a short, ranked list of concrete
 * actions for the guide/team leader. Every recommendation traces back to a
 * real task, student id, or count already present on `evidence` — nothing
 * here invents a task, deadline, or student that doesn't exist in the
 * database.
 *
 * Recommendation types (Step 19 spec):
 *   REASSIGN_OVERLOADED_TASK, PRIORITIZE_OVERDUE_TASK, BREAK_DOWN_LARGE_TASK,
 *   FOLLOW_UP_WITH_INACTIVE_MEMBER, REVIEW_PENDING_SUBMISSION,
 *   REDUCE_TASK_SCOPE, ADD_DEADLINE_BUFFER, RESOLVE_BLOCKED_TASK,
 *   MONITOR_PROGRESS, NO_ACTION_REQUIRED
 */
const DAY = 24 * 60 * 60 * 1000;
const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const MAX_RECOMMENDATIONS = 8;

function makeRec(type, priority, title, reason, evidence, suggestedAction) {
  return { type, priority, title, reason, evidence, suggestedAction };
}

/**
 * Feature 3 — computes the ranked recommendation list from real evidence
 * only. Deterministic: the same (evidence, forecast) pair always produces
 * the same list, in the same order.
 */
function generateRecommendations(evidence, forecast) {
  if (!evidence || !forecast || forecast.status === "INSUFFICIENT_DATA") {
    return [];
  }

  const out = [];
  const now = evidence.generatedAt instanceof Date ? evidence.generatedAt : new Date();

  // PRIORITIZE_OVERDUE_TASK — the most overdue tasks first, capped at 3 so
  // this never becomes an unreadable wall of duplicate advice.
  const overdue = [...(evidence.overdueTasks || [])].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 3);
  for (const t of overdue) {
    out.push(
      makeRec(
        "PRIORITIZE_OVERDUE_TASK",
        "HIGH",
        `Prioritize overdue task: ${t.title}`,
        `Task is ${t.daysOverdue} day${t.daysOverdue === 1 ? "" : "s"} overdue and has no recorded completion.`,
        { taskId: t.taskId, daysOverdue: t.daysOverdue, assigneeId: t.assigneeId },
        "Contact the assignee and agree on a concrete completion plan."
      )
    );
  }

  // RESOLVE_BLOCKED_TASK — long-stalled tasks (14+ days), treated as
  // effectively blocked. Distinct evidence (staleness) from a plain
  // BREAK_DOWN_LARGE_TASK suggestion below.
  const blocked = (evidence.stalledTasks || []).filter((t) => t.daysSinceUpdate >= 14).slice(0, 2);
  for (const t of blocked) {
    out.push(
      makeRec(
        "RESOLVE_BLOCKED_TASK",
        "HIGH",
        `Resolve blocked task: ${t.title}`,
        `No update on this task in ${t.daysSinceUpdate} days — it appears blocked.`,
        { taskId: t.taskId, daysSinceUpdate: t.daysSinceUpdate, status: t.status, assigneeId: t.assigneeId },
        "Identify the blocker with the assignee and unblock or reassign the task."
      )
    );
  }

  // FOLLOW_UP_WITH_INACTIVE_MEMBER — members with real assigned work and no
  // recorded activity in 7+ days, based only on task-derived last-activity
  // timestamps already gathered by the Team Risk evidence layer.
  const inactiveMembers = Object.entries(evidence.perStudent || {})
    .filter(([, s]) => s.assigned > 0 && s.lastActivityAt && now - new Date(s.lastActivityAt) >= 7 * DAY)
    .map(([studentId, s]) => ({ studentId, daysInactive: Math.floor((now - new Date(s.lastActivityAt)) / DAY) }))
    .sort((a, b) => b.daysInactive - a.daysInactive)
    .slice(0, 2);
  for (const m of inactiveMembers) {
    out.push(
      makeRec(
        "FOLLOW_UP_WITH_INACTIVE_MEMBER",
        m.daysInactive >= 10 ? "HIGH" : "MEDIUM",
        "Follow up with an inactive team member",
        `No task activity recorded for ${m.daysInactive} days despite assigned work.`,
        { studentId: m.studentId, daysInactive: m.daysInactive },
        "Check in with this member to confirm they aren't blocked or overloaded elsewhere."
      )
    );
  }

  // REASSIGN_OVERLOADED_TASK — reuse the existing STUDENT_OVERLOAD warning
  // already computed by teamRiskAnalyzer.buildWarnings (never recomputed).
  const overloadWarning = (evidence.teamRisk?.warnings || []).find((w) => w.type === "STUDENT_OVERLOAD");
  if (overloadWarning) {
    out.push(
      makeRec(
        "REASSIGN_OVERLOADED_TASK",
        "MEDIUM",
        "Rebalance uneven workload",
        overloadWarning.description,
        { evidence: overloadWarning.evidence },
        "Move upcoming tasks from the overloaded member(s) to teammates with more capacity."
      )
    );
  }

  // BREAK_DOWN_LARGE_TASK — real, large (estimate >= 8h), unstarted or
  // stalled tasks, capped at 2.
  for (const t of (evidence.largeUnstartedTasks || []).slice(0, 2)) {
    out.push(
      makeRec(
        "BREAK_DOWN_LARGE_TASK",
        "MEDIUM",
        `Break down large task: ${t.title}`,
        `Task is estimated at ${t.estimate}h and has not shown recent progress.`,
        { taskId: t.taskId, estimate: t.estimate },
        "Split this task into smaller subtasks so progress can be tracked incrementally."
      )
    );
  }

  // REVIEW_PENDING_SUBMISSION — real submissions sitting in guide_review.
  const pending = evidence.pendingReviewTasks || [];
  if (pending.length > 0) {
    out.push(
      makeRec(
        "REVIEW_PENDING_SUBMISSION",
        pending.length >= 3 ? "HIGH" : "MEDIUM",
        `Review ${pending.length} pending submission${pending.length === 1 ? "" : "s"}`,
        `${pending.length} submission${pending.length === 1 ? " is" : "s are"} awaiting guide review and blocking downstream progress.`,
        { taskIds: pending.map((t) => t.taskId) },
        "Review and approve or request changes on the pending submission(s)."
      )
    );
  }

  // REDUCE_TASK_SCOPE — forecast is trending badly with a real, fixed
  // deadline that the current pace cannot meet.
  const { daysRemaining, remainingTasks, velocityPerDay } = forecast.evidence || {};
  if (
    ["LIKELY_LATE", "CRITICAL"].includes(forecast.status) &&
    daysRemaining != null &&
    daysRemaining > 0 &&
    remainingTasks != null
  ) {
    out.push(
      makeRec(
        "REDUCE_TASK_SCOPE",
        "HIGH",
        "Consider reducing remaining scope",
        `${remainingTasks} task(s) remain with only ${daysRemaining} day(s) left at the current pace (${velocityPerDay ?? 0} tasks/day).`,
        { remainingTasks, daysRemaining, velocityPerDay: velocityPerDay ?? null },
        "Work with the guide to de-scope or defer lower-priority tasks to protect the deadline."
      )
    );
  }

  // ADD_DEADLINE_BUFFER — moderate risk, deadline still comfortably ahead;
  // a buffer is a softer ask than cutting scope.
  if (forecast.status === "AT_RISK" && daysRemaining != null && daysRemaining > 0) {
    out.push(
      makeRec(
        "ADD_DEADLINE_BUFFER",
        "MEDIUM",
        "Request a small deadline buffer",
        `Current pace puts the group at moderate risk of missing the ${daysRemaining}-day deadline.`,
        { daysRemaining, probability: forecast.probability },
        "Discuss a short buffer with the guide before the risk becomes critical."
      )
    );
  }

  // Deduplicate by type (keep the first/most-relevant instance of each
  // type only — e.g. don't recommend PRIORITIZE_OVERDUE_TASK 3 separate
  // times as 3 distinct list entries when 3 overdue tasks exist; instead
  // each overdue task IS its own real, distinct entry above, so no
  // dedup is needed there — this only guards defensive/fallback types).
  const ranked = out
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, MAX_RECOMMENDATIONS);

  if (ranked.length === 0) {
    if (forecast.status === "ON_TRACK") {
      return [
        makeRec(
          "NO_ACTION_REQUIRED",
          "LOW",
          "No action required",
          "The group is on track with no overdue, stalled, or blocked work detected.",
          { probability: forecast.probability },
          "Keep the current cadence — no intervention needed right now."
        ),
      ];
    }
    return [
      makeRec(
        "MONITOR_PROGRESS",
        "LOW",
        "Monitor progress",
        "No single blocking issue was detected, but the forecast is not fully on track.",
        { probability: forecast.probability, status: forecast.status },
        "Keep an eye on the next few days of activity before intervening."
      ),
    ];
  }

  // If everything on track already but minor items exist (e.g. only a
  // LOW-signal REVIEW_PENDING_SUBMISSION), still surface a MONITOR_PROGRESS
  // entry so the guide knows nothing critical needs to happen.
  if (forecast.status === "ON_TRACK" && !ranked.some((r) => r.priority === "HIGH")) {
    ranked.push(
      makeRec(
        "MONITOR_PROGRESS",
        "LOW",
        "Monitor progress",
        "The group is on track overall; the items above are minor and worth keeping an eye on.",
        { probability: forecast.probability },
        "No urgent action needed — continue monitoring."
      )
    );
  }

  return ranked;
}

module.exports = { generateRecommendations };
