import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Plus,
  Sparkles,
  Clock,
  AlertTriangle,
  Trash2,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  KanbanSquare,
  ListTodo,
  Search,
  SlidersHorizontal,
  Inbox,
  Users,
  RefreshCw,
  CalendarRange,
  ShieldAlert,
  FolderArchive,
  X,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import SectionHeading from "../../components/dashboard/SectionHeading";
import SubmissionFeedbackPanel from "../../components/tasks/SubmissionFeedbackPanel";
import SubmissionHistoryPanel from "../../components/tasks/SubmissionHistoryPanel";
import AIProjectPlanModal from "../../components/groups/AIProjectPlanModal";
import { useAuth } from "../../hooks/useAuth";
import { useGroups } from "../../hooks/useGroups";
import { useNavigate } from "@/lib/router-compat";
import { nameOf as dirName, colorOf as dirColor } from "../../services/userDirectory";
import { formatDay, formatTime, getDeadlineStatus, getDeadlineCountdown } from "../../utils/dateFormatter";
import { TASK_STATUSES, TASK_PRIORITIES } from "../../services/workspaceData";
import { ROUTES } from "../../utils/constants";
import * as taskService from "../../services/taskService";
import * as sprintPlannerService from "../../services/sprintPlannerService";
import * as conflictService from "../../services/conflictService";

// The backend also drives tasks through a submission workflow
// (pending -> submitted -> ai_review -> guide_review -> completed | rejected)
// that isn't part of the 5 kanban columns below. Map those statuses onto the
// nearest column so a submitted task stays visible instead of disappearing.
const columnForStatus = (status) => {
  if (status === "completed") return "done";
  if (["submitted", "ai_review", "guide_review", "changes_requested"].includes(status)) return "review";
  if (status === "rejected") return "todo";
  if (["backlog", "todo", "in_progress", "review", "done"].includes(status)) return status;
  return "todo"; // pending / overdue / anything unmapped
};

/**
 * Step 11 §2 — the visible status badge shown on every Task Page card.
 * Maps every real Task.status value (kanban columns + the submission
 * workflow states) onto the exact 7-state badge set the spec calls for,
 * without introducing a second/duplicate status system.
 */
const STATUS_BADGE = {
  backlog: { label: "⏳ Queued in Backlog", tone: "bg-slate-100 text-slate-600 border border-slate-200" },
  todo: { label: "⚪ Not Started", tone: "bg-cloud text-slate-muted" },
  pending: { label: "⚪ Not Started", tone: "bg-cloud text-slate-muted" },
  in_progress: { label: "🟡 In Progress", tone: "bg-brand-soft text-brand" },
  review: { label: "🔵 In Review", tone: "bg-amber-soft text-amber" },
  in_review: { label: "🔵 In Review", tone: "bg-amber-soft text-amber" },
  submitted: { label: "🔵 Waiting for Guide Review", tone: "bg-brand-soft text-brand" },
  ai_review: { label: "🟡 AI Analyzing", tone: "bg-brand-soft text-brand" },
  guide_review: { label: "🔵 Waiting for Guide Review", tone: "bg-amber-soft text-amber" },
  changes_requested: { label: "🟠 Changes Requested", tone: "bg-coral-soft text-coral" },
  overdue: { label: "🟡 In Progress", tone: "bg-brand-soft text-brand" },
  done: { label: "🟢 Completed", tone: "bg-mint/10 text-mint" },
  completed: { label: "🟢 Completed", tone: "bg-mint/10 text-mint" },
  rejected: { label: "🔴 Rejected", tone: "bg-coral-soft text-coral" },
};

const nameOf = (id) => dirName(id, "Unassigned");
const initials = (id) =>
  nameOf(id)
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
const colorOf = (id) => dirColor(id);
const dayDiff = (iso) => Math.round((new Date(iso).getTime() - Date.now()) / 86400000);

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
};

const DueChip = ({ due }) => {
  const { label, tone } = getDeadlineStatus(due);
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      <Clock className="w-3 h-3" /> {label}
    </span>
  );
};

/** Left accent strip so urgency is readable at a glance without opening the card. */
const urgencyAccent = (task) => {
  if (columnForStatus(task.status) === "done") return "before:bg-mint";
  const { accent } = getDeadlineStatus(task.due);
  return accent || "before:bg-slate-line";
};

