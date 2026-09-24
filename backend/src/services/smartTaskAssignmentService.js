/**
 * STEP 17 — Feature 1: AI Smart Task Auto-Assignment.
 *
 * Purely additive. Reuses existing evidence instead of duplicating it:
 *   - workload / completion / stalled-task counts and per-student risk come
 *     from services/teamRiskAnalyzer.js (gatherGroupEvidence + the existing
 *     AT_RISK/CRITICAL classification from Step 15/16) — nothing here
 *     re-implements risk scoring.
 *   - task titles for the similarity signal are read directly off the
 *     existing Task model.
 *
 * This module is split the same way teamRiskAnalyzer.js is split:
 *   LAYER 1 — evidence gathering (DB access)
 *   LAYER 2 — pure scoring (no DB, deterministic, unit-testable)
 *   LAYER 3 — orchestration used by the controller
 *
 * This is a RECOMMENDATION ONLY. Nothing in this file assigns a task —
 * see taskController.recommendAssignment, which never writes to the task;
 * the guide/leader still calls the existing PATCH .../tasks/:taskId to
 * actually assign someone.
 */
const Task = require("../models/Task");
const {
  gatherGroupEvidence,
  computeAllStudentRisks,
} = require("./teamRiskAnalyzer");

const WEIGHTS = {
  workload: 0.3,
  performance: 0.25,
  similarity: 0.2,
  activity: 0.15,
  risk: 0.1,
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
  "page", "app", "system", "feature", "task", "add", "create", "update",
  "implement", "build", "fix", "new",
]);

const RISK_LEVEL_SCORE = {
  ON_TRACK: 100,
  NEEDS_ATTENTION: 70,
  AT_RISK: 35,
  CRITICAL: 10,
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/* ============================================================
 * LAYER 1 — evidence gathering (DB access)
 * ============================================================ */

/**
 * Adds one thing gatherGroupEvidence() does not track — each member's
 * completed vs. currently-active task TITLES — needed for the task
 * similarity signal. Everything else (workload, completion, risk) is read
 * straight from the existing teamRiskAnalyzer evidence, never recomputed.
 */
async function gatherAssignmentEvidence(group) {
  const [evidence, tasks] = await Promise.all([
    gatherGroupEvidence(group),
    Task.find({ group: group._id }).select("title status assignee").lean(),
  ]);

  const studentRisks = computeAllStudentRisks(evidence);
  const riskByStudent = Object.fromEntries(studentRisks.map((r) => [r.studentId, r]));

  const DONE = ["done", "completed"];
  const titlesByStudent = {};
  (evidence.members || []).forEach((id) => {
    titlesByStudent[id] = { completed: [], active: [] };
  });
  tasks.forEach((t) => {
    const aid = t.assignee ? String(t.assignee) : null;
    if (!aid || !titlesByStudent[aid]) return;
    const bucket = DONE.includes(t.status) ? titlesByStudent[aid].completed : titlesByStudent[aid].active;
    bucket.push(t.title);
  });

  return { evidence, riskByStudent, titlesByStudent };
}

/* ============================================================
 * LAYER 2 — pure scoring (no DB, deterministic)
 * ============================================================ */

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    )
  );
}

/**
 * Compares the new task's title/description against a member's own past
 * task titles only (never claims a general "skill"). Returns null when
 * there is no usable evidence either way (nothing to compare, or the
 * member has no task history) — the caller must treat null as "unknown",
 * not "bad match".
 */
function scoreTaskSimilarity(taskTokens, otherTitles) {
  if (!taskTokens.length || !otherTitles.length) return null;
  let overlapTitles = 0;
  const overlapTokens = new Set();
  otherTitles.forEach((title) => {
    const common = tokenize(title).filter((w) => taskTokens.includes(w));
    if (common.length) {
      overlapTitles += 1;
      common.forEach((w) => overlapTokens.add(w));
    }
  });
  if (!overlapTitles) return { score: 0, overlapTitles: 0, overlapTokens: [] };
  return {
    score: clamp(40 + overlapTitles * 20 + overlapTokens.size * 5),
    overlapTitles,
    overlapTokens: [...overlapTokens],
  };
}

/**
 * Scores every group member as a candidate for `task`. Pure function —
 * takes already-gathered evidence, does no DB access, so it is fully
 * deterministic and unit-testable without a database.
 *
 * @param {object} context  { evidence, riskByStudent, titlesByStudent } from gatherAssignmentEvidence
 * @param {object} task     { title, description }
 * @param {Array}  members  [{ id, name }] — display info for the group's members
 */
