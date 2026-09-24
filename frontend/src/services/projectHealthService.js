import { api, normalize } from "../lib/apiClient";

/**
 * STEP 20 — AI Project Health Command Center.
 * Separate from services/teamRiskService.js and services/projectForecastService.js
 * — this file calls only its own new, additive, guide/leader-only endpoints
 * (see backend/src/controllers/projectHealthController.js). Students
 * continue to use projectForecastService.getProjectForecast's `myProgress`
 * shape — there is no student-facing project-health endpoint.
 */
export const getProjectHealth = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/project-health`));

export const getProjectHealthHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/project-health/history`));
