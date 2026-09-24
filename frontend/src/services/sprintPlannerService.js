import { api, normalize } from "../lib/apiClient";

/**
 * STEP 23 — AI Sprint Planner.
 * Separate from services/teamPerformanceService.js, services/taskService.js,
 * etc. — calls only its own new, additive endpoints (see
 * backend/src/controllers/sprintPlannerController.js). Preview never
 * mutates a task; only `applySprintPlan` does, and only after the backend
 * re-validates the plan isn't stale (409 SPRINT_PLAN_STALE).
 */

/** Generates a new DRAFT sprint plan. Guide/team-leader only (backend-enforced). */
export const previewSprintPlan = async (
  groupId,
  { startDate, endDate, durationDays, maxTasks, title } = {},
) =>
  normalize(
    await api.post(`/groups/${groupId}/sprint-planner/preview`, {
      startDate,
      endDate,
      durationDays,
      maxTasks,
      title,
    }),
  );

/** The ONLY call that mutates real tasks. On a 409 conflict the backend
 * returns { error: "SPRINT_PLAN_STALE", staleTasks }; the shared apiClient
 * (see lib/apiClient.js#request) surfaces this as a thrown Error whose
 * message is the backend's human-readable explanation — the caller should
 * prompt the user to regenerate the plan rather than retry blindly. */
export const applySprintPlan = async (groupId, planId) =>
  normalize(await api.post(`/groups/${groupId}/sprint-planner/${planId}/apply`));

export const cancelSprintPlan = async (groupId, planId) =>
  normalize(await api.post(`/groups/${groupId}/sprint-planner/${planId}/cancel`));

export const getSprintPlanHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/sprint-planner/history`));

export const getSprintPlan = async (groupId, planId) =>
  normalize(await api.get(`/groups/${groupId}/sprint-planner/${planId}`));

/** Latest APPLIED plan only, student-safe shaped for non-guide/leader callers. Returns null if none applied yet. */
export const getCurrentSprint = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/sprint-planner/current`));