function recommendAssignee(context, task, members) {
  const { evidence, riskByStudent, titlesByStudent } = context;

  if (!members || !members.length) {
    return {
      recommendedStudent: null,
      score: null,
      reasons: ["No group members available to recommend."],
      alternatives: [],
      breakdown: [],
    };
  }

  const taskTokens = tokenize(`${task?.title || ""} ${task?.description || ""}`);

  // Pass 1 — raw per-candidate signals (no cross-candidate comparison yet).
  const raw = members.map((m) => {
    const id = String(m.id);
    const s = evidence.perStudent?.[id] || {
      assigned: 0, completed: 0, overdue: 0, inProgress: 0, stalled: 0,
      pendingSubmissionReview: 0, changesRequested: 0, rejected: 0, lastActivityAt: null,
    };
    const risk = riskByStudent[id];
    const titles = titlesByStudent[id] || { completed: [], active: [] };

    // Workload: active/open load, weighted so overdue and pending-review
    // work count for more than plain in-progress work.
    const load = Math.max(0, s.assigned - s.completed) + s.overdue * 1.5 + s.pendingSubmissionReview * 0.5;

    const completionRatio = s.assigned > 0 ? s.completed / s.assigned : null;

    const daysSinceActivity = s.lastActivityAt
      ? (Date.now() - new Date(s.lastActivityAt).getTime()) / 86400000
      : null;

    const similarity = scoreTaskSimilarity(taskTokens, [...titles.completed, ...titles.active]);

    return { id, name: m.name, s, risk, load, completionRatio, daysSinceActivity, similarity };
  });

  const minLoad = Math.min(...raw.map((r) => r.load));

  // Pass 2 — normalize workload relative to the group, then score every category.
  const scored = raw.map((r) => {
    const workloadScore = clamp(100 - (r.load - minLoad) * 15);

    let performanceScore;
    if (r.completionRatio === null) {
      performanceScore = 50; // no history yet — neutral, not penalized
    } else {
      performanceScore = clamp(
        r.completionRatio * 100 - r.s.overdue * 10 - r.s.rejected * 10 - r.s.changesRequested * 5
      );
    }

    const similarityScore = r.similarity === null ? 50 : r.similarity.score;

    let activityScore;
    if (r.daysSinceActivity === null) activityScore = 50; // no assigned work yet — neutral
    else if (r.daysSinceActivity <= 2) activityScore = 100;
    else if (r.daysSinceActivity <= 7) activityScore = 70;
    else if (r.daysSinceActivity <= 14) activityScore = 40;
    else activityScore = 15;

    const riskLevel = r.risk?.riskLevel || "ON_TRACK";
    const riskScore = RISK_LEVEL_SCORE[riskLevel] ?? 50;

    const total = clamp(
      Math.round(
        workloadScore * WEIGHTS.workload +
          performanceScore * WEIGHTS.performance +
          similarityScore * WEIGHTS.similarity +
          activityScore * WEIGHTS.activity +
          riskScore * WEIGHTS.risk
      )
    );

    const reasons = [];
    if (r.load === minLoad) reasons.push("Lowest active workload in the group");
    if (r.completionRatio !== null && performanceScore >= 70) {
      reasons.push(`Strong completion rate (${Math.round(r.completionRatio * 100)}%) on assigned tasks`);
    }
    if (r.similarity && r.similarity.overlapTitles > 0) {
      reasons.push(
        `Task title overlaps with ${r.similarity.overlapTitles} previous task(s) this member handled` +
          (r.similarity.overlapTokens.length ? ` (${r.similarity.overlapTokens.slice(0, 3).join(", ")})` : "")
      );
    }
    if (r.daysSinceActivity !== null && r.daysSinceActivity <= 2) {
      reasons.push("Currently active in the group");
    }
    if (riskLevel === "AT_RISK" || riskLevel === "CRITICAL") {
      reasons.push(`Currently flagged ${riskLevel} — weighted down accordingly`);
    }
    if (!reasons.length) reasons.push("Balanced workload and steady progress relative to the rest of the group");

    return {
      studentId: r.id,
      name: r.name,
      score: total,
      reasons,
      breakdown: {
        workload: Math.round(workloadScore),
        performance: Math.round(performanceScore),
        similarity: Math.round(similarityScore),
        activity: Math.round(activityScore),
        risk: Math.round(riskScore),
      },
      riskLevel,
    };
  });

  // Deterministic ordering: score desc, then id asc as a stable tie-breaker.
  scored.sort((a, b) => b.score - a.score || (a.studentId < b.studentId ? -1 : 1));

  const [top, ...rest] = scored;

  return {
    recommendedStudent: { id: top.studentId, name: top.name },
    score: top.score,
    reasons: top.reasons,
    breakdown: top.breakdown,
    alternatives: rest.slice(0, 3).map((r) => ({
      studentId: r.studentId,
      name: r.name,
      score: r.score,
    })),
  };
}

/**
 * Authorization rule for the recommendation endpoint — identical to the
 * existing task-creation rule (guide or team leader of THIS group only).
 * Pulled out as a pure, unit-testable helper rather than left inline in
 * the controller. requireGroupAccess (middleware/auth.js) is what already
 * rejects cross-group / non-member requests before this ever runs.
 */
// STEP 31 — delegates to the single shared implementation in utils/authz.js
// (was a standalone copy of the same guide-or-leader check; behavior
// unchanged, see that module's header comment for why this is safe).
const { isGuideOrLeader } = require("../utils/authz");

function canRequestRecommendation({ isGuide, groupLeaderId, userId }) {
  return isGuideOrLeader({
    isGuide,
    group: { leader: groupLeaderId },
    user: { _id: userId },
  });
}

/* ============================================================
 * LAYER 3 — orchestration (used by the controller)
 * ============================================================ */

/**
 * @param {object} group           Mongoose Group doc (needs ._id and .members)
 * @param {object} task             { title, description }
 * @param {Array}  populatedMembers [{ _id, name }] — group.members already populated with names
 */
async function getRecommendation(group, task, populatedMembers) {
  const context = await gatherAssignmentEvidence(group);
  const members = (populatedMembers || []).map((u) => ({ id: String(u._id), name: u.name || "Member" }));
  return recommendAssignee(context, { title: task.title, description: task.description }, members);
}

module.exports = {
  WEIGHTS,
  tokenize,
  scoreTaskSimilarity,
  canRequestRecommendation,
  gatherAssignmentEvidence,
  recommendAssignee,
  getRecommendation,
};
