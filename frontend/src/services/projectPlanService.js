import { api } from "../lib/apiClient";

/**
 * STEP 1 — ask the AI engine (via the Node backend) to turn this group's
 * project title/description/deadline/members into a structured plan.
 * Read-only: does not create any Task documents.
 */
export const generateProjectPlan = async (groupId, payload = {}) =>
  api.post(`/groups/${groupId}/ai/project-plan`, payload);

/**
 * STEP 2 — only called after the guide has reviewed the plan and clicked
 * "Create Tasks". Sends the reviewed plan back so the backend can validate,
 * map assignments to real group members, and persist real Task documents.
 * Returns { created, skipped, duplicates, tasks }.
 */
export const createTasksFromPlan = async (groupId, plan) =>
  api.post(`/groups/${groupId}/ai/project-plan/create-tasks`, { plan });
