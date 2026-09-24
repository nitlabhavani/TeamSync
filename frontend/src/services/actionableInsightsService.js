import { api } from "../lib/apiClient";

/**
 * STEP 29 — AI Actionable Project Insights & Recommendation Engine.
 *
 * Mirrors projectMemoryAssistantService.js conventions exactly: uses the
 * same `api` helper, and the backend response is NOT a Mongoose document
 * (no `_id`), so it is returned as-is — { success, groupId, generatedAt,
 * summary, recommendations }. Errors are left to throw (see `request()`
 * in lib/apiClient.js) so the calling component can catch them the same
 * way ProjectMemoryAssistant.jsx does.
 */

/** Fetch this group's current actionable insights.
 * @param {string} groupId
 * @param {{ limit?: number, priority?: string, category?: string }} [options]
 */
export const getActionableInsights = async (groupId, options = {}) =>
  api.post(`/groups/${groupId}/ai/actionable-insights`, options);
