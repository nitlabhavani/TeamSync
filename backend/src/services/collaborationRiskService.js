/**
 * STEP 16 — Feature 3: Chat Sentiment / Disengagement Flag.
 *
 * Lightweight, deterministic, rule-based signal system over the EXISTING
 * Message collection (no new ML model, matching the requirement). Detects
 * two kinds of signal, using only neutral, non-clinical terminology:
 *
 *   COLLABORATION_DROP  — message activity/active-days fell off compared
 *                          with the previous period, or the member has gone
 *                          quiet for an extended stretch.
 *   COMMUNICATION_RISK  — recent messages repeatedly contain blocking/
 *                          problem language ("stuck", "blocked", "can't", …)
 *
 * This module NEVER labels or infers a mental/emotional state (no
 * "depression", "burnout", "anxiety", etc. anywhere) — only task-focused,
 * supportive language. It reuses the collaboration/communication scoring
 * *idea* already present in teamRiskAnalyzer.js's Category C (message-drop
 * detection) but computes it per-student (that file only computes it at the
 * whole-group level) and adds the negative-keyword signal, which did not
 * exist before.
 *
 * Score/threshold scale is intentionally the SAME 0–100 / LOW-MODERATE-HIGH-
 * CRITICAL scale already used by teamRiskAnalyzer.js's student risk levels,
 * so the two systems stay easy to reason about together.
 */
const Message = require("../models/Message");
const Group = require("../models/Group");
const CollaborationAlertState = require("../models/CollaborationAlertState");
const { notifyUsers } = require("./notificationService");

const DAY = 24 * 60 * 60 * 1000;

// Same family of "problem/blocker" words as chatAnalyzer.py's NEGATIVE set
// (backend/ai-engine/analyzers/chatAnalyzer.py), extended per the Step 16 spec.
const PROBLEM_KEYWORDS = [
  "can't",
  "cant",
  "cannot",
  "stuck",
  "blocked",
  "not working",
  "unable",
  "confused",
  "don't know",
  "dont know",
  "failed",
  "issue",
  "problem",
];

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

function classifyLevel(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MODERATE";
  return "LOW";
}

/**
 * Pure function: given raw per-student message stats, returns the
 * COLLABORATION_DROP / COMMUNICATION_RISK flags + overall score. No DB
 * access here — gatherStudentMessageStats() below does the DB reads.
 */
function scoreStudentCollaboration(stats) {
  const {
    messagesThisWeek,
    messagesLastWeek,
    activeDaysThisWeek,
    daysSinceLastMessage,
    problemKeywordHits,
    totalRecentMessages,
  } = stats;

  const flags = [];
  let score = 0;

  // --- Collaboration drop signals -----------------------------------
  if (messagesLastWeek >= 3 && messagesThisWeek < messagesLastWeek) {
    const dropPct = Math.round(((messagesLastWeek - messagesThisWeek) / messagesLastWeek) * 100);
    if (dropPct >= 20) {
      const pts = dropPct >= 60 ? 35 : dropPct >= 40 ? 25 : 15;
      score += pts;
      flags.push({
        type: "COLLABORATION_DROP",
        severity: dropPct >= 60 ? "HIGH" : dropPct >= 40 ? "MODERATE" : "LOW",
        reason: `Message activity dropped by ${dropPct}% compared with the previous period.`,
      });
    }
  }

  if (daysSinceLastMessage !== null) {
    if (daysSinceLastMessage >= 7) {
      score += 30;
      flags.push({
        type: "DISENGAGEMENT_RISK",
        severity: "HIGH",
        reason: `No group chat activity from this member in ${daysSinceLastMessage}+ day(s).`,
      });
    } else if (daysSinceLastMessage >= 3) {
      score += 15;
      flags.push({
        type: "DISENGAGEMENT_RISK",
        severity: "MODERATE",
        reason: `No group chat activity from this member in ${daysSinceLastMessage} day(s).`,
      });
    }
  }

  if (activeDaysThisWeek <= 1 && (messagesThisWeek > 0 || messagesLastWeek > 0)) {
    score += 10;
    flags.push({
      type: "COLLABORATION_DROP",
      severity: "LOW",
      reason: `Active on only ${activeDaysThisWeek} day(s) of chat activity this week.`,
    });
  }

  // --- Communication risk (repeated problem/blocker language) --------
  if (totalRecentMessages >= 3 && problemKeywordHits > 0) {
    const ratio = problemKeywordHits / totalRecentMessages;
    if (ratio >= 0.4) {
      score += 25;
      flags.push({
        type: "COMMUNICATION_RISK",
        severity: "HIGH",
        reason: "Recent messages contain frequent blocking/problem indicators.",
      });
    } else if (ratio >= 0.2) {
      score += 15;
      flags.push({
        type: "COMMUNICATION_RISK",
        severity: "MODERATE",
        reason: "Recent messages contain repeated blocking/problem indicators.",
      });
    }
  }

  score = clamp(score);
  const riskLevel = classifyLevel(score);

  let recommendation = "No action needed — activity looks normal.";
  if (flags.some((f) => f.type === "COMMUNICATION_RISK")) {
    recommendation = "Check in with the member and ask whether they need help with their assigned work.";
  } else if (flags.length) {
    recommendation = "Check in with the member to see if they're blocked or need support.";
  }

  return { riskScore: score, riskLevel, flags, recommendation };
}

