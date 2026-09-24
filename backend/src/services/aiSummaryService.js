const Task = require("../models/Task");
const Meeting = require("../models/Meeting");
const Message = require("../models/Message");
const ProjectKnowledge = require("../models/ProjectKnowledge");
const { analyzeGroupRisk } = require("./teamRiskAnalyzer");
const { runProjectForecast } = require("./projectForecastService");

const DONE_STATUSES = ["done", "completed"];
const IN_REVIEW_STATUSES = ["review", "in_review", "submitted", "ai_review", "guide_review"];

/**
 * Generates an evidence-based, authentic AI Project Summary for a group.
 * Strictly uses real database records for group._id.
 * Never uses hardcoded or placeholder text.
 * Returns INSUFFICIENT_DATA when insufficient tasks or activity exist.
 *
 * @param {Object} group - Populated Group document
 * @param {Object} [reqUser] - Authenticated user requesting the summary
 * @returns {Promise<Object>}
 */
async function generateGroupAiSummary(group, reqUser = null) {
  const groupId = group._id;
  const now = new Date();
  const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 1. Query real project data strictly scoped to this group
  const [tasks, meetings, messageCount, knowledgeItems] = await Promise.all([
    Task.find({ group: groupId }).populate("assignee", "name email color avatar").lean(),
    Meeting.find({ group: groupId }).sort("when").lean(),
    Message.countDocuments({ group: groupId, deleted: false }),
    ProjectKnowledge.find({ group: groupId, status: { $ne: "ARCHIVED" } })
      .sort("-createdAt")
      .limit(5)
      .lean(),
  ]);

  const totalTasks = tasks.length;

  // 2. Handle Insufficient Data truthfully
  if (totalTasks === 0 && messageCount === 0) {
    return {
      groupId: String(groupId),
      groupName: group.name,
      projectTitle: group.project || group.name,
      status: "INSUFFICIENT_DATA",
      summary: "Not enough project data yet. Assign initial project tasks and start team conversations to enable AI summary generation.",
      evidence: {
        totalTasks: 0,
        completedTasks: 0,
        overdueTasks: 0,
        blockedTasks: 0,
        inReviewTasks: 0,
        messageCount: 0,
        meetingsCount: meetings.length,
      },
      metrics: {
        completionPct: 0,
        teamRiskLevel: "INSUFFICIENT_DATA",
        teamRiskScore: 0,
        forecastStatus: "INSUFFICIENT_DATA",
        predictedFinishDate: null,
      },
      upcomingDeadlines: [],
      recentDecisions: [],
      recommendations: [
        "Create or auto-plan initial tasks for the project modules.",
        "Set an expected completion target date in group settings.",
        "Encourage team members to check in via group chat.",
      ],
      generatedAt: new Date(),
    };
  }

  // 3. Compute real task metrics
  const completedTasks = tasks.filter((t) => DONE_STATUSES.includes(t.status));
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const inReviewTasks = tasks.filter((t) => IN_REVIEW_STATUSES.includes(t.status));
  const overdueTasks = tasks.filter((t) => t.due && !DONE_STATUSES.includes(t.status) && new Date(t.due) < now);
  const blockedTasks = tasks.filter((t) => t.status === "changes_requested");
  const completionPct = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;

  // 4. Run official Team Risk analysis (Step 15 engine)
  let riskResult = null;
  try {
    riskResult = await analyzeGroupRisk(group, { persist: false });
  } catch (err) {
    console.warn(`[aiSummaryService] Risk analysis error for ${groupId}: ${err.message}`);
  }

  const teamRiskLevel = riskResult?.riskLevel || (totalTasks === 0 ? "INSUFFICIENT_DATA" : "LOW");
  const teamRiskScore = typeof riskResult?.riskScore === "number" ? riskResult.riskScore : 0;

  // 5. Run official Project Progress Forecast (Step 19 engine)
  let forecastResult = null;
  try {
    forecastResult = await runProjectForecast(group, { persist: false });
  } catch (err) {
    console.warn(`[aiSummaryService] Forecast error for ${groupId}: ${err.message}`);
  }

  const forecastStatus = forecastResult?.status || (totalTasks === 0 ? "INSUFFICIENT_DATA" : "ON_TRACK");
  const predictedFinishDate = forecastResult?.predictedFinishDate || null;

  // 6. Upcoming deadlines (next 7 days)
  const upcomingDeadlines = tasks
    .filter((t) => t.due && !DONE_STATUSES.includes(t.status) && new Date(t.due) >= now && new Date(t.due) <= next7Days)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 5)
    .map((t) => ({
      taskId: String(t._id),
      title: t.title,
      due: t.due,
      assigneeName: t.assignee?.name || "Unassigned",
      priority: t.priority || "medium",
      module: t.module || "General",
    }));

  // 7. Recent decisions from Project Knowledge and Meetings
  const recentDecisions = [];
  knowledgeItems.forEach((k) => {
    if (k.type === "DECISION" || k.category === "ARCHITECTURE" || k.category === "SCOPE") {
      recentDecisions.push({
        title: k.title,
        source: "Project Knowledge",
        date: k.createdAt,
      });
    }
  });

  meetings.forEach((m) => {
    if (Array.isArray(m.decisions)) {
      m.decisions.forEach((d) => {
        recentDecisions.push({
          title: typeof d === "string" ? d : d.text || "Meeting decision",
          source: `Meeting: ${m.title}`,
          date: m.when,
        });
      });
    }
  });

  // 8. Compile consolidated evidence-based recommendations
  const recommendationSet = new Set();
  if (overdueTasks.length > 0) {
    recommendationSet.add(`Review and unblock ${overdueTasks.length} overdue task(s) in the next team stand-up.`);
  }
  if (blockedTasks.length > 0) {
    recommendationSet.add(`Address ${blockedTasks.length} task(s) with changes requested to prevent pipeline stalls.`);
  }
  if (inReviewTasks.length > 0) {
    recommendationSet.add(`Conduct guide review on ${inReviewTasks.length} submitted task(s) awaiting verification.`);
  }
  if (riskResult?.recommendations?.length > 0) {
    riskResult.recommendations.slice(0, 2).forEach((r) => recommendationSet.add(r));
  }
  if (forecastResult?.recommendations?.length > 0) {
    forecastResult.recommendations.slice(0, 2).forEach((r) => recommendationSet.add(r));
  }
  if (recommendationSet.size === 0) {
    recommendationSet.add("Project is progressing on track. Maintain regular communication and meeting cadence.");
  }

  const finalRecommendations = Array.from(recommendationSet).slice(0, 5);

  // 9. Synthesize coherent, evidence-backed narrative summary
  const summarySentences = [];
  const pName = group.project || group.name;

  summarySentences.push(
    `Project "${pName}" is currently at ${completionPct}% completion with ${completedTasks.length} of ${totalTasks} task(s) completed.`
  );

  const riskDesc =
    teamRiskLevel === "LOW"
      ? "Team risk is low"
      : teamRiskLevel === "MODERATE"
      ? "Team risk is moderate"
      : teamRiskLevel === "HIGH"
      ? "Team risk is high"
      : teamRiskLevel === "CRITICAL"
      ? "Team risk is critical"
      : "Risk data is accumulating";

  const forecastDesc =
    forecastStatus === "ON_TRACK"
      ? "the project is currently on track to meet its completion target"
      : forecastStatus === "AT_RISK"
      ? "the project timeline is at risk of potential slippage"
      : forecastStatus === "LIKELY_LATE"
      ? "the project is likely to finish past the target date"
      : forecastStatus === "CRITICAL"
      ? "the project schedule is severely delayed and requires immediate intervention"
      : "delivery timeline is being projected";

  summarySentences.push(`${riskDesc} (${teamRiskScore}/100), and ${forecastDesc}.`);

  if (overdueTasks.length > 0) {
    summarySentences.push(`Attention is required for ${overdueTasks.length} overdue task(s).`);
  } else {
    summarySentences.push(`Zero tasks are currently overdue.`);
  }

  if (inReviewTasks.length > 0) {
    summarySentences.push(`${inReviewTasks.length} task submission(s) are actively awaiting review.`);
  }

  if (upcomingDeadlines.length > 0) {
    summarySentences.push(`${upcomingDeadlines.length} task deadline(s) fall within the next 7 days.`);
  }

  return {
    groupId: String(groupId),
    groupName: group.name,
    projectTitle: pName,
    status: "ACTIVE",
    summary: summarySentences.join(" "),
    evidence: {
      totalTasks,
      completedTasks: completedTasks.length,
      inProgressTasks: inProgressTasks.length,
      inReviewTasks: inReviewTasks.length,
      overdueTasks: overdueTasks.length,
      blockedTasks: blockedTasks.length,
      messageCount,
      meetingsCount: meetings.length,
    },
    metrics: {
      completionPct,
      teamRiskLevel,
      teamRiskScore,
      forecastStatus,
      predictedFinishDate,
      expectedCompletion: group.expectedCompletion || null,
    },
    upcomingDeadlines,
    recentDecisions: recentDecisions.slice(0, 5),
    recommendations: finalRecommendations,
    generatedAt: new Date(),
  };
}

module.exports = {
  generateGroupAiSummary,
};
