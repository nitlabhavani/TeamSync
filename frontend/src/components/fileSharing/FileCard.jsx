import { useState } from "react";
import { FileText, FileArchive, FileImage, File, Download, Eye, Trash2, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { formatFileSize } from "../../utils/helperFunctions";
import { formatRelativeTime } from "../../utils/dateFormatter";

const iconFor = (type) => {
  if (type === "pdf") return { Icon: FileText, tone: "text-coral bg-coral-soft" };
  if (type === "zip") return { Icon: FileArchive, tone: "text-amber bg-amber-soft" };
  if (type === "image") return { Icon: FileImage, tone: "text-brand bg-brand-soft" };
  return { Icon: File, tone: "text-mint bg-mint-soft" };
};

const exactTime = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

const scoreTone = (score) => {
  if (score == null) return "text-slate-muted bg-cloud";
  if (score >= 80) return "text-mint bg-mint-soft";
  if (score >= 60) return "text-amber bg-amber-soft";
  return "text-coral bg-coral-soft";
};

const FileCard = ({ file, uploaderName, onPreview, onDownload, onDelete, canDelete }) => {
  const { Icon, tone } = iconFor(file.type);
  const [showAi, setShowAi] = useState(false);
  const ai = file.aiAnalysis;
  const analyzing = !ai;
  const failed = ai?.engine === "error";

  return (
    <div className="file-card bg-paper border border-slate-line rounded-xl p-4">
      <div className="flex items-center gap-3">
        <span className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-ink truncate">{file.name}</p>
          <p className="text-xs text-slate-muted mt-0.5" title={exactTime(file.uploadedAt)}>
            {formatFileSize(file.size)} · {uploaderName || "Unknown"} · {formatRelativeTime(file.uploadedAt)}
          </p>
          <p className="text-[11px] text-slate-muted/80 mt-0.5">Uploaded {exactTime(file.uploadedAt)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onPreview?.(file)}
            className="w-8 h-8 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted"
            aria-label="Preview"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDownload?.(file)}
            className="w-8 h-8 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted"
            aria-label="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete?.(file)}
              className="w-8 h-8 rounded-full hover:bg-coral-soft flex items-center justify-center text-slate-muted hover:text-coral"
              aria-label="Delete file"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-line/70">
        {analyzing ? (
          <p className="text-xs text-slate-muted flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" /> AI analysis in progress…
          </p>
        ) : failed ? (
          <p className="text-xs text-coral flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AI analysis failed{ai.reason ? `: ${ai.reason}` : "."}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setShowAi((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-medium text-slate-ink"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-brand" /> AI review
              {ai.score != null && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${scoreTone(ai.score)}`}>
                  {ai.score}/100
                </span>
              )}
            </span>
            {showAi ? <ChevronUp className="w-3.5 h-3.5 text-slate-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-muted" />}
          </button>
        )}

        {!analyzing && !failed && showAi && (
          <div className="mt-2 space-y-2 text-xs text-slate-muted">
            {ai.summary && <p>{ai.summary}</p>}
            {ai.issues?.length > 0 && (
              <div>
                <p className="font-medium text-slate-ink mb-1">Issues</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {ai.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {ai.recommendations?.length > 0 && (
              <div>
                <p className="font-medium text-slate-ink mb-1">Recommendations</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {ai.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileCard;
