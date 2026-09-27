import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Sparkles, GraduationCap, ListChecks, Download, FolderArchive } from "lucide-react";
import SubmissionFeedbackPanel from "./SubmissionFeedbackPanel";
import { nameOf as dirName } from "../../services/userDirectory";
import { formatDay, formatTime } from "../../utils/dateFormatter";
import { SERVER_URL } from "../../lib/apiClient";

const nameOf = (idOrObj, fallback = "Unknown") => {
  if (idOrObj && typeof idOrObj === "object") return idOrObj.name || dirName(idOrObj.id, fallback);
  return dirName(idOrObj, fallback);
};

const VERDICT_META = {
  approved: { icon: "✅", label: "Approved", tone: "text-mint" },
  changes_requested: { icon: "🔄", label: "Changes Requested", tone: "text-amber" },
  rejected: { icon: "❌", label: "Rejected", tone: "text-coral" },
};

/** A fixed, always-applicable action sequence — not a guess about the
 * specific work needed (that comes from the AI suggestions/guide feedback
 * shown above it), just the mechanical "what to do with this feedback"
 * steps (Step 12 §7). */
const NEXT_STEPS = [
  "Complete the missing functionality.",
  "Update the identified files.",
  "Test the implementation.",
  "Create a new ZIP.",
  "Upload the new version.",
];

/**
 * §7 — Combined Improvement Panel. Only ever restates data already present
 * on the submission (aiAnalysis.missingParts/suggestions + guideFeedback) —
 * never invents new findings.
 */
