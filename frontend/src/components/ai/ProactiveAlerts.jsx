import { Clock, MessageCircleWarning, Sparkles } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 16 — Guide "🤖 Proactive AI Alerts" section.
 * Purely additive UI fed by the additive `earlyWarnings` / `collaborationRisks`
 * fields already returned by GET /groups/:groupId/ai-risk (see
 * services/teamRiskAnalyzer.js). Renders nothing extra when there is
 * nothing to show — never invents placeholder rows.
 */
const severityBadge = (level) =>
  classNames(
    "text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2",
    level === "CRITICAL" || level === "AT_RISK" || level === "HIGH"
      ? "bg-coral-soft text-coral"
      : level === "MODERATE" || level === "DEADLINE_APPROACHING"
      ? "bg-amber-soft text-amber"
      : "bg-cloud text-slate-muted"
  );

const ProactiveAlerts = ({ earlyWarnings = [], collaborationRisks = [] }) => {
  const hasDeadline = earlyWarnings.length > 0;
  const hasCollab = collaborationRisks.length > 0;

  if (!hasDeadline && !hasCollab) return null;

  return (
    <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-4">
        <Sparkles className="w-4 h-4 text-brand" /> 🤖 Proactive AI Alerts
      </p>

      <div className="grid lg:grid-cols-2 gap-5">
        {hasDeadline && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
              <Clock className="w-3.5 h-3.5" /> Deadline nudges
            </p>
            <div className="space-y-1.5">
              {earlyWarnings.map((w) => (
                <div key={w.taskId} className="border border-slate-line rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-ink font-medium truncate">{w.title}</span>
                    <span className={severityBadge(w.level)}>{w.level.replace("_", " ")}</span>
                  </div>
                  <p className="text-[11px] text-slate-muted mt-0.5">
                    {w.assignee?.name || "Unassigned"} · {w.progress}% progress · {w.daysLeft}d left
                  </p>
                  <p className="text-[11px] text-slate-ink mt-1">{w.reason}</p>
                  <p className="text-[11px] text-brand mt-0.5">{w.recommendedAction}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasCollab && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
              <MessageCircleWarning className="w-3.5 h-3.5" /> Collaboration alerts
            </p>
            <div className="space-y-1.5">
              {collaborationRisks.map((c) => (
                <div key={c.studentId} className="border border-slate-line rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-ink font-medium">Team member</span>
                    <span className={severityBadge(c.riskLevel)}>{c.riskLevel}</span>
                  </div>
                  {c.flags?.map((f, i) => (
                    <p key={i} className="text-[11px] text-slate-ink mt-1">
                      {f.reason}
                    </p>
                  ))}
                  <p className="text-[11px] text-brand mt-1">{c.recommendation}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default ProactiveAlerts;
