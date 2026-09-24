import { api, normalize } from "../lib/apiClient";

/**
 * STEP 22 — AI Team Performance Insights.
 * Separate from services/teamRiskService.js and
 * services/projectExecutionCopilotService.js — calls only its own new,
 * additive endpoints (see backend/src/controllers/teamPerformanceController.js).
 * The same endpoint is used by both the Guide Dashboard and the Student
 * Dashboard — the backend shapes the response per-role (see
 * teamPerformanceService.shapeForStudent on the backend).
 */
export const getTeamPerformance = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/team-performance`));

export const getTeamPerformanceHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/team-performance/history`));
