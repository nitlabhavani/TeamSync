import { api, normalize } from "../lib/apiClient";

/**
 * STEP 21 — AI Project Execution Copilot.
 * Separate from services/projectHealthService.js, services/teamRiskService.js
 * and services/projectForecastService.js — this file calls only its own
 * new, additive, guide/leader-only endpoints (see
 * backend/src/controllers/projectExecutionCopilotController.js). There is
 * no student-facing Execution Copilot endpoint.
 */
export const getExecutionCopilot = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/execution-copilot`));

export const getExecutionCopilotHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/execution-copilot/history`));
