import { CheckCircle2, XCircle, AlertTriangle, Sparkles, PartyPopper } from "lucide-react";

/**
 * implementationStatus -> visual treatment. Mirrors the AI response
 * categories from the Step 9 spec (§7): WRONG_PROJECT,
 * PROJECT_RELATED_TASK_NOT_IMPLEMENTED, PARTIAL_PROGRESS,
 * VALID_BUT_NEEDS_IMPROVEMENT, VALID_SUBMISSION.
 */
const STATUS_META = {
  WRONG_PROJECT: {
    icon: XCircle,
    tone: "coral",
    title: "❌ Wrong ZIP folder",
    headline: "The uploaded ZIP does not belong to the TeamSync AI project.",
  },
  PROJECT_RELATED_TASK_NOT_IMPLEMENTED: {
    icon: AlertTriangle,
    tone: "amber",
    title: "⚠️ This submission does not appear to implement your assigned task.",
    headline: "Your project is related to TeamSync AI, but the assigned task has not been implemented yet.",
  },
  PARTIAL_PROGRESS: {
    icon: AlertTriangle,
    tone: "amber",
    title: "🔄 Your task is partially completed.",
    headline: "The task-related implementation is present, but some required parts are still incomplete.",
  },
  VALID_BUT_NEEDS_IMPROVEMENT: {
    icon: CheckCircle2,
    tone: "mint",
    title: "✅ Implementation found",
    headline: "A few improvements are recommended before considering it production-ready.",
  },
  VALID_SUBMISSION: {
    icon: CheckCircle2,
    tone: "mint",
    title: "✅ Submission looks valid",
    headline: "Your implementation is related to the assigned task and the required changes are present.",
  },
  UNREADABLE_ZIP: {
    icon: XCircle,
    tone: "coral",
    title: "❌ Unable to analyze this ZIP file",
    headline: "The uploaded file could not be opened. Please upload a valid project ZIP.",
  },
};

const TONE_CLASSES = {
  coral: { border: "border-coral/30", bg: "bg-coral-soft", text: "text-coral", chip: "bg-coral/10 text-coral" },
  amber: { border: "border-amber/30", bg: "bg-amber-soft", text: "text-amber", chip: "bg-amber/10 text-amber" },
  mint: { border: "border-mint/30", bg: "bg-mint/10", text: "text-mint", chip: "bg-mint/10 text-mint" },
};

