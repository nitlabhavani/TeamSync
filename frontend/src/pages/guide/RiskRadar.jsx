import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Radar,
  AlertTriangle,
  CalendarClock,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Eye,
  Search,
  RefreshCw,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import * as riskService from "../../services/riskService";
import { classNames } from "../../utils/helperFunctions";

const DAY_MS = 24 * 60 * 60 * 1000;

// Real backend levels only — computeGroupRisk (backend/src/services/riskService.js)
// only ever returns "high" | "medium" | "low". An UNKNOWN fallback is kept for
// safety (so an unexpected value can't crash the chip/bar) without pretending
// an unrecognized level is "Healthy".
const LEVELS = {
  high: { label: "High risk", chip: "bg-coral-soft text-coral", bar: "bg-coral" },
  medium: { label: "Watch", chip: "bg-amber-soft text-amber", bar: "bg-amber" },
  low: { label: "Healthy", chip: "bg-mint-soft text-mint", bar: "bg-mint" },
  insufficient_data: { label: "Insufficient Data", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", bar: "bg-slate-400" },
};
const UNKNOWN_LEVEL = { label: "Unknown", chip: "bg-cloud text-slate-muted", bar: "bg-slate-muted" };

const LEVEL_FILTERS = [
  { id: "all", label: "All" },
  { id: "high", label: "High risk" },
  { id: "medium", label: "Watch" },
  { id: "low", label: "Healthy" },
  { id: "insufficient_data", label: "Insufficient Data" },
];

// Deadline timeline items (buildDeadlineTimeline, backend/src/services/riskService.js)
// come back as kind: "task" | "milestone" | "meeting" — badge copy for each.
const KIND_BADGE = {
  milestone: { label: "milestone", cls: "bg-brand-soft text-brand" },
  meeting: { label: "meeting", cls: "bg-cloud text-slate-muted" },
};

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const CardSkeleton = () => (
  <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
    <div className="flex items-center gap-3">
      <div className="h-4 w-40 bg-cloud rounded animate-pulse" />
      <div className="h-4 w-16 bg-cloud rounded-full animate-pulse ml-auto" />
    </div>
    <div className="mt-4 h-2 rounded-full bg-cloud animate-pulse" />
    <div className="mt-4 h-16 bg-cloud/60 rounded-lg animate-pulse" />
  </div>
);

const ListSkeleton = () => (
  <div className="space-y-2.5">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-[52px] rounded-lg bg-cloud/60 animate-pulse" />
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

const RiskRadar = () => {
  const [radar, setRadar] = useState([]);
  const [radarLoading, setRadarLoading] = useState(true);
  const [radarError, setRadarError] = useState("");

  const [deadlines, setDeadlines] = useState([]);
  const [deadlinesLoading, setDeadlinesLoading] = useState(true);
  const [deadlinesError, setDeadlinesError] = useState("");

  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");

  // Split into two independent loaders (previously a single Promise.all with
  // no .catch — one failing request left both skeletons spinning forever
  // with the error silently swallowed). Each now has its own loading/error
  // state and a Retry that calls the same existing service function.
  const loadRadar = useCallback(() => {
    setRadarLoading(true);
    setRadarError("");
    riskService
      .getRiskRadar()
      .then(setRadar)
      .catch((e) => setRadarError(e?.message || "Couldn't load the risk radar."))
      .finally(() => setRadarLoading(false));
  }, []);

  const loadDeadlines = useCallback(() => {
    setDeadlinesLoading(true);
    setDeadlinesError("");
    riskService
      .getUpcomingDeadlines()
      .then(setDeadlines)
      .catch((e) => setDeadlinesError(e?.message || "Couldn't load the deadline timeline."))
      .finally(() => setDeadlinesLoading(false));
  }, []);

  useEffect(() => {
    loadRadar();
    loadDeadlines();
  }, [loadRadar, loadDeadlines]);

  // Real counts derived from the already-loaded radar array — no extra
  // request to getRiskSummary() for the same data.
  const counts = useMemo(
    () => ({
      total: radar.length,
      high: radar.filter((g) => g.level === "high").length,
      medium: radar.filter((g) => g.level === "medium").length,
      low: radar.filter((g) => g.level === "low").length,
      insufficient: radar.filter((g) => g.level === "insufficient_data").length,
    }),
    [radar]
  );

  const filteredRadar = useMemo(() => {
    const q = search.trim().toLowerCase();
    return radar.filter((g) => {
      if (levelFilter !== "all" && g.level !== levelFilter) return false;
      if (q && !(g.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [radar, levelFilter, search]);

  // Deadline timeline items only carry `when` (a date) and `group` (the
  // group's name) from the backend — not `daysLeft`, `groupId`, `groupName`,
  // or `isTask`, which the previous version read anyway (always undefined,
  // so every item silently rendered as 0 days / no group / "milestone").
  // daysLeft is computed here from the real `when` field, and `group`/`kind`
  // are read directly instead of the non-existent fields.
  const enrichedDeadlines = useMemo(() => {
    const now = Date.now();
    return deadlines
      .filter((d) => d.when)
      .map((d) => ({ ...d, daysLeft: Math.floor((new Date(d.when) - now) / DAY_MS) }));
  }, [deadlines]);

  const dueWithin7 = useMemo(
    () => enrichedDeadlines.filter((d) => d.daysLeft >= 0 && d.daysLeft <= 7).length,
    [enrichedDeadlines]
  );

  const showInitialRadarLoading = radarLoading && radar.length === 0 && !radarError;

  return (
    <>
      <Navbar title="Risk Radar" subtitle="Groups across your teams that need attention, scored from real activity and deadlines" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-6xl w-full mx-auto">
        {/* Summary KPIs — derived entirely from the loaded radar array */}
        {showInitialRadarLoading ? (
          <KpiSkeleton />
        ) : radarError ? (
          <ErrorState message={radarError} onRetry={loadRadar} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatsCard label="Groups tracked" value={counts.total} icon={Radar} tone="brand" />
            <StatsCard label="High risk" value={counts.high} icon={ShieldAlert} tone="coral" />
            <StatsCard label="Watch" value={counts.medium} icon={Eye} tone="amber" />
            <StatsCard label="Healthy" value={counts.low} icon={ShieldCheck} tone="mint" />
            <StatsCard label="No Data" value={counts.insufficient} icon={AlertTriangle} tone="cloud" />
          </div>
        )}

        {/* Risk distribution — real counts only */}
        {!radarError && !showInitialRadarLoading && counts.total > 0 && (
          <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
            <p className="text-xs font-medium text-slate-muted mb-3">Risk distribution</p>
            <div className="h-2.5 rounded-full bg-cloud overflow-hidden flex">
              {counts.high > 0 && (
                <div className="h-full bg-coral" style={{ width: `${(counts.high / counts.total) * 100}%` }} />
              )}
              {counts.medium > 0 && (
                <div className="h-full bg-amber" style={{ width: `${(counts.medium / counts.total) * 100}%` }} />
              )}
              {counts.low > 0 && (
                <div className="h-full bg-mint" style={{ width: `${(counts.low / counts.total) * 100}%` }} />
              )}
              {counts.insufficient > 0 && (
                <div className="h-full bg-slate-400" style={{ width: `${(counts.insufficient / counts.total) * 100}%` }} />
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-4 text-[11px] text-slate-muted flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-coral" /> High risk · {counts.high}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber" /> Watch · {counts.medium}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mint" /> Healthy · {counts.low}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-400" /> Insufficient Data · {counts.insufficient}</span>
            </div>
          </div>
        )}

        {/* Filters — client-side only, over the already-loaded radar array */}
        {!showInitialRadarLoading && !radarError && radar.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-cloud rounded-full px-3.5 py-2 w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-muted shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search groups…"
                aria-label="Search groups"
                className="bg-transparent text-sm outline-none flex-1 placeholder:text-slate-muted"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {LEVEL_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLevelFilter(f.id)}
                  aria-pressed={levelFilter === f.id}
                  className={classNames(
                    "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    levelFilter === f.id
                      ? "bg-brand text-white border-brand"
                      : "border-slate-line text-slate-muted hover:text-slate-ink hover:border-brand"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          {/* Group risk cards */}
          <div className="space-y-4">
            {radarLoading && radar.length === 0 && !radarError && (
              <>
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </>
            )}

            {!radarLoading && radarError && (
              <ErrorState message={radarError} onRetry={loadRadar} />
            )}

            {!radarLoading && !radarError && radar.length === 0 && (
              <EmptyState
                icon={ShieldCheck}
                title="No groups to score yet"
                subtitle="Once you have active groups, their AI risk analysis will appear here."
              />
            )}

            {!radarLoading && !radarError && radar.length > 0 && filteredRadar.length === 0 && (
              <EmptyState
                icon={Search}
                title="No groups match your filters"
                subtitle="Try a different risk level or search term."
              />
            )}

            {!radarError &&
              filteredRadar.map((g) => {
                const level = LEVELS[g.level] || UNKNOWN_LEVEL;
                return (
                  <article key={g.groupId} className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="font-display text-base font-semibold text-slate-ink truncate">{g.name}</h2>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${level.chip}`}>{level.label}</span>
                      <span className="font-display text-xl font-semibold text-slate-ink shrink-0">{g.risk}</span>
                    </div>

                    <div className="mt-3 h-2 rounded-full bg-cloud">
                      <div className={`h-2 rounded-full ${level.bar}`} style={{ width: `${g.risk}%` }} />
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-ink">
                          <TrendingDown className="w-3.5 h-3.5 text-coral" /> Why this score
                        </p>
                        {g.drivers.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {g.drivers.map((d, i) => (
                              <li key={i} className="text-xs text-slate-muted">
                                • {d}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-slate-muted">No risk drivers detected.</p>
                        )}
                      </div>
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-ink">
                          <Sparkles className="w-3.5 h-3.5 text-brand" /> AI recommended actions
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {g.actions.map((a, i) => (
                            <li key={i} className="rounded-lg bg-cloud px-2.5 py-1.5 text-xs leading-relaxed text-slate-ink">
                              {a}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Stats footer — real fields from stats: {} only.
                        Fixed: overdue/dueSoon are counts (numbers) from the
                        backend, not arrays — the previous version called
                        `.length` on them, which is undefined on a number and
                        rendered as blank/"undefined" text. Also dropped
                        `nextMilestone`/`project`, which the service never
                        populates (always undefined), and added the real
                        missed-milestones and completion-% fields that were
                        already being fetched but never shown. */}
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-line pt-3 text-[11px] text-slate-muted">
                      <span>{g.overdue} overdue task{g.overdue === 1 ? "" : "s"}</span>
                      <span>{g.dueSoon} due within 3 days</span>
                      <span>{g.missedMilestones} missed milestone{g.missedMilestones === 1 ? "" : "s"}</span>
                      <span>{g.weeklyMessages} message{g.weeklyMessages === 1 ? "" : "s"} this week</span>
                      <span>Last meeting {g.daysSinceMeeting}d ago</span>
                      <span>{g.progress}% complete</span>
                    </div>
                  </article>
                );
              })}
          </div>

          {/* Deadline timeline */}
          <aside className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel h-fit">
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarClock className="w-4 h-4 text-brand shrink-0" />
              <h2 className="font-display text-sm font-semibold text-slate-ink">Deadline timeline</h2>
              {!deadlinesLoading && !deadlinesError && dueWithin7 > 0 && (
                <span className="text-[11px] font-medium text-amber bg-amber-soft rounded-full px-2 py-0.5 ml-auto">
                  {dueWithin7} due in 7 days
                </span>
              )}
            </div>

            {deadlinesLoading && deadlines.length === 0 && !deadlinesError && (
              <div className="mt-4">
                <ListSkeleton />
              </div>
            )}

            {!deadlinesLoading && deadlinesError && (
              <div className="mt-4">
                <ErrorState message={deadlinesError} onRetry={loadDeadlines} />
              </div>
            )}

            {!deadlinesLoading && !deadlinesError && enrichedDeadlines.length === 0 && (
              <div className="mt-4 flex items-center gap-2 text-xs text-mint">
                <ShieldCheck className="w-4 h-4" /> Nothing pending. All clear.
              </div>
            )}

            {!deadlinesError && enrichedDeadlines.length > 0 && (
              <ul className="mt-4 space-y-2.5">
                {enrichedDeadlines.slice(0, 12).map((d) => {
                  const tone = d.daysLeft < 0 ? "text-coral" : d.daysLeft <= 3 ? "text-amber" : "text-slate-muted";
                  const dot = d.daysLeft < 0 ? "bg-coral" : d.daysLeft <= 3 ? "bg-amber" : "bg-mint";
                  const badge = KIND_BADGE[d.kind];
                  return (
                    <li key={`${d.kind}-${d.id}`} className="flex items-start gap-2.5">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-ink">
                          {d.title}
                          {badge && (
                            <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-slate-muted">{d.group || "—"}</p>
                      </div>
                      <span className={`shrink-0 text-[11px] font-medium ${tone}`}>
                        {d.daysLeft < 0 ? `${Math.abs(d.daysLeft)}d late` : `${d.daysLeft}d`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </main>
    </>
  );
};

export default RiskRadar;
