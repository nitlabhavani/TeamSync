import {
  AlertOctagon,
  Lightbulb,
  ThumbsUp,
  Rocket,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Check,
  AlertTriangle,
} from "lucide-react";
import SubmissionReviewCard from "./SubmissionReviewCard";

const CHANGE_META = {
  improved: { icon: TrendingUp, label: "📈 Improvement detected", tone: "text-mint" },
  decreased: { icon: TrendingDown, label: "⚠️ Progress decreased", tone: "text-coral" },
  no_change: { icon: Minus, label: "➖ No significant change detected", tone: "text-slate-muted" },
};

const ImprovementBanner = ({ improvementSummary }) => {
  if (!improvementSummary || !improvementSummary.changeNote) return null;
  const meta = CHANGE_META[improvementSummary.changeNote];
  if (!meta) return null;
  const Icon = meta.icon;
  const { progressDelta, projectConfidenceDelta, taskConfidenceDelta, resolvedIssues, newIssues } = improvementSummary;

  return (
    <div className="rounded-lg bg-cloud/70 p-2.5 space-y-1">
      <p className={`flex items-center gap-1 text-[11px] font-semibold ${meta.tone}`}>
        <Icon className="w-3.5 h-3.5" /> {meta.label}
      </p>
      <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-muted">
        {progressDelta != null && (
          <span>
            Progress {progressDelta >= 0 ? "+" : ""}
            {progressDelta}%
          </span>
        )}
        {projectConfidenceDelta != null && (
          <span>
            Project {projectConfidenceDelta >= 0 ? "+" : ""}
            {projectConfidenceDelta}%
          </span>
        )}
        {taskConfidenceDelta != null && (
          <span>
            Task {taskConfidenceDelta >= 0 ? "+" : ""}
            {taskConfidenceDelta}%
          </span>
        )}
      </div>
      {resolvedIssues?.length > 0 && (
        <p className="text-[11px] text-mint">✔ Resolved: {resolvedIssues.slice(0, 3).join("; ")}</p>
      )}
      {newIssues?.length > 0 && <p className="text-[11px] text-coral">⚠ New: {newIssues.slice(0, 3).join("; ")}</p>}
    </div>
  );
};

