import { api, normalize } from "../lib/apiClient";

export const getGroupAnalytics = async (groupId, days = 14) =>
  normalize(await api.get(`/groups/${groupId}/analytics?days=${days}`));

export const getActivityData = async (groupId) => {
  const data = await getGroupAnalytics(groupId);
  return data.activity || data.activitySeries || [];
};

export const getContributionData = async (groupId) => {
  const data = await getGroupAnalytics(groupId);
  return data.contribution || data.contributions || [];
};

export const getProgressData = async (groupId) => {
  const group = normalize(await api.get(`/groups/${groupId}`));
  return { progress: group.progress ?? 0 };
};

/** Guide-level rollup across every supervised group. */
export const getTeamStats = async () => {
  try {
    const data = await api.get("/ai/guide-overview");
    return {
      totalGroups: data.groupCount ?? 0,
      studentCount: data.studentCount ?? 0,
      activeMembers: data.activeMembers ?? 0,
      inactiveMembers: data.inactiveMembers ?? 0,
      pendingInvitations: data.pendingInvitations ?? 0,
      acceptedInvitations: data.acceptedInvitations ?? 0,
      rejectedInvitations: data.rejectedInvitations ?? 0,
      avgProgress: data.avgProgress ?? 0,
      avgScore: data.avgScore ?? data.avgProgress ?? 0,
      ranking: data.ranking || [],
      topTeam: data.topTeam || null,
      leastActiveTeam: data.leastActiveTeam || null,
      atRisk: data.atRisk || [],
    };
  } catch {
    const groups = normalize(await api.get("/groups"));
    const total = groups.length || 1;
    return {
      totalGroups: groups.length,
      studentCount: 0,
      activeMembers: 0,
      inactiveMembers: 0,
      pendingInvitations: 0,
      avgScore: Math.round(groups.reduce((a, g) => a + (g.collaborationScore || 0), 0) / total),
      avgProgress: Math.round(groups.reduce((a, g) => a + (g.progress || 0), 0) / total),
      ranking: [],
      topTeam: null,
      leastActiveTeam: null,
      atRisk: [],
    };
  }
};

/** Per-student activity rollup: messages, files shared, tasks, collaboration score. */
export const getMyPerformance = async (userId = "me") => {
  const data = normalize(await api.get(`/users/${userId}/performance`));
  return {
    groups: data.groups || [],
    totals: data.totals || {},
    activity: data.activity || { messages: 0, filesShared: 0, bytesShared: 0, daily: [] },
    collaborationScore: data.collaborationScore ?? 0,
    peerScore: data.peerScore ?? 0,
    badges: data.badges || [],
  };
};

/** Weekly (7 daily points) or monthly (6 weekly points) performance trend. */
export const getPerformanceTrend = async (range = "weekly", userId = "me") => {
  const data = normalize(await api.get(`/users/${userId}/performance/trend?range=${range}`));
  return { range: data.range || range, points: data.points || [], totals: data.totals || {} };
};
