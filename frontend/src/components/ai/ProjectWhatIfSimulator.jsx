import { useState } from "react";
import {
  Plus, Trash2, Play, Loader2, AlertTriangle,
  TrendingUp, TrendingDown, Minus, ShieldAlert, Info,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as whatIfService from "../../services/projectWhatIfService";

/**
 * STEP 25 — AI Project What-If Simulator.
 *
 * READ-ONLY / SIMULATION-ONLY UI. Nothing this component does can change a
 * real task, group, or sprint plan — every call goes to
 * services/projectWhatIfService.js's simulate/compare endpoints, which the
 * backend guarantees never mutate project data (see
 * backend/src/services/projectWhatIfSimulatorService.js). There is no
 * "Apply" button here by design (Step 25 spec: applyable stays false).
 *
 * Purely additive alongside SprintPlannerPanel / ExecutionCopilotPanel /
 * ConflictResolutionPanel — reuses their underlying scores via the backend,
 * never re-derives its own.
 */

const TASK_STATUSES = [
  "backlog", "todo", "in_progress", "review", "done",
  "pending", "submitted", "ai_review", "guide_review", "changes_requested", "overdue", "completed", "rejected",
];
const TASK_PRIORITIES = ["low", "medium", "high", "critical"];

const CHANGE_LABELS = {
  TASK_DEADLINE: "Move a task's deadline",
  TASK_REASSIGNMENT: "Reassign a task",
  TASK_STATUS: "Change a task's status",
  TASK_PRIORITY: "Change a task's priority",
  TASK_BLOCKER: "Resolve a task's blockers",
  PROJECT_DEADLINE: "Change the project deadline",
  WORKLOAD_REDISTRIBUTION: "Redistribute a task's owner",
  SPRINT_CHANGE: "Flag this as a sprint-plan change",
};

const STATUS_STYLES = {
  HEALTHY: { text: "text-mint", bg: "bg-mint-soft" },
  STABLE: { text: "text-mint", bg: "bg-mint-soft" },
  ON_TRACK: { text: "text-mint", bg: "bg-mint-soft" },
  NEEDS_ATTENTION: { text: "text-amber", bg: "bg-amber-soft" },
  LIKELY_LATE: { text: "text-amber", bg: "bg-amber-soft" },
  AT_RISK: { text: "text-amber", bg: "bg-amber-soft" },
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft" },
  INSUFFICIENT_DATA: { text: "text-slate-muted", bg: "bg-cloud" },
};

const statusStyle = (s) => STATUS_STYLES[s] || STATUS_STYLES.INSUFFICIENT_DATA;

function ChangeBuilder({ capabilities, tasks, members, onAdd }) {
  const supported = capabilities?.supportedChanges || [];
  const [type, setType] = useState(supported[0] || "");
  const [taskId, setTaskId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [value, setValue] = useState("");

  const needsTask = ["TASK_DEADLINE", "TASK_REASSIGNMENT", "TASK_STATUS", "TASK_PRIORITY", "TASK_BLOCKER"].includes(type);
  const needsMember = type === "TASK_REASSIGNMENT" || type === "WORKLOAD_REDISTRIBUTION";
  const needsDate = type === "TASK_DEADLINE" || type === "PROJECT_DEADLINE";
  const needsStatus = type === "TASK_STATUS";
  const needsPriority = type === "TASK_PRIORITY";

  const canAdd = type && (!needsTask || taskId) && (!needsMember || memberId) && (!needsDate || value) && (!needsStatus || value) && (!needsPriority || value);

  const add = () => {
    if (!canAdd) return;
    let change = { type };
    if (needsTask) change.taskId = taskId;
    if (type === "TASK_REASSIGNMENT") change.memberId = memberId;
    if (type === "WORKLOAD_REDISTRIBUTION") change.assignments = [{ taskId, memberId }];
    if (needsDate) change.value = value;
    if (needsStatus || needsPriority) change.value = value;
    if (type === "TASK_BLOCKER") change.value = "RESOLVE";
    onAdd(change);
    setValue("");
  };

  return (
    <div className="rounded-lg border border-slate-line/70 p-3 space-y-2.5">
      <label className="block text-xs font-semibold text-slate-muted">Scenario change</label>
      <select
        value={type}
        onChange={(e) => { setType(e.target.value); setValue(""); }}
        className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
      >
        {supported.map((t) => (
          <option key={t} value={t}>{CHANGE_LABELS[t] || t}</option>
        ))}
      </select>

      {needsTask && (
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand">
          <option value="">Choose a task…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      )}

      {needsMember && (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand">
          <option value="">Choose a member…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      )}

      {needsDate && (
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
      )}

      {needsStatus && (
        <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand">
          <option value="">Choose a status…</option>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      {needsPriority && (
        <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand">
          <option value="">Choose a priority…</option>
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}

      <button
        onClick={add}
        disabled={!canAdd}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-brand bg-cloud rounded-lg px-3 py-2 hover:bg-slate-line/60 transition-colors disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" /> Add to scenario
      </button>
    </div>
  );
}

function MetricRow({ label, baseline, projected, format = (v) => v }) {
  const changed = baseline !== projected;
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-slate-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-slate-ink">{format(baseline)}</span>
        {changed && (
          <>
            <span className="text-slate-muted">→</span>
            <span className="font-semibold text-brand">{format(projected)}</span>
          </>
        )}
      </span>
    </div>
  );
}

function ImpactList({ title, items, icon: Icon, tone }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={classNames("flex items-center gap-1.5 text-xs font-semibold mb-1.5", tone)}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((it, i) => <li key={i} className="text-sm text-slate-ink">• {it}</li>)}
      </ul>
    </div>
  );
}

function ResultView({ result }) {
  if (!result) return null;

  if (result.status === "INVALID_SIMULATION") {
    return (
      <div className="rounded-lg bg-coral-soft text-coral px-4 py-3 space-y-1">
        <p className="text-sm font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> This scenario has contradictory changes</p>
        {result.conflicts.map((c, i) => <p key={i} className="text-sm">{c.message}</p>)}
      </div>
    );
  }

  const { baseline, projected, impact, summary, rejected, warnings } = result;
  const bStyle = statusStyle(baseline.projectStatus);
  const pStyle = statusStyle(projected.projectStatus);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2">No changes were applied — this is a projection only.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-line/70 p-3">
          <p className="text-xs font-semibold text-slate-muted mb-1.5">CURRENT</p>
          <span className={classNames("text-xs font-semibold px-2.5 py-1 rounded-full inline-block mb-2", bStyle.bg, bStyle.text)}>
            {baseline.projectStatus}
          </span>
          <MetricRow label="Completion" baseline={baseline.completionProbability} projected={baseline.completionProbability} format={(v) => (v == null ? "—" : `${v}%`)} />
          <MetricRow label="Risk" baseline={baseline.riskScore} projected={baseline.riskScore} format={(v) => (v == null ? "—" : v)} />
        </div>
        <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
          <p className="text-xs font-semibold text-brand mb-1.5">PROJECTED</p>
          <span className={classNames("text-xs font-semibold px-2.5 py-1 rounded-full inline-block mb-2", pStyle.bg, pStyle.text)}>
            {projected.projectStatus}
          </span>
          <MetricRow label="Completion" baseline={projected.completionProbability} projected={projected.completionProbability} format={(v) => (v == null ? "—" : `${v}%`)} />
          <MetricRow label="Risk" baseline={projected.riskScore} projected={projected.riskScore} format={(v) => (v == null ? "—" : v)} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-line/70 p-3 space-y-1">
        <MetricRow label="Overdue tasks" baseline={baseline.overdueTaskCount} projected={projected.overdueTaskCount} />
        <MetricRow label="Blocked tasks" baseline={baseline.blockedTaskCount} projected={projected.blockedTaskCount} />
        <MetricRow label="Review backlog" baseline={baseline.reviewBacklogCount} projected={projected.reviewBacklogCount} />
        <MetricRow label="High-risk tasks" baseline={baseline.highRiskTaskCount} projected={projected.highRiskTaskCount} />
        <MetricRow label="Execution readiness" baseline={baseline.executionScore} projected={projected.executionScore} format={(v) => (v == null ? "—" : v)} />
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-ink mb-1">{summary.headline}</p>
        <ul className="space-y-0.5">
          {summary.details.map((d, i) => <li key={i} className="text-sm text-slate-muted">• {d}</li>)}
        </ul>
      </div>

      <ImpactList title="Improves" items={impact.positive} icon={TrendingUp} tone="text-mint" />
      <ImpactList title="Worsens" items={impact.negative} icon={TrendingDown} tone="text-coral" />
      <ImpactList title="Unchanged" items={impact.unchanged} icon={Minus} tone="text-slate-muted" />

      {(baseline.blockedTaskCount > 0 || projected.blockedTaskCount > 0 || baseline.overdueTaskCount > 0 || projected.overdueTaskCount > 0) && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber mb-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Remaining Risks</p>
          <ul className="space-y-0.5">
            {projected.overdueTaskCount > 0 && <li className="text-sm text-slate-ink">• {projected.overdueTaskCount} task(s) remain overdue</li>}
            {projected.blockedTaskCount > 0 && <li className="text-sm text-slate-ink">• {projected.blockedTaskCount} task(s) remain blocked</li>}
            {projected.reviewBacklogCount > 0 && <li className="text-sm text-slate-ink">• Review backlog still has {projected.reviewBacklogCount} task(s)</li>}
          </ul>
        </div>
      )}

      {rejected?.length > 0 && (
        <div className="rounded-lg bg-amber-soft text-amber px-3 py-2 space-y-1">
          <p className="text-xs font-semibold">Some changes couldn't be simulated</p>
          {rejected.map((r, i) => <p key={i} className="text-xs">{r.reason}</p>)}
        </div>
      )}
      {warnings?.length > 0 && warnings.map((w, i) => <p key={i} className="text-xs text-slate-muted">{w}</p>)}
    </div>
  );
}