const CombinedImprovementPanel = ({ submission }) => {
  const analysis = submission.aiAnalysis;
  const aiPoints = [...(analysis?.missingParts || []), ...(analysis?.suggestions || [])].slice(0, 6);
  const hasGuideFeedback = Boolean(submission.guideFeedback);
  if (!aiPoints.length && !hasGuideFeedback) return null;

  return (
    <div className="rounded-lg border border-slate-line bg-paper p-2.5 space-y-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-ink">
        <ListChecks className="w-3.5 h-3.5 text-brand" /> What you should improve
      </p>

      {aiPoints.length > 0 && (
        <div>
          <p className="flex items-center gap-1 text-[11px] font-medium text-slate-ink">
            <Sparkles className="w-3 h-3 text-brand" /> AI Analysis
          </p>
          <ul className="mt-0.5 list-disc list-inside text-[11px] text-slate-muted">
            {aiPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {hasGuideFeedback && (
        <div>
          <p className="flex items-center gap-1 text-[11px] font-medium text-slate-ink">
            <GraduationCap className="w-3 h-3 text-brand" /> Guide Feedback
          </p>
          <p className="mt-0.5 text-[11px] text-slate-muted italic">"{submission.guideFeedback}"</p>
        </div>
      )}

      <div>
        <p className="text-[11px] font-medium text-slate-ink">📌 Recommended Next Steps</p>
        <ol className="mt-0.5 list-decimal list-inside text-[11px] text-slate-muted">
          {NEXT_STEPS.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
};

/** §11 — Progress Comparison. Only ever computed from two real, stored
 * progress values — never claims improvement/decrease it can't back up.
 * Step 13 §6 extends this with project/task confidence and issue-count
 * deltas when the latest submission carries a server-computed
 * improvementSummary; older submissions without one just keep showing the
 * original progress-only comparison. */
const ProgressComparison = ({ previous, latest }) => {
  const prevProgress = previous?.aiAnalysis?.progress;
  const latestProgress = latest?.aiAnalysis?.progress;
  if (prevProgress == null || latestProgress == null) return null;

  const delta = latestProgress - prevProgress;
  const improved = delta > 0;
  const same = delta === 0;

  const prevConfidence = previous?.aiAnalysis?.projectConfidence;
  const latestConfidence = latest?.aiAnalysis?.projectConfidence;
  const prevTaskConfidence = previous?.aiAnalysis?.taskConfidence;
  const latestTaskConfidence = latest?.aiAnalysis?.taskConfidence;
  const prevCriticalCount = previous?.aiAnalysis?.criticalIssues?.length;
  const latestCriticalCount = latest?.aiAnalysis?.criticalIssues?.length;
  const prevSuggestionCount = previous?.aiAnalysis?.suggestions?.length;
  const latestSuggestionCount = latest?.aiAnalysis?.suggestions?.length;

  const Row = ({ label, before, after }) =>
    before == null || after == null ? null : (
      <div className="flex items-center justify-between text-[11px] text-slate-muted">
        <span>{label}</span>
        <span className="font-medium text-slate-ink">
          {before}% → {after}% {after > before ? "⬆️" : after < before ? "⬇️" : ""}
        </span>
      </div>
    );

  const CountRow = ({ label, before, after }) =>
    before == null || after == null ? null : (
      <div className="flex items-center justify-between text-[11px] text-slate-muted">
        <span>{label}</span>
        <span className="font-medium text-slate-ink">
          {before} → {after}
        </span>
      </div>
    );

  return (
    <div className="rounded-lg bg-cloud/70 p-2.5 space-y-1">
      <p className="text-[11px] font-medium text-slate-ink mb-1">
        Version {previous?.version} → Version {latest?.version}
      </p>
      <Row label="Progress" before={prevProgress} after={latestProgress} />
      <Row label="Project confidence" before={prevConfidence} after={latestConfidence} />
      <Row label="Task relevance" before={prevTaskConfidence} after={latestTaskConfidence} />
      <CountRow label="Critical issues" before={prevCriticalCount} after={latestCriticalCount} />
      <CountRow label="Improvements remaining" before={prevSuggestionCount} after={latestSuggestionCount} />
      {!same && (
        <p className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${improved ? "text-mint" : "text-coral"}`}>
          {improved ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {improved ? `Improvement: +${delta}%` : `Progress decreased by ${Math.abs(delta)}%`}
        </p>
      )}
      {same && <p className="mt-1 text-[11px] text-slate-muted">No change in progress since the last submission.</p>}
    </div>
  );
};

/** One row in the Submission History list — collapsed by default, expands
 * to the full per-version detail required by §3. Also reused (read-only,
 * as-is) by the Step 11 Guide Review page for its own compact version list
 * (Step 12 §18) — no separate history system, just this same component. */
export const HistoryRow = ({ submission, isLatest }) => {
  const [open, setOpen] = useState(false);
  const verdict = VERDICT_META[submission.verdict];
  const progress = submission.aiAnalysis?.progress;
  const codeQualityScore = submission.aiAnalysis?.codeReview?.score;
  const codeQualityIssueCount = submission.aiAnalysis?.codeReview?.issues?.length;
  const reviewedDate = submission.reviewedAt ? formatDay(submission.reviewedAt) : null;

  return (
    <div className="rounded-lg border border-slate-line bg-paper">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-slate-ink shrink-0">
            Version {submission.version}
            {isLatest && <span className="ml-1 text-brand">(current)</span>}
          </span>
          {verdict && (
            <span className={`text-[11px] font-medium shrink-0 ${verdict.tone}`}>
              {verdict.icon} {verdict.label}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0 text-[11px] text-slate-muted">
          {progress != null && <span>{progress}%</span>}
          {codeQualityScore != null && (
            <span title="Code quality">
              💻 {codeQualityScore}
              {codeQualityIssueCount ? ` (${codeQualityIssueCount})` : ""}
            </span>
          )}
          {reviewedDate && <span>{reviewedDate}</span>}
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-1.5 text-[11px]">
          <p className="text-slate-muted">
            Uploaded {formatDay(submission.submittedAt)} · {formatTime(submission.submittedAt)}
          </p>
          {submission.reviewedBy && (
            <p className="text-slate-muted">
              Reviewed by {nameOf(submission.reviewedBy, "the guide")}
              {reviewedDate ? ` on ${reviewedDate}` : ""}
            </p>
          )}
          {submission.files?.length > 0 && (
            <div className="rounded-lg border border-slate-line bg-cloud/50 p-2 space-y-1">
              <span className="font-semibold text-slate-ink flex items-center gap-1">
                <FolderArchive className="w-3.5 h-3.5 text-brand" /> Attached ZIP Files:
              </span>
              <div className="space-y-1">
                {submission.files.map((f, i) => {
                  const url = f.url ? (f.url.startsWith("http") ? f.url : `${SERVER_URL}${f.url}`) : "#";
                  return (
                    <div key={f._id || i} className="flex items-center justify-between gap-2 p-1.5 rounded bg-paper border border-slate-line/60">
                      <span className="truncate max-w-[200px] text-slate-ink font-mono">{f.name || "archive.zip"}</span>
                      <a
                        href={url}
                        download={f.name || "archive.zip"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand text-white text-[10px] font-medium hover:bg-brand-deep transition-colors"
                      >
                        <Download className="w-3 h-3" /> Download ZIP
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {submission.aiAnalysis && <SubmissionFeedbackPanel analysis={submission.aiAnalysis} />}
        </div>
      )}
    </div>
  );
};

/**
 * Step 12 — Submission History + AI Improvement Suggestions.
 * `submissions` is the task's full, unmodified submissions array
 * (oldest -> newest, exactly as stored — nothing here ever deletes or
 * reorders a previous version).
 */
const SubmissionHistoryPanel = ({ submissions }) => {
  if (!submissions?.length) return null;

  const latest = submissions[submissions.length - 1];
  const previous = submissions.length > 1 ? submissions[submissions.length - 2] : null;
  const previousCount = submissions.length - 1;
  const countLabel =
    previousCount === 0 ? "No previous submissions yet." : previousCount === 1 ? "1 submission" : `${previousCount} submissions`;

  const NEEDS_IMPROVEMENT_STATUSES = new Set([
    "PARTIAL_PROGRESS",
    "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
    "WRONG_PROJECT",
    "UNREADABLE_ZIP",
    "VALID_BUT_NEEDS_IMPROVEMENT",
  ]);
  const showCombinedPanel =
    ["changes_requested", "rejected"].includes(latest.verdict) ||
    NEEDS_IMPROVEMENT_STATUSES.has(latest.aiAnalysis?.implementationStatus);

  return (
    <div className="space-y-2.5">
      {previous && <ProgressComparison previous={previous} latest={latest} />}
      {showCombinedPanel && <CombinedImprovementPanel submission={latest} />}

      <div>
        <p className="text-[11px] font-medium text-slate-ink mb-1.5">Submission History · {countLabel}</p>
        <div className="space-y-1.5">
          {[...submissions]
            .reverse()
            .map((s) => (
              <HistoryRow key={s.id || s.version} submission={s} isLatest={s.version === latest.version} />
            ))}
        </div>
      </div>
    </div>
  );
};

export default SubmissionHistoryPanel;
