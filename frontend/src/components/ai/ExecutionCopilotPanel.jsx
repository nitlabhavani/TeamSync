import { ListChecks, AlertTriangle, Star, ArrowRightLeft } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 21 — expandable detail panel shown when the guide clicks "View Full
 * Plan" on ProjectExecutionCopilot. Purely presentational: every section
 * reuses fields already present on the `copilot` payload from
 * services/projectExecutionCopilotService.js — nothing is recomputed here.
 */
const PRIORITY_STYLES = {
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", dot: "🔴" },
  HIGH: { text: "text-amber", bg: "bg-amber-soft", dot: "🟠" },
  MEDIUM: { text: "text-amber", bg: "bg-amber-soft", dot: "🟡" },
  LOW: { text: "text-slate-muted", bg: "bg-cloud", dot: "⚪" },
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

const ActionCard = ({ action }) => {
  const style = PRIORITY_STYLES[action.priority] || PRIORITY_STYLES.LOW;
  return (
    <div className={classNames("rounded-xl2 p-3 border border-slate-line", style.bg)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-ink">
          {style.dot} {action.title}
        </p>
        <span className={classNames("text-[10px] font-semibold uppercase", style.text)}>{action.priority}</span>
      </div>
      {action.reason && <p className="text-xs text-slate-ink mt-1">{action.reason}</p>}
      {action.suggestedAction && <p className="text-xs font-medium text-slate-ink mt-1.5">→ {action.suggestedAction}</p>}
    </div>
  );
};

const EmptyRow = ({ icon: Icon, text }) => (
  <p className="text-sm text-slate-muted flex items-center gap-1.5">
    <Icon className="w-4 h-4" /> {text}
  </p>
);

const ExecutionCopilotPanel = ({ copilot, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Loading the full Execution Copilot plan…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">Couldn't load the Execution Copilot plan.</p>
      </div>
    );
  }

  if (!copilot || copilot.overallStatus === "INSUFFICIENT_DATA") {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Not enough data yet for a detailed execution plan.</p>
      </div>
    );
  }

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-5">
      {/* 1. Project status */}
      <Section title="1. Project Status">
        <Row label="Status" value={copilot.overallStatus?.replace("_", " ")} />
        <Row label="Execution score" value={copilot.executionScore != null ? `${copilot.executionScore} / 100` : null} />
        <Row label="Trend" value={copilot.trend} />
        <Row label="Top priority" value={copilot.topPriority?.title} />
        <p className="text-xs text-slate-muted mt-2">{copilot.disclaimer}</p>
      </Section>

      {/* 2. Today's actions */}
      <Section title="2. Today's Actions">
        {(copilot.todayActions || []).length === 0 ? (
          <EmptyRow icon={Star} text="No urgent actions for today." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {copilot.todayActions.map((a, i) => (
              <ActionCard key={`${a.type}-${i}`} action={a} />
            ))}
          </div>
        )}
      </Section>

      {/* 3. Blocked tasks */}
      <Section title="3. Blocked Tasks">
        {(copilot.blockedTasks || []).length === 0 ? (
          <EmptyRow icon={Star} text="No blocked or stalled tasks detected." />
        ) : (
          <ul className="space-y-1.5">
            {copilot.blockedTasks.map((t, i) => (
              <li key={i} className="text-sm text-slate-ink rounded-xl2 border border-slate-line p-2.5">
                {t.title} <span className="text-xs text-slate-muted">— no update in {t.daysSinceUpdate} day(s)</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 4. Deadline actions */}
      <Section title="4. Deadline Actions">
        {(copilot.deadlineActions || []).length === 0 ? (
          <EmptyRow icon={Star} text="No deadline-related actions right now." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {copilot.deadlineActions.slice(0, 6).map((a, i) => (
              <ActionCard key={`${a.type}-${i}`} action={a} />
            ))}
          </div>
        )}
      </Section>

      {/* 5. Team attention */}
      <Section title="5. Team Attention">
        {(copilot.teamAttention || []).length === 0 ? (
          <EmptyRow icon={Star} text="No members currently flagged for attention." />
        ) : (
          <ul className="space-y-1.5">
            {copilot.teamAttention.map((s, i) => (
              <li key={i} className="text-sm text-slate-ink rounded-xl2 border border-slate-line p-2.5">
                <span className="font-semibold">{s.riskLevel}</span> — {s.reasons?.[0] || "Flagged for review."}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 6. Submission/review actions */}
      <Section title="6. Submission / Review Actions">
        {(copilot.submissionActions || []).length === 0 ? (
          <EmptyRow icon={Star} text="No submission or review actions pending." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {copilot.submissionActions.slice(0, 6).map((a, i) => (
              <ActionCard key={`${a.type}-${i}`} action={a} />
            ))}
          </div>
        )}
      </Section>

      {/* 7. Collaboration actions */}
      <Section title="7. Collaboration Actions">
        {(copilot.collaborationActions || []).length === 0 ? (
          <EmptyRow icon={Star} text="No collaboration or engagement concerns." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {copilot.collaborationActions.slice(0, 6).map((a, i) => (
              <ActionCard key={`${a.type}-${i}`} action={a} />
            ))}
          </div>
        )}
      </Section>

      {/* 8. Recommended reassignments */}
      <Section title="8. Recommended Reassignments">
        {(copilot.recommendedReassignments || []).length === 0 ? (
          <EmptyRow icon={ArrowRightLeft} text="No reassignments recommended right now." />
        ) : (
          <ul className="space-y-1.5">
            {copilot.recommendedReassignments.map((r, i) => (
              <li key={i} className="text-sm text-slate-ink rounded-xl2 border border-slate-line p-2.5">
                {r.suggestedAction}
                <p className="text-xs text-slate-muted mt-1">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 9. Positive signals */}
      <Section title="9. Positive Signals">
        {(copilot.positiveSignals || []).length === 0 ? (
          <EmptyRow icon={Star} text="No positive signals detected yet." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {copilot.positiveSignals.map((p, i) => (
              <div key={i} className="rounded-xl2 p-3 border border-slate-line bg-mint-soft">
                <p className="text-sm font-semibold text-slate-ink">✓ {p.title}</p>
                <p className="text-xs text-slate-ink mt-1">{p.reason}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 10. Reasoning */}
      <Section title="10. Reasoning">
        {(copilot.reasoning || []).length === 0 ? (
          <EmptyRow icon={AlertTriangle} text="No reasoning available." />
        ) : (
          <ul className="space-y-1">
            {copilot.reasoning.map((r, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-1.5">
                <ListChecks className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-muted" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* This Week's Plan — shown alongside the 10 sections above */}
      {(copilot.thisWeekActions || []).length > 0 && (
        <Section title="This Week's Plan">
          <div className="grid sm:grid-cols-2 gap-3">
            {copilot.thisWeekActions.map((a, i) => (
              <ActionCard key={`${a.type}-${i}`} action={a} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

export default ExecutionCopilotPanel;