const FeedbackSection = ({ icon: Icon, tone, title, items }) => {
  if (!items?.length) return null;
  return (
    <div>
      <p className={`flex items-center gap-1 text-[11px] font-semibold ${tone}`}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </p>
      <ul className="mt-0.5 list-disc list-inside text-[11px] text-slate-muted">
        {items.slice(0, 8).map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
};

const OriginalityPanel = ({ plagiarism }) => {
  if (!plagiarism) return null;

  if (!plagiarism.detected) {
    return (
      <div className="rounded-lg border border-mint/30 bg-mint/10 p-2.5 flex items-start gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-mint mt-0.5 shrink-0" />
        <div>
          <p className="text-[11px] font-semibold text-mint">✅ Originality Check Passed</p>
          <p className="text-[11px] text-slate-muted">
            Your submission does not show significant similarity to existing submissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber/30 bg-amber-soft p-2.5 space-y-1">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-amber">
        <ShieldAlert className="w-3.5 h-3.5" /> ⚠️ Similarity Warning
      </p>
      <p className="text-[11px] text-slate-ink">This submission appears similar to an existing submission.</p>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-muted">
        <span>Similarity: {plagiarism.similarityScore}%</span>
        <span>Severity: {plagiarism.severity}</span>
      </div>
      {plagiarism.matchedFiles?.length > 0 && (
        <p className="text-[11px] text-slate-muted">
          Matched file(s): {plagiarism.matchedFiles.length} — {plagiarism.matchedFiles.slice(0, 3).join(", ")}
          {plagiarism.matchedFiles.length > 3 ? "…" : ""}
        </p>
      )}
      {plagiarism.reasons?.length > 0 && <p className="text-[11px] text-slate-muted">{plagiarism.reasons[0]}</p>}
      {plagiarism.recommendation && <p className="text-[11px] text-slate-ink">{plagiarism.recommendation}</p>}
      <p className="text-[11px] text-slate-muted">Your guide will make the final decision on this submission.</p>
    </div>
  );
};

const SEVERITY_META = {
  CRITICAL: { label: "Critical", tone: "text-coral" },
  HIGH: { label: "High", tone: "text-coral" },
  MEDIUM: { label: "Medium", tone: "text-amber" },
  LOW: { label: "Low", tone: "text-slate-muted" },
  INFO: { label: "Info", tone: "text-slate-muted" },
};

const CodeReviewPanel = ({ codeReview }) => {
  if (!codeReview || codeReview.score == null) return null;

  const issues = codeReview.issues || [];
  const counts = issues.reduce((acc, i) => ({ ...acc, [i.severity]: (acc[i.severity] || 0) + 1 }), {});
  const severeCount = (counts.CRITICAL || 0) + (counts.HIGH || 0);

  return (
    <div className="rounded-lg border border-slate-line bg-paper p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-ink">💻 AI Code Review</p>
        <span className="text-[11px] font-medium text-slate-ink">Code Quality: {codeReview.score}/100</span>
      </div>

      {codeReview.comparison?.changeNote && codeReview.comparison.changeNote !== "no_change" && (
        <p className={`text-[11px] font-medium ${codeReview.comparison.changeNote === "improved" ? "text-mint" : "text-coral"}`}>
          {codeReview.comparison.changeNote === "improved" ? "📈" : "📉"} Code quality {codeReview.comparison.changeNote}{" "}
          {codeReview.comparison.currentScore} vs {codeReview.comparison.previousScore}
        </p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-muted">
        {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sev) => (
          <span key={sev} className={counts[sev] ? SEVERITY_META[sev].tone : ""}>
            {SEVERITY_META[sev].label}: {counts[sev] || 0}
          </span>
        ))}
      </div>

      {issues.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] text-slate-muted">
            {severeCount > 0 ? `⚠️ ${severeCount} ${severeCount === 1 ? "issue needs" : "issues need"} attention` : `${issues.length} improvement(s) to consider`}
          </p>
          <ol className="list-decimal list-inside text-[11px] text-slate-ink space-y-1">
            {issues.slice(0, 6).map((issue, i) => (
              <li key={i}>
                <span className={`font-medium ${SEVERITY_META[issue.severity]?.tone || ""}`}>{SEVERITY_META[issue.severity]?.label}</span>
                {" · "}
                {issue.message}
                {issue.file && <span className="text-slate-muted"> ({issue.file}{issue.line ? `:${issue.line}` : ""})</span>}
                {issue.suggestion && <p className="ml-4 text-slate-muted">💡 {issue.suggestion}</p>}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-[11px] text-mint">✅ No code-quality issues detected.</p>
      )}

      {codeReview.positiveFindings?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-mint">✅ Positive findings</p>
          <ul className="list-disc list-inside text-[11px] text-slate-muted">
            {codeReview.positiveFindings.slice(0, 5).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/**
 * Task Verification & Next Task Routing Card
 */
const TaskVerificationCard = ({ verification, nextTask, taskStatus }) => {
  if (!verification && !nextTask) return null;

  const status = verification?.status || (taskStatus === "completed" ? "PASS" : "");
  if (!status && !nextTask) return null;

  const isPass = status === "PASS";
  const isFail = status === "FAIL";
  const isReview = status === "NEEDS_REVIEW";

  return (
    <div
      className={`rounded-lg border p-3 space-y-2.5 ${
        isPass
          ? "border-mint/40 bg-mint/5"
          : isFail
          ? "border-coral/40 bg-coral/5"
          : "border-amber/40 bg-amber/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isPass && <CheckCircle2 className="w-4 h-4 text-mint" />}
          {isFail && <XCircle className="w-4 h-4 text-coral" />}
          {isReview && <Clock className="w-4 h-4 text-amber" />}
          <span
            className={`text-xs font-semibold ${
              isPass ? "text-mint" : isFail ? "text-coral" : "text-amber"
            }`}
          >
            {isPass
              ? "Task Requirements Verified (PASS)"
              : isFail
              ? "Revisions Required (FAIL)"
              : "Awaiting Guide Approval (NEEDS REVIEW)"}
          </span>
        </div>
        {verification?.score != null && (
          <span className="text-[11px] font-medium text-slate-ink">
            Score: {verification.score}%
          </span>
        )}
      </div>

      {(verification?.completionStatus || verification?.evidenceQuality || verification?.deliverableType) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {verification.deliverableType && (
            <span className="rounded bg-brand/10 text-brand font-semibold text-[10px] px-1.5 py-0.5 uppercase">
              📦 Deliverable: {verification.deliverableType}
            </span>
          )}
          {verification.completionStatus && (
            <span className={`rounded font-semibold text-[10px] px-1.5 py-0.5 ${
              verification.completionStatus === "COMPLETE"
                ? "bg-mint/15 text-mint"
                : verification.completionStatus === "PARTIALLY_COMPLETE"
                ? "bg-amber/15 text-amber"
                : "bg-coral/15 text-coral"
            }`}>
              {verification.completionStatus.replace(/_/g, " ")}
            </span>
          )}
          {verification.evidenceQuality && (
            <span className="rounded bg-cloud text-slate-muted font-medium text-[10px] px-1.5 py-0.5">
              Evidence: {verification.evidenceQuality.replace(/_/g, " ")}
            </span>
          )}
        </div>
      )}

      {verification?.feedback && (
        <p className="text-xs text-slate-ink">{verification.feedback}</p>
      )}

      {/* Passed Requirements */}
      {verification?.requirementsPassed?.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-mint flex items-center gap-1">
            <Check className="w-3 h-3" /> Requirements Satisfied:
          </p>
          <ul className="text-[11px] text-slate-muted pl-4 list-disc space-y-0.5">
            {verification.requirementsPassed.map((req, idx) => (
              <li key={idx}>{req}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Missing / Failed Requirements */}
      {verification?.missingItems?.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-coral flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Missing Requirements / Needed Revisions:
          </p>
          <ul className="text-[11px] text-slate-ink pl-4 list-disc space-y-0.5">
            {verification.missingItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Next Task Routing */}
      {nextTask && (
        <div className="mt-2 pt-2 border-t border-slate-line/50">
          <div className="rounded-md border border-brand/30 bg-brand-soft p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-brand">
                <Rocket className="w-3.5 h-3.5" /> Next Assigned Task
              </span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                {nextTask.priority || "Normal"}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-ink">{nextTask.title}</p>
            <div className="flex items-center gap-2 text-[10px] text-slate-muted">
              <span>Status: {nextTask.status || "todo"}</span>
              {nextTask.autoAssigned && (
                <span className="text-mint font-medium">⚡ Auto-assigned</span>
              )}
              {nextTask.due && (
                <span>Due: {new Date(nextTask.due).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * @param {object} analysis submission.aiAnalysis (Step 9 + Step 13 shape).
 * @param {object|null} previousAnalysis
 * @param {object|null} submission
 * @param {object|null} task
 */
const SubmissionFeedbackPanel = ({ analysis, previousAnalysis, submission, task }) => {
  if (!analysis) return null;

  const verification = submission?.verification || analysis?.verification;
  const nextTask = task?.nextTask || submission?.verification?.nextTask || verification?.nextTask;

  // Generic (non-ZIP) submissions
  if (!analysis.implementationStatus) {
    return (
      <div className="space-y-2.5">
        <TaskVerificationCard
          verification={verification}
          nextTask={nextTask}
          taskStatus={task?.status}
        />
        <SubmissionReviewCard analysis={analysis} />
      </div>
    );
  }

  const nextSteps = [...(analysis.missingParts || []), ...(analysis.suggestions || [])].slice(0, 6);
  const hasTaskConfidence = analysis.taskConfidence != null;

  return (
    <div className="space-y-2.5">
      <TaskVerificationCard
        verification={verification}
        nextTask={nextTask}
        taskStatus={task?.status}
      />

      <SubmissionReviewCard analysis={analysis} />

      {hasTaskConfidence && (
        <div className="rounded-lg border border-slate-line bg-paper p-2.5 flex items-center justify-between text-[11px]">
          <span className="text-slate-muted">Task Check confidence</span>
          <span className="font-medium text-slate-ink">{analysis.taskConfidence}%</span>
        </div>
      )}

      <FeedbackSection icon={AlertOctagon} tone="text-coral" title="🔴 Critical Issues" items={analysis.criticalIssues} />
      <FeedbackSection icon={Lightbulb} tone="text-amber" title="🟡 Improvements Needed" items={analysis.suggestions} />
      <FeedbackSection icon={ThumbsUp} tone="text-mint" title="🟢 What You Did Well" items={analysis.positiveFindings} />

      <OriginalityPanel plagiarism={analysis.plagiarism} />
      <CodeReviewPanel codeReview={analysis.codeReview} />

      {nextSteps.length > 0 && (
        <div className="rounded-lg border border-brand/20 bg-brand-soft p-2.5">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-brand">
            <Rocket className="w-3.5 h-3.5" /> Recommended Next Steps
          </p>
          <ol className="mt-0.5 list-decimal list-inside text-[11px] text-slate-ink">
            {nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      <ImprovementBanner improvementSummary={analysis.improvementSummary} />
    </div>
  );
};

export default SubmissionFeedbackPanel;
