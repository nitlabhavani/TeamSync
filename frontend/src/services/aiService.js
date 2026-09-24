import { api, normalize } from "../lib/apiClient";

export const getCollaborationScore = async (groupId) => {
  const group = normalize(await api.get(`/groups/${groupId}`));
  return group.collaborationScore ?? 0;
};

export const getProjectCompletion = async (groupId) => {
  const group = normalize(await api.get(`/groups/${groupId}`));
  return { progress: group.progress ?? 0 };
};

/** Risk-model based delivery prediction for one group. */
export const getPerformancePrediction = async (groupId) => {
  const risk = normalize(await api.get(`/groups/${groupId}/risk`));
  return {
    score: risk.score,
    level: risk.level,
    drivers: risk.drivers || [],
    stats: risk.stats || {},
    onTrack: risk.level === "low",
  };
};

export const getContributionRanking = async (groupId) => {
  const data = normalize(await api.get(`/groups/${groupId}/analytics`));
  return data.contribution || data.contributions || [];
};

export const getChatSummary = async (groupId) => {
  const data = await api.get(`/groups/${groupId}/messages/summary`);
  return data?.summary || data?.text || "No summary available yet.";
};

export const getRecommendations = async (groupId) => {
  const risk = normalize(await api.get(`/groups/${groupId}/risk`));
  return risk.recommendations || [];
};

/** Chat-only AI analysis: themes, alerts and generated collaboration score. */
export const getGroupInsights = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/ai/insights`));

export const getChatAlerts = async (groupId) => (await getGroupInsights(groupId)).alerts || [];

/**
 * STEP 4 — Step 3 project-performance analysis for a group.
 * GET /api/groups/:groupId/ai/project-performance
 *
 * Returns the full evidence-based engine response as-is (studentAnalysis,
 * performancePrediction, projectCompletionPrediction, chatAnalysis,
 * fileAnalysis, warnings, recommendations, dataSufficiency). No values are
 * computed or invented on the frontend — this is a thin passthrough.
 *
 * @param {string} groupId
 * @param {string} [studentId] optional — scope the engine's studentAnalysis
 *   to a single student (used for the student-facing view).
 */
export const getProjectPerformance = async (groupId, studentId) => {
  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : "";
  // api.get() already unwraps the {success, data} envelope (see apiClient.request).
  return api.get(`/groups/${groupId}/ai/project-performance${qs}`);
};

/**
 * AI Project Summary synthesizing group tasks, meetings, risk, and forecast.
 * GET /api/groups/:groupId/ai-summary
 */
export const getGroupAiSummary = async (groupId) => {
  return normalize(await api.get(`/groups/${groupId}/ai-summary`));
};

