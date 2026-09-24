import { CalendarClock } from "lucide-react";
import { statusStyle, statusLabel, confidenceLabel } from "../../utils/aiStatus";

/**
 * STEP 4B / 4F — Step 3 `projectCompletionPrediction` for a group.
 * Distinct from the simple `ProjectCompletion` progress bar (which just
 * echoes the group's raw `progress` field) — this shows the AI engine's
 * status/confidence/reasons, and must show an explicit insufficient-data
 * state instead of a fake 0%.
 */
const ProjectCompletionPrediction = ({ data, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Predicting project completion…</p>
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

  if (!data) return null;

  const insufficient = data.status === "INSUFFICIENT_DATA" || data.completionPercentage == null;

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-slate-ink">Project completion</p>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusStyle(data.status)}`}>
          {statusLabel(data.status)}
        </span>
      </div>

      {insufficient ? (
        <>
          <p className="text-sm text-slate-muted">Project completion estimate unavailable</p>
          <p className="text-xs text-slate-muted mt-1">Reason: Insufficient project evidence.</p>
        </>
      ) : (
        <p className="text-3xl font-semibold text-slate-ink leading-none mb-1">{data.completionPercentage}%</p>
      )}

      {data.confidence && (
        <p className="text-xs text-slate-muted mt-2">Confidence: {confidenceLabel(data.confidence)}</p>
      )}

      {data.predictedDaysRemaining != null && (
        <div className="flex items-center gap-2 text-slate-ink mt-2">
          <CalendarClock className="w-4 h-4 text-slate-muted" />
          <p className="text-sm">{data.predictedDaysRemaining} day(s) remaining at current pace</p>
        </div>
      )}

      {(data.reasons || []).length > 0 && (
        <ul className="mt-3 space-y-1">
          {data.reasons.map((r, i) => (
            <li key={i} className="text-sm text-slate-ink">
              · {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ProjectCompletionPrediction;
