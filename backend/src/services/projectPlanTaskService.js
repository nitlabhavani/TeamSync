/**
 * STEP 2 of the project-planning AI — turns a guide-approved AI project plan
 * (the JSON shape returned by POST /groups/:groupId/ai/project-plan) into
 * the concrete inputs the existing Task model needs.
 *
 * Deliberately pure / DB-free: every function here takes plain data in and
 * returns plain data out, so reportController.createProjectPlanTasks stays
 * the one place responsible for authorization, persistence and duplicate
 * protection — "the AI generates the plan, the existing backend remains
 * responsible for ... task creation" (per the Step 2 spec). Keeping the date
 * math here (rather than re-calling the Python engine) avoids duplicating
 * AI logic in two languages for something that's just arithmetic over
 * numbers the AI already returned.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Mirrors Task.TASK_PRIORITIES (../models/Task.js). Kept as a local literal
// rather than requiring the Mongoose model here so this module stays
// pure/DB-free (no mongoose import) and independently unit-testable — see
// scripts/testProjectPlanTaskService.js. If Task.js's priority enum ever
// changes, update this list too.
const TASK_PRIORITIES = ["low", "medium", "high", "critical"];
const VALID_DELIVERABLES = ["", "code", "frontend", "backend", "database", "documentation", "presentation", "report"];

function normalizeDeliverableType(raw) {
  const low = String(raw || "").toLowerCase().trim();
  if (VALID_DELIVERABLES.includes(low)) return low;
  if (low.includes("front") || low.includes("ui")) return "frontend";
  if (low.includes("back") || low.includes("api")) return "backend";
  if (low.includes("data") || low.includes("schema")) return "database";
  if (low.includes("doc") || low.includes("test") || low.includes("qa")) return "documentation";
  if (low.includes("present")) return "presentation";
  if (low.includes("report")) return "report";
  if (low.includes("code") || low.includes("ml") || low.includes("script")) return "code";
  return "";
}

/**
 * Cleans one raw AI-generated task into the shape the rest of this module
 * (and the controller) trusts. Never trusts anything beyond title/
 * description/module/priority/estimatedDays/dependencies — in particular
 * this never reads an assignee/assigneeId off the AI payload; assignment is
 * resolved separately against real group members (see resolveAssignments).
 */
function sanitizeTask(raw) {
  const title = String(raw?.title || "").trim();
  if (!title) return null;
  const estimatedDays = Number(raw?.estimatedDays);
  return {
    title,
    description: String(raw?.description || "").trim(),
    module: String(raw?.module || "").trim(),
    priority: TASK_PRIORITIES.includes(raw?.priority) ? raw.priority : "medium",
    estimatedDays: Number.isFinite(estimatedDays) && estimatedDays > 0 ? estimatedDays : 1,
    dependencies: Array.isArray(raw?.dependencies)
      ? [...new Set(raw.dependencies.map((d) => String(d || "").trim()).filter(Boolean))]
      : [],
    whatToDo: String(raw?.whatToDo || raw?.description || "").trim(),
    expectedOutput: String(raw?.expectedOutput || raw?.deliverable || "").trim(),
    deliverableType: normalizeDeliverableType(raw?.deliverableType),
    completionCriteria: Array.isArray(raw?.completionCriteria)
      ? raw.completionCriteria.map((c) => String(c).trim()).filter(Boolean)
      : [],
    assignedTo: raw?.assignedTo && typeof raw.assignedTo === "object" ? raw.assignedTo : null,
    assigneeId: raw?.assigneeId ? String(raw.assigneeId).trim() : (raw?.assignedTo?.id ? String(raw.assignedTo.id).trim() : null),
    due: raw?.due ? String(raw.due).trim() : (raw?.dueDate ? String(raw.dueDate).trim() : null),
    dueDate: raw?.dueDate ? String(raw.dueDate).trim() : (raw?.due ? String(raw.due).trim() : null),
  };
}

/**
 * Sanitizes plan.tasks, de-duplicating by title (case-insensitive) so a
 * malformed/duplicated AI payload can't produce two tasks with the same
 * title in a single request.
 */
function sanitizeTasks(rawTasks) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(rawTasks) ? rawTasks : []) {
    const task = sanitizeTask(raw);
    if (!task) continue;
    const key = task.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(task);
  }
  return out;
}

/**
 * Maps AI-suggested assignments (by task title) to a resolved member from
 * the group's actual roster. Every assignment that names an email must
 * resolve to a real group member — this returns the first unmatched email
 * as `unresolved` so the caller can fail the whole request before creating
 * anything (see the "unable to map" requirement in the Step 2 spec) rather
 * than silently dropping the assignment or trusting a client-supplied id.
 *
 * @param {Array} suggestedAssignments plan.suggestedAssignments
 * @param {Set<string>} knownTitleKeys lowercase titles that exist in this batch
 * @param {Map<string, object>} memberByEmail lowercase email -> populated member doc
 * @returns {{ assignmentsByTitle: Map<string, object>, unresolvedEmail: string|null }}
 */
