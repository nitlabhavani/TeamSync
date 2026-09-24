import { Sparkles, ChevronRight, AlertTriangle, Star } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 20, Feature 8 — compact "AI Project Health" card for the Guide
 * Dashboard. Purely presentational: renders the already-aggregated
 * payload from services/projectHealthService.js (getProjectHealth). Mirrors
 * the existing AIProjectForecastCard/AI Team Risk cards' structure and tone
 * so this reads as part of the same dashboard, not a new visual theme.
 */
const HEALTH_STYLES = {
  HEALTHY: { text: "text-mint", bg: "bg-mint-soft", label: "HEALTHY", dot: "🟢" },
  STABLE: { text: "text-mint", bg: "bg-mint-soft", label: "STABLE", dot: "🟢" },
  NEEDS_ATTENTION: { text: "text-amber", bg: "bg-amber-soft", label: "NEEDS ATTENTION", dot: "🟡" },
  AT_RISK: { text: "text-amber", bg: "bg-amber-soft", label: "AT RISK", dot: "🟠" },
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", label: "CRITICAL", dot: "🔴" },
};

const TREND_LABEL = { IMPROVING: "↑ Improving", WORSENING: "↓ Worsening", STABLE: "→ Stable" };

const SEVERITY_DOT = { CRITICAL: "🔴", HIGH: "🟠", MEDIUM: "🟡", MODERATE: "🟡", LOW: "⚪" };

const ProjectHealthCommandCenter = ({ health, loading, error, onViewDetails }) => {
  if (loading) {
    return <div className="h-[260px] rounded-xl2 border border-slate-line bg-cloud/60 animate-pulse" />;
  }

  if (error) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load the AI Project Health Command Center.</p>
      </div>
    );
  }

  if (!health || health.health === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
          <Sparkles className="w-4 h-4 text-brand" /> AI Project Health
        </p>
        <p className="text-sm text-slate-muted">
          Not enough task or activity data yet to compute an overall project health score.
        </p>
      </div>
    );
  }

  const style = HEALTH_STYLES[health.health] || HEALTH_STYLES.NEEDS_ATTENTION;
  const trendLabel = TREND_LABEL[health.trend] || "→ Not enough history";
  const s = health.summary || {};
  const completionPct = s.totalTasks ? Math.round((s.completedTasks / s.totalTasks) * 100) : 0;
  const topIssues = (health.topIssues || []).slice(0, 3);
  const positives = (health.positiveSignals || []).slice(0, 2);
  const actions = (health.recommendedActions || []).slice(0, 3);

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
        <Sparkles className="w-4 h-4 text-brand" /> AI Project Health
      </p>

      <div className="flex items-baseline justify-between">
        <div className={classNames("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", style.bg, style.text)}>
          {style.dot} {style.label}
        </div>
        <p className="font-display text-2xl font-bold text-slate-ink">{health.healthScore} / 100</p>
      </div>
      <p className="text-xs text-slate-muted mt-1">{trendLabel}</p>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <div className="rounded-xl border border-slate-line p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-slate-muted">Tasks</p>
          <p className="text-sm font-semibold text-slate-ink mt-0.5">{completionPct}%</p>
        </div>
        <div className="rounded-xl border border-slate-line p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-slate-muted">Forecast</p>
          <p className="text-sm font-semibold text-slate-ink mt-0.5">
            {health.forecast?.probability != null ? `${health.forecast.probability}%` : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-line p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-slate-muted">Risk</p>
          <p className="text-sm font-semibold text-slate-ink mt-0.5">{health.teamRisk?.level || "—"}</p>
        </div>
      </div>

      {topIssues.length > 0 && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Needs Attention
          </p>
          <ul className="space-y-1">
            {topIssues.map((issue, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-1.5">
                <span>{SEVERITY_DOT[issue.severity] || "⚪"}</span>
                <span>{issue.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {positives.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <Star className="w-3.5 h-3.5" /> Going Well
          </p>
          <ul className="space-y-1">
            {positives.map((p, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-1.5">
                <span>✓</span>
                <span>{p.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-muted mb-1.5">⚡ Recommended Actions</p>
          <ul className="space-y-1">
            {actions.map((a, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {a.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onViewDetails}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-deep transition-colors mt-4"
      >
        View Full Analytics <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default ProjectHealthCommandCenter;
