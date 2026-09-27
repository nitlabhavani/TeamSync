import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  RefreshCw,
  XCircle,
  AlertTriangle,
  Inbox,
  Sparkles,
  Users,
  Clock,
  Download,
  FolderArchive,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import SubmissionFeedbackPanel from "../../components/tasks/SubmissionFeedbackPanel";
import { HistoryRow } from "../../components/tasks/SubmissionHistoryPanel";
import { useGroups } from "../../hooks/useGroups";
import { nameOf as dirName } from "../../services/userDirectory";
import { formatDay, formatTime } from "../../utils/dateFormatter";
import { api, SERVER_URL } from "../../lib/apiClient";
import * as taskService from "../../services/taskService";
import * as teamRiskService from "../../services/teamRiskService";

const nameOf = (id) => dirName(id, "Unknown student");

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "0 B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
};

/**
 * The tabs mirror the Step 11 §2 status set, scoped to what a guide
 * actually needs to act on or audit — "Needs review" is the queue, the rest
 * is history.
 */
const TABS = [
  { id: "guide_review", label: "Needs review" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "completed", label: "Completed" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

const STATUS_PILL = {
  guide_review: "bg-amber-soft text-amber",
  changes_requested: "bg-coral-soft text-coral",
  completed: "bg-mint/10 text-mint",
  rejected: "bg-coral-soft text-coral",
};

const STATUS_LABEL = {
  guide_review: "🔵 Waiting for Guide Review",
  changes_requested: "🟠 Changes Requested",
  completed: "🟢 Completed",
  rejected: "🔴 Rejected",
};

/**
 * Step 14, Feature 5/6 — the guide-facing originality badge. Uses the
 * `SIMILAR_TO_EXISTING_SUBMISSION`-style flag additively (via
 * aiAnalysis.plagiarism.severity) without touching task.status or any of
 * the existing STATUS_PILL/STATUS_LABEL values above — see Feature 6.
 */
const PLAGIARISM_BADGE = {
  NONE: { label: "🟢 Originality Check Passed", className: "bg-mint/10 text-mint" },
  POSSIBLE: { label: "🟡 Possible Similarity — Review Recommended", className: "bg-amber-soft text-amber" },
  HIGH: { label: "🟠 High Similarity — Manual Review Required", className: "bg-amber-soft text-amber" },
  DUPLICATE: { label: "🔴 Likely Duplicate — Investigate Before Approval", className: "bg-coral-soft text-coral" },
};

/** One submission row: task + group + student context, AI summary, and the
 * three review actions when it's still awaiting a decision. */
const SubmissionRow = ({ row, onReview, busy }) => {
  const { task, submission, groupName, riskNote } = row;
  const [feedback, setFeedback] = useState("");
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const needsReview = ["guide_review", "in_review", "submitted", "ai_review", "review"].includes(task.status);
  const studentId = submission.student?.id || submission.student;
  const studentName = submission.student?.name || nameOf(studentId);

  const act = (verdict) => {
    if (verdict !== "approved" && !feedback.trim()) {
      setLocalError(
        verdict === "rejected" ? "Enter a reason before rejecting." : "Enter feedback before requesting changes."
      );
      return;
    }
    setLocalError("");
    onReview(row, verdict, feedback.trim());
    setFeedback("");
  };

  return (
    <div className="rounded-xl2 border border-slate-line bg-paper p-4 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-ink truncate">{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-muted">
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" /> {studentName} · {groupName}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDay(submission.submittedAt)} · {formatTime(submission.submittedAt)}
            </span>
            <span>v{submission.version}</span>
          </p>
          {task.description && <p className="mt-1.5 text-xs text-slate-muted line-clamp-2">{task.description}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_PILL[task.status] || "bg-cloud text-slate-muted"}`}>
          {STATUS_LABEL[task.status] || task.status}
        </span>
      </div>

      {/* Step 15, Feature 14 — small contextual pointer only, never a
          duplicate of the full risk system (see teamRiskAnalyzer.js
          evidence.riskyTasks). */}
      {riskNote && (
        <div className="mt-2 rounded-lg border border-amber/30 bg-amber-soft px-2.5 py-1.5 text-[11px] text-amber">
          ⚠️ This submission contributes to the team's current risk.
          <br />
          Reason: {riskNote}
        </div>
      )}

      {/* Step 14, Feature 5 — always visible (not tucked behind "Show AI
          review summary") so a guide never misses a HIGH/DUPLICATE
          similarity result before approving. */}
      {submission.aiAnalysis?.plagiarism?.severity && submission.aiAnalysis.plagiarism.severity !== "NONE" && (
        <div className="mt-2 rounded-lg border border-slate-line/60 p-2.5 text-[11px] space-y-1">
          <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${PLAGIARISM_BADGE[submission.aiAnalysis.plagiarism.severity].className}`}>
            {PLAGIARISM_BADGE[submission.aiAnalysis.plagiarism.severity].label}
          </span>
          <div className="grid grid-cols-2 gap-1 text-slate-muted">
            <span>Similarity score: {submission.aiAnalysis.plagiarism.similarityScore}%</span>
            <span>Matched files: {submission.aiAnalysis.plagiarism.matchedFiles?.length || 0}</span>
          </div>
          {/* Privacy-safe: never names the other student/group here — only
              that a match exists elsewhere in the system (Feature 1 §8,
              Feature 12). */}
          {submission.aiAnalysis.plagiarism.matchedSubmissionId && (
            <p className="text-slate-muted">Matches another existing submission in the system.</p>
          )}
          {submission.aiAnalysis.plagiarism.reasons?.slice(0, 2).map((r, i) => (
            <p key={i} className="text-slate-muted">
              {r}
            </p>
          ))}
          {submission.aiAnalysis.plagiarism.recommendation && (
            <p className="text-slate-ink font-medium">{submission.aiAnalysis.plagiarism.recommendation}</p>
          )}
        </div>
      )}

      {/* Safe ZIP Content Relevance Check — prominent flag for irrelevant submissions without blocking review */}
      {submission.aiAnalysis?.relevance?.isIrrelevant && (
        <div className="mt-2 rounded-lg border border-amber/40 bg-amber-soft/80 p-2.5 text-[11px] space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 font-semibold text-coral">
              ⚠️ Possible Irrelevant Submission
            </span>
            {submission.aiAnalysis.relevance.score != null && (
              <span className="text-slate-muted font-medium">Relevance: {submission.aiAnalysis.relevance.score}%</span>
            )}
          </div>
          <p className="text-slate-ink font-medium">
            {submission.aiAnalysis.relevance.reason || "The uploaded archive does not appear to implement the assigned task."}
          </p>
          {submission.aiAnalysis.relevance.evidence?.zipName && (
            <p className="text-slate-muted">
              Uploaded archive: <span className="font-mono font-medium text-slate-ink">{submission.aiAnalysis.relevance.evidence.zipName}</span>
            </p>
          )}
          {submission.aiAnalysis.relevance.evidence?.taskKeywords?.length > 0 && (
            <p className="text-slate-muted">
              Expected task keywords: {submission.aiAnalysis.relevance.evidence.taskKeywords.slice(0, 6).join(", ")}
            </p>
          )}
        </div>
      )}

      {submission.note && <p className="mt-2 text-xs text-slate-muted italic">"{submission.note}"</p>}
      
      {/* Student Attached ZIP Submissions with Direct Download */}
      {submission.files?.length > 0 && (
        <div className="mt-2.5 space-y-2 rounded-xl border border-slate-line bg-paper p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-ink flex items-center gap-1.5">
              <FolderArchive className="w-4 h-4 text-brand" /> Submitted ZIP & Project Files
            </span>
            <span className="text-[11px] text-slate-muted font-medium">{submission.files.length} file(s) attached</span>
          </div>
          <div className="space-y-1.5 pt-0.5">
            {submission.files.map((file, idx) => {
              const fileUrl = file.url ? (file.url.startsWith("http") ? file.url : `${SERVER_URL}${file.url}`) : "#";
              return (
                <div
                  key={file._id || file.id || idx}
                  className="flex items-center justify-between gap-3 p-2 rounded-lg border border-brand/20 bg-cloud/50 hover:bg-brand-soft/20 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                      <FolderArchive className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-ink truncate" title={file.name}>
                        {file.name || "Student Submission Archive"}
                      </p>
                      <p className="text-[10px] text-slate-muted">
                        {file.size ? formatFileSize(file.size) : "ZIP Package"}
                      </p>
                    </div>
                  </div>
                  <a
                    href={fileUrl}
                    download={file.name || "submission.zip"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-deep transition-colors shadow-sm shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" /> Download ZIP
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {submission.verdict && (
        <div className="mt-2 text-xs">
          {submission.verdict === "approved" && (
            <p className="text-mint font-medium">🎉 Approved & completed{submission.reviewedAt ? ` on ${formatDay(submission.reviewedAt)}` : ""}.</p>
          )}
          {submission.verdict === "changes_requested" && (
            <p className="text-coral font-medium">🔄 Changes requested{submission.guideFeedback ? ` — "${submission.guideFeedback}"` : ""}</p>
          )}
          {submission.verdict === "rejected" && (
            <p className="text-coral font-medium">❌ Rejected{submission.guideFeedback ? ` — ${submission.guideFeedback}` : ""}</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-[11px] font-medium text-brand hover:underline"
      >
        {open ? "Hide AI review summary" : "Show AI review summary"}
      </button>

      {open && submission.aiAnalysis && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-ink mb-1">
            <Sparkles className="w-3 h-3 text-brand" /> AI Review Summary
          </p>
          <SubmissionFeedbackPanel analysis={submission.aiAnalysis} submission={submission} task={task} />
        </div>
      )}

      {/* Step 12 §18 — compact, read-only version history so the guide can
          see how this submission evolved. The latest version (shown above)
          is always what's under review; older versions are informational
          only — no actions render for them. */}
      {task.submissions?.length > 1 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[11px] font-medium text-brand hover:underline"
          >
            {historyOpen ? "Hide version history" : `Show version history (${task.submissions.length} versions)`}
          </button>
          {historyOpen && (
            <div className="mt-1.5 space-y-1.5">
              {[...task.submissions].reverse().map((s) => (
                <HistoryRow key={s.id || s.version} submission={s} isLatest={s.version === submission.version} />
              ))}
            </div>
          )}
        </div>
      )}

      {needsReview && (
        <div className="mt-3 space-y-1.5 border-t border-slate-line pt-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback for the student (required for Request Changes / Reject)"
            rows={2}
            className="w-full rounded-lg border border-slate-line bg-cloud px-2.5 py-1.5 text-xs outline-none focus:border-brand"
          />
          {localError && <p className="text-[11px] text-coral">{localError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => act("approved")}
              className="inline-flex items-center gap-1 rounded-lg bg-mint px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve & Complete
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("changes_requested")}
              className="inline-flex items-center gap-1 rounded-lg bg-amber px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Request Changes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("rejected")}
              className="inline-flex items-center gap-1 rounded-lg bg-coral px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Reject Submission
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SubmissionReview = () => {
  const { groups } = useGroups();
  const [tasksByGroup, setTasksByGroup] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("guide_review");
  const [busyTaskId, setBusyTaskId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // Step 15, Feature 14 — taskId -> short reason string, sourced from the
  // same team-risk evidence used on the Guide Dashboard/Team Analytics.
  const [riskyTaskReasons, setRiskyTaskReasons] = useState({});

  // Every group here already comes from GET /groups, which is filtered
  // server-side to `guide: req.user._id` (see groupController.list) — so
  // this component can never even ask about a group the guide doesn't own.
  const load = useCallback(async () => {
    if (!groups.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const entries = await Promise.all(
        groups.map(async (g) => {
          // requireGroupAccess re-checks group ownership server-side on
          // every one of these calls — this loop can never surface another
          // guide's group even if it tried.
          const tasks = await taskService.getTasks(g.id);
          return [g.id, tasks];
        })
      );
      setTasksByGroup(Object.fromEntries(entries));
    } catch (err) {
      setLoadError(err.message || "Submissions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [groups]);

  useEffect(() => {
    load();
  }, [load]);

  // Best-effort, additive: if the risk endpoint is unavailable for any
  // reason, submissions just render without the small indicator — never
  // blocks the core review workflow.
  useEffect(() => {
    if (!groups.length) return;
    let alive = true;
    Promise.all(
      groups.map((g) =>
        teamRiskService
          .getTeamRisk(g.id)
          .then((data) => data?.riskyTasks || [])
          .catch(() => [])
      )
    ).then((lists) => {
      if (!alive) return;
      const map = {};
      lists.flat().forEach((t) => {
        map[t.taskId] = t.reasons?.[0] || "";
      });
      setRiskyTaskReasons(map);
    });
    return () => {
      alive = false;
    };
  }, [groups]);

  const rows = useMemo(() => {
    const out = [];
    groups.forEach((g) => {
      (tasksByGroup[g.id] || []).forEach((task) => {
        const submission = task.latestSubmission;
        if (!submission) return;
        out.push({ task, submission, groupId: g.id, groupName: g.name, riskNote: riskyTaskReasons[task.id] });
      });
    });
    return out.sort((a, b) => new Date(b.submission.submittedAt) - new Date(a.submission.submittedAt));
  }, [groups, tasksByGroup, riskyTaskReasons]);

  const filtered =
    tab === "all"
      ? rows
      : tab === "guide_review"
      ? rows.filter((r) => ["guide_review", "in_review", "submitted", "ai_review", "review"].includes(r.task.status))
      : tab === "completed"
      ? rows.filter((r) => r.task.status === "completed" || r.task.status === "done")
      : rows.filter((r) => r.task.status === tab);

  const countForTab = (tabId) => {
    if (tabId === "all") return rows.length;
    if (tabId === "guide_review") return rows.filter((r) => ["guide_review", "in_review", "submitted", "ai_review", "review"].includes(r.task.status)).length;
    if (tabId === "completed") return rows.filter((r) => r.task.status === "completed" || r.task.status === "done").length;
    return rows.filter((r) => r.task.status === tabId).length;
  };

  const handleReview = async (row, verdict, feedback) => {
    const taskId = row.task.id || row.task._id;
    const groupId = row.groupId || row.task.groupId || row.task.group;
    setBusyTaskId(taskId);
    setActionError("");
    setSuccessMessage("");
    try {
      await taskService.reviewTask(groupId, taskId, { verdict, feedback });
      await load();
      if (verdict === "approved") {
        setSuccessMessage(`🎉 Task "${row.task.title}" has been approved and assigned to Completed!`);
        setTab("completed");
      } else if (verdict === "changes_requested") {
        setSuccessMessage(`🔄 Changes requested for "${row.task.title}". The student has been notified.`);
        setTab("changes_requested");
      } else if (verdict === "rejected") {
        setSuccessMessage(`❌ Submission for "${row.task.title}" was rejected. The student has been notified.`);
        setTab("rejected");
      }
    } catch (err) {
      setActionError(err.message || "Review failed.");
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <>
      <Navbar title="Submission review" subtitle="AI-analyzed task submissions across your groups" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-5 max-w-4xl w-full mx-auto">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const count = countForTab(t.id);
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
                  tab === t.id
                    ? "bg-brand text-white shadow-sm"
                    : "bg-cloud text-slate-muted hover:text-slate-ink hover:bg-slate-line/50"
                }`}
              >
                <span>{t.label}</span>
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      tab === t.id ? "bg-white/25 text-white" : "bg-paper text-slate-ink border border-slate-line"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {successMessage && (
          <div className="flex items-center justify-between gap-2 rounded-xl2 border border-mint/30 bg-mint-soft px-4 py-3 text-sm text-mint">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button
              onClick={() => setSuccessMessage("")}
              className="text-xs font-medium hover:underline text-mint/80"
            >
              Dismiss
            </button>
          </div>
        )}

        {actionError && (
          <div className="flex items-center gap-2 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {actionError}
          </div>
        )}

        {loadError && (
          <div className="flex items-center gap-2 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {loadError}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 rounded-xl2 border border-slate-line bg-paper animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
            <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
              <Inbox className="w-5 h-5 text-slate-muted" />
            </span>
            <p className="text-sm font-medium text-slate-ink">No submissions here</p>
            <p className="text-xs text-slate-muted max-w-sm">
              {tab === "guide_review" ? "Nothing is waiting on your review right now." : "Nothing matches this filter yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((row) => (
              <SubmissionRow key={row.task.id} row={row} onReview={handleReview} busy={busyTaskId === row.task.id} />
            ))}
          </div>
        )}
      </main>
    </>
  );
};

export default SubmissionReview;
