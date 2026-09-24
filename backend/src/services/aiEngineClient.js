/**
 * Thin HTTP client for the Python AI engine (see ../../../ai-engine).
 *
 * Every call degrades gracefully: if the engine is offline the caller receives
 * `{ ok: false }` and falls back to the built-in Node heuristics, so the
 * platform keeps working without Python running.
 */
const AI_ENGINE_URL = (process.env.AI_ENGINE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const AI_ENGINE_KEY = process.env.AI_ENGINE_KEY || "";
const TIMEOUT_MS = Number(process.env.AI_ENGINE_TIMEOUT_MS || 20000);

async function callEngine(path, body, method = "POST") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_ENGINE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(AI_ENGINE_KEY ? { "X-AI-Engine-Key": AI_ENGINE_KEY } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: payload?.message || `engine_error_${res.status}` };
    return { ok: true, data: payload?.data ?? payload };
  } catch (err) {
    return { ok: false, reason: err.name === "AbortError" ? "engine_timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const health = () => callEngine("/health", null, "GET");
const analyzeFile = (payload) => callEngine("/analyze/file", payload);
const analyzeChat = (payload) => callEngine("/analyze/chat", payload);
const analyzeTasks = (payload) => callEngine("/analyze/tasks", payload);
const analyzeCollaboration = (payload) => callEngine("/analyze/collaboration", payload);
const analyzePerformance = (payload) => callEngine("/analyze/performance", payload);
const analyzeDeadlines = (payload) => callEngine("/analyze/deadlines", payload);
const recommend = (payload) => callEngine("/recommendations", payload);
const report = (payload) => callEngine("/reports/generate", payload);
/**
 * Project-planning AI (STEP 1): turns { projectTitle, projectDescription,
 * deadline, members } into a structured plan (modules/phases/tasks/
 * dependencies/milestones/suggested assignments). Same graceful-degrade
 * contract as every other method here — callers must handle `{ ok: false }`
 * themselves; there is intentionally no Node-side fallback for this one
 * (see reportController.projectPlan), since a rule-based plan needs the
 * same logic either way and duplicating it in two languages is exactly
 * the kind of duplicate AI logic this change is required not to create.
 */
const analyzeProjectPlan = (payload) => callEngine("/analyze/project-plan", payload);
/**
 * STEP 3: evidence-based student work analysis, AI score, performance
 * prediction, project completion prediction, group-chat analysis, per-file
 * evidence, warnings (with duplicate suppression) and recommendations —
 * all combined server-side by the AI engine's analyzers/performanceAnalyzer
 * .analyze_project_performance(). Same graceful-degrade contract as every
 * other method here: callers must handle `{ ok: false }`.
 */
const analyzeProjectPerformance = (payload) => callEngine("/analyze/project-performance", payload);
/**
 * Group-chat automatic task assignment: analyzes ONE chat message and
 * returns { isTask, tasks: [...], unmatchedMentions: [...], reason }. See
 * ai-engine/analyzers/messageTaskAnalyzer.py. Same graceful-degrade
 * contract as every other method here — chatTaskService.js falls back to
 * aiService.detectMessageTasks (Node heuristic) when `ok` is false, so a
 * chat message never fails to send just because this engine is offline.
 */
const analyzeMessageTask = (payload) => callEngine("/analyze/message-task", payload);
/**
 * STEP 9: static analysis of a student's ZIP task submission against the
 * CURRENT TeamSync AI project and the assigned task. Body: { taskTitle,
 * taskDescription, taskModule, referenceProject, files: [{relPath, ext,
 * size, content}], fileCount, ignoredCount, secretFileCount }. Response:
 * { projectRelated, projectConfidence, taskRelated, implementationStatus,
 * progress, summary, completedParts, missingParts, suggestions,
 * analyzedFiles }. Same graceful-degrade contract as every other method
 * here — taskSubmissionAnalysisService falls back to its own Node
 * heuristic (analyzeLocally) when `ok` is false.
 */
const analyzeTaskSubmission = (payload) => callEngine("/analyze/task-submission", payload);
/**
 * Step 15 — engine-side equivalent team-risk analyzer (see
 * ai-engine/analyzers/teamRiskAnalyzer.py). Not called by
 * services/teamRiskAnalyzer.js at runtime — that service computes its own
 * deterministic result locally so team risk keeps working even when this
 * engine is offline. Exposed here for parity/completeness and for any
 * future caller that wants the engine's version specifically.
 */
const analyzeTeamRisk = (payload) => callEngine("/analyze/team-risk", payload);
/**
 * STEP 17 — Feature 2: AI-Expanded Task Description. Turns a short task
 * title (+ optional description) into a structured draft (see
 * ai-engine/analyzers/taskExpansionAnalyzer.py). Same graceful-degrade
 * contract as every other method here — services/taskExpansionService.js
 * falls back to a minimal, non-fabricated stub when `ok` is false.
 */
const analyzeTaskExpansion = (payload) => callEngine("/analyze/task-expansion", payload);
/**
 * STEP 18 — AI Task Intelligence / Smart Planning. Subtask-plan generation
 * only (see ai-engine/analyzers/taskPlanAnalyzer.py) — the workload/risk/
 * priority/assignee reasoning is computed entirely in Node
 * (taskPlanService.js), reusing existing services, never sent to or
 * generated by this engine call.
 */
const analyzeTaskPlan = (payload) => callEngine("/analyze/task-plan", payload);

module.exports = {
  AI_ENGINE_URL,
  health,
  analyzeFile,
  analyzeChat,
  analyzeTasks,
  analyzeCollaboration,
  analyzePerformance,
  analyzeDeadlines,
  recommend,
  report,
  analyzeProjectPlan,
  analyzeProjectPerformance,
  analyzeMessageTask,
  analyzeTaskSubmission,
  analyzeTeamRisk,
  analyzeTaskExpansion,
  analyzeTaskPlan,
};
