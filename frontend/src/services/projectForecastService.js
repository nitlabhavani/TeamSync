import { api, normalize } from "../lib/apiClient";

/**
 * STEP 19 — AI Project Progress Forecast & Early Intervention System.
 * Separate from services/teamRiskService.js/reportService.js — this file
 * calls its own new, additive endpoints only.
 *
 * Guide/Team Leader get the full forecast + recommendations. Students get a
 * reduced `{ myProgress }` shape (see backend/src/controllers/
 * projectForecastController.js).
 */
export const getProjectForecast = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/project-forecast`));

export const getInterventionRecommendations = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/intervention-recommendations`));

export const getProjectForecastHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/project-forecast/history`));
