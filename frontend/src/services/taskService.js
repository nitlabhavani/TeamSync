import { api, normalize, idOf } from "../lib/apiClient";
import { nameOf as directoryName } from "./userDirectory";

/**
 * Mirrors the backend's existing upload configuration (backend/.env
 * MAX_UPLOAD_MB, default 25 — see backend/src/middleware/upload.js). There is
 * no public "config" endpoint, so this is kept in one place and can be
 * overridden at build time via VITE_MAX_UPLOAD_MB if the backend's limit
 * ever changes, without touching the upload UI itself.
 */
export const MAX_UPLOAD_MB = Number(import.meta.env?.VITE_MAX_UPLOAD_MB) || 25;

const toTask = (t) => {
  const task = normalize(t);
  return {
    ...task,
    assigneeId: idOf(task.assignee),
    groupId: idOf(task.group),
    tags: task.tags || [],
  };
};

export const getTasks = async (groupId) => (await api.get(`/groups/${groupId}/tasks`)).map(toTask);

export const getBoard = async (groupId) => {
  const data = await api.get(`/groups/${groupId}/tasks/board`);
  return {
    total: data.total,
    columns: (data.columns || []).map((c) => ({ ...c, tasks: c.tasks.map(toTask) })),
  };
};

export const moveTask = async (groupId, taskId, status, order = 0) =>
  toTask(await api.patch(`/groups/${groupId}/tasks/${taskId}/move`, { status, order }));

export const createTask = async (groupId, { title, description } = {}) => {
  return toTask(
    await api.post(`/groups/${groupId}/tasks`, {
      title,
      description,
    }),
  );
};

export const previewTask = async (groupId, { title, description } = {}) => {
  return await api.post(`/groups/${groupId}/tasks/ai-preview`, {
    title,
    description,
  });
};

/**
 * STEP 17 — Feature 1: AI Smart Task Auto-Assignment. Recommendation only —
 * never assigns anyone by itself. `title`/`description` are used for a
 * not-yet-created task (the "New task" form); pass `taskId` instead when
 * recommending a reassignment for a task that already exists.
 */
export const getAssignmentRecommendation = async (groupId, { taskId, title, description } = {}) =>
  taskId
    ? await api.get(`/groups/${groupId}/tasks/${taskId}/ai-assignment`)
    : await api.post(`/groups/${groupId}/tasks/ai-assignment`, { title, description });

/**
 * STEP 17 — Feature 2: AI-Expanded Task Description. Suggestion only —
 * the caller decides whether/how to use description/subtasks/acceptanceCriteria.
 */
export const getTaskExpansion = async (groupId, { title, description } = {}) =>
  await api.post(`/groups/${groupId}/tasks/ai-expand`, { title, description });

/**
 * STEP 18 — AI Task Intelligence / Smart Planning. Suggestion only until
 * applyTaskPlan() is explicitly called. `title`/`description`/`due` are
 * used for a not-yet-created task (the "New task" form); pass `taskId`
 * instead to (re-)plan a task that already exists.
 */
export const getTaskPlan = async (groupId, { taskId, title, description, due } = {}) =>
  taskId
    ? await api.get(`/groups/${groupId}/tasks/${taskId}/ai-plan`)
    : await api.post(`/groups/${groupId}/tasks/ai-plan`, { title, description, due });

/** Persists only the student-safe subset of a generated plan onto the task. */
export const applyTaskPlan = async (groupId, taskId, plan) =>
  toTask(await api.post(`/groups/${groupId}/tasks/${taskId}/ai-plan/apply`, plan));

export const updateTask = async (groupId, taskId, patch) => {
  const { assigneeId, ...rest } = patch || {};
  return toTask(
    await api.patch(`/groups/${groupId}/tasks/${taskId}`, {
      ...rest,
      ...(assigneeId !== undefined ? { assignee: assigneeId } : {}),
    }),
  );
};

export const deleteTask = async (groupId, taskId) => api.del(`/groups/${groupId}/tasks/${taskId}`);

/**
 * Student task submission workflow (pending -> submitted -> ai_review -> guide_review -> completed/rejected).
 * Uses the existing POST /groups/:groupId/tasks/:taskId/submit endpoint (multipart, field "files").
 */
export const submitTask = async (groupId, taskId, { note = "", files = [], action = "submit_for_review", onProgress } = {}) => {
  const form = new FormData();
  if (note) form.append("note", note);
  if (action) form.append("action", action);
  for (const file of files) form.append("files", file);
  return toTask(await api.upload(`/groups/${groupId}/tasks/${taskId}/submit`, form, onProgress));
};

export const getSubmissions = async (groupId, taskId) =>
  normalize(await api.get(`/groups/${groupId}/tasks/${taskId}/submissions`));

export const reanalyzeSubmission = async (groupId, taskId, submissionId) =>
  normalize(
    await api.post(`/groups/${groupId}/tasks/${taskId}/submissions/${submissionId}/analyze`),
  );

/** Guide (or team leader) approval decision that closes the workflow. */
export const reviewTask = async (groupId, taskId, { verdict, feedback = "" } = {}) =>
  toTask(await api.post(`/groups/${groupId}/tasks/${taskId}/review`, { verdict, feedback }));

export const getTaskStats = async (groupId) => api.get(`/groups/${groupId}/tasks/stats`);

/** Server-side workload/rebalance suggestions. */
export const fetchWorkloadInsights = async (groupId) =>
  api.get(`/groups/${groupId}/tasks/workload`);

