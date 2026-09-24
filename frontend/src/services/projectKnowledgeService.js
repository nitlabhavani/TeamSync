import { api, normalize, requestRaw } from "../lib/apiClient";

/**
 * STEP 27 — AI Project Knowledge & Decision Memory.
 * Separate from services/meetingIntelligenceService.js / conflictService.js
 * — calls only the new, additive endpoints in
 * backend/src/controllers/projectKnowledgeController.js. Only functions for
 * endpoints that actually exist are implemented here.
 */

/** Search/list knowledge for a group. Guide/team-leader see every status;
 * a student only ever sees ACTIVE/SUPERSEDED items in the student-safe
 * shape (backend-enforced — see projectKnowledgeController.list).
 * Uses requestRaw (not api.get) so pagination `meta` (total/page/limit) is
 * preserved instead of being unwrapped away. */
export const searchKnowledge = async (
  groupId,
  { q = "", type = "", status = "", page = 1, limit = 20 } = {},
) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const payload = await requestRaw(`/groups/${groupId}/knowledge${qs ? `?${qs}` : ""}`, {
    method: "GET",
  });
  return { items: normalize(payload.data || []), meta: payload.meta || {} };
};

export const getKnowledge = async (groupId, knowledgeId) =>
  normalize(await api.get(`/groups/${groupId}/knowledge/${knowledgeId}`));

/** Guide/team-leader only — scans recent group messages and persists any
 * valid candidates as CANDIDATE records (never auto-confirmed). Entirely
 * user-triggered — never called on mount/poll (spec Phase 33). */
export const extractKnowledgeFromMessages = async (groupId, { sinceDate } = {}) =>
  normalize(await api.post(`/groups/${groupId}/knowledge/extract`, sinceDate ? { sinceDate } : {}));

/** Guide/team-leader only — reuses an already-saved Step 26 Meeting
 * Intelligence analysis; never re-runs meeting analysis. */
export const extractKnowledgeFromMeetingIntelligence = async (groupId, snapshotId) =>
  normalize(await api.post(`/groups/${groupId}/knowledge/from-meeting-intelligence/${snapshotId}`));

/** Guide/team-leader only manual entry. */
export const createKnowledgeCandidate = async (groupId, { type, title, content, tags }) =>
  normalize(await api.post(`/groups/${groupId}/knowledge`, { type, title, content, tags }));

export const confirmKnowledge = async (groupId, knowledgeId) =>
  normalize(await api.post(`/groups/${groupId}/knowledge/${knowledgeId}/confirm`));

export const archiveKnowledge = async (groupId, knowledgeId) =>
  normalize(await api.post(`/groups/${groupId}/knowledge/${knowledgeId}/archive`));

export const resolveKnowledgeConflict = async (groupId, knowledgeId, supersededByKnowledgeId) =>
  normalize(
    await api.post(`/groups/${groupId}/knowledge/${knowledgeId}/mark-superseded`, {
      supersededByKnowledgeId,
    }),
  );
