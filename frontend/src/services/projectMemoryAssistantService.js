import { api } from "../lib/apiClient";

/**
 * STEP 28 — AI Project Memory Assistant / Contextual Project Q&A.
 * Separate from services/projectKnowledgeService.js / meetingIntelligenceService.js
 * — calls only the new, additive endpoint in
 * backend/src/controllers/projectMemoryAssistantController.js.
 *
 * The backend response is NOT a Mongoose document (no `_id`), so this file
 * intentionally does not run it through `normalize()` — it is returned
 * as-is: { success, groupId, intent, answer, confidence, evidence,
 * relatedItems, limitations }.
 */

/** Ask a grounded question about this group's project memory (decisions,
 * tasks, meetings, conflicts, risk/health/forecast/sprint where the caller
 * is guide/team-leader). Ephemeral — nothing about the question is stored
 * server-side, so there is no history to fetch back. */
export const askProjectMemory = async (groupId, question) =>
  api.post(`/groups/${groupId}/ai/project-memory/ask`, { question });