/**
 * Canonical 4-stage task progress based on:
 * - todo / backlog / pending: 0%
 * - in_progress: 10%
 * - in_review (when zip folder uploaded / submitted for review): 90%
 * - done / completed: 100% (AI verified done; if rejected/incomplete: 90%)
 */
export const getTaskProgress = (task) => {
  if (typeof task?.progress === "number" && task.progress >= 0 && task.progress <= 100) {
    return task.progress;
  }
  const s = String(task?.status || "").toLowerCase().trim();
  if (s === "done" || s === "completed") {
    const ver = task?.verification;
    if (ver && (ver.status === "FAIL" || ver.completionStatus === "PARTIALLY_COMPLETE" || ver.completionStatus === "INSUFFICIENT_EVIDENCE")) {
      return 90;
    }
    return 100;
  }
  if (["in_review", "review", "submitted", "ai_review", "guide_review", "changes_requested"].includes(s)) {
    return 90;
  }
  if (s === "in_progress") {
    return 10;
  }
  return 0;
};

/**
 * Client-side workload & progress view.
 * Computes each student's progress percentage based on the 4-stage lifecycle terms:
 * - progress (in_progress): 10%
 * - in review (when zip folder uploaded): 90%
 * - done: 100% (AI verified; otherwise 90%)
 * - todo / not started: 0%
 */
export const getWorkloadInsights = (tasks = [], memberIds = [], members = []) => {
  const isDone = (status) => status === "done" || status === "completed";
  const open = (tasks || []).filter((t) => !isDone(t?.status));
  const totalOpenCount = open.length;

  // Resolve members map for name lookups
  const memberMap = new Map();
  (members || []).forEach((m) => {
    const id = String(m?.id || m?._id || "");
    if (id) memberMap.set(id, m.name || m.email || directoryName(id, id));
  });

  const nameOf = (id) =>
    memberMap.get(String(id)) || directoryName(id, id);

  // Collect all relevant member IDs (both from group and any assignees on open tasks)
  const allMemberIdSet = new Set((memberIds || []).map(String).filter(Boolean));
  (tasks || []).forEach((t) => {
    const aid = String(t.assigneeId || t.assignee?._id || t.assignee?.id || t.assignee || "");
    if (aid) allMemberIdSet.add(aid);
  });
  const allMemberIds = Array.from(allMemberIdSet);

  const hasHours = open.some((t) => Number(t.estimate) > 0);
  const totalHours = open.reduce((sum, t) => sum + (Number(t.estimate) > 0 ? Number(t.estimate) : 0), 0);

  const load = allMemberIds.map((id) => {
    const memberTasks = (tasks || []).filter(
      (t) => String(t.assigneeId || t.assignee?._id || t.assignee?.id || t.assignee || "") === String(id)
    );
    const mineOpen = memberTasks.filter((t) => !isDone(t?.status));
    const mineDone = memberTasks.filter((t) => isDone(t?.status));
    const memberHours = mineOpen.reduce((sum, t) => sum + (Number(t.estimate) > 0 ? Number(t.estimate) : 0), 0);

    // Calculate member's progress percentage across assigned tasks based on:
    // in_progress: 10%, in_review: 90%, done: 100% (or 90% if rejected), todo: 0%
    let percentage = 0;
    if (memberTasks.length > 0) {
      const totalProgress = memberTasks.reduce((sum, t) => sum + getTaskProgress(t), 0);
      percentage = Math.round(totalProgress / memberTasks.length);
    }

    const inReviewTasks = memberTasks.filter((t) =>
      ["in_review", "review", "submitted", "ai_review", "guide_review", "changes_requested"].includes(
        String(t?.status || "").toLowerCase()
      )
    );
    const inProgressTasks = memberTasks.filter(
      (t) => String(t?.status || "").toLowerCase() === "in_progress"
    );

    return {
      id,
      name: nameOf(id),
      totalCount: memberTasks.length,
      openCount: mineOpen.length,
      doneCount: mineDone.length,
      inReviewCount: inReviewTasks.length,
      inProgressCount: inProgressTasks.length,
      hours: memberHours,
      percentage,
      highCount: mineOpen.filter((t) => t.priority === "high").length,
    };
  });

  // Sort by percentage descending, then task count
  const sorted = [...load].sort((a, b) => b.percentage - a.percentage || b.openCount - a.openCount);
  const suggestions = [];

  load.forEach((l) => {
    if (l.totalCount === 0) {
      suggestions.push(`${l.name} has no tasks assigned — assign work to balance team responsibilities.`);
    } else if (l.percentage === 100) {
      suggestions.push(`🎉 ${l.name} has completed all assigned tasks (100% verified done).`);
    } else if (l.inReviewCount > 0) {
      suggestions.push(`🔍 ${l.name} has ${l.inReviewCount} task(s) in review (90%) — AI is evaluating the uploaded files.`);
    } else if (l.inProgressCount > 0) {
      suggestions.push(`⚡ ${l.name} has ${l.inProgressCount} task(s) in progress (10%) — upload deliverable ZIP and submit for review.`);
    }
  });

  if (!suggestions.length) {
    suggestions.push(
      totalOpenCount === 0
        ? "All tasks are complete! Team workload is 100% cleared."
        : "Workload and task progress are balanced across the team."
    );
  }

  const teamAvgProgress = tasks.length
    ? Math.round(tasks.reduce((sum, t) => sum + getTaskProgress(t), 0) / tasks.length)
    : 0;

  return {
    load: sorted,
    suggestions,
    totalOpenCount,
    totalHours,
    hasHours,
    teamAvgProgress,
  };
};
