import { api, normalize, idOf } from "../lib/apiClient";

/** Backend group doc -> the shape the UI already renders. */
export const toGroup = (g) => {
  const group = normalize(g);
  return {
    ...group,
    guideId: idOf(group.guide),
    guide: group.guide,
    leaderId: idOf(group.leader),
    memberIds: (group.members || []).map(idOf).filter(Boolean),
    members: group.members || [],
    collaborationScore: group.collaborationScore ?? 0,
    progress: group.progress ?? 0,
  };
};

export const getGroups = async () => (await api.get("/groups")).map(toGroup);

export const getGroupById = async (groupId) => {
  const group = await api.get(`/groups/${groupId}`);
  if (!group) throw new Error("Group not found.");
  return toGroup(group);
};

/**
 * Create a group. Guides only — the backend rejects students with 403.
 * payload: { name, project, description, memberEmails: string[] }
 */
export const createGroup = async ({
  name,
  project,
  description = "",
  memberEmails = [],
  expectedCompletion = null,
  autoGenerateTasks = true,
}) => {
  if (!name || name.trim().length < 3) throw new Error("Team title must be at least 3 characters.");
  if (!project || !project.trim()) throw new Error("Enter the project name.");
  const emails = [
    ...new Set(memberEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)),
  ];
  const bad = emails.find((e) => !/^\S+@\S+\.\S+$/.test(e));
  if (bad) throw new Error(`"${bad}" is not a valid email address.`);

  const payload = await api.postRaw("/groups", {
    name: name.trim(),
    project: project.trim(),
    description: description.trim(),
    expectedCompletion: expectedCompletion || undefined,
    autoGenerateTasks,
    memberEmails: emails,
  });
  // The API returns { data: group, meta: { invitations, autoTasksCreated, tasks } }. Attach results
  // onto the returned group so callers can read them directly.
  const group = toGroup(payload.data);
  group.invitationResults = payload.meta?.invitations || [];
  group.autoTasksCreated = payload.meta?.autoTasksCreated || 0;
  group.autoTasks = payload.meta?.tasks || [];
  return group;
};

/** Explicitly trigger automatic AI project planning for a group. */
export const autoPlanTasks = async (groupId, payload = {}) => {
  const res = await api.postRaw(`/groups/${groupId}/ai/auto-plan-tasks`, payload);
  return res.data;
};

/** Invite more people to an existing group by email (guide only). */
export const inviteMembers = async (groupId, memberEmails = []) => {
  const emails = [
    ...new Set(memberEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)),
  ];
  if (!emails.length) throw new Error("Add at least one email address.");
  const payload = await api.postRaw(`/groups/${groupId}/invitations`, { memberEmails: emails });
  const group = toGroup(payload.data);
  group.invitationResults = payload.meta?.invitations || [];
  return group;
};

export const getInvitations = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/invitations`));

export const resendInvitation = async (groupId, invitationId) =>
  normalize(await api.post(`/groups/${groupId}/invitations/${invitationId}/resend`));

export const cancelInvitation = async (groupId, invitationId) =>
  api.del(`/groups/${groupId}/invitations/${invitationId}`);

export const deleteGroup = async (groupId) => api.del(`/groups/${groupId}`);

export const leaveGroup = async (groupId, userId) =>
  api.del(`/groups/${groupId}/members/${userId}`);

export const joinGroup = async (inviteCode) =>
  toGroup(await api.post("/groups/join", { inviteCode }));

export const updateGroup = async (groupId, payload) => {
  const res = await api.patchRaw(`/groups/${groupId}`, payload);
  const group = toGroup(res.data);
  group.autoTasksCreated = res.meta?.autoTasksCreated || 0;
  group.autoTasks = res.meta?.tasks || [];
  return group;
};

export const getGroupMembers = async (groupId) => {
  const group = await getGroupById(groupId);
  return group.members || [];
};

export const addMember = async (groupId, userId) =>
  toGroup(await api.post(`/groups/${groupId}/members`, { userId }));

export const removeMember = async (groupId, userId) =>
  api.del(`/groups/${groupId}/members/${userId}`);

export const searchUsers = async (query) => {
  const q = (query || "").trim();
  if (!q) return [];
  return normalize(await api.get(`/users?q=${encodeURIComponent(q)}`));
};

export const getUser = async (userId) => normalize(await api.get(`/users/${userId}`));

export const getMilestones = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/milestones`));

export const createMilestone = async (groupId, payload) =>
  normalize(await api.post(`/groups/${groupId}/milestones`, payload));

export const updateMilestone = async (groupId, milestoneId, payload) =>
  normalize(await api.patch(`/groups/${groupId}/milestones/${milestoneId}`, payload));

export const deleteMilestone = async (groupId, milestoneId) =>
  api.del(`/groups/${groupId}/milestones/${milestoneId}`);
