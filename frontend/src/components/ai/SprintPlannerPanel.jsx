import { useState } from "react";
import {
  CalendarRange, ListTree, Users, AlertTriangle, Sparkles,
  RefreshCcw, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as sprintPlannerService from "../../services/sprintPlannerService";

/**
 * STEP 23 — AI Sprint Planner.
 *
 * Guide/team-leader only. This is a PLANNING/RECOMMENDATION UI: generating
 * a plan (sprintPlannerService.previewSprintPlan) only ever creates a DRAFT
 * SprintPlan — it never touches a Task. "Apply Sprint Plan" is the single
 * action that mutates real tasks (backend re-validates the plan isn't
 * stale first; a 409 surfaces here as a regenerate prompt, never a silent
 * overwrite).
 *
 * Purely additive alongside TeamPerformanceInsights / ExecutionCopilot /
 * TeamRisk cards — reuses their evidence via the backend, never re-derives
 * it here.
 */

const RISK_STYLES = {
  LOW_RISK: { text: "text-mint", bg: "bg-mint-soft", label: "Low Risk" },
  MODERATE_RISK: { text: "text-amber", bg: "bg-amber-soft", label: "Moderate Risk" },
  HIGH_RISK: { text: "text-coral", bg: "bg-coral-soft", label: "High Risk" },
  CRITICAL_RISK: { text: "text-coral", bg: "bg-coral-soft", label: "Critical Risk" },
  INSUFFICIENT_DATA: { text: "text-slate-muted", bg: "bg-cloud", label: "Insufficient Data" },
};

const PRIORITY_STYLES = {
  critical: "text-coral",
  high: "text-amber",
  medium: "text-slate-ink",
  low: "text-slate-muted",
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

function ConfigForm({ config, setConfig, onGenerate, generating }) {
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <div>
        <label className="block text-xs font-semibold text-slate-muted mb-1.5">Duration (days)</label>
        <input
          type="number"
          min={1}
          max={60}
          value={config.durationDays}
          onChange={(e) => setConfig((c) => ({ ...c, durationDays: e.target.value }))}
          className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-muted mb-1.5">Max tasks</label>
        <input
          type="number"
          min={1}
          max={30}
          value={config.maxTasks}
          onChange={(e) => setConfig((c) => ({ ...c, maxTasks: e.target.value }))}
          className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div className="flex items-end">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="w-full inline-flex items-center justify-center gap-1.5 bg-brand text-white text-sm font-semibold rounded-lg px-3 py-2 hover:bg-brand-deep transition-colors disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? "Generating…" : "Generate Sprint Plan"}
        </button>
      </div>
    </div>
  );
}

function TaskRow({ t }) {
  return (
    <div className="rounded-lg border border-slate-line/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-ink truncate">
            {t.recommendedOrder}. {t.title}
          </p>
          <p className={classNames("text-xs font-medium mt-0.5", PRIORITY_STYLES[t.priority] || "text-slate-muted")}>
            {(t.priority || "medium").toUpperCase()} · Due {fmtDate(t.recommendedDue)}
          </p>
        </div>
        {t.riskLevel && t.riskLevel !== "LOW" && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-coral-soft text-coral shrink-0">{t.riskLevel}</span>
        )}
      </div>
      {t.blockedBy?.length > 0 && (
        <p className="text-xs text-amber mt-1.5">Depends on {t.blockedBy.length} task(s) outside this sprint</p>
      )}
      {t.dependencyTaskIds?.length > 0 && (
        <p className="text-xs text-slate-muted mt-1">In-sprint dependencies: {t.dependencyTaskIds.length}</p>
      )}
      {t.reason && <p className="text-xs text-slate-muted mt-1.5">{t.reason}</p>}
    </div>
  );
}

