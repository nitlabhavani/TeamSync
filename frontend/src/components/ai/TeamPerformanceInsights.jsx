import { Trophy, ChevronRight, Star, AlertTriangle } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 22 — compact "🏆 AI Team Performance" card. Purely presentational:
 * renders the already-aggregated payload from
 * services/teamPerformanceService.js (getTeamPerformance). Works for BOTH
 * the Guide Dashboard (full payload) and the Student Dashboard (shaped
 * `myPerformance`-only payload) — see `isStudentView`.
 */
const LEVEL_STYLES = {
  EXCEPTIONAL: { text: "text-mint", bg: "bg-mint-soft", label: "EXCEPTIONAL", dot: "🟢" },
  STRONG: { text: "text-mint", bg: "bg-mint-soft", label: "STRONG", dot: "🟢" },
  ON_TRACK: { text: "text-amber", bg: "bg-amber-soft", label: "ON TRACK", dot: "🟡" },
  NEEDS_IMPROVEMENT: { text: "text-coral", bg: "bg-coral-soft", label: "NEEDS IMPROVEMENT", dot: "🔴" },
};

const TREND_LABEL = { IMPROVING: "↑ Improving", DECLINING: "↓ Declining", STABLE: "→ Stable" };

const STRENGTH_LABEL = {
  CONSISTENT_TASK_COMPLETION: "Consistent task completion",
  DEADLINE_RELIABILITY: "Deadline reliability",
  STRONG_CODE_QUALITY: "Strong code quality",
  HIGH_REVIEW_SUCCESS: "High review success",
  GOOD_COLLABORATION: "Good collaboration",
  TASK_OWNERSHIP: "Task ownership",
  QUICK_TURNAROUND: "Quick turnaround",
};

const TeamPerformanceInsights = ({ performance, loading, error, onViewDetails, isStudentView = false }) => {
  if (loading) {
    return <div className="h-[220px] rounded-xl2 border border-slate-line bg-cloud/60 animate-pulse" />;
  }

  if (error) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load AI Team Performance.</p>
      </div>
    );
  }

  const data = isStudentView ? performance?.myPerformance : performance;
  const level = data?.performanceLevel;

  if (!data || level === "INSUFFICIENT_DATA" || data.performanceScore == null) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
          <Trophy className="w-4 h-4 text-brand" /> {isStudentView ? "Your Performance" : "AI Team Performance"}
        </p>
        <p className="text-sm text-slate-muted">
          {isStudentView ? "No tasks are currently assigned to you yet." : "Not enough completed work yet to generate team performance insights."}
        </p>
      </div>
    );
  }

  const style = LEVEL_STYLES[level] || LEVEL_STYLES.ON_TRACK;
  const trendLabel = TREND_LABEL[isStudentView ? data.trend : performance.trend] || "→ Not enough history";
  const strengths = (data.strengths || data.topStrengths || []).slice(0, 3);
  const membersNeedingAttention = !isStudentView ? (performance.membersNeedingAttention || []).slice(0, 3) : [];
  const recommendedActions = !isStudentView ? (performance.recommendedTeamActions || []).slice(0, 2) : [data.recommendedAction].filter(Boolean);

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
        <Trophy className="w-4 h-4 text-brand" /> {isStudentView ? "Your Performance" : "AI Team Performance"}
      </p>

      <div className="flex items-baseline justify-between">
        <div className={classNames("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full", style.bg, style.text)}>
          {style.dot} {style.label}
        </div>
        <p className="font-display text-2xl font-bold text-slate-ink">{data.performanceScore} / 100</p>
      </div>
      <p className="text-xs text-slate-muted mt-1">{trendLabel}</p>

      {strengths.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <Star className="w-3.5 h-3.5" /> Top Strengths
          </p>
          <ul className="space-y-1">
            {strengths.map((s, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-1.5">
                <span>✓</span>
                <span>{STRENGTH_LABEL[s] || s.replace(/_/g, " ").toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isStudentView && membersNeedingAttention.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Members Needing Attention
          </p>
          <p className="text-sm text-slate-ink">{membersNeedingAttention.length} member(s) flagged for review.</p>
        </div>
      )}

      {recommendedActions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-muted mb-1.5">💡 Recommended</p>
          <ul className="space-y-1">
            {recommendedActions.map((a, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onViewDetails && (
        <button
          onClick={onViewDetails}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-deep transition-colors mt-4"
        >
          View Details <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default TeamPerformanceInsights;
