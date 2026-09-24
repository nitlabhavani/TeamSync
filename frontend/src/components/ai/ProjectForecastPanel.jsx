import { CalendarClock, TrendingUp, TrendingDown, Minus, AlertTriangle, ListChecks } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 19, Feature 7 — Detailed AI Project Forecast panel for the guide/
 * team leader. Purely presentational: receives the already-fetched
 * forecast + recommendations (see services/projectForecastService.js) and
 * never computes or fabricates anything itself.
 *
 * Guide/leader-only — the parent page is responsible for only mounting
 * this for a guide or team leader (students get StudentProgressCard
 * instead, which uses a completely different, reduced data shape).
 */
const STATUS_STYLES = {
  ON_TRACK: { text: "text-mint", bg: "bg-mint-soft", label: "ON TRACK" },
  AT_RISK: { text: "text-amber", bg: "bg-amber-soft", label: "AT RISK" },
  LIKELY_LATE: { text: "text-amber", bg: "bg-amber-soft", label: "LIKELY LATE" },
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", label: "CRITICAL" },
  INSUFFICIENT_DATA: { text: "text-slate-muted", bg: "bg-cloud", label: "NOT ENOUGH DATA" },
};

const PRIORITY_STYLES = {
  HIGH: { text: "text-coral", bg: "bg-coral-soft", dot: "🟠" },
  MEDIUM: { text: "text-amber", bg: "bg-amber-soft", dot: "🟡" },
  LOW: { text: "text-slate-muted", bg: "bg-cloud", dot: "⚪" },
};

const TrendIcon = ({ trend }) => {
  if (trend === "IMPROVING") return <TrendingUp className="w-4 h-4 text-mint" />;
  if (trend === "WORSENING") return <TrendingDown className="w-4 h-4 text-coral" />;
  return <Minus className="w-4 h-4 text-slate-muted" />;
};

const EvidenceRow = ({ label, value }) => (
  <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-line/60 last:border-0">
    <span className="text-slate-muted">{label}</span>
    <span className="font-medium text-slate-ink">{value ?? "—"}</span>
  </div>
);

const RecommendationCard = ({ rec }) => {
  const style = PRIORITY_STYLES[rec.priority] || PRIORITY_STYLES.LOW;
  return (
    <div className={classNames("rounded-xl2 p-4 border border-slate-line", style.bg)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-ink">
          {style.dot} {rec.title}
        </p>
        <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase", style.text)}>
          {rec.priority}
        </span>
      </div>
      <p className="text-sm text-slate-ink mt-1.5">{rec.reason}</p>
      {rec.evidence && Object.keys(rec.evidence).length > 0 && (
        <p className="text-xs text-slate-muted mt-1.5">
          {Object.entries(rec.evidence)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`)
            .join(" · ")}
        </p>
      )}
      {rec.suggestedAction && <p className="text-xs font-medium text-slate-ink mt-2">→ {rec.suggestedAction}</p>}
    </div>
  );
};

const ProjectForecastPanel = ({ forecast, recommendations = [], loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Loading the detailed forecast…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load the AI project forecast.</p>
      </div>
    );
  }

  if (!forecast || forecast.status === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm font-semibold text-slate-ink mb-1">AI Project Forecast</p>
        <p className="text-sm text-slate-muted">
          {forecast?.explanation || "Not enough task data yet to produce a forecast."}
        </p>
      </div>
    );
  }

  const style = STATUS_STYLES[forecast.status] || STATUS_STYLES.INSUFFICIENT_DATA;
  const ev = forecast.evidence || {};

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-5">
      {/* Forecast summary */}
      <div className="grid md:grid-cols-[auto,1fr] gap-5">
        <div className={classNames("rounded-xl2 p-4 flex flex-col items-center justify-center min-w-[140px]", style.bg)}>
          <p className={classNames("font-display text-3xl font-bold", style.text)}>{forecast.probability}%</p>
          <p className={classNames("text-xs font-semibold mt-1", style.text)}>{style.label}</p>
          <div className="flex items-center gap-1 mt-1.5">
            <TrendIcon trend={forecast.trend} />
            <span className="text-[11px] text-slate-muted">{forecast.trendMessage || "Trend unavailable"}</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-slate-ink">
            <CalendarClock className="w-4 h-4 text-slate-muted" />
            Projected completion:{" "}
            <span className="font-semibold">
              {forecast.projectedCompletionDate ? new Date(forecast.projectedCompletionDate).toLocaleDateString() : "Unknown"}
            </span>
          </p>
          <p className="text-xs text-slate-muted">{forecast.disclaimer}</p>
        </div>
      </div>

      {/* Evidence */}
      <div>
        <p className="text-xs font-semibold text-slate-muted mb-1.5">Evidence</p>
        <div className="grid sm:grid-cols-2 gap-x-6">
          <div>
            <EvidenceRow label="Completion rate" value={ev.completionRate != null ? `${ev.completionRate}%` : null} />
            <EvidenceRow label="Velocity" value={ev.velocityPerDay != null ? `${ev.velocityPerDay} tasks/day` : null} />
            <EvidenceRow label="Remaining tasks" value={ev.remainingTasks} />
            <EvidenceRow label="Days remaining" value={ev.daysRemaining} />
          </div>
          <div>
            <EvidenceRow label="Overdue tasks" value={ev.overdueTasks} />
            <EvidenceRow label="Stalled tasks" value={ev.stalledTasks} />
            <EvidenceRow label="Pending reviews" value={ev.pendingReviews} />
            <EvidenceRow label="Team risk" value={ev.teamRisk} />
          </div>
        </div>
      </div>

      {/* Recommended actions */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
          <ListChecks className="w-3.5 h-3.5" /> Recommended actions
        </p>
        {recommendations.length === 0 ? (
          <p className="text-sm text-slate-muted flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> No recommendations available.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {recommendations.map((rec, i) => (
              <RecommendationCard key={`${rec.type}-${i}`} rec={rec} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectForecastPanel;