/** DB reads only — reduces raw Message documents into the plain stats object
 * scoreStudentCollaboration() scores. Group chat only (mirrors the Python
 * chatAnalyzer.py contract: direct/private messages are never analyzed). */
async function gatherStudentMessageStats(groupId, studentId, now = new Date()) {
  const weekAgo = new Date(now - 7 * DAY);
  const twoWeeksAgo = new Date(now - 14 * DAY);

  const [thisWeekMsgs, lastWeekCount, lastMessage] = await Promise.all([
    Message.find({ group: groupId, sender: studentId, createdAt: { $gte: weekAgo } })
      .select("text createdAt")
      .lean(),
    Message.countDocuments({ group: groupId, sender: studentId, createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } }),
    Message.findOne({ group: groupId, sender: studentId }).sort("-createdAt").select("createdAt").lean(),
  ]);

  const activeDays = new Set(thisWeekMsgs.map((m) => new Date(m.createdAt).toISOString().slice(0, 10)));
  const problemKeywordHits = thisWeekMsgs.filter((m) => {
    const low = (m.text || "").toLowerCase();
    return PROBLEM_KEYWORDS.some((k) => low.includes(k));
  }).length;

  const daysSinceLastMessage = lastMessage
    ? Math.floor((now - new Date(lastMessage.createdAt)) / DAY)
    : null;

  return {
    messagesThisWeek: thisWeekMsgs.length,
    messagesLastWeek: lastWeekCount,
    activeDaysThisWeek: activeDays.size,
    daysSinceLastMessage,
    problemKeywordHits,
    totalRecentMessages: thisWeekMsgs.length,
  };
}

/** Read-only, no notifications/persistence — used by the ai-risk API/UI. */
async function getGroupCollaborationRisks(group) {
  const now = new Date();
  const memberIds = group.members || [];
  const results = [];
  for (const studentId of memberIds) {
    const stats = await gatherStudentMessageStats(group._id, studentId, now);
    // Skip members with no activity history at all in either window and no
    // prior message ever — nothing to say yet, and flagging a brand-new
    // member with zero data would be a false positive.
    if (stats.messagesThisWeek === 0 && stats.messagesLastWeek === 0 && stats.daysSinceLastMessage === null) {
      continue;
    }
    const scored = scoreStudentCollaboration(stats);
    if (scored.riskLevel === "LOW" && !scored.flags.length) continue;
    results.push({ studentId: String(studentId), ...scored });
  }
  return results;
}

const LEVEL_RANK = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Scheduler entry point — mirrors deadlineNudgeService.scanEarlyWarnings():
 * computes per-student collaboration risk for every active group, notifies
 * the guide (never other students) and the student themself (about their
 * own status only) only when the level first appears or worsens.
 */
async function scanCollaborationRisk() {
  const groups = await Group.find({ status: "active" });
  let notified = 0;

  for (const group of groups) {
    try {
      const risks = await getGroupCollaborationRisks(group);
      for (const risk of risks) {
        if (risk.riskLevel === "LOW") continue;

        const state = await CollaborationAlertState.findOneAndUpdate(
          { group: group._id, student: risk.studentId },
          {},
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const worse = LEVEL_RANK[risk.riskLevel] > LEVEL_RANK[state.lastNotifiedLevel || "LOW"];
        if (!worse) continue;

        if (group.guide) {
          await notifyUsers([group.guide], {
            title: "Collaboration alert",
            body: `A member of ${group.name} may need support — ${risk.flags[0]?.reason || "activity/communication signal detected"}.`,
            type: "risk",
            link: "/guide/team-analytics",
            group: group._id,
          });
        }
        // Student is only ever told about their OWN status, phrased
        // supportively and task-focused (never a clinical/emotional label).
        await notifyUsers([risk.studentId], {
          title: "Checking in",
          body: risk.recommendation,
          type: "risk",
          link: "/app/tasks",
          group: group._id,
        });

        state.lastNotifiedLevel = risk.riskLevel;
        state.lastNotifiedAt = new Date();
        await state.save();
        notified += 1;
      }
    } catch (err) {
      console.error(`[collaboration-risk] scan failed for group ${group._id}: ${err.message}`);
    }
  }

  return { groups: groups.length, notified };
}

module.exports = {
  scoreStudentCollaboration,
  gatherStudentMessageStats,
  getGroupCollaborationRisks,
  scanCollaborationRisk,
  PROBLEM_KEYWORDS,
};
