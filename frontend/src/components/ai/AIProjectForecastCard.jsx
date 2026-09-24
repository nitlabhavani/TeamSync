import { Sparkles, ChevronRight, CalendarClock } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 19, Feature 6 — compact "AI Project Forecast" card for the Guide
 * Dashboard. Mirrors the existing "AI Team Risk" card's structure/tone
 * (see pages/guide/GuideDashboard.jsx) so it reads as part of the same
 * dashboard rather than a new visual theme.
 */
const STATUS_STYLES = {
  ON_TRACK: { text: "text-mint", bg: "bg-mint-soft", label: "ON TRACK", dot: "🟢" },
  AT_RISK: { text: "text-amber", bg: "bg-amber-soft", label: "AT RISK", dot: "🟡" },
  LIKELY_LATE: { text: "text-amber", bg: "bg-amber-soft", label: "LIKELY LATE", dot: "🟠" },
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", label: "CRITICAL", dot: "🔴" },
};

const PRIORITY_DOT = { HIGH: "🟠", MEDIUM: "🟡", LOW: "⚪" };

const AIProjectForecastCard = ({ forecast, loading, error, onViewDetails }) => {
  if (loading) {
    return <div className="h-[220px] rounded-xl2 border border-slate-line bg-cloud/60 animate-pulse" />;
  }

  if (error) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load the AI project forecast.</p>
      </div>
    );
  }

  if (!forecast || forecast.status === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
          <Sparkles className="w-4 h-4 text-brand" /> AI Project Forecast
        </p>
        <p className="text-sm text-slate-muted">
          {forecast?.explanation || "Assign tasks to start tracking a completion forecast."}
        </p>
      </div>
    );
  }

  const style = STATUS_STYLES[forecast.status] || STATUS_STYLES.AT_RISK;
  const progress = forecast.evidence?.completionRate ?? 0;
  const trendLabel =
    forecast.trend === "IMPROVING" ? "↑ Improving" : forecast.trend === "WORSENING" ? "↓ Worsening" : "→ Stable";
  const topRecs = (forecast.recommendations || []).slice(0, 2);

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
        <Sparkles className="w-4 h-4 text-brand" /> AI Project Forecast
      </p>

      <p className="text-2xl font-display font-bold text-slate-ink">{forecast.probability}% chance of finishing on time</p>
      <div className={classNames("inline-flex items-center gap-1.5 mt-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", style.bg, style.text)}>
        {style.dot} {style.label}
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-ink mt-3">
        <CalendarClock className="w-4 h-4 text-slate-muted" />
        Projected completion:{" "}
        <span className="font-medium">
          {forecast.projectedCompletionDate ? new Date(forecast.projectedCompletionDate).toLocaleDateString() : "—"}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-muted mb-1">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-cloud overflow-hidden">
          <div className="h-full bg-brand rounded-full" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-muted mt-2">
        <span>Remaining: {forecast.evidence?.remainingTasks ?? "—"} tasks</span>
        <span>Days left: {forecast.evidence?.daysRemaining ?? "—"}</span>
        <span>Trend: {trendLabel}</span>
      </div>

      {topRecs.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-muted mb-1.5">⚡ Recommended Actions</p>
          <ul className="space-y-1">
            {topRecs.map((rec, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-center gap-1.5">
                {PRIORITY_DOT[rec.priority] || "⚪"} {rec.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onViewDetails}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-deep transition-colors mt-4"
      >
        View Details <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default AIProjectForecastCard;
