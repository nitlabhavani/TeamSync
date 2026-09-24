import { AlertTriangle } from "lucide-react";
import { severityStyle, severityIconStyle } from "../../utils/aiStatus";
import { formatRelativeTime } from "../../utils/dateFormatter";

const TYPE_LABELS = {
  TASK_AT_RISK: "Task at risk",
  TASK_OVERDUE: "Task overdue",
  LOW_PROGRESS: "Low progress",
  BLOCKER_UNRESOLVED: "Unresolved blocker",
};

/**
 * STEP 4H/4I — Step 3 `warnings`. The AI engine already performs
 * duplicate suppression (each warning carries `status: "active" |
 * "suppressed_duplicate"`); this component only renders whatever the
 * backend returned and never generates or de-duplicates warnings itself.
 */
const AIWarningsList = ({ warnings = [], loading, error }) => {
  const active = warnings.filter((w) => w.status !== "suppressed_duplicate");

  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Checking for AI warnings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">AI analysis is temporarily unavailable.</p>
      </div>
    );
  }

  if (!active.length) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">No AI warnings right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {active.map((w, i) => (
        <div
          key={i}
          className={`rounded-lg p-3.5 flex items-start gap-3 ${severityStyle(w.severity)}`}
        >
          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${severityIconStyle(w.severity)}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-muted uppercase tracking-wide">
                {TYPE_LABELS[w.type] || w.type}
              </span>
              {w.status && w.status !== "active" && (
                <span className="text-[10px] text-slate-muted">({w.status.replace(/_/g, " ")})</span>
              )}
            </div>
            <p className="text-sm text-slate-ink mt-0.5">{w.message}</p>
            {(w.evidence || []).length > 0 && (
              <ul className="mt-1">
                {w.evidence.map((e, idx) => (
                  <li key={idx} className="text-xs text-slate-muted">
                    · {e}
                  </li>
                ))}
              </ul>
            )}
            {w.generatedAt && (
              <p className="text-xs text-slate-muted mt-1">{formatRelativeTime(w.generatedAt)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AIWarningsList;
