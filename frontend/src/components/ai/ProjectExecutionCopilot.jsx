import { Sparkles, ChevronRight, AlertTriangle, ListChecks, Users, ArrowRightLeft } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 21 — compact "AI Execution Copilot" card for the Guide Dashboard.
 * Purely presentational: renders the already-aggregated payload from
 * services/projectExecutionCopilotService.js (getExecutionCopilot). Mirrors
 * ProjectHealthCommandCenter/AIProjectForecastCard's structure and tone so
 * this reads as part of the same dashboard, not a new visual theme.
 */
const STATUS_STYLES = {
  HEALTHY: { text: "text-mint", bg: "bg-mint-soft", label: "ON TRACK", dot: "🟢" },
  STABLE: { text: "text-mint", bg: "bg-mint-soft", label: "STABLE", dot: "🟢" },
  NEEDS_ATTENTION: { text: "text-amber", bg: "bg-amber-soft", label: "NEEDS ATTENTION", dot: "🟡" },
  AT_RISK: { text: "text-amber", bg: "bg-amber-soft", label: "AT RISK", dot: "🟠" },
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", label: "CRITICAL", dot: "🔴" },
};

const TREND_LABEL = { IMPROVING: "↑ Improving", WORSENING: "↓ Worsening", STABLE: "→ Stable" };

const PRIORITY_DOT = { CRITICAL: "🔴", HIGH: "🟠", MEDIUM: "🟡", LOW: "⚪" };

const ProjectExecutionCopilot = ({ copilot, loading, error, onViewDetails }) => {
  if (loading) {
    return <div className="h-[260px] rounded-xl2 border border-slate-line bg-cloud/60 animate-pulse" />;
  }

  if (error) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load the AI Execution Copilot.</p>
      </div>
    );
  }

  if (!copilot || copilot.overallStatus === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
          <Sparkles className="w-4 h-4 text-brand" /> AI Execution Copilot
        </p>
        <p className="text-sm text-slate-muted">
          Not enough task or activity data yet to generate an execution plan.
        </p>
      </div>
    );
  }

  const style = STATUS_STYLES[copilot.overallStatus] || STATUS_STYLES.NEEDS_ATTENTION;
  const trendLabel = TREND_LABEL[copilot.trend] || "→ Not enough history";
  const today = (copilot.todayActions || []).slice(0, 5);
  const thisWeek = (copilot.thisWeekActions || []).slice(0, 8);
  const teamAttention = (copilot.teamAttention || []).slice(0, 3);
  const reassignments = (copilot.recommendedReassignments || []).slice(0, 2);

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
        <Sparkles className="w-4 h-4 text-brand" /> AI Execution Copilot
      </p>

      <div className="flex items-baseline justify-between">
        <div className={classNames("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", style.bg, style.text)}>
          {style.dot} {style.label}
        </div>
        <p className="font-display text-2xl font-bold text-slate-ink">
          {copilot.executionScore != null ? `${copilot.executionScore} / 100` : "—"}
        </p>
      </div>
      <p className="text-xs text-slate-muted mt-1">{trendLabel}</p>

      {copilot.topPriority && (
        <div className="mt-4 rounded-xl border border-slate-line p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-muted">Top priority</p>
          <p className="text-sm font-semibold text-slate-ink mt-0.5 flex items-start gap-1.5">
            <span>{PRIORITY_DOT[copilot.topPriority.priority] || "⚪"}</span>
            <span>{copilot.topPriority.title}</span>
          </p>
        </div>
      )}

      {copilot.criticalActions?.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Critical Actions ({copilot.criticalActions.length})
          </p>
          <ul className="space-y-1">
            {copilot.criticalActions.slice(0, 3).map((a, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-1.5">
                <span>🔴</span>
                <span>{a.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {today.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <ListChecks className="w-3.5 h-3.5" /> Today's Plan
          </p>
          <ul className="space-y-1">
            {today.map((a, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-1.5">
                <span>{PRIORITY_DOT[a.priority] || "⚪"}</span>
                <span>{a.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {thisWeek.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-muted mb-1.5">📅 This Week ({thisWeek.length})</p>
          <ul className="space-y-1">
            {thisWeek.slice(0, 3).map((a, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {a.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {teamAttention.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <Users className="w-3.5 h-3.5" /> Team Attention
          </p>
          <ul className="space-y-1">
            {teamAttention.map((s, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {s.reasons?.[0] || `Member flagged ${s.riskLevel}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reassignments.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <ArrowRightLeft className="w-3.5 h-3.5" /> Recommended Reassignment
          </p>
          <ul className="space-y-1">
            {reassignments.map((r, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {r.suggestedAction}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onViewDetails}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-deep transition-colors mt-4"
      >
        View Full Plan <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default ProjectExecutionCopilot;