const TaskCard = ({ task, currentUser, groupId, leaderId, onDragStart, onDelete, onSubmitted, onReviewed, onJumpToDetails }) => {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [pickedFiles, setPickedFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadPhase, setUploadPhase] = useState("idle"); // idle | uploading | analyzing
  const [uploadPct, setUploadPct] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [isDraggingZip, setIsDraggingZip] = useState(false);
  const fileInputRef = useRef(null);

  const validateAndAddFiles = (fileList) => {
    setSubmitError("");
    const valid = [];
    for (const f of fileList) {
      if (!f.name.toLowerCase().endsWith(".zip")) {
        setSubmitError(`"${f.name}" is not a ZIP file. Only .zip archives are allowed.`);
        continue;
      }
      if (f.size > taskService.MAX_UPLOAD_MB * 1024 * 1024) {
        setSubmitError(`"${f.name}" exceeds the maximum size limit of ${taskService.MAX_UPLOAD_MB}MB.`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length > 0) {
      setPickedFiles((prev) => [...prev, ...valid]);
    }
  };

  const removePickedFile = (indexToRemove) => {
    setPickedFiles((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const isAssignee = String(task.assigneeId) === String(currentUser?.id);
  const isGuide = currentUser?.role === "guide";
  const isTeamLeader = !isGuide && leaderId != null && String(leaderId) === String(currentUser?.id);

  const rawLatest = task.latestSubmission;
  const latestSubmissionStudentId = rawLatest?.student?.id ?? rawLatest?.student;
  const submission =
    isGuide || isTeamLeader || !rawLatest || String(latestSubmissionStudentId) === String(currentUser?.id)
      ? rawLatest
      : null;
  const isQueued = task.status === "backlog";
  const statusBadge = isQueued
    ? { label: "⏳ Queued in Backlog", tone: "bg-slate-100 text-slate-600 border border-slate-200" }
    : (STATUS_BADGE[task.status] || STATUS_BADGE.todo);
  const canSubmit = isAssignee && !isGuide && !["completed", "done", "backlog"].includes(task.status);
  const canReview = (isGuide || isTeamLeader) && task.status === "guide_review";

  const handleSubmit = async (e, action = "submit_for_review") => {
    if (e?.preventDefault) e.preventDefault();
    if (!pickedFiles.length && !note.trim()) {
      setSubmitError("Attach a .zip archive or add a note.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    const hasZip = pickedFiles.some((f) => f.name.toLowerCase().endsWith(".zip"));
    setUploadPhase(pickedFiles.length ? "uploading" : "analyzing");
    setUploadPct(0);
    try {
      const updated = await taskService.submitTask(groupId, task.id, {
        note: note.trim(),
        files: pickedFiles,
        action,
        onProgress: (pct) => {
          setUploadPct(pct);
          if (pct >= 100 && hasZip && action === "submit_for_review") setUploadPhase("analyzing");
        },
      });
      onSubmitted?.(updated);
      setNote("");
      setPickedFiles([]);
      // Smoothly navigate to the AI Verification & Missing Requirements section below
      setTimeout(() => {
        onJumpToDetails?.(task.id);
      }, 500);
    } catch (err) {
      setSubmitError(err.message || "Submission failed.");
    } finally {
      setSubmitting(false);
      setUploadPhase("idle");
    }
  };

  const handleReview = async (verdict) => {
    if (verdict !== "approved" && !feedback.trim()) {
      setSubmitError(
        verdict === "rejected" ? "Please enter a reason before rejecting." : "Please enter feedback before requesting changes."
      );
      return;
    }
    setReviewing(true);
    setSubmitError("");
    try {
      const updated = await taskService.reviewTask(groupId, task.id, { verdict, feedback: feedback.trim() });
      onReviewed?.(updated);
      setFeedback("");
    } catch (err) {
      setSubmitError(err.message || "Review failed.");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/90 dark:bg-[#151926]/90 p-3.5 pl-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] ${urgencyAccent(
        task
      )}`}
    >
      <div
        draggable
        onDragStart={(e) => onDragStart(e, task.id)}
        className="cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-ink leading-snug">{task.title}</p>
          <button
            onClick={() => onDelete(task.id)}
            title="Delete task"
            aria-label="Delete task"
            className="text-slate-muted hover:text-coral transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_PRIORITIES[task.priority]?.classes}`}>
            {TASK_PRIORITIES[task.priority]?.label}
          </span>
          <DueChip due={task.due} />
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.tone}`}>
            {statusBadge.label}
          </span>
          {task.tags?.map((t) => (
            <span key={t} className="rounded-full bg-cloud px-2 py-0.5 text-xs text-slate-muted">
              #{t}
            </span>
          ))}
        </div>

        {isQueued && (
          <div className="mt-2 rounded-lg bg-cloud/80 border border-slate-line/80 px-2.5 py-1.5 text-[11px] text-slate-600 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Queued · Unlocks automatically after active task is verified</span>
          </div>
        )}

        {/* Deliverable & Progress Stage */}
        <div className="mt-2.5 rounded-lg border border-brand/15 bg-brand-soft/30 p-2 text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 text-[10px]">
              {task.deliverableType && (
                <span className="rounded bg-brand/10 text-brand font-semibold px-1.5 py-0.5 uppercase">
                  📦 {task.deliverableType}
                </span>
              )}
              {task.verifiedBy && (
                <span className="rounded bg-mint/15 text-mint font-semibold px-1.5 py-0.5">
                  ✓ Verified by {task.verifiedBy}
                </span>
              )}
            </div>
            {task.due && (
              <span className="text-[10px] text-slate-muted font-medium shrink-0">
                Due: {formatDay(task.due)}
              </span>
            )}
          </div>

          {/* Progress Stage Bar */}
          <div className="pt-0.5">
            <div className="flex items-center justify-between text-[10px] font-medium text-slate-muted mb-1">
              <span>Progress: {task.progress ?? (task.status === "completed" || task.status === "done" ? 100 : task.status === "in_review" || task.status === "review" ? 90 : task.status === "in_progress" ? 10 : 0)}%</span>
              <span className="text-brand font-semibold">
                {task.progress === 100 || task.status === "completed" || task.status === "done"
                  ? "Done (100%)"
                  : task.progress === 90 || task.status === "in_review" || task.status === "review"
                  ? "In Review (90%)"
                  : task.progress === 10 || task.status === "in_progress"
                  ? "In Progress (10%)"
                  : "Not Started (0%)"}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-line/50 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  task.progress === 100 || task.status === "completed" || task.status === "done"
                    ? "bg-mint w-full"
                    : task.progress === 90 || task.status === "in_review" || task.status === "review"
                    ? "bg-amber w-[90%]"
                    : task.progress === 10 || task.status === "in_progress"
                    ? "bg-brand w-[10%]"
                    : "bg-slate-muted/20 w-0"
                }`}
              />
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span
              className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white"
              style={{ backgroundColor: colorOf(task.assigneeId) }}
            >
              {initials(task.assigneeId)}
            </span>
            <span className="text-xs text-slate-muted">{nameOf(task.assigneeId).split(" ")[0]}</span>
          </div>
          <span className="text-xs text-slate-muted">{task.estimate}h</span>
        </div>
      </div>

      {(canSubmit || canReview || submission) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 w-full flex items-center justify-center gap-1 text-xs font-medium text-brand border-t border-slate-line pt-2.5 hover:text-brand-deep transition-colors"
        >
          {expanded ? "Hide submission box" : canReview ? "Review submission" : canSubmit ? "Submit ZIP Archive" : "View submission status"}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      )}

      {expanded && (
        <div className="mt-2.5 space-y-3 text-xs">
          {/* If already submitted: show concise status banner + jump button */}
          {submission && (
            <div className="rounded-xl border border-slate-line/80 bg-cloud/50 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-ink">
                  Latest Submission (v{submission.version})
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  submission.verdict === "approved" || task.status === "completed"
                    ? "bg-mint/15 text-mint"
                    : submission.verdict === "changes_requested"
                    ? "bg-coral/15 text-coral"
                    : "bg-amber/15 text-amber"
                }`}>
                  {submission.verdict === "approved" || task.status === "completed"
                    ? "Approved (100%)"
                    : submission.verdict === "changes_requested"
                    ? "Changes Requested"
                    : "In Review (90%)"}
                </span>
              </div>
              <p className="text-[10px] text-slate-muted">
                Uploaded {formatDay(submission.submittedAt)} · {formatTime(submission.submittedAt)}
                {submission.files?.length > 0 ? ` · ${submission.files.length} file(s) attached` : ""}
              </p>

              <button
                type="button"
                onClick={() => onJumpToDetails?.(task.id)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-soft hover:bg-brand-soft/80 text-brand-deep border border-brand/20 py-1.5 text-xs font-semibold transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>View AI Instructions & Missing Files Below ↓</span>
              </button>
            </div>
          )}

          {/* Guide / Leader Review Controls */}
          {canReview && (
            <div className="space-y-1.5">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Feedback for student (required for Request Changes / Reject)"
                rows={2}
                className="w-full rounded-lg border border-slate-line bg-cloud px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={() => handleReview("approved")}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-mint px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Approve & Complete
                </button>
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={() => handleReview("changes_requested")}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Request Changes
                </button>
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={() => handleReview("rejected")}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-coral px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} Reject Submission
                </button>
              </div>
            </div>
          )}

          {/* Student ZIP Submission Only Form */}
          {canSubmit && (
            <form onSubmit={handleSubmit} className="space-y-2">
              {submitting ? (
                <div className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2.5 text-xs font-medium text-brand">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  {uploadPhase === "uploading" ? `Uploading… ${uploadPct}%` : "🔍 AI is analyzing your ZIP submission..."}
                </div>
              ) : (
                <>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingZip(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingZip(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingZip(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingZip(false);
                      if (e.dataTransfer?.files) {
                        validateAndAddFiles(Array.from(e.dataTransfer.files));
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`cursor-pointer rounded-xl border-2 border-dashed p-3 text-center transition-all ${
                      isDraggingZip
                        ? "border-brand bg-brand-soft/70 scale-[1.01]"
                        : "border-slate-line/80 bg-cloud/50 hover:bg-cloud/80 hover:border-brand/40"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".zip"
                      onChange={(e) => {
                        validateAndAddFiles(Array.from(e.target.files || []));
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                    <div className="flex flex-col items-center justify-center gap-1 pointer-events-none">
                      <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                        <FolderArchive className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-xs font-medium text-slate-ink">
                        Drag & drop <span className="font-semibold text-brand">.zip</span> or <span className="text-brand underline">browse</span>
                      </p>
                      <p className="text-[10px] text-slate-muted">
                        Max size: {taskService.MAX_UPLOAD_MB}MB
                      </p>
                    </div>
                  </div>

                  {pickedFiles.length > 0 && (
                    <div className="space-y-1">
                      {pickedFiles.map((file, idx) => (
                        <div
                          key={`${file.name}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-brand/20 bg-paper px-2.5 py-1.5 text-xs shadow-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FolderArchive className="w-3.5 h-3.5 text-brand shrink-0" />
                            <span className="font-medium text-slate-ink truncate" title={file.name}>
                              {file.name}
                            </span>
                            <span className="text-[10px] text-slate-muted shrink-0 font-mono">
                              ({formatFileSize(file.size)})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePickedFile(idx);
                            }}
                            className="p-1 rounded text-slate-muted hover:text-coral hover:bg-coral-soft transition-colors shrink-0"
                            title="Remove file"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="w-full rounded-lg border border-slate-line bg-cloud px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                  />

                  <div className="flex flex-col sm:flex-row gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={(e) => handleSubmit(e, "upload_only")}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-line bg-paper px-2 py-1.5 text-xs font-medium text-slate-ink hover:bg-cloud disabled:opacity-60 transition-colors"
                      title="Upload ZIP as evidence"
                    >
                      <Upload className="w-3 h-3 text-slate-muted" />
                      Save Evidence
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={(e) => handleSubmit(e, "submit_for_review")}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-brand px-2 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-60 transition-colors shadow-sm"
                      title="Submit ZIP for AI & guide review"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Submit ZIP
                    </button>
                  </div>

                  {/* Informational hint pointing to inspection section below */}
                  <p className="text-[10px] text-slate-muted text-center pt-1">
                    AI verification, missing files checklist & instructions are detailed below ↓
                  </p>
                </>
              )}
            </form>
          )}

          {submitError && <p className="text-coral text-xs">{submitError}</p>}
        </div>
      )}
    </article>
  );
};

/** Skeleton placeholder for a kanban column while the board is loading. */
const ColumnSkeleton = ({ label }) => (
  <section className="flex min-h-[220px] w-[280px] sm:w-[320px] shrink-0 md:w-auto flex-col gap-2.5 rounded-xl2 border border-slate-line bg-cloud/60 p-3">
    <header className="flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted">{label}</h2>
      <span className="h-4 w-5 rounded-full bg-slate-line/60 animate-pulse" />
    </header>
    {[0, 1].map((i) => (
      <div key={i} className="h-[92px] rounded-xl border border-slate-line bg-paper/70 animate-pulse" />
    ))}
  </section>
);

const Tasks = () => {
  const { user } = useAuth();
  const { groups, activeGroupId, setActiveGroupId } = useGroups();
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dragOver, setDragOver] = useState(null);
  const [form, setForm] = useState({ title: "", description: "" });
  const [showForm, setShowForm] = useState(false);
  const [aiPreview, setAiPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [showAiInsights, setShowAiInsights] = useState(false);

  useEffect(() => {
    if (groupId || !groups.length) return;
    // Resume the exact group the student was last viewing (e.g. in
    // GroupDetails/Chat) rather than defaulting to groups[0] — critical
    // when two groups share the same name, since groups[0] could silently
    // select the wrong "Team Vision".
    const active = activeGroupId && groups.some((g) => g.id === activeGroupId) ? activeGroupId : null;
    setGroupId(active || groups[0].id);
  }, [groups, groupId, activeGroupId]);

  const loadTasks = useCallback(() => {
    if (!groupId) return;
    setLoading(true);
    setLoadError("");
    taskService
      .getTasks(groupId)
      .then((t) => {
        setTasks(t);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err.message || "Tasks could not be loaded.");
        setLoading(false);
      });
  }, [groupId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // STEP 23 — AI Sprint Planner: student-safe view of the current applied
  // sprint, if any. Purely additive read — never mutates a task, and only
  // ever shows tasks assigned to this student (see backend
  // sprintPlannerService.shapeForStudent). No separate task lifecycle is
  // introduced; this reuses the same Task objects already loaded above.
  const [currentSprint, setCurrentSprint] = useState(null);
  useEffect(() => {
    if (!groupId) return;
    sprintPlannerService
      .getCurrentSprint(groupId)
      .then(setCurrentSprint)
      .catch(() => setCurrentSprint(null));
  }, [groupId]);

  // STEP 24 — AI Conflict Detection: student-safe notices only, for
  // conflicts that actually involve this student (backend already shapes
  // the response — see conflictController.list + shapeForStudent). Never
  // shows other members' data, evidence, or guide-only reasoning.
  const [myConflictNotices, setMyConflictNotices] = useState([]);
  useEffect(() => {
    if (!groupId) return;
    conflictService
      .getConflicts(groupId)
      .then((data) => setMyConflictNotices(Array.isArray(data) ? data : []))
      .catch(() => setMyConflictNotices([]));
  }, [groupId]);

  const group = groups.find((g) => g.id === groupId);
  const memberIds = group?.memberIds || [];
  const groupMembers = group?.members || [];
  const insights = useMemo(() => taskService.getWorkloadInsights(tasks, memberIds, groupMembers), [tasks, memberIds, groupMembers]);
  // getWorkloadInsights() returns { load: [{ hours, openCount, percentage, ... }], suggestions } —
  // derive the team average from that real data rather than a nonexistent field.
  const avgLoadHours = useMemo(() => {
    if (!insights.load.length) return 0;
    return Math.round((insights.load.reduce((sum, l) => sum + l.hours, 0) / insights.load.length) * 10) / 10;
  }, [insights.load]);

  // Real, derived-only summary counts — scoped strictly to the student if user is a student
  const stats = useMemo(() => {
    const currentUserId = String(user?.id || user?._id || "");
    const scopedTasks = user?.role === "student"
      ? tasks.filter((t) => {
          const assigneeId = String(t.assignee?.id || t.assignee?._id || t.assignee || t.assigneeId || "");
          return !assigneeId || !currentUserId || assigneeId === currentUserId;
        })
      : tasks;
    const total = scopedTasks.length;
    const completed = scopedTasks.filter((t) => columnForStatus(t.status) === "done").length;
    const inProgress = scopedTasks.filter((t) => columnForStatus(t.status) === "in_progress").length;
    const overdue = scopedTasks.filter((t) => columnForStatus(t.status) !== "done" && dayDiff(t.due) < 0).length;
    return { total, completed, inProgress, overdue };
  }, [tasks, user]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const currentUserId = String(user?.id || user?._id || "");
    return tasks.filter((t) => {
      // Strict Student Isolation guard on the client side:
      if (user?.role === "student") {
        const assigneeId = String(t.assignee?.id || t.assignee?._id || t.assignee || t.assigneeId || "");
        if (assigneeId && currentUserId && assigneeId !== currentUserId) return false;
      }
      if (q && !t.title?.toLowerCase().includes(q)) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (statusFilter !== "all" && columnForStatus(t.status) !== statusFilter) return false;
      return true;
    });
  }, [tasks, search, priorityFilter, statusFilter, user]);

  // Tasks to show in the detailed AI inspection section below the board
  const detailedInspectionTasks = useMemo(() => {
    const currentUserId = String(user?.id || user?._id || "");
    return tasks.filter((t) => {
      if (user?.role === "student") {
        const assigneeId = String(t.assignee?.id || t.assignee?._id || t.assignee || t.assigneeId || "");
        if (assigneeId && currentUserId && assigneeId !== currentUserId) return false;
      }
      return true;
    });
  }, [tasks, user]);

  const scrollToTaskDetail = (taskId) => {
    const el = document.getElementById(`task-detail-${taskId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-brand", "ring-offset-2");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-brand", "ring-offset-2");
      }, 2500);
    }
  };

  // Tasks with submissions that this user is authorized to review/view
  const myReviewTasks = useMemo(() => {
    const currentUserId = String(user?.id || user?._id || "");
    return tasks.filter((t) => {
      if (!t.submissions?.length) return false;
      if (user?.role === "student") {
        const assigneeId = String(t.assignee?.id || t.assignee?._id || t.assignee || t.assigneeId || "");
        if (assigneeId && currentUserId && assigneeId !== currentUserId) return false;
      }
      return true;
    });
  }, [tasks, user]);

  const filtersActive = search.trim() || priorityFilter !== "all" || statusFilter !== "all";
  const visibleColumns = statusFilter === "all" ? TASK_STATUSES : TASK_STATUSES.filter((c) => c.id === statusFilter);

  const handleDragStart = (e, id) => e.dataTransfer.setData("text/plain", id);

  const handleDrop = async (e, status) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const taskBeingMoved = tasks.find((t) => (t.id === id || t._id === id));
    if (taskBeingMoved?.status === "backlog" && user?.role === "student" && !canCreateTask) {
      alert("This task is queued in your backlog. Complete and verify your active focus task to automatically unlock this task.");
      return;
    }
    if ((status === "done" || status === "completed") && user?.role === "student" && !canCreateTask) {
      alert("Students cannot manually mark tasks as Completed. Tasks are completed automatically by AI when you submit a verified ZIP archive satisfying all requirements.");
      return;
    }
    try {
      const moved = await taskService.moveTask(groupId, id, status);
      setTasks((prev) => prev.map((t) => ((t.id === id || t._id === id) ? { ...t, ...moved } : t)));
    } catch (err) {
      if (err.message) alert(err.message);
    } finally {
      loadTasks();
    }
  };

  const handleGenerateAiPreview = async (e) => {
    e?.preventDefault?.();
    if (!canCreateTask) return;
    if (!form.title.trim()) return;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const preview = await taskService.previewTask(groupId, {
        title: form.title.trim(),
        description: form.description.trim(),
      });
      setAiPreview(preview);
    } catch (err) {
      setPreviewError(err.message || "Failed to generate AI task preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmCreate = async () => {
    if (!canCreateTask || creatingTask) return;
    if (!form.title.trim()) return;
    setCreatingTask(true);
    setPreviewError("");
    try {
      const created = await taskService.createTask(groupId, {
        title: form.title.trim(),
        description: form.description.trim(),
      });
      setTasks((prev) => [created, ...prev]);
      setForm({ title: "", description: "" });
      setAiPreview(null);
      setShowForm(false);
      loadTasks();
    } catch (err) {
      setPreviewError(err.message || "Task creation failed.");
    } finally {
      setCreatingTask(false);
    }
  };

  const handleCreateDirectly = async (e) => {
    e?.preventDefault?.();
    await handleConfirmCreate();
  };

  const isLeader =
    (group?.leaderId != null && String(group.leaderId) === String(user?.id)) ||
    (group?.leader && String(group.leader.id || group.leader._id || group.leader) === String(user?.id)) ||
    (group?.leaderEmail && user?.email && String(group.leaderEmail).toLowerCase() === String(user.email).toLowerCase());
  const canRequestAiAssignment = user?.role === "guide" || user?.role === "admin" || isLeader;
  const canCreateTask = user?.role === "guide" || user?.role === "admin" || isLeader;

  const activeFocusTask = useMemo(() => {
    if (user?.role !== "student") return null;
    const currentUserId = String(user?.id || user?._id || "");
    return tasks.find((t) => {
      const assigneeId = String(t.assignee?.id || t.assignee?._id || t.assignee || t.assigneeId || "");
      if (assigneeId !== currentUserId) return false;
      return (
        ["todo", "in_progress", "review", "submitted", "ai_review", "guide_review", "changes_requested"].includes(t.status) ||
        t.isActiveTask === true
      );
    });
  }, [tasks, user]);


  const handleDelete = async (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id && t._id !== id));
    await taskService.deleteTask(groupId, id);
    loadTasks();
  };

  return (
    <>
      <Navbar title="Tasks" subtitle="Track your assignments, deadlines, and progress across your project groups." />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6">
        {/* No groups at all — nothing to show a board for */}
        {groups.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
            <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
              <Users className="w-5 h-5 text-slate-muted" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-ink">No project groups yet</p>
              <p className="text-xs text-slate-muted mt-1 max-w-sm">
                Tasks live inside project groups. Join or get added to a group to see your board here.
              </p>
            </div>
            <button
              onClick={() => navigate(ROUTES.STUDENT_GROUPS)}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep transition-colors"
            >
              Go to groups
            </button>
          </div>
        ) : (
          <>
            {/* Current sprint — Step 23, student-safe (only this student's tasks) */}
            {currentSprint && currentSprint.myTasks?.length > 0 && (
              <div className="bg-brand-soft border border-brand/20 rounded-xl2 p-4 flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-paper flex items-center justify-center shrink-0">
                  <CalendarRange className="w-4 h-4 text-brand" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-ink">
                    {currentSprint.title || "Current sprint"}: {formatDay(currentSprint.sprintStart)} – {formatDay(currentSprint.sprintEnd)}
                  </p>
                  <p className="text-xs text-slate-muted mt-0.5">
                    You have {currentSprint.myTasks.length} task{currentSprint.myTasks.length === 1 ? "" : "s"} in this sprint.
                  </p>
                </div>
              </div>
            )}

            {/* Collaboration notices — Step 24, student-safe only */}
            {myConflictNotices.length > 0 && (
              <div className="space-y-2">
                {myConflictNotices.map((n) => (
                  <div key={n.conflictId} className="bg-amber-soft border border-amber/20 rounded-xl2 p-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-full bg-paper flex items-center justify-center shrink-0">
                      <ShieldAlert className="w-4 h-4 text-amber" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-ink">{n.title}</p>
                      <p className="text-xs text-slate-muted mt-0.5">{n.summary}</p>
                      {n.nextAction && <p className="text-xs text-amber font-medium mt-1">Next: {n.nextAction}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Summary */}
            <div className="space-y-3">
              <SectionHeading title="Overview" />
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <StatsCard label="Total tasks" value={loading ? "…" : stats.total} icon={ListTodo} tone="brand" />
                <StatsCard label="In progress" value={loading ? "…" : stats.inProgress} icon={KanbanSquare} tone="amber" />
                <StatsCard label="Completed" value={loading ? "…" : stats.completed} icon={CheckCircle2} tone="mint" />
                <StatsCard label="Overdue" value={loading ? "…" : stats.overdue} icon={AlertTriangle} tone="coral" />
              </div>
            </div>

            {/* Group switcher + new task */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5 rounded-full bg-cloud p-1 overflow-x-auto">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setGroupId(g.id);
                      setActiveGroupId(g.id);
                    }}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      g.id === groupId ? "bg-paper text-slate-ink shadow-sm" : "text-slate-muted hover:text-slate-ink"
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-muted">
                {stats.completed}/{stats.total} tasks done
              </span>
              {/* ISSUE #3 FIX — hidden entirely for a plain student/member;
                  only the guide or this group's team leader ever sees it. */}
              {canCreateTask && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setPlanModalOpen(true)}
                    title="Generate and assign tasks for group members with AI"
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft hover:bg-brand-soft/80 text-brand-deep px-3.5 py-2 text-sm font-semibold transition-colors"
                  >
                    <Sparkles className="w-4 h-4" /> AI Project Plan & Assign
                  </button>
                  <button
                    onClick={() => {
                      setShowForm((s) => !s);
                      setAiRec(null);
                      setAiError("");
                      setAiExpansion(null);
                      setAiExpansionError("");
                      setAiPlan(null);
                      setAiPlanError("");
                      setAiPlanApplyOnCreate(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep transition-colors"
                  >
                    <Plus className="w-4 h-4" /> New task
                  </button>
                </div>
              )}
            </div>

            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-3 shadow-panel backdrop-blur-md">
              <div className="flex items-center gap-2 bg-cloud rounded-full px-3.5 py-2 flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-slate-muted shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tasks…"
                  aria-label="Search tasks"
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-slate-muted min-w-0"
                />
              </div>
              <div className="flex items-center gap-1.5 text-slate-muted">
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="rounded-full border border-slate-line bg-cloud px-3 py-2 text-sm text-slate-ink outline-none focus:border-brand"
              >
                <option value="all">All statuses</option>
                {TASK_STATUSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                aria-label="Filter by priority"
                className="rounded-full border border-slate-line bg-cloud px-3 py-2 text-sm text-slate-ink outline-none focus:border-brand"
              >
                <option value="all">All priorities</option>
                {Object.entries(TASK_PRIORITIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label} priority
                  </option>
                ))}
              </select>
              {filtersActive && (
                <button
                  onClick={() => {
                    setSearch("");
                    setPriorityFilter("all");
                    setStatusFilter("all");
                  }}
                  className="text-xs font-medium text-brand hover:underline shrink-0"
                >
                  Clear filters
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAiInsights((v) => !v)}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-all ${
                  showAiInsights
                    ? "bg-brand text-white border-brand shadow-xs"
                    : "bg-paper text-slate-muted border-slate-line hover:text-slate-ink hover:border-slate-300"
                }`}
                title={showAiInsights ? "Hide AI Workload Insights" : "Show AI Workload Insights"}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Insights {showAiInsights ? "▲ Hide" : "▼ Show"}</span>
              </button>
            </div>

            {/* ISSUE #3 FIX — the create-task form itself is never rendered
                for an unauthorized user, even if `showForm` were somehow
                set to true (e.g. stray state) — the buttons that set it
                are already hidden above, this is the belt-and-suspenders
                second layer on the frontend; the backend is the real
                authority (see taskController.create). */}
            {showForm && canCreateTask && (
              <div className="rounded-2xl border border-brand/20 bg-paper p-5 shadow-panel space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-line/60">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-bold">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-ink">AI-Controlled Task Creation</h3>
                      <p className="text-xs text-slate-muted">Provide only the title and description. TeamSync AI handles breakdown, assignment, and deadlines.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setAiPreview(null);
                      setPreviewError("");
                    }}
                    className="p-1.5 text-slate-muted hover:text-slate-ink hover:bg-cloud rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-ink mb-1">
                      Task Title <span className="text-coral">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="e.g., Implement secure JWT authentication and role-based route guard"
                      className="w-full rounded-xl border border-slate-line bg-cloud px-3.5 py-2.5 text-sm text-slate-ink placeholder:text-slate-muted/60 outline-none focus:border-brand focus:bg-paper transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-ink mb-1">
                      Task Description & Requirements
                    </label>
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Provide context, expected deliverables, or requirements for the AI to analyze..."
                      className="w-full rounded-xl border border-slate-line bg-cloud px-3.5 py-2.5 text-sm text-slate-ink placeholder:text-slate-muted/60 outline-none focus:border-brand focus:bg-paper transition-all resize-none"
                    />
                  </div>

                  {previewError && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-coral/10 border border-coral/20 text-xs text-coral">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{previewError}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div className="text-[11px] text-slate-muted flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-mint animate-pulse" />
                      <span>AI evaluates 1-active-task rule & project schedule automatically</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateAiPreview}
                        disabled={!form.title.trim() || previewLoading || creatingTask}
                        className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-deep transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {previewLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {previewLoading ? "Analyzing with AI..." : "Generate AI Task Preview"}
                      </button>

                      <button
                        type="button"
                        onClick={handleCreateDirectly}
                        disabled={!form.title.trim() || creatingTask || previewLoading}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-line bg-cloud hover:bg-paper px-3.5 py-2 text-xs font-medium text-slate-ink transition-colors disabled:opacity-50"
                      >
                        {creatingTask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        <span>Create Directly</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Task Breakdown & Assignment Preview Modal */}
            {aiPreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-ink/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-paper border border-slate-line rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-5">
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-line">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="p-1 rounded-lg bg-brand/10 text-brand">
                          <Sparkles className="w-4 h-4" />
                        </span>
                        <h2 className="text-base font-bold text-slate-ink">AI Task Breakdown & Assignment Preview</h2>
                      </div>
                      <p className="text-xs text-brand font-medium">
                        {aiPreview.notice || "These task details and assignment were generated by AI from the provided title and description."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAiPreview(null)}
                      className="p-1 rounded-lg text-slate-muted hover:text-slate-ink hover:bg-cloud"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Task Header & Objective */}
                  <div className="space-y-2 p-3.5 rounded-xl bg-cloud/50 border border-slate-line/60">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-ink">{aiPreview.title}</h3>
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-brand/10 text-brand border border-brand/20">
                          {aiPreview.deliverableType || "code"}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber/10 text-amber border border-amber/20">
                          {aiPreview.priority}
                        </span>
                      </div>
                    </div>
                    {aiPreview.objective && (
                      <p className="text-xs text-slate-ink">
                        <strong className="text-slate-muted">Objective: </strong>
                        {aiPreview.objective}
                      </p>
                    )}
                    {aiPreview.problemStatement && (
                      <p className="text-xs text-slate-muted">
                        <strong className="text-slate-ink">Problem Statement: </strong>
                        {aiPreview.problemStatement}
                      </p>
                    )}
                  </div>

                  {/* AI Assignee Selection with 1-Active-Task Badge */}
                  <div className="p-4 rounded-xl border border-brand/20 bg-brand-soft/20 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-ink uppercase tracking-wider flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-brand" /> AI Assignee Selection
                      </span>
                      {aiPreview.aiAssignment?.eligibilityStatus === "ASSIGNED" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-mint-soft text-mint border border-mint/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Eligible (0 Active Tasks)
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-coral-soft text-coral border border-coral/30 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> No Free Assignee (Queued to Backlog)
                        </span>
                      )}
                    </div>

                    {aiPreview.aiAssignment?.eligibilityStatus === "ASSIGNED" ? (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-ink">
                          Selected Member: <span className="text-brand font-bold">{aiPreview.aiAssignment.studentName}</span>
                          {aiPreview.aiAssignment.confidence > 0 && (
                            <span className="text-xs font-normal text-slate-muted ml-2">({aiPreview.aiAssignment.confidence}/100 match score)</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-muted leading-relaxed">{aiPreview.aiAssignment.assignmentReason}</p>
                      </div>
                    ) : (
                      <div className="space-y-1 text-xs text-coral">
                        <p className="font-semibold">{aiPreview.aiAssignment?.assignmentReason}</p>
                        <p className="text-slate-muted text-[11px]">Strict policy: Every student can work on only 1 active task at a time.</p>
                      </div>
                    )}
                  </div>

                  {/* Implementation Steps */}
                  {aiPreview.implementationPlan?.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-ink uppercase tracking-wider">Step-by-Step Implementation Plan</h4>
                      <div className="space-y-1.5">
                        {aiPreview.implementationPlan.map((s, idx) => (
                          <div key={idx} className="p-2.5 rounded-xl border border-slate-line bg-cloud/30 text-xs space-y-1">
                            <p className="font-semibold text-slate-ink">
                              {s.stepNumber || idx + 1}. {s.title}
                            </p>
                            {s.description && <p className="text-slate-muted text-[11px]">{s.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expected Files & Criteria */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border border-slate-line bg-cloud/30 space-y-1.5">
                      <h4 className="text-xs font-bold text-slate-ink uppercase tracking-wider flex items-center gap-1">
                        <FolderArchive className="w-3.5 h-3.5 text-brand" /> Expected Deliverables
                      </h4>
                      <ul className="text-xs text-slate-muted space-y-1 list-disc pl-4">
                        {aiPreview.expectedFiles?.map((f, i) => (
                          <li key={i} className="font-mono text-[11px]">{f}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 rounded-xl border border-slate-line bg-cloud/30 space-y-1.5">
                      <h4 className="text-xs font-bold text-slate-ink uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-mint" /> Acceptance Criteria
                      </h4>
                      <ul className="text-xs text-slate-muted space-y-1 list-disc pl-4">
                        {aiPreview.completionCriteria?.map((c, i) => (
                          <li key={i} className="text-[11px]">{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Deadline & Priority Context */}
                  <div className="p-3 rounded-xl border border-slate-line bg-cloud/40 flex items-center justify-between gap-3 flex-wrap text-xs">
                    <div>
                      <p className="font-semibold text-slate-ink">
                        Deadline: {formatDay(aiPreview.due)}
                      </p>
                      <p className="text-[11px] text-slate-muted">{aiPreview.deadlineSource}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-ink">
                        Priority: {aiPreview.priority?.toUpperCase()}
                      </p>
                      <p className="text-[11px] text-slate-muted">{aiPreview.priorityRationale}</p>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-line">
                    <button
                      type="button"
                      onClick={() => setAiPreview(null)}
                      className="px-4 py-2 rounded-xl border border-slate-line text-xs font-semibold text-slate-muted hover:text-slate-ink hover:bg-cloud transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmCreate}
                      disabled={creatingTask}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-brand hover:bg-brand-deep text-white text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                    >
                      {creatingTask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {creatingTask ? "Creating Task..." : "Confirm & Create Task"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {loadError && (
              <div className="flex items-center justify-between gap-3 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
                  <p className="text-sm text-coral truncate">Tasks could not be loaded — {loadError}</p>
                </div>
                <button
                  onClick={loadTasks}
                  className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-paper border border-coral/30 px-3 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            )}

            {!loadError && (
              <div className="space-y-6">
                {user?.role === "student" && activeFocusTask && (
                  <div className="bg-brand-soft/60 border border-brand/20 rounded-xl2 p-4 flex items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-full bg-paper border border-brand/20 flex items-center justify-center shrink-0">
                        <Sparkles className="w-5 h-5 text-brand-deep" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-full bg-brand text-white">
                            Current Active Focus Task (1 Task Policy)
                          </span>
                          {activeFocusTask.due && (
                            <span className="text-xs font-medium text-slate-muted">
                              Deadline: {formatDay(activeFocusTask.due)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-ink mt-0.5 truncate">
                          {activeFocusTask.title}
                        </p>
                        <p className="text-xs text-slate-muted line-clamp-1">
                          {activeFocusTask.whatToDo || activeFocusTask.description || "Submit verified deliverables/ZIP to complete this task and automatically unlock your next queued task."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className={`grid gap-5 items-start ${showAiInsights ? "xl:grid-cols-[1fr_320px]" : "grid-cols-1"}`}>
                  <div className="min-w-0">
                    {loading ? (
                      <div className="flex overflow-x-auto pb-4 gap-3 md:grid md:grid-cols-3 xl:grid-cols-5">
                        {TASK_STATUSES.map((col) => (
                          <ColumnSkeleton key={col.id} label={col.label} />
                        ))}
                      </div>
                    ) : tasks.length === 0 ? (
                      <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
                        <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
                          <Inbox className="w-5 h-5 text-slate-muted" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-slate-ink">No tasks yet</p>
                          <p className="text-xs text-slate-muted mt-1 max-w-sm">
                            Tasks assigned to you will appear here.
                          </p>
                        </div>
                        {/* ISSUE #3 FIX — same gating as the toolbar button above. */}
                        {canCreateTask && (
                          <button
                            onClick={() => setShowForm(true)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep transition-colors"
                          >
                            <Plus className="w-4 h-4" /> New task
                          </button>
                        )}
                      </div>
                    ) : filteredTasks.length === 0 ? (
                      <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
                        <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
                          <Search className="w-5 h-5 text-slate-muted" />
                        </span>
                        <p className="text-sm font-medium text-slate-ink">No tasks match these filters</p>
                        <button
                          onClick={() => {
                            setSearch("");
                            setPriorityFilter("all");
                            setStatusFilter("all");
                          }}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Clear filters
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`flex overflow-x-auto pb-4 gap-3 md:grid ${
                          visibleColumns.length > 1 ? (showAiInsights ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-3 lg:grid-cols-5") : "grid-cols-1"
                        }`}
                      >
                        {visibleColumns.map((col) => {
                          const items = filteredTasks.filter((t) => columnForStatus(t.status) === col.id);
                          return (
                            <section
                              key={col.id}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setDragOver(col.id);
                              }}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={(e) => handleDrop(e, col.id)}
                              className={`flex min-h-[220px] w-[280px] sm:w-[320px] shrink-0 md:w-auto flex-col gap-2.5 rounded-xl2 border p-3.5 transition-colors ${
                                dragOver === col.id ? "border-brand bg-brand-soft" : "border-slate-line bg-cloud/60"
                              }`}
                            >
                              <header className="flex items-center justify-between pb-0.5">
                                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted">{col.label}</h2>
                                <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-slate-muted">{items.length}</span>
                              </header>
                              {!items.length && <p className="text-xs text-slate-muted/70">Drop tasks here</p>}
                              {items.map((t) => (
                                <TaskCard
                                  key={t.id}
                                  task={t}
                                  currentUser={user}
                                  groupId={groupId}
                                  leaderId={group?.leaderId}
                                  onDragStart={handleDragStart}
                                  onDelete={handleDelete}
                                  onJumpToDetails={scrollToTaskDetail}
                                  onSubmitted={(updated) => {
                                    setTasks((prev) => prev.map((x) => ((x.id === updated.id || x._id === updated.id || x.id === updated._id || x._id === updated._id) ? { ...x, ...updated } : x)));
                                    loadTasks();
                                  }}
                                  onReviewed={(updated) => {
                                    setTasks((prev) => prev.map((x) => ((x.id === updated.id || x._id === updated.id || x.id === updated._id || x._id === updated._id) ? { ...x, ...updated } : x)));
                                    loadTasks();
                                  }}
                                />
                              ))}
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {showAiInsights && (
                    <aside className="space-y-4">
                      <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                        <div className="flex items-center justify-between">
                          <SectionHeading icon={Sparkles} title="AI workload balance" />
                          {tasks.length > 0 && (
                            <span className="text-[11px] font-semibold text-brand bg-brand/10 border border-brand/20 px-2.5 py-0.5 rounded-full">
                              Team: {insights.teamAvgProgress}% avg
                            </span>
                          )}
                        </div>

                        {/* Updation terms & lifecycle progression banner */}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-muted bg-cloud/70 rounded-lg p-2 border border-slate-line/50">
                          <span className="font-semibold text-slate-ink">Lifecycle:</span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand/10 text-brand font-medium">
                            Progress 10%
                          </span>
                          <span>→</span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber/10 text-amber font-medium">
                            In Review 90%
                          </span>
                          <span>→</span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-mint/10 text-mint font-medium">
                            Done 100%
                          </span>
                        </div>

                        <div className="mt-4 space-y-3.5">
                          {insights.load.length === 0 ? (
                            <p className="text-xs text-slate-muted">No members found in this group.</p>
                          ) : (
                            insights.load.map((l) => {
                              const pct = Math.min(100, Math.max(0, l.percentage || 0));
                              const stageBadge =
                                l.totalCount === 0
                                  ? { label: "No tasks", tone: "bg-cloud text-slate-muted border-slate-200" }
                                  : pct === 100
                                  ? { label: "Done (100%)", tone: "bg-mint-soft text-mint border-mint/30" }
                                  : pct >= 90
                                  ? { label: "In Review (90%)", tone: "bg-amber-soft text-amber border-amber/30" }
                                  : pct >= 10
                                  ? { label: "In Progress (10%)", tone: "bg-brand/10 text-brand border-brand/30" }
                                  : { label: "Todo (0%)", tone: "bg-cloud text-slate-muted border-slate-200" };

                              const stageColor =
                                pct === 100
                                  ? "bg-mint"
                                  : pct >= 90
                                  ? "bg-amber"
                                  : pct >= 10
                                  ? "bg-gradient-to-r from-brand to-mint"
                                  : "bg-transparent";

                              return (
                                <div key={l.id} className="space-y-1.5 rounded-lg border border-slate-line/60 bg-cloud/30 p-2.5 transition-colors">
                                  <div className="flex items-center justify-between text-xs">
                                    <div className="min-w-0 pr-2">
                                      <p className="font-semibold text-slate-ink truncate" title={l.name}>
                                        {l.name}
                                      </p>
                                      <p className="text-[11px] text-slate-muted mt-0.5">
                                        {l.totalCount > 0
                                          ? `${l.openCount} open · ${l.totalCount} task${l.totalCount === 1 ? "" : "s"}${l.hours > 0 ? ` (${l.hours}h)` : ""}`
                                          : "No tasks assigned"}
                                      </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border ${stageBadge.tone}`}>
                                        {stageBadge.label}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-2 rounded-full bg-cloud overflow-hidden border border-slate-line/40">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${stageColor}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-line/60 flex items-center justify-between text-[11px] text-slate-muted">
                          <span>Total open: {insights.totalOpenCount} task{insights.totalOpenCount === 1 ? "" : "s"}{insights.totalHours > 0 ? ` (${insights.totalHours}h)` : ""}</span>
                          <span className="font-semibold text-slate-ink">Team avg: {insights.teamAvgProgress}%</span>
                        </div>
                      </div>

                      <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                        <SectionHeading icon={AlertTriangle} title="Suggestions" />
                        <ul className="mt-3 space-y-2.5">
                          {insights.suggestions.map((s, i) => (
                            <li key={i} className="rounded-lg bg-cloud px-3 py-2 text-xs leading-relaxed text-slate-ink">
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </aside>
                  )}
                </div>

              {/* Full-width AI Task Verification, Missing Requirements & Instructions Section */}
              <section id="ai-inspection-section" className="rounded-2xl border border-slate-line bg-paper p-6 shadow-panel space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-line">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-ink flex items-center gap-2">
                        AI Task Verification, Missing Requirements & Instructions
                        <span className="text-[11px] font-semibold bg-brand/10 text-brand px-2.5 py-0.5 rounded-full border border-brand/20">
                          Inspection & Feedback
                        </span>
                      </h2>
                      <p className="text-xs text-slate-muted">
                        All AI task instructions, required deliverable files, automated verification reports, missing requirements, and code quality reviews.
                      </p>
                    </div>
                  </div>

                  {/* Summary pills */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-mint-soft text-mint border border-mint/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {detailedInspectionTasks.filter((t) => t.status === "completed" || t.status === "done").length} Verified (100%)
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-soft text-amber border border-amber/20">
                      <Clock className="w-3.5 h-3.5" />
                      {detailedInspectionTasks.filter((t) => ["in_review", "review", "submitted", "ai_review", "guide_review"].includes(t.status)).length} In Review (90%)
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-coral-soft text-coral border border-coral/20">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {detailedInspectionTasks.filter((t) => t.status === "changes_requested" || t.submissions?.some((s) => s.aiAnalysis?.relevance?.isIrrelevant || s.verification?.status === "FAIL" || s.verification?.status === "NEEDS_REVIEW")).length} Missing Requirements / Action Items
                    </span>
                  </div>
                </div>

                {/* Submissions & Detailed Task Cards */}
                {detailedInspectionTasks.length === 0 ? (
                  <div className="text-center py-8 text-slate-muted text-xs space-y-2">
                    <FolderArchive className="w-8 h-8 mx-auto text-slate-muted/50" />
                    <p className="font-medium">No tasks assigned yet.</p>
                    <p className="text-[11px]">Tasks, AI instructions, and automated verification analyses will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {detailedInspectionTasks.map((taskItem) => {
                      const sub = taskItem.latestSubmission || (taskItem.submissions && taskItem.submissions[taskItem.submissions.length - 1]);
                      const ai = sub?.aiAnalysis || {};
                      const ver = sub?.verification || ai?.verification || {};
                      const isPass = taskItem.status === "completed" || ver.status === "PASS";
                      const isWrongProject = ai.relevance?.isIrrelevant || ai.implementationStatus === "WRONG_PROJECT";
                      const isUnreadable = ai.implementationStatus === "UNREADABLE_ZIP";
                      const isNeedsChanges = taskItem.status === "changes_requested" || ver.status === "FAIL" || ver.status === "NEEDS_REVIEW";

                      return (
                        <div
                          key={taskItem.id || taskItem._id}
                          id={`task-detail-${taskItem.id || taskItem._id}`}
                          className="rounded-xl border border-slate-line/80 bg-cloud/20 p-5 space-y-5 transition-all scroll-mt-20"
                        >
                          {/* Task Header */}
                          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-line/60 pb-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-sm font-bold text-slate-ink">{taskItem.title}</h3>
                                {taskItem.module && (
                                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-paper border border-slate-line text-slate-muted">
                                    {taskItem.module}
                                  </span>
                                )}
                                {taskItem.deliverableType && (
                                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-brand/10 text-brand">
                                    📦 {taskItem.deliverableType}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-muted">
                                Assigned to: <strong className="text-slate-ink">{nameOf(taskItem.assigneeId)}</strong>
                                {taskItem.due ? ` · Deadline: ${formatDay(taskItem.due)}` : ""}
                                {taskItem.estimate ? ` · Estimate: ~${taskItem.estimate}h` : ""}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_BADGE[taskItem.status]?.tone || "bg-cloud text-slate-muted"}`}>
                                {STATUS_BADGE[taskItem.status]?.label || taskItem.status}
                              </span>
                            </div>
                          </div>

                          {/* SECTION 1: AI Task Instructions & Requirements */}
                          {(taskItem.whatToDo || taskItem.description || taskItem.expectedOutput || taskItem.aiPlan) && (
                            <div className="rounded-xl border border-brand/20 bg-brand-soft/20 p-4 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-xs font-bold text-brand-deep uppercase tracking-wider flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-brand" /> AI Task Instructions & Deliverable Scope
                                </h4>
                                {taskItem.aiPlan?.estimatedTotalEffort && (
                                  <span className="text-[11px] font-medium text-brand">
                                    Effort: {taskItem.aiPlan.estimatedTotalEffort}
                                  </span>
                                )}
                              </div>

                              {(taskItem.whatToDo || taskItem.description) && (
                                <div className="text-xs text-slate-ink space-y-1">
                                  <p className="font-semibold text-slate-muted text-[11px]">What to do:</p>
                                  <p className="leading-relaxed bg-paper/60 p-2.5 rounded-lg border border-brand/10">
                                    {taskItem.whatToDo || taskItem.description}
                                  </p>
                                </div>
                              )}

                              {taskItem.expectedOutput && (
                                <div className="text-xs space-y-1">
                                  <p className="font-semibold text-slate-muted text-[11px]">Expected Deliverable:</p>
                                  <p className="leading-relaxed text-slate-ink bg-paper/60 p-2.5 rounded-lg border border-brand/10">
                                    {taskItem.expectedOutput}
                                  </p>
                                </div>
                              )}

                              {/* Subtasks breakdown */}
                              {taskItem.aiPlan?.subtasks?.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="font-semibold text-slate-muted text-[11px]">Implementation Subtasks:</p>
                                  <ol className="list-decimal list-inside space-y-1 text-xs text-slate-ink bg-paper/60 p-2.5 rounded-lg border border-brand/10">
                                    {taskItem.aiPlan.subtasks.map((s, i) => (
                                      <li key={i}>
                                        <span className="font-medium">{s.title}</span>
                                        <span className="text-slate-muted text-[11px]"> ({s.difficulty}{s.estimatedHours ? `, ~${s.estimatedHours}h` : ""})</span>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}

                              {/* Acceptance Criteria & Testing Checklist Grid */}
                              {(taskItem.aiPlan?.acceptanceCriteria?.length > 0 || taskItem.aiPlan?.testingChecklist?.length > 0) && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
                                  {taskItem.aiPlan?.acceptanceCriteria?.length > 0 && (
                                    <div className="p-2.5 rounded-lg bg-paper/70 border border-brand/10 space-y-1">
                                      <p className="font-semibold text-slate-ink text-[11px] flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3 text-mint" /> Acceptance Criteria
                                      </p>
                                      <ul className="list-disc list-inside text-[11px] text-slate-muted space-y-0.5">
                                        {taskItem.aiPlan.acceptanceCriteria.map((c, i) => (
                                          <li key={i}>{c}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {taskItem.aiPlan?.testingChecklist?.length > 0 && (
                                    <div className="p-2.5 rounded-lg bg-paper/70 border border-brand/10 space-y-1">
                                      <p className="font-semibold text-slate-ink text-[11px] flex items-center gap-1">
                                        <Clock className="w-3 h-3 text-brand" /> Testing Checklist
                                      </p>
                                      <ul className="list-disc list-inside text-[11px] text-slate-muted space-y-0.5">
                                        {taskItem.aiPlan.testingChecklist.map((c, i) => (
                                          <li key={i}>{c}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* SECTION 2: AI Verification, Missing Files & Detailed Feedback (After Submission) */}
                          {sub ? (
                            <div className="space-y-4 pt-1">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-xs font-bold text-slate-ink uppercase tracking-wider flex items-center gap-1.5">
                                  <FolderArchive className="w-3.5 h-3.5 text-brand" /> Submission Verification & AI Analysis (v{sub.version})
                                </h4>
                                <span className="text-[11px] text-slate-muted">
                                  Submitted {formatDay(sub.submittedAt)} · {formatTime(sub.submittedAt)}
                                </span>
                              </div>

                              {/* Safe ZIP Content Relevance Check Banner */}
                              {ai.relevance?.isIrrelevant && (
                                <div className="rounded-xl border border-coral/30 bg-coral-soft p-3.5 space-y-1.5 text-xs text-coral">
                                  <div className="flex items-start gap-2 font-semibold">
                                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-coral" />
                                    <span>⚠️ Incorrect Project / Unrelated ZIP Archive</span>
                                  </div>
                                  <p className="text-[11px] text-slate-ink font-normal leading-relaxed">
                                    {ai.relevance.reason || "The uploaded ZIP does not appear to match your assigned task."}
                                  </p>
                                  {ai.relevance.evidence?.unmatchedReasons?.length > 0 && (
                                    <ul className="list-disc list-inside text-[10px] text-slate-muted space-y-0.5 pl-2">
                                      {ai.relevance.evidence.unmatchedReasons.map((r, idx) => (
                                        <li key={idx}>{r}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}

                              {/* Full SubmissionFeedbackPanel (Renders TaskVerificationCard, Missing Requirements, Satisfied Requirements, Code Review, Originality, etc.) */}
                              {ai && (
                                <div className="rounded-xl border border-slate-line/80 bg-paper p-4">
                                  <SubmissionFeedbackPanel
                                    analysis={ai}
                                    submission={sub}
                                    task={taskItem}
                                  />
                                </div>
                              )}

                              {/* Submission History Panel */}
                              {taskItem.submissions?.length > 0 && (
                                <div className="pt-2">
                                  <SubmissionHistoryPanel
                                    task={taskItem}
                                    submissions={taskItem.submissions}
                                    currentUser={user}
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-line/80 bg-paper/40 p-4 text-center text-xs text-slate-muted space-y-1">
                              <p className="font-medium text-slate-ink">No ZIP archive submitted for this task yet.</p>
                              <p className="text-[11px]">
                                Use the <strong>"Submit ZIP Archive"</strong> button in your task board card above to upload your implementation ZIP.
                                Automated AI verification, missing files checklist, and requirements inspection will be generated here automatically.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              </div>
            )}
          </>
        )}
      </main>
      <AIProjectPlanModal
        open={planModalOpen}
        group={group}
        onClose={() => setPlanModalOpen(false)}
        onTasksCreated={() => {
          setPlanModalOpen(false);
          loadTasks();
        }}
      />
    </>
  );
};

export default Tasks;