const Row = ({ label, value, ok }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-slate-muted">{label}</span>
    <span className={`inline-flex items-center gap-1 font-medium ${ok ? "text-mint" : "text-slate-ink"}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3 text-coral" />}
      {value}
    </span>
  </div>
);

/**
 * @param {object} analysis submission.aiAnalysis (Step 9 shape — projectRelated,
 *   projectConfidence, taskRelated, implementationStatus, progress, summary,
 *   completedParts, missingParts, suggestions, analyzedFiles). Falls back to a
 *   generic (non-ZIP) view when implementationStatus isn't set.
 */
const SubmissionReviewCard = ({ analysis }) => {
  if (!analysis) return null;

  // Generic (non-ZIP) submissions keep the original simple card — untouched.
  if (!analysis.implementationStatus) {
    return (
      <div className="pt-1 border-t border-slate-line/60 mt-1.5">
        <p className="flex items-center gap-1 text-slate-ink font-medium">
          <Sparkles className="w-3 h-3 text-brand" /> AI review
          {analysis.score != null && ` — ${analysis.score}/100`}
        </p>
        {analysis.summary && <p className="mt-1 text-slate-muted">{analysis.summary}</p>}
        {analysis.issues?.length > 0 && (
          <ul className="mt-1 list-disc list-inside text-slate-muted">
            {analysis.issues.slice(0, 5).map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const meta = STATUS_META[analysis.implementationStatus] || STATUS_META.PROJECT_RELATED_TASK_NOT_IMPLEMENTED;
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.icon;
  const isExcellent = analysis.implementationStatus === "VALID_SUBMISSION" && analysis.progress >= 90;

  return (
    <div className={`mt-1.5 rounded-lg border ${tone.border} ${tone.bg} p-3 space-y-2.5`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${tone.text}`} />
        <p className={`text-xs font-semibold ${tone.text}`}>{meta.title}</p>
      </div>
      <p className="text-xs text-slate-ink">{analysis.summary || meta.headline}</p>

      <div className="rounded-md bg-paper/70 p-2 space-y-1">
        <Row label="Project" value={analysis.projectRelated ? "TeamSync AI" : "Not recognized"} ok={analysis.projectRelated} />
        <Row label="Task relevance" value={analysis.taskRelated ? "Relevant" : "Not detected"} ok={analysis.taskRelated} />
        <Row
          label="Implementation"
          value={analysis.implementationStatus.replaceAll("_", " ").toLowerCase()}
          ok={analysis.implementationStatus === "VALID_SUBMISSION"}
        />
        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-line/40">
          <span className="text-slate-muted">Confidence</span>
          <span className="font-medium text-slate-ink">{analysis.projectConfidence}%</span>
        </div>
        {analysis.progress != null && (
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-muted">Progress</span>
              <span className="font-medium text-slate-ink">{analysis.progress}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-cloud">
              <div
                className={`h-1.5 rounded-full ${tone.text === "text-coral" ? "bg-coral" : "bg-gradient-to-r from-brand to-mint"}`}
                style={{ width: `${analysis.progress}%` }}
              />
            </div>
          </div>
        )}
        {analysis.analyzedFiles?.length > 0 && (
          <p className="text-[11px] text-slate-muted pt-1">Files analyzed: {analysis.analyzedFiles.length}</p>
        )}
      </div>

      {analysis.completedParts?.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-slate-ink">Completed</p>
          <ul className="mt-0.5 list-disc list-inside text-[11px] text-slate-muted">
            {analysis.completedParts.slice(0, 6).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.missingParts?.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-slate-ink">Missing</p>
          <ul className="mt-0.5 list-disc list-inside text-[11px] text-slate-muted">
            {analysis.missingParts.slice(0, 6).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.suggestions?.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-slate-ink">AI Suggestions</p>
          <ul className="mt-0.5 list-disc list-inside text-[11px] text-slate-muted">
            {analysis.suggestions.slice(0, 6).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.implementationStatus === "WRONG_PROJECT" && (
        <div className="text-[11px] space-y-1">
          <p className="text-coral font-medium">
            Your task remains In Progress. Please upload the correct TeamSync AI project ZIP and try again.
          </p>
          <div>
            <p className="font-medium text-slate-ink">Before resubmitting</p>
            <ul className="mt-0.5 list-disc list-inside text-slate-muted">
              <li>Make sure you selected the correct TeamSync AI project folder.</li>
              <li>Do not upload an unrelated project.</li>
              <li>Create the ZIP from the correct project root.</li>
              <li>Upload the corrected ZIP.</li>
            </ul>
          </div>
        </div>
      )}

      {analysis.implementationStatus === "UNREADABLE_ZIP" && (
        <div className="text-[11px]">
          <p className="font-medium text-slate-ink">Before resubmitting</p>
          <ul className="mt-0.5 list-disc list-inside text-slate-muted">
            <li>Re-create the ZIP.</li>
            <li>Make sure it opens normally on your computer.</li>
            <li>Upload the ZIP again.</li>
          </ul>
        </div>
      )}

      {analysis.implementationStatus === "VALID_SUBMISSION" && (
        <p className="text-[11px] text-slate-muted">
          Your guide will review this submission before it's marked complete.
        </p>
      )}

      {isExcellent && (
        <p className="flex items-center gap-1 text-xs font-semibold text-mint">
          <PartyPopper className="w-3.5 h-3.5" /> Excellent Job! Keep up the great work.
        </p>
      )}
    </div>
  );
};

export default SubmissionReviewCard;