function resolveAssignments(suggestedAssignments, knownTitleKeys, memberByEmail) {
  const assignmentsByTitle = new Map();
  for (const a of Array.isArray(suggestedAssignments) ? suggestedAssignments : []) {
    const title = String(a?.taskTitle || "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (!knownTitleKeys.has(key)) continue; // assignment for a task not in this plan/batch
    const rawEmail = String(a?.studentEmail || "").trim();
    if (!rawEmail) continue; // AI couldn't name a student either — leave unassigned
    const member = memberByEmail.get(rawEmail.toLowerCase());
    if (!member) {
      return { assignmentsByTitle, unresolvedEmail: rawEmail };
    }
    assignmentsByTitle.set(key, member);
  }
  return { assignmentsByTitle, unresolvedEmail: null };
}

/**
 * Orders tasks so every task comes after all of its (in-batch) dependencies
 * — needed so a dependency's real Task._id already exists by the time a
 * dependent task is created. Falls back to the given order for any task
 * involved in a dependency cycle (defensive; the AI planner does not
 * generate cycles, but this must never hang or throw on unexpected input).
 */
function topoSortTasks(tasks) {
  const byTitle = new Map(tasks.map((t) => [t.title.toLowerCase(), t]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  function visit(task) {
    const key = task.title.toLowerCase();
    if (visited.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const depTitle of task.dependencies) {
      const dep = byTitle.get(depTitle.toLowerCase());
      if (dep) visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(task);
  }

  for (const task of tasks) visit(task);
  // Any task a cycle kept out of `ordered` (shouldn't happen) is appended
  // in original order rather than silently dropped.
  for (const task of tasks) {
    if (!visited.has(task.title.toLowerCase())) ordered.push(task);
  }
  return ordered;
}

/**
 * Computes a due date per task title from estimatedDays + dependencies,
 * scaled against the group's real deadline — mirrors the same start/span
 * scaling the AI engine already uses for milestones (see
 * ai-engine/planning/projectPlanner.py:_build_milestones), just applied per
 * task instead of per phase. Tasks with more/longer dependencies land
 * later; nothing gets the same flat deadline.
 *
 * @param {Array} tasks sanitized tasks (title, estimatedDays, dependencies)
 * @param {Date|string|null} deadline group.expectedCompletion
 * @param {Date} [now] injectable for tests
 * @returns {Map<string, Date>} lowercase title -> due date
 */
function computeTaskDueDates(tasks, deadline, now = new Date()) {
  const byTitle = new Map(tasks.map((t) => [t.title.toLowerCase(), t]));
  const finishCache = new Map();

  function finishOffset(title, guard = new Set()) {
    const key = title.toLowerCase();
    if (finishCache.has(key)) return finishCache.get(key);
    const task = byTitle.get(key);
    if (!task || guard.has(key)) return 0; // unknown dep or cycle guard — treat as no delay
    guard.add(key);
    let maxDepFinish = 0;
    for (const depTitle of task.dependencies) {
      maxDepFinish = Math.max(maxDepFinish, finishOffset(depTitle, guard));
    }
    const finish = maxDepFinish + task.estimatedDays;
    finishCache.set(key, finish);
    return finish;
  }

  const finishByTitle = new Map();
  let totalOffset = 0;
  for (const task of tasks) {
    const finish = finishOffset(task.title);
    finishByTitle.set(task.title.toLowerCase(), finish);
    totalOffset = Math.max(totalOffset, finish);
  }
  totalOffset = totalOffset || 1;

  const deadlineDate = deadline ? new Date(deadline) : null;
  const hasFutureDeadline = deadlineDate && !Number.isNaN(deadlineDate.getTime()) && deadlineDate > now;
  const spanDays = hasFutureDeadline ? (deadlineDate.getTime() - now.getTime()) / MS_PER_DAY : totalOffset;

  const dueByTitle = new Map();
  for (const task of tasks) {
    const key = task.title.toLowerCase();
    const finish = finishByTitle.get(key);
    const offsetDays = (finish / totalOffset) * spanDays;
    dueByTitle.set(key, new Date(now.getTime() + offsetDays * MS_PER_DAY));
  }
  return dueByTitle;
}

module.exports = {
  sanitizeTask,
  sanitizeTasks,
  resolveAssignments,
  topoSortTasks,
  computeTaskDueDates,
  normalizeDeliverableType,
};