const SprintPlannerPanel = ({ groupId }) => {
  const [config, setConfig] = useState({ durationDays: 7, maxTasks: 10 });
  const [plan, setPlan] = useState(null);
  const [meta, setMeta] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [applyError, setApplyError] = useState(null);
  const [applied, setApplied] = useState(false);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setApplyError(null);
    setApplied(false);
    try {
      const data = await sprintPlannerService.previewSprintPlan(groupId, {
        durationDays: Number(config.durationDays) || undefined,
        maxTasks: Number(config.maxTasks) || undefined,
      });
      setPlan(data.plan);
      setMeta({ insufficient: data.insufficient, insufficientReason: data.insufficientReason });
    } catch (e) {
      setError(e.message || "Couldn't generate a sprint plan.");
      setPlan(null);
    } finally {
      setGenerating(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await sprintPlannerService.applySprintPlan(groupId, plan.id);
      setPlan(result);
      setApplied(true);
    } catch (e) {
      // A 409 SPRINT_PLAN_STALE surfaces here — never silently overwritten.
      setApplyError(e.message || "This plan is out of date. Regenerate it and try again.");
    } finally {
      setApplying(false);
    }
  };

  const cancelDraft = async () => {
    if (!plan) return;
    try {
      await sprintPlannerService.cancelSprintPlan(groupId, plan.id);
    } catch {
      /* best-effort — clearing the local view either way */
    }
    setPlan(null);
    setMeta(null);
  };

  const riskStyle = RISK_STYLES[plan?.riskSummary?.sprintRiskLevel] || RISK_STYLES.INSUFFICIENT_DATA;

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
          <CalendarRange className="w-4 h-4 text-brand" /> AI Sprint Planner
        </p>
        {plan && plan.status === "DRAFT" && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-soft text-amber">DRAFT</span>
        )}
        {plan && plan.status === "APPLIED" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-mint-soft text-mint">
            <CheckCircle2 className="w-3 h-3" /> APPLIED
          </span>
        )}
      </div>

      {!plan && <ConfigForm config={config} setConfig={setConfig} onGenerate={generate} generating={generating} />}

      {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

      {plan && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-slate-ink">
              Sprint: <strong>{fmtDate(plan.sprintStart)} – {fmtDate(plan.sprintEnd)}</strong> ({plan.planningHorizonDays} days)
            </p>
            <span className={classNames("text-xs font-semibold px-2.5 py-1 rounded-full", riskStyle.bg, riskStyle.text)}>
              {riskStyle.label}
            </span>
          </div>

          {meta?.insufficient && (
            <p className="text-sm text-amber bg-amber-soft rounded-lg px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {meta.insufficientReason}
            </p>
          )}

          {plan.riskSummary?.factors?.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Risk Factors
              </p>
              <ul className="space-y-0.5">
                {plan.riskSummary.factors.map((f, i) => (
                  <li key={i} className="text-sm text-slate-ink">• {f}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
              <ListTree className="w-3.5 h-3.5" /> Selected Tasks ({plan.plannedTasks?.length || 0})
            </p>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {(plan.plannedTasks || []).map((t) => (
                <TaskRow key={t.task || t.taskId} t={t} />
              ))}
            </div>
          </div>

          {plan.workloadSummary?.byMember?.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
                <Users className="w-3.5 h-3.5" /> Workload Balance
              </p>
              <div className="flex flex-wrap gap-2">
                {plan.workloadSummary.byMember.map((m) => (
                  <span
                    key={m.memberId}
                    className={classNames(
                      "text-xs font-medium px-2.5 py-1 rounded-full",
                      m.balanceLabel === "OVERLOADED" ? "bg-coral-soft text-coral"
                        : m.balanceLabel === "UNDER_UTILIZED" ? "bg-cloud text-slate-muted"
                        : "bg-mint-soft text-mint"
                    )}
                  >
                    {m.percentage != null ? `${m.percentage}% · ` : ""}{m.taskCount} task{m.taskCount === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
              {!plan.workloadSummary.effortEstimatesAvailable && (
                <p className="text-xs text-slate-muted mt-1.5">Effort estimates unavailable — shown as task counts only.</p>
              )}
            </div>
          )}

          {plan.recommendations?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-muted mb-1.5">💡 Recommended Actions</p>
              <ul className="space-y-1">
                {plan.recommendations.map((r, i) => (
                  <li key={i} className="text-sm text-slate-ink">• {r}</li>
                ))}
              </ul>
            </div>
          )}

          {applyError && (
            <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3 flex items-start gap-2">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {applyError}
            </p>
          )}

          {applied ? (
            <p className="text-sm text-mint bg-mint-soft rounded-lg px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Sprint plan applied. Affected students have been notified.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={generate}
                disabled={generating || applying}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-ink bg-cloud rounded-lg px-3 py-2 hover:bg-slate-line/60 transition-colors disabled:opacity-60"
              >
                <RefreshCcw className="w-3.5 h-3.5" /> Regenerate
              </button>
              <button
                onClick={apply}
                disabled={applying || generating || plan.status !== "DRAFT" || meta?.insufficient}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand rounded-lg px-3 py-2 hover:bg-brand-deep transition-colors disabled:opacity-60"
              >
                {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Apply Sprint Plan
              </button>
              <button
                onClick={cancelDraft}
                disabled={applying || generating}
                className="inline-flex items-center gap-1 text-sm font-semibold text-slate-muted hover:text-slate-ink transition-colors px-3 py-2"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SprintPlannerPanel;
