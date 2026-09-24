import { api, normalize } from "../lib/apiClient";

/**
 * Step 15 — AI Team Risk & Early Warning System.
 * Separate from services/riskService.js (older risk radar) — that file and
 * its `/groups/:groupId/risk` endpoint are untouched.
 *
 * Guides get the full team + per-student breakdown; students get a reduced
 * `{ myRisk, team }` shape (see backend/src/controllers/teamRiskController.js).
 */
export const getTeamRisk = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/ai-risk`));

export const getTeamRiskHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/ai-risk/history`));
