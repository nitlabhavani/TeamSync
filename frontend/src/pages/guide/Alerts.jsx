import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import AlertCard from "../../components/dashboard/AlertCard";
import AIWarningsList from "../../components/ai/AIWarningsList";
import * as alertService from "../../services/alertService";
import * as aiService from "../../services/aiService";
import { useGroups } from "../../hooks/useGroups";
import { classNames } from "../../utils/helperFunctions";

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const ListSkeleton = () => (
  <div className="space-y-2.5">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-[64px] rounded-lg bg-cloud/60 animate-pulse" />
    ))}
  </div>
);

const EmptyState = ({ icon: Icon, title, subtitle }) => (
  <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-14 px-6 bg-paper">
    <span className="w-11 h-11 rounded-full bg-cloud flex items-center justify-center">
      <Icon className="w-5 h-5 text-slate-muted" />
    </span>
    <p className="text-sm font-medium text-slate-ink">{title}</p>
    {subtitle && <p className="text-xs text-slate-muted max-w-xs">{subtitle}</p>}
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="flex items-center justify-between gap-3 bg-coral-soft border border-coral/20 rounded-xl2 px-4 py-3.5">
    <div className="flex items-center gap-3 min-w-0">
      <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
      <p className="text-sm text-coral truncate">{message}</p>
    </div>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

// Real backend severities only — the alert feed (built from the risk radar,
// see alertService.getGuideAlerts) ever emits "high" | "medium" | "low".
// No "critical"/"warning"/"info" tier exists in the data, so none is invented here.
const SEVERITY_META = {
  high: { label: "Needs attention" },
  medium: { label: "Worth watching" },
  low: { label: "Good news" },
};

const SEVERITY_FILTERS = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

const Alerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState(false);

  const { groups } = useGroups();
  const [groupId, setGroupId] = useState(null);

  const [severityFilter, setSeverityFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [search, setSearch] = useState("");

  // STEP 4H/4I — Step 3 AI warnings for the selected group. Rendered
  // separately from the existing chat-derived alert feed above (a
  // different, already-shipped feature) rather than merged, so neither
  // list needs to guess at the other's de-duplication.
  const [aiWarnings, setAiWarnings] = useState([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState(null);

  const loadAlerts = useCallback(() => {
    setAlertsLoading(true);
    setAlertsError(false);
    alertService
      .getGuideAlerts()
      .then(setAlerts)
      .catch(() => setAlertsError(true))
      .finally(() => setAlertsLoading(false));
  }, []);

  useEffect(loadAlerts, [loadAlerts]);

  useEffect(() => {
    if (!groupId && groups[0]) setGroupId(groups[0].id);
  }, [groups, groupId]);

  useEffect(() => {
    if (!groupId) return undefined;
    let alive = true;
    setAiLoading(true);
    setAiError(null);
    aiService
      .getProjectPerformance(groupId)
      .then((data) => alive && setAiWarnings(data?.warnings || []))
      .catch((err) => alive && setAiError(err.message))
      .finally(() => alive && setAiLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId]);

  // Counts computed only from the alert array already loaded — no backend
  // statistics endpoint exists for alerts, so nothing here is fetched or
  // invented separately from what's rendered below.
  const counts = useMemo(
    () => ({
      total: alerts.length,
      high: alerts.filter((a) => a.severity === "high").length,
      medium: alerts.filter((a) => a.severity === "medium").length,
      low: alerts.filter((a) => a.severity === "low").length,
    }),
    [alerts]
  );

  // Distinct groups actually represented in the loaded alerts, for the
  // group filter — not the full groups list, since a group with no alerts
  // shouldn't appear as a filter option here.
  const alertGroups = useMemo(() => {
    const seen = new Map();
    alerts.forEach((a) => {
      if (a.groupId && !seen.has(a.groupId)) seen.set(a.groupId, a.groupName);
    });
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (groupFilter !== "all" && a.groupId !== groupFilter) return false;
      if (q && !`${a.message} ${a.groupName || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [alerts, severityFilter, groupFilter, search]);

  return (
    <>
      <Navbar title="Alerts" subtitle="Real risk alerts flagged across your groups, plus AI project warnings" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-3xl w-full mx-auto">
        {/* Summary — only real, computable counts from the loaded alert array */}
        {alertsLoading ? (
          <KpiSkeleton />
        ) : alertsError ? (
          <ErrorState message="Couldn't load alerts." onRetry={loadAlerts} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard label="Total alerts" value={counts.total} icon={Bell} tone="brand" />
            <StatsCard label="Needs attention" value={counts.high} icon={ShieldAlert} tone="coral" />
            <StatsCard label="Worth watching" value={counts.medium} icon={AlertTriangle} tone="amber" />
            <StatsCard label="Good news" value={counts.low} icon={ShieldCheck} tone="mint" />
          </div>
        )}

        {/* Filter / search — client-side only, over already-loaded real alerts */}
        {!alertsLoading && !alertsError && alerts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-cloud rounded-full px-3.5 py-2 w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-muted shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search alerts…"
                aria-label="Search alerts"
                className="bg-transparent text-sm outline-none flex-1 placeholder:text-slate-muted"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {SEVERITY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSeverityFilter(f.id)}
                  aria-pressed={severityFilter === f.id}
                  className={classNames(
                    "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    severityFilter === f.id
                      ? "bg-brand text-white border-brand"
                      : "border-slate-line text-slate-muted hover:text-slate-ink hover:border-brand"
                  )}
                >
                  {f.label}
                </button>
              ))}
              {alertGroups.length > 1 && (
                <label className="sr-only" htmlFor="alerts-group-filter">
                  Filter by group
                </label>
              )}
              {alertGroups.length > 1 && (
                <select
                  id="alerts-group-filter"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="text-xs font-medium pl-3 pr-2 py-1.5 rounded-full border border-slate-line text-slate-muted bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <option value="all">All groups</option>
                  {alertGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* Alert list */}
        <section aria-label="Alerts">
          {alertsLoading ? (
            <ListSkeleton />
          ) : alertsError ? null : alerts.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Everything looks on track" subtitle="No active alerts right now." />
          ) : filteredAlerts.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No alerts match your filters"
              subtitle="Try a different severity, group, or search term."
            />
          ) : (
            <div className="space-y-5">
              {["high", "medium", "low"].map((sev) => {
                const items = filteredAlerts.filter((a) => a.severity === sev);
                if (items.length === 0) return null;
                return (
                  <div key={sev}>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted mb-2.5">
                      {SEVERITY_META[sev].label} · {items.length}
                    </h2>
                    <div className="space-y-2.5">
                      {items.map((a) => (
                        <AlertCard
                          key={a.id}
                          severity={a.severity}
                          message={a.message}
                          time={a.time}
                          groupName={a.groupName}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* AI project warnings — unchanged data flow, restyled container only */}
        {groups.length > 0 && (
          <section aria-label="AI project warnings">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted mb-2.5">
              AI project warnings
            </h2>
            <div className="flex gap-2 flex-wrap mb-3">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupId(g.id)}
                  aria-pressed={groupId === g.id}
                  className={classNames(
                    "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    groupId === g.id
                      ? "bg-brand text-white border-brand"
                      : "border-slate-line text-slate-muted hover:text-slate-ink hover:border-brand"
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <AIWarningsList warnings={aiWarnings} loading={aiLoading} error={aiError} />
          </section>
        )}
      </main>
    </>
  );
};

export default Alerts;
