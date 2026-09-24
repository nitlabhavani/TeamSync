import { FileText, CheckCircle2, XCircle } from "lucide-react";

/**
 * STEP 4C — per-file AI evidence, from the engine's `fileAnalysis` array
 * (already filtered server-side to the current student when a studentId
 * was passed to the project-performance endpoint).
 */
const FileEvidenceList = ({ files = [] }) => {
  if (!files.length) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm font-medium text-slate-ink mb-1">File evidence</p>
        <p className="text-xs text-slate-muted">No files have been analyzed yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <p className="text-sm font-medium text-slate-ink mb-3">File evidence</p>
      <ul className="space-y-2.5">
        {files.map((f, i) => (
          <li key={i} className="border border-slate-line rounded-lg p-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-muted shrink-0" />
              <p className="text-sm font-medium text-slate-ink truncate">{f.filename}</p>
              <span className="text-[11px] text-slate-muted uppercase">{f.fileType}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-xs">
              {f.relevantToTask === true ? (
                <span className="flex items-center gap-1 text-mint">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Relevant to assigned task
                </span>
              ) : f.relevantToTask === false ? (
                <span className="flex items-center gap-1 text-coral">
                  <XCircle className="w-3.5 h-3.5" /> Not clearly related to assigned task
                </span>
              ) : (
                <span className="text-slate-muted">{f.relevanceReason}</span>
              )}
            </div>
            <p className="text-xs text-slate-muted mt-1">
              {f.contentAnalysis === "analyzed"
                ? "Content analyzed."
                : "Content analysis unavailable for this file type."}
            </p>
            {(f.issues || []).length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {f.issues.map((issue, idx) => (
                  <li key={idx} className="text-xs text-coral">
                    · {issue}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default FileEvidenceList;
