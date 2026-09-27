import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  X,
  Loader2,
  Wand2,
  Boxes,
  ListChecks,
  Flag,
  AlertTriangle,
  CheckCircle2,
  User,
  Calendar,
  Clock,
} from "lucide-react";
import * as projectPlanService from "../../services/projectPlanService";

const PRIORITY_STYLES = {
  low: "bg-cloud text-slate-muted",
  medium: "bg-amber-50 text-amber-800",
  high: "bg-coral-soft text-coral",
  critical: "bg-coral-soft text-coral",
};

const toDateInputValue = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const findAssignment = (plan, taskTitle) =>
  (plan?.suggestedAssignments || []).find(
    (a) => String(a?.taskTitle || "").trim().toLowerCase() === taskTitle.trim().toLowerCase()
  );

/**
 * AI Project Planning Modal:
 * Guides and Team Leaders can enter/update project title and description,
 * generate AI structured tasks with clear requirements, automatically assign
 * tasks to group members, review calculated deadlines, and confirm tasks to
 * the project board and calendar.
 */
const AIProjectPlanModal = ({ open, onClose, group, onTasksCreated }) => {
  const [step, setStep] = useState("confirm"); // confirm | loading | review | creating | result | error
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [plan, setPlan] = useState(null);
  const [taskEdits, setTaskEdits] = useState({});
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const activeMembers = useMemo(() => {
    const list = [];
    if (group?.leader) {
      list.push({
        id: String(group.leader.id || group.leader._id),
        name: group.leader.name,
        email: group.leader.email,
        isLeader: true,
      });
    }
    for (const m of group?.members || []) {
      const mid = String(m.id || m._id);
      if (!list.some((existing) => existing.id === mid)) {
        list.push({
          id: mid,
          name: m.name,
          email: m.email,
          isLeader: false,
        });
      }
    }
    return list;
  }, [group]);

  useEffect(() => {
    if (open) {
      setStep("confirm");
      setProjectTitle(group?.project || group?.name || "");
      setProjectDescription(group?.description || "");
      setDeadline(toDateInputValue(group?.expectedCompletion));
      setPlan(null);
      setTaskEdits({});
      setError("");
      setResult(null);
    }
  }, [open, group]);

  const tasksByModule = useMemo(() => {
    if (!plan?.tasks?.length) return [];
    const order = [];
    const groups = new Map();
    for (const task of plan.tasks) {
      const moduleName = task.module || "General";
      if (!groups.has(moduleName)) {
        groups.set(moduleName, []);
        order.push(moduleName);
      }
      groups.get(moduleName).push(task);
    }
    return order.map((name) => ({ name, tasks: groups.get(name) }));
  }, [plan]);

  const taskQueueInfo = useMemo(() => {
    const counts = {};
    const queueMap = {};
    for (const t of plan?.tasks || []) {
      const edit = taskEdits[t.title] || {};
      const aid = edit.assigneeId || t.assigneeId || "";
      if (aid) {
        counts[aid] = (counts[aid] || 0) + 1;
        queueMap[t.title] = {
          queueNum: counts[aid],
          isActive: counts[aid] === 1,
        };
      } else {
        queueMap[t.title] = { queueNum: 0, isActive: false };
      }
    }
    return queueMap;
  }, [plan, taskEdits]);

  if (!open) return null;

  const updateTaskEdit = (title, field, value) => {
    setTaskEdits((prev) => ({
      ...prev,
      [title]: {
        ...(prev[title] || {}),
        [field]: value,
      },
    }));
  };

  const groupId = group?.id || group?._id || group?._doc?._id;

  const generate = async () => {
    if (!projectTitle.trim()) {
      setError("Please provide a project title for the AI to analyze.");
      return;
    }
    if (!groupId) {
      setError("Group identifier missing. Please refresh the page and try again.");
      return;
    }
    setError("");
    setStep("loading");
    try {
      const data = await projectPlanService.generateProjectPlan(groupId, {
        projectTitle: projectTitle.trim(),
        projectDescription: projectDescription.trim(),
        deadline: deadline || null,
      });
      setPlan(data);

      // Initialize customizable task edits with AI suggestions
      const initialEdits = {};
      const now = new Date();
      for (let idx = 0; idx < (data?.tasks || []).length; idx++) {
        const t = data.tasks[idx];
        let matchedMemberId = "";

        // 1. Direct assignee from AI task
        if (t.assigneeId) {
          const m = activeMembers.find(
            (mem) =>
              mem.id === String(t.assigneeId) ||
              mem.email?.toLowerCase() === String(t.assigneeId).toLowerCase()
          );
          if (m) matchedMemberId = m.id;
        }
        if (!matchedMemberId && t.assignedTo) {
          const m = activeMembers.find(
            (mem) =>
              mem.id === String(t.assignedTo.id) ||
              mem.email?.toLowerCase() === String(t.assignedTo.email).toLowerCase() ||
              mem.name?.toLowerCase() === String(t.assignedTo.name).toLowerCase()
          );
          if (m) matchedMemberId = m.id;
        }
        // 2. From suggestedAssignments
        if (!matchedMemberId) {
          const assignment = findAssignment(data, t.title);
          if (assignment) {
            const m = activeMembers.find(
              (mem) =>
                (assignment.studentId && mem.id === String(assignment.studentId)) ||
                mem.email?.toLowerCase() === assignment.studentEmail?.toLowerCase() ||
                mem.name?.toLowerCase() === assignment.studentName?.toLowerCase()
            );
            if (m) matchedMemberId = m.id;
          }
        }
        // 3. Fallback: ensure every task is assigned to an active member if available
        if (!matchedMemberId && activeMembers.length > 0) {
          matchedMemberId = activeMembers[idx % activeMembers.length].id;
        }

        // Deadline: use AI calculated dueDate
        const calculatedDue = t.dueDate || t.due || toDateInputValue(new Date(now.getTime() + (idx + 1) * 3 * 86400000));

        initialEdits[t.title] = {
          assigneeId: matchedMemberId,
          due: calculatedDue,
          priority: t.priority || "medium",
        };
      }
      setTaskEdits(initialEdits);
      setStep("review");
    } catch (e) {
      setError(e?.message || "Could not generate the AI project plan.");
      setStep("error");
    }
  };

  const createTasks = async () => {
    if (!groupId) {
      setError("Group identifier missing. Please refresh the page and try again.");
      return;
    }
    setError("");
    setStep("creating");
    try {
      const mergedTasks = (plan?.tasks || []).map((t) => {
        const edit = taskEdits[t.title] || {};
        return {
          ...t,
          assigneeId: edit.assigneeId || t.assigneeId || undefined,
          due: edit.due ? new Date(edit.due).toISOString() : (t.dueDate ? new Date(t.dueDate).toISOString() : undefined),
          priority: edit.priority || t.priority || "medium",
          whatToDo: t.whatToDo || t.description,
          expectedOutput: t.expectedOutput || (Array.isArray(t.deliverables) ? t.deliverables.join(", ") : "") || `Deliverable for ${t.title}`,
          completionCriteria: Array.isArray(t.completionCriteria) ? t.completionCriteria : [],
        };
      });

      const data = await projectPlanService.createTasksFromPlan(groupId, {
        ...plan,
        tasks: mergedTasks,
      });
      setResult(data);
      setStep("result");
      onTasksCreated?.(data);
    } catch (e) {
      setError(e?.message || "Could not create tasks from the AI project plan.");
      setStep("review");
    }
  };

  const close = () => {
    if (step === "loading" || step === "creating") return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6 animate-fadeIn">
      <div className="bg-paper/95 dark:bg-[#131722]/95 backdrop-blur-xl w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl border border-slate-line/80 dark:border-white/10 max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-line shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-full bg-brand-soft flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-brand-deep" />
            </span>
            <div className="min-w-0">
              <p className="font-display font-semibold text-slate-ink truncate">AI Project Understanding & Planning</p>
              <p className="text-xs text-slate-muted truncate">{projectTitle || group?.name || group?.project}</p>
            </div>
          </div>
          <button onClick={close} className="p-1.5 text-slate-muted hover:text-slate-ink shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {(step === "confirm" || step === "loading" || step === "error") && (
            <div className="space-y-3.5">
              <p className="text-xs text-slate-muted">
                Enter or update the project title and description. The AI engine will analyze your inputs and automatically assign every task to your group members with clear requirements, deliverables, and realistic deadlines.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-ink mb-1">
                  Project Title <span className="text-coral">*</span>
                </label>
                <input
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  disabled={step === "loading"}
                  placeholder="e.g. Smart Library Management System"
                  className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand font-medium text-slate-ink"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-ink mb-1">
                  Project Description & Requirements
                </label>
                <textarea
                  rows={3}
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  disabled={step === "loading"}
                  placeholder="Describe the system purpose, core features (e.g. user authentication, book catalog, borrowing workflows, real-time alerts, dashboard analytics), and tech stack..."
                  className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand text-slate-ink resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-ink mb-1">
                  Target Project Completion Deadline
                </label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  disabled={step === "loading"}
                  className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand text-slate-ink"
                />
                <p className="text-[11px] text-slate-muted mt-1">
                  AI will distribute task deadlines across the timeline leading up to this date.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-ink mb-1.5">
                  Enrolled Team Members for AI Assignment ({activeMembers.length})
                </label>
                {activeMembers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 p-2 bg-cloud/70 border border-slate-line rounded-lg">
                    {activeMembers.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-paper border border-slate-line px-2.5 py-1 rounded-full text-slate-ink font-medium shadow-2xs"
                      >
                        <User className="w-3 h-3 text-brand" />
                        <span>{m.name}</span>
                        <span className="text-[10px] text-slate-muted">
                          ({m.isLeader ? "Leader" : "Student"})
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                    No students enrolled yet. Tasks can still be structured, but will remain unassigned until members join.
                  </p>
                )}
              </div>

              {error && <p className="text-xs text-coral bg-coral-soft rounded-lg px-3.5 py-2.5">{error}</p>}
            </div>
          )}

          {step === "review" && plan && (
            <>
              {plan.insufficient_data && (
                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-1">AI had limited information to work with:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {(plan.insufficientDataReasons || []).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="flex items-center gap-2 text-xs font-semibold text-mint bg-mint-soft rounded-full px-3 py-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> AI Tasks & Deadlines Ready
                </p>
                <span className="text-xs text-slate-muted italic">
                  * All tasks are pre-assigned with calculated deadlines. You can customize assignees and dates below.
                </span>
              </div>

              {/* Sequential Task Assignment Rule Banner */}
              <div className="bg-brand-soft/50 border border-brand/25 rounded-xl p-3.5 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-brand-deep shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-brand-deep">
                    Sequential Task Assignment: 1 Active Task at a Time ({activeMembers.length} group members analyzed)
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    To maintain high focus and quality, each member is assigned <strong>1 active task</strong> immediately. Subsequent tasks remain queued in the backlog and will automatically unlock when the preceding task is successfully verified.
                  </p>
                </div>
              </div>

              {/* Project Understanding */}
              {plan.projectUnderstanding && (
                <section>
                  <h3 className="flex items-center gap-1.5 text-sm font-display font-semibold text-slate-ink mb-2">
                    <Wand2 className="w-4 h-4 text-brand-deep" /> Project Understanding
                  </h3>
                  <div className="bg-cloud/60 border border-slate-line rounded-xl p-3.5 space-y-2 text-sm">
                    <p>
                      <span className="font-semibold text-slate-ink">Summary: </span>
                      <span className="text-slate-muted">{plan.projectUnderstanding.summary}</span>
                    </p>
                    <p>
                      <span className="font-semibold text-slate-ink">Main goal: </span>
                      <span className="text-slate-muted">{plan.projectUnderstanding.mainGoal}</span>
                    </p>
                    <p>
                      <span className="font-semibold text-slate-ink">Expected outcome: </span>
                      <span className="text-slate-muted">{plan.projectUnderstanding.expectedOutcome}</span>
                    </p>
                  </div>
                </section>
              )}

              {/* Modules */}
              {!!(plan.modules || []).length && (
                <section>
                  <h3 className="flex items-center gap-1.5 text-sm font-display font-semibold text-slate-ink mb-2">
                    <Boxes className="w-4 h-4 text-brand-deep" /> Suggested Architecture Modules
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {plan.modules.map((m) => (
                      <div key={m.moduleKey || m.name} className="border border-slate-line rounded-xl px-3.5 py-2.5 bg-paper">
                        <p className="text-sm font-medium text-slate-ink flex items-center justify-between gap-2">
                          <span>{m.name}</span>
                          <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[m.priority] || PRIORITY_STYLES.medium}`}>
                            {m.priority}
                          </span>
                        </p>
                        <p className="text-xs text-slate-muted mt-0.5">{m.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Tasks with Member Assignment Dropdown, Clear Info, and Deadline Picker */}
              {!!tasksByModule.length && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-sm font-display font-semibold text-slate-ink">
                      <ListChecks className="w-4 h-4 text-brand-deep" /> Structured Tasks, Member Assignments & Deadlines
                    </h3>
                    <span className="text-xs font-semibold text-brand bg-brand-soft px-2 py-0.5 rounded-full">
                      {(plan.tasks || []).length} tasks
                    </span>
                  </div>

                  <div className="flex flex-col gap-4">
                    {tasksByModule.map((group_) => (
                      <div key={group_.name} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-brand-deep">
                          {group_.name}
                        </p>
                        <div className="flex flex-col gap-3">
                          {group_.tasks.map((task) => {
                            const edit = taskEdits[task.title] || {};
                            const assignment = findAssignment(plan, task.title);
                            const assignedMember = activeMembers.find((m) => m.id === edit.assigneeId);

                            return (
                              <div key={task.title} className="border border-slate-line rounded-xl p-3.5 bg-paper shadow-xs space-y-3">
                                {/* Header: Title, Module, Priority */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <span className="text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-full bg-brand-soft text-brand-deep">
                                        {task.module || "General"}
                                      </span>
                                      {task.deliverableType && (
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                          {task.deliverableType}
                                        </span>
                                      )}
                                      {taskQueueInfo[task.title]?.isActive ? (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-mint-soft text-mint border border-mint/30 flex items-center gap-1">
                                          <CheckCircle2 className="w-3 h-3" /> Active Task 1 (Immediate Focus)
                                        </span>
                                      ) : taskQueueInfo[task.title]?.queueNum > 1 ? (
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1">
                                          <Clock className="w-3 h-3" /> Queued #{taskQueueInfo[task.title]?.queueNum} (Unlocks after Task {taskQueueInfo[task.title]?.queueNum - 1} verified)
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="text-sm font-semibold text-slate-ink">{task.title}</p>
                                    {task.description && (
                                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{task.description}</p>
                                    )}
                                  </div>
                                  <select
                                    value={edit.priority || task.priority || "medium"}
                                    onChange={(e) => updateTaskEdit(task.title, "priority", e.target.value)}
                                    className="text-xs uppercase font-semibold border border-slate-line rounded-lg px-2 py-1 bg-cloud text-slate-ink outline-none"
                                  >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                    <option value="critical">Critical</option>
                                  </select>
                                </div>

                                {/* Clear Task Specifications & Deliverables */}
                                {(task.whatToDo || task.expectedOutput || (task.completionCriteria && task.completionCriteria.length > 0)) && (
                                  <div className="bg-cloud/50 rounded-lg p-2.5 border border-slate-line/50 text-[11px] space-y-1.5 text-slate-ink">
                                    {task.whatToDo && (
                                      <p className="leading-relaxed">
                                        <strong className="text-slate-muted uppercase text-[10px] tracking-wider mr-1">Steps:</strong>
                                        {task.whatToDo}
                                      </p>
                                    )}
                                    {task.expectedOutput && (
                                      <p className="leading-relaxed">
                                        <strong className="text-slate-muted uppercase text-[10px] tracking-wider mr-1">Deliverable:</strong>
                                        <span className="text-slate-700 font-medium">{task.expectedOutput}</span>
                                      </p>
                                    )}
                                    {task.completionCriteria && task.completionCriteria.length > 0 && (
                                      <div>
                                        <strong className="text-slate-muted uppercase text-[10px] tracking-wider block mb-0.5">Acceptance Criteria:</strong>
                                        <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                                          {task.completionCriteria.map((c, idx_) => (
                                            <li key={idx_}>{c}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-slate-muted">
                                  <span>Estimated: ~{task.estimatedDays} day{task.estimatedDays === 1 ? "" : "s"} ({Math.round(task.estimatedDays * 8)} hrs)</span>
                                  {!!(task.dependencies || []).length && (
                                    <span>Prerequisites: <strong className="text-slate-ink">{task.dependencies.join(", ")}</strong></span>
                                  )}
                                </div>

                                {/* Assignment & Deadline Controls */}
                                <div className="grid sm:grid-cols-2 gap-2.5 pt-2.5 border-t border-slate-line/60">
                                  <div className="bg-cloud/30 p-2.5 rounded-lg border border-slate-line/60">
                                    <div className="flex items-center justify-between mb-1">
                                      <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-ink">
                                        <User className="w-3 h-3 text-brand" /> Assigned Team Member
                                      </label>
                                      {assignedMember && (
                                        <span className="text-[10px] text-mint font-semibold">Pre-assigned</span>
                                      )}
                                    </div>
                                    <select
                                      value={edit.assigneeId || ""}
                                      onChange={(e) => updateTaskEdit(task.title, "assigneeId", e.target.value)}
                                      className="w-full bg-paper border border-slate-line rounded-lg px-2.5 py-1.5 text-xs text-slate-ink outline-none focus:border-brand font-medium"
                                    >
                                      <option value="">-- Unassigned --</option>
                                      {activeMembers.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.name} ({m.isLeader ? "Team Leader" : "Member"})
                                        </option>
                                      ))}
                                    </select>
                                    {(task.assignmentReason || assignment?.reason) && (
                                      <p className="text-[10px] text-brand-deep mt-1 italic leading-tight">
                                        AI Rationale: {task.assignmentReason || assignment.reason}
                                      </p>
                                    )}
                                  </div>

                                  <div className="bg-cloud/30 p-2.5 rounded-lg border border-slate-line/60">
                                    <div className="flex items-center justify-between mb-1">
                                      <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-ink">
                                        <Calendar className="w-3 h-3 text-brand" /> Task Deadline Date
                                      </label>
                                      {edit.due && (
                                        <span className="text-[10px] text-brand font-semibold">AI Scheduled</span>
                                      )}
                                    </div>
                                    <input
                                      type="date"
                                      value={edit.due || ""}
                                      onChange={(e) => updateTaskEdit(task.title, "due", e.target.value)}
                                      className="w-full bg-paper border border-slate-line rounded-lg px-2.5 py-1.5 text-xs text-slate-ink outline-none focus:border-brand font-medium"
                                    />
                                    <p className="text-[10px] text-slate-muted mt-1 leading-tight">
                                      Synchronizes to assignee's calendar & project board
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Milestones */}
              {!!(plan.milestones || []).length && (
                <section>
                  <h3 className="flex items-center gap-1.5 text-sm font-display font-semibold text-slate-ink mb-2">
                    <Flag className="w-4 h-4 text-brand-deep" /> Suggested Project Milestones
                  </h3>
                  <div className="flex flex-col gap-2">
                    {plan.milestones.map((m) => (
                      <div key={m.title} className="flex items-center justify-between gap-3 border border-slate-line rounded-xl px-3.5 py-2.5 bg-paper">
                        <span className="text-sm text-slate-ink">{m.title}</span>
                        {m.targetDate && <span className="text-xs text-slate-muted shrink-0 font-medium">{m.targetDate}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}
            </>
          )}

          {step === "creating" && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-muted">
              <Loader2 className="w-6 h-6 animate-spin text-brand" />
              <p className="text-sm font-medium text-slate-ink">Creating tasks and synchronizing calendar…</p>
            </div>
          )}

          {step === "loading" && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-muted">
              <Loader2 className="w-6 h-6 animate-spin text-brand" />
              <p className="text-sm font-medium text-slate-ink">Analyzing project title & description, assigning tasks to team members, and calculating deadlines…</p>
            </div>
          )}

          {step === "result" && result && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-mint font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5" /> Tasks Successfully Created!
              </div>
              <div className="bg-cloud/60 border border-slate-line rounded-xl p-4 space-y-2 text-xs">
                <p>
                  <strong>{result.created || 0}</strong> tasks were generated across {activeMembers.length} team members. The 1st active focus task has been assigned to each member and scheduled on their calendar. Subsequent tasks are queued in the backlog to unlock sequentially upon successful verification.
                </p>
                {result.duplicates?.length > 0 && (
                  <p className="text-slate-muted">
                    {result.duplicates.length} task(s) already existed and were skipped to prevent duplicates.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-line flex items-center justify-end gap-2 shrink-0 bg-cloud/30">
          {(step === "confirm" || step === "error") && (
            <>
              <button
                onClick={close}
                className="px-4 py-2 text-xs font-semibold text-slate-muted hover:text-slate-ink rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={generate}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-brand text-white rounded-lg hover:bg-brand/90 shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5" /> Analyze Project & Generate AI Tasks
              </button>
            </>
          )}

          {step === "review" && (
            <>
              <button
                onClick={() => setStep("confirm")}
                className="px-4 py-2 text-xs font-semibold text-slate-muted hover:text-slate-ink rounded-lg"
              >
                Re-Analyze
              </button>
              <button
                onClick={createTasks}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-mint text-white rounded-lg hover:bg-mint/90 shadow-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Create & Assign 1st Active Task to Each Member
              </button>
            </>
          )}

          {step === "result" && (
            <button
              onClick={close}
              className="px-4 py-2 text-xs font-semibold bg-brand text-white rounded-lg hover:bg-brand/90"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIProjectPlanModal;
