import { api, normalize } from "../lib/apiClient";

/**
 * STEP 24 — AI Conflict Detection & Resolution.
 * Separate from services/sprintPlannerService.js, services/chatService.js
 * (if any), etc. — calls only its own new, additive endpoints (see
 * backend/src/controllers/conflictController.js). Analysis itself runs
 * fire-and-forget on the backend whenever a group chat message is sent;
 * there is no "analyze" call to trigger from the frontend.
 */

/** Guide/leader: every conflict for the group. Student: only conflicts
 * that involve them, shaped with student-safe fields only. */
export const getConflicts = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/conflicts`));

export const getConflict = async (groupId, conflictId) =>
  normalize(await api.get(`/groups/${groupId}/conflicts/${conflictId}`));

export const acknowledgeConflict = async (groupId, conflictId) =>
  normalize(await api.post(`/groups/${groupId}/conflicts/${conflictId}/acknowledge`));

export const resolveConflict = async (groupId, conflictId, resolutionNote) =>
  normalize(
    await api.post(`/groups/${groupId}/conflicts/${conflictId}/resolve`, { resolutionNote }),
  );

export const dismissConflict = async (groupId, conflictId, resolutionNote) =>
  normalize(
    await api.post(`/groups/${groupId}/conflicts/${conflictId}/dismiss`, { resolutionNote }),
  );