const ProjectWhatIfSimulator = ({ groupId, capabilities, tasks, members }) => {
  const [pendingChanges, setPendingChanges] = useState([]);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const removeChange = (i) => setPendingChanges((cs) => cs.filter((_, idx) => idx !== i));

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await whatIfService.runWhatIfSimulation(groupId, pendingChanges);
      setResult(data);
    } catch (e) {
      setError(e.message || "Couldn't run this simulation.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const taskTitle = (id) => tasks.find((t) => t.id === id)?.title || id;
  const memberName = (id) => members.find((m) => m.id === id)?.name || id;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Simulation only — no project data will be changed.
      </p>

      <ChangeBuilder capabilities={capabilities} tasks={tasks} members={members} onAdd={(c) => setPendingChanges((cs) => [...cs, c])} />

      {pendingChanges.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-muted">Scenario ({pendingChanges.length} change{pendingChanges.length === 1 ? "" : "s"})</p>
          {pendingChanges.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-sm bg-cloud rounded-lg px-3 py-2">
              <span className="text-slate-ink">
                {CHANGE_LABELS[c.type] || c.type}
                {c.taskId && <> — {taskTitle(c.taskId)}</>}
                {c.memberId && <> → {memberName(c.memberId)}</>}
                {c.value && typeof c.value === "string" && <> ({c.value})</>}
              </span>
              <button onClick={() => removeChange(i)} className="text-slate-muted hover:text-coral transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={run}
        disabled={running || pendingChanges.length === 0}
        className="w-full inline-flex items-center justify-center gap-1.5 bg-brand text-white text-sm font-semibold rounded-lg px-3 py-2 hover:bg-brand-deep transition-colors disabled:opacity-60"
      >
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {running ? "Simulating…" : "Run Simulation"}
      </button>

      {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

      <ResultView result={result} />
    </div>
  );
};

export default ProjectWhatIfSimulator;
