/**
 * STEP 17 — Feature 2: AI-Expanded Task Description.
 *
 * Same graceful-degrade contract as every other AI-backed service in this
 * project (see taskSubmissionAnalysisService.analyzeLocally): try the
 * Python AI engine first (ai-engine/analyzers/taskExpansionAnalyzer.py);
 * if it's offline or errors, fall back to a minimal, honest stub instead
 * of fabricating detailed content in two places.
 *
 * This is a SUGGESTION ONLY. Nothing here writes to a Task — the guide
 * must explicitly accept it (see taskController.expandTask and the
 * frontend "Use Suggestion" button).
 */
const aiEngine = require("./aiEngineClient");

const VALID_DIFFICULTIES = new Set(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]);

/** Per the spec's own fallback example — never invents detailed content when the AI is unavailable. */
function fallbackExpansion() {
  return {
    description: "Complete the task described by the provided title.",
    subtasks: [],
    acceptanceCriteria: [],
    estimatedDifficulty: "UNKNOWN",
    estimatedEffort: null,
  };
}

/**
 * Defends against a malformed engine response (wrong types, missing
 * fields) the same way the rest of this codebase treats engine output as
 * untrusted — falls back rather than passing bad shapes to the frontend.
 */
function sanitizeEngineResponse(data) {
  if (!data || typeof data !== "object") return null;
  const description = typeof data.description === "string" ? data.description : "";
  const subtasks = Array.isArray(data.subtasks) ? data.subtasks.filter((s) => typeof s === "string") : [];
  const acceptanceCriteria = Array.isArray(data.acceptanceCriteria)
    ? data.acceptanceCriteria.filter((s) => typeof s === "string")
    : [];
  const estimatedDifficulty = VALID_DIFFICULTIES.has(data.estimatedDifficulty) ? data.estimatedDifficulty : "UNKNOWN";
  const estimatedEffort = typeof data.estimatedEffort === "string" ? data.estimatedEffort : null;
  if (!description) return null; // treat a response with no usable description as malformed
  return { description, subtasks, acceptanceCriteria, estimatedDifficulty, estimatedEffort };
}

async function expandTask({ title, description }) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return fallbackExpansion();

  const engineResp = await aiEngine.analyzeTaskExpansion({ title: cleanTitle, description: description || "" });
  if (engineResp.ok) {
    const sanitized = sanitizeEngineResponse(engineResp.data);
    if (sanitized) return sanitized;
  }
  return fallbackExpansion();
}

module.exports = { expandTask, sanitizeEngineResponse, fallbackExpansion };
