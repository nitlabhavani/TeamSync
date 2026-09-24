import { api, normalize } from "../lib/apiClient";

/**
 * AI risk & deadline radar — scores now come from the backend
 * (GET /api/ai/risk-radar) and are mapped to the shape the UI renders.
 */
const toRow = (r) => ({
  groupId: r.groupId,
  name: r.groupName,
  project: r.project || "",
  risk: r.score,
  score: r.score,
  level: r.level,
  drivers: (r.drivers || []).map((d) => (typeof d === "string" ? d : `${d.label}: ${d.detail}`)),
  actions: r.recommendations || [],
  overdue: r.stats?.overdueTasks ?? 0,
  dueSoon: r.stats?.dueSoon ?? 0,
  missedMilestones: r.stats?.missedMilestones ?? 0,
  weeklyMessages: r.stats?.messagesLast7Days ?? 0,
  daysSinceMeeting: r.stats?.daysSinceMeeting ?? 0,
  progress: r.stats?.completionPct ?? 0,
  stats: r.stats || {},
});

export const getRiskRadar = async () => {
  const data = normalize(await api.get("/ai/risk-radar"));
  return (data.groups || []).map(toRow).sort((a, b) => b.risk - a.risk);
};

export const getRiskSummary = async () => {
  const data = normalize(await api.get("/ai/risk-radar"));
  return data.summary || { high: 0, medium: 0, low: 0, insufficient_data: 0 };
};

export const getGroupRisk = async (groupId) =>
  toRow(normalize(await api.get(`/groups/${groupId}/risk`)));

export const getRiskHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/risk/history`));

/** Upcoming deadlines across the user's groups. */
export const getUpcomingDeadlines = async () => normalize(await api.get("/ai/timeline"));
