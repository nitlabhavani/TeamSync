import { Trophy, Star, TrendingUp } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 22 — expandable detail panel shown when the guide clicks "View
 * Details" on TeamPerformanceInsights. Purely presentational: every field
 * reuses the `performance` payload from services/teamPerformanceService.js
 * (getTeamPerformance) — nothing is recomputed here. Guide/leader-only —
 * the backend never sends other students' data to a student, so this
 * component is only ever mounted with the full payload.
 */
const LEVEL_STYLES = {
  EXCEPTIONAL: { text: "text-mint", bg: "bg-mint-soft" },
  STRONG: { text: "text-mint", bg: "bg-mint-soft" },
  ON_TRACK: { text: "text-amber", bg: "bg-amber-soft" },
  NEEDS_IMPROVEMENT: { text: "text-coral", bg: "bg-coral-soft" },
};

const STRENGTH_LABEL = {
  CONSISTENT_TASK_COMPLETION: "Consistent task completion",
  DEADLINE_RELIABILITY: "Deadline reliability",
  STRONG_CODE_QUALITY: "Strong code quality",
  HIGH_REVIEW_SUCCESS: "High review success",
  GOOD_COLLABORATION: "Good collaboration",
  TASK_OWNERSHIP: "Task ownership",
  QUICK_TURNAROUND: "Quick turnaround",
};

const AREA_LABEL = {
  DEADLINE_CONSISTENCY: "Deadline consistency",
  TASK_COMPLETION: "Task completion",
  CODE_QUALITY: "Code quality",
  REVIEW_QUALITY: "Review quality",
  COLLABORATION: "Collaboration",
  TASK_ESTIMATION: "Task estimation",
};

const label = (map, key) => map[key] || key.replace(/_/g, " ").toLowerCase();

const Metric = ({ label: l, value }) => (
  <div className="text-center">
    <p className="text-[10px] uppercase tracking-wide text-slate-muted">{l}</p>
    <p className="text-sm font-semibold text-slate-ink">{value != null ? `${value}%` : "—"}</p>
  </div>
);

const MemberCard = ({ member }) => {
  const style = LEVEL_STYLES[member.performanceLevel] || LEVEL_STYLES.ON_TRACK;
  const insufficient = member.performanceScore == null;

  return (
    <div className="rounded-xl2 border border-slate-line p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-ink">{member.studentName || "Team member"}</p>
        {!insufficient && (
          <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full", style.bg, style.text)}>
            {member.performanceLevel.replace("_", " ")}
          </span>
        )}
      </div>

      {insufficient ? (
        <p className="text-xs text-slate-muted mt-2">No tasks currently assigned.</p>
      ) : (
        <>
          <p className="text-xs text-slate-muted mt-0.5">Score: {member.performanceScore} / 100</p>

          <div className="grid grid-cols-4 gap-2 mt-3 py-2 border-y border-slate-line/60">
            <Metric label="Completion" value={member.metrics?.completionRate} />
            <Metric label="On-time" value={member.metrics?.onTimeRate} />
            <Metric label="Review" value={member.metrics?.reviewSuccessRate} />
            <Metric label="Code" value={member.metrics?.avgCodeReviewScore} />
          </div>

          {member.strengths?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-muted mb-1">Strengths:</p>
              <ul className="space-y-0.5">
                {member.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-slate-ink">
                    ✓ {label(STRENGTH_LABEL, s)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {member.improvementAreas?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-muted mb-1">Improve:</p>
              <ul className="space-y-0.5">
                {member.improvementAreas.map((a, i) => (
                  <li key={i} className="text-sm text-slate-ink">
                    • {label(AREA_LABEL, a)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {member.recommendedAction && (
            <div className="mt-3 pt-2 border-t border-slate-line/60">
              <p className="text-xs font-semibold text-slate-muted mb-0.5">AI recommendation:</p>
              <p className="text-sm text-slate-ink">{member.recommendedAction}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TeamPerformancePanel = ({ performance, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Loading team performance details…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load team performance details.</p>
      </div>
    );
  }

  if (!performance || performance.performanceLevel === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">{performance?.narrative || "Not enough data yet for team performance insights."}</p>
      </div>
    );
  }

  const members = performance.members || [];

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-5">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
          <Trophy className="w-4 h-4 text-brand" /> Team Overview
        </p>
        <p className="text-sm text-slate-ink">{performance.narrative}</p>
      </div>

      {performance.topStrengths?.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <Star className="w-3.5 h-3.5" /> Top Team Strengths
          </p>
          <div className="flex flex-wrap gap-2">
            {performance.topStrengths.map((s, i) => (
              <span key={i} className="text-xs font-medium text-slate-ink bg-mint-soft px-2.5 py-1 rounded-full">
                {label(STRENGTH_LABEL, s)}
              </span>
            ))}
          </div>
        </div>
      )}

      {performance.topImprovementAreas?.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Top Team Improvement Areas
          </p>
          <div className="flex flex-wrap gap-2">
            {performance.topImprovementAreas.map((a, i) => (
              <span key={i} className="text-xs font-medium text-slate-ink bg-amber-soft px-2.5 py-1 rounded-full">
                {label(AREA_LABEL, a)}
              </span>
            ))}
          </div>
        </div>
      )}

      {performance.recommendedTeamActions?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-muted mb-1.5">Recommended Team Actions</p>
          <ul className="space-y-1">
            {performance.recommendedTeamActions.map((a, i) => (
              <li key={i} className="text-sm text-slate-ink">
                • {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-muted mb-2">Member Performance</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {members.map((m) => (
            <MemberCard key={m.studentId} member={m} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TeamPerformancePanel;
