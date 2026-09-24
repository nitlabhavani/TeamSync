import { api, normalize } from "../lib/apiClient";

/**
 * STEP 25 — AI Project What-If Simulator.
 * Separate from services/sprintPlannerService.js, services/teamRiskService.js,
 * etc. — calls only its own new, additive, READ-ONLY endpoints (see
 * backend/src/controllers/projectWhatIfController.js). Nothing this service
 * calls ever mutates a task, group, or sprint plan — every call here is a
 * simulation only.
 */

/** Which change types this project's current data supports (drives the UI's
 * scenario picker so it never offers an unsupported simulation). */
export const getWhatIfCapabilities = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/what-if/capabilities`));

/** Runs one simulation. `changes` — array of { type, taskId?, memberId?, value?, assignments? }.
 * Never mutates project data — see backend disclaimer echoed in the response. */
export const runWhatIfSimulation = async (groupId, changes) =>
  normalize(await api.post(`/groups/${groupId}/what-if/simulate`, { changes }));

/** Compares multiple scenarios at once. `scenarios` — array of { id?, label?, changes }.
 * The real current state is always included as the "baseline" scenario. */
export const compareWhatIfScenarios = async (groupId, scenarios) =>
  normalize(await api.post(`/groups/${groupId}/what-if/compare`, { scenarios }));
