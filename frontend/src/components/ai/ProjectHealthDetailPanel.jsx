import { ListChecks, AlertTriangle, Star } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 20, Feature 9 — expandable detail panel shown when the guide clicks
 * "View Full Analytics" on ProjectHealthCommandCenter. Purely
 * presentational: every section reuses fields already present on the
 * `health` payload from services/projectHealthService.js — nothing is
 * recomputed here.
 */
const SEVERITY_STYLES = {
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", dot: "🔴" },
  HIGH: { text: "text-amber", bg: "bg-amber-soft", dot: "🟠" },
  MEDIUM: { text: "text-amber", bg: "bg-amber-soft", dot: "🟡" },
  MODERATE: { text: "text-amber", bg: "bg-amber-soft", dot: "🟡" },
  LOW: { text: "text-slate-muted", bg: "bg-cloud", dot: "⚪" },
};

const PRIORITY_STYLES = {
  HIGH: { text: "text-coral", dot: "🟠" },
  MEDIUM: { text: "text-amber", dot: "🟡" },
  LOW: { text: "text-slate-muted", dot: "⚪" },
};

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-line/60 last:border-0">
    <span className="text-slate-muted">{label}</span>
    <span className="font-medium text-slate-ink">{value ?? "—"}</span>
  </div>
);

const Section = ({ title, children }) => (
  <div>
    <p className="text-xs font-semibold text-slate-muted mb-2">{title}</p>
    {children}
  </div>
);

const IssueCard = ({ issue }) => {
  const style = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.LOW;
  return (
    <div className={classNames("rounded-xl2 p-3 border border-slate-line", style.bg)}>
      <p className="text-sm font-semibold text-slate-ink">
        {style.dot} {issue.title}
      </p>
      <p className="text-xs text-slate-ink mt-1">{issue.reason}</p>
    </div>
  );
};

const RecommendationCard = ({ rec }) => {
  const style = PRIORITY_STYLES[rec.priority] || PRIORITY_STYLES.LOW;
  return (
    <div className="rounded-xl2 p-3 border border-slate-line">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-ink">
          {style.dot} {rec.title}
        </p>
        <span className={classNames("text-[10px] font-semibold uppercase", style.text)}>{rec.priority}</span>
      </div>
      <p className="text-xs text-slate-ink mt-1">{rec.reason}</p>
      {rec.suggestedAction && <p className="text-xs font-medium text-slate-ink mt-1.5">→ {rec.suggestedAction}</p>}
    </div>
  );
};

const ProjectHealthDetailPanel = ({ health, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Loading the full Project Health analytics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load Project Health analytics.</p>
      </div>
    );
  }

  if (!health || health.health === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Not enough data yet for a detailed breakdown.</p>
      </div>
    );
  }

  const s = health.summary || {};

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-5">
      {/* 1. Overall Health */}
      <Section title="1. Overall Health">
        <Row label="Status" value={health.health.replace("_", " ")} />
        <Row label="Health score" value={`${health.healthScore} / 100`} />
        <Row label="Trend" value={health.trend} />
        <p className="text-xs text-slate-muted mt-2">{health.disclaimer}</p>
      </Section>

      {/* 2. Team Risk */}
      <Section title="2. Team Risk">
        <Row label="Level" value={health.teamRisk?.level} />
        <Row label="Trend" value={health.teamRisk?.trend} />
      </Section>

      {/* 3. Completion Forecast */}
      <Section title="3. Completion Forecast">
        <Row label="Probability" value={health.forecast?.probability != null ? `${health.forecast.probability}%` : null} />
        <Row label="Status" value={health.forecast?.status} />
      </Section>

      {/* 4. Deadline Alerts */}
      <Section title="4. Deadline Alerts">
        <Row label="Overdue tasks" value={s.overdueTasks} />
        <Row label="Early warnings" value={s.earlyWarnings} />
      </Section>

      {/* 5. Collaboration */}
      <Section title="5. Collaboration">
        <Row label="Collaboration alerts" value={s.collaborationAlerts} />
      </Section>

      {/* 6. Submission Quality */}
      <Section title="6. Submission Quality">
        <Row label="Pending reviews" value={s.pendingReviews} />
      </Section>

      {/* 7. Originality */}
      <Section title="7. Originality">
        <Row label="Originality alerts" value={s.originalityAlerts} />
      </Section>

      {/* 8. Code Quality */}
      <Section title="8. Code Quality">
        <Row label="Critical code issues" value={s.criticalCodeIssues} />
      </Section>

      {/* 9. Recommended Actions */}
      <Section title="9. Recommended Actions">
        {(health.recommendedActions || []).length === 0 ? (
          <p className="text-sm text-slate-muted flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> No recommendations available.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {health.recommendedActions.map((rec, i) => (
              <RecommendationCard key={`${rec.type}-${i}`} rec={rec} />
            ))}
          </div>
        )}
      </Section>

      {/* 10. Positive Signals */}
      <Section title="10. Positive Signals">
        {(health.positiveSignals || []).length === 0 ? (
          <p className="text-sm text-slate-muted flex items-center gap-1.5">
            <Star className="w-4 h-4" /> No positive signals detected yet.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {health.positiveSignals.map((p, i) => (
              <div key={i} className="rounded-xl2 p-3 border border-slate-line bg-mint-soft">
                <p className="text-sm font-semibold text-slate-ink">✓ {p.title}</p>
                <p className="text-xs text-slate-ink mt-1">{p.reason}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Top Issues (Feature 3) — shown alongside the 10 sections above */}
      {(health.topIssues || []).length > 0 && (
        <Section title="Top Issues">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
            <ListChecks className="w-3.5 h-3.5" /> Up to 5, most severe first
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {health.topIssues.map((issue, i) => (
              <IssueCard key={`${issue.type}-${i}`} issue={issue} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

export default ProjectHealthDetailPanel;
