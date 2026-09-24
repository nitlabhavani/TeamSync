import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Download,
  Printer,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import AIReportView from "../../components/ai/AIReportView";
import { useGroups } from "../../hooks/useGroups";
import * as aiService from "../../services/aiService";
import * as reportService from "../../services/reportService";
import { classNames, getInitials } from "../../utils/helperFunctions";
import { formatRelativeTime } from "../../utils/dateFormatter";
import { ROUTES } from "../../utils/constants";

const RowSkeleton = () => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-5 flex items-center gap-4 animate-pulse">
    <div className="w-11 h-11 rounded-full bg-cloud shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3.5 w-40 bg-cloud rounded" />
      <div className="h-3 w-24 bg-cloud/70 rounded" />
    </div>
    <div className="h-9 w-36 bg-cloud rounded-lg shrink-0" />
  </div>
);

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const EmptyState = ({ icon: Icon, title, subtitle, action }) => (
  <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-14 px-6 bg-paper">
    <span className="w-11 h-11 rounded-full bg-cloud flex items-center justify-center">
      <Icon className="w-5 h-5 text-slate-muted" />
    </span>
    <p className="text-sm font-medium text-slate-ink">{title}</p>
    {subtitle && <p className="text-xs text-slate-muted max-w-xs">{subtitle}</p>}
    {action}
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

/**
 * Step 14, Feature 7/10 — Weekly AI Summary. Additive: this is a completely
 * separate fetch (reportService.getGroupPeriodReport(id, "weekly")) from
 * the existing Step 3 AIReportView data above it, so a failure here never
 * affects the report that already worked. Renders only real fields off
 * `narrative` — nothing here is invented client-side.
 */
const WeeklyNarrativeCard = ({ narrative, loading }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel animate-pulse">
        <div className="h-3.5 w-40 bg-cloud rounded" />
      </div>
    );
  }
  if (!narrative) return null;

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Weekly AI Summary</p>
        <p className="text-sm font-semibold text-slate-ink">What happened this week</p>
      </div>
      <p className="text-sm text-slate-ink leading-relaxed">{narrative.summary}</p>

      {narrative.highlights?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-mint mb-1">Key Highlights</p>
          <ul className="list-disc list-inside text-xs text-slate-muted space-y-0.5">
            {narrative.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {narrative.concerns?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-amber mb-1">Attention Required</p>
          <ul className="list-disc list-inside text-xs text-slate-muted space-y-0.5">
            {narrative.concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {narrative.recommendations?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-brand mb-1">Recommended Actions</p>
          <ul className="list-disc list-inside text-xs text-slate-muted space-y-0.5">
            {narrative.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const Reports = () => {
  const navigate = useNavigate();
  const { groups, loading: groupsLoading } = useGroups();
  const [openGroupId, setOpenGroupId] = useState(null);
  const [reportData, setReportData] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [errorId, setErrorId] = useState(null);
  const [search, setSearch] = useState("");
  // Step 14, Feature 7/10 — separate state for the weekly narrative so a
  // failure to fetch it (e.g. no weekly data yet) never blocks or clears
  // the existing Step 3 report above it.
  const [narrativeData, setNarrativeData] = useState({});
  const [narrativeLoadingId, setNarrativeLoadingId] = useState(null);

  // Existing, unmodified call — aiService.getProjectPerformance(groupId), the
  // same Step 3 endpoint already used by TeamAnalytics/MemberDetails/Alerts/
  // AISummary. Every value in the rendered report still comes straight from
  // this response via the existing AIReportView component.
  const generateReport = useCallback(async (id) => {
    setLoadingId(id);
    setErrorId(null);
    try {
      const data = await aiService.getProjectPerformance(id);
      setReportData((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setErrorId(id);
    } finally {
      setLoadingId(null);
    }
  }, []);

  // STEP 4K — same toggle/fetch-once logic as before: expanding a group
  // that already has report data (or is already open) never re-fetches.
  const handleGenerate = (id) => {
    if (openGroupId === id) {
      setOpenGroupId(null);
      return;
    }
    setOpenGroupId(id);
    if (!reportData[id]) generateReport(id);
    // Step 14 — fetched independently of the Step 3 report; a missing or
    // failed weekly narrative simply renders nothing (see WeeklyNarrativeCard).
    if (!narrativeData[id]) fetchNarrative(id);
  };

  // Step 14, Feature 7/10 — fetches the persisted weekly AiReport payload
  // (reportService.buildPeriodReport's output) for this group and pulls out
  // just the `narrative` block added additively there.
  const fetchNarrative = useCallback(async (id) => {
    setNarrativeLoadingId(id);
    try {
      const data = await reportService.getGroupPeriodReport(id, "weekly");
      setNarrativeData((prev) => ({ ...prev, [id]: data?.narrative || null }));
    } catch {
      setNarrativeData((prev) => ({ ...prev, [id]: null }));
    } finally {
      setNarrativeLoadingId(null);
    }
  }, []);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name?.toLowerCase().includes(q) || g.project?.toLowerCase().includes(q)
    );
  }, [groups, search]);

  // Summary strip — computed only from data already available on this page:
  // the guide's real group list (with real memberIds) and the reports
  // actually generated so far this session. No separate summary endpoint
  // exists or is called here — reportService.getGuideReport() was inspected
  // but not wired in, since it runs a different (Node-side) scoring
  // pipeline from the Step 3 engine already used for the reports below, and
  // everything the summary needs is already present without it.
  const studentsCovered = useMemo(
    () => groups.reduce((sum, g) => sum + (g.memberIds?.length || 0), 0),
    [groups]
  );
  const generatedReports = useMemo(() => Object.values(reportData), [reportData]);
  const latestReportAt = useMemo(() => {
    const timestamps = generatedReports.map((r) => r?.generatedAt).filter(Boolean);
    if (!timestamps.length) return null;
    return timestamps.sort((a, b) => new Date(b) - new Date(a))[0];
  }, [generatedReports]);

  return (
    <>
      <Navbar title="Reports" subtitle="Generate AI collaboration reports for each of your groups" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-4xl w-full mx-auto">
        {/* Summary */}
        {groupsLoading ? (
          <KpiSkeleton />
        ) : groups.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard label="Groups" value={groups.length} icon={Users} tone="brand" />
            <StatsCard label="Students covered" value={studentsCovered} icon={TrendingUp} tone="mint" />
            <StatsCard label="Reports generated" value={generatedReports.length} icon={ClipboardList} tone="amber" />
            <StatsCard
              label="Latest report"
              value={latestReportAt ? formatRelativeTime(latestReportAt) : "—"}
              icon={CalendarClock}
              tone="brand"
            />
          </div>
        ) : null}

        {/* Search */}
        {!groupsLoading && groups.length > 1 && (
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
        )}

        {/* Group / report list */}
        <section aria-label="Group reports" className="space-y-4">
          {groupsLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No groups available yet"
              subtitle="Create a group before generating AI reports."
              action={
                <button
                  onClick={() => navigate(ROUTES.GUIDE_GROUP_MANAGEMENT)}
                  className="mt-1 text-xs font-semibold text-brand hover:text-brand-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Manage groups
                </button>
              }
            />
          ) : filteredGroups.length === 0 ? (
            <EmptyState icon={Search} title="No groups match your search" subtitle="Try a different name or project." />
          ) : (
            filteredGroups.map((g) => {
              const isOpen = openGroupId === g.id;
              const isLoading = loadingId === g.id;
              const hasError = errorId === g.id;
              const report = reportData[g.id];

              return (
                <div key={g.id}>
                  <div className="bg-paper border border-slate-line rounded-xl2 p-5 flex items-center gap-4 flex-wrap shadow-panel">
                    <span className="w-11 h-11 rounded-full bg-brand-deep flex items-center justify-center text-white font-semibold shrink-0">
                      {getInitials(g.name)}
                    </span>
                    <div className="flex-1 min-w-[180px]">
                      <p className="font-medium text-slate-ink">{g.name}</p>
                      <p className="text-xs text-slate-muted">{g.project}</p>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-muted">
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-brand" /> {g.collaborationScore} score
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-mint" /> {g.progress}% progress
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-amber" /> {g.memberIds.length} members
                      </span>
                      {report?.generatedAt && (
                        <span className="hidden sm:inline text-slate-muted">
                          · Report generated {formatRelativeTime(report.generatedAt)}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleGenerate(g.id)}
                      disabled={isLoading}
                      aria-expanded={isOpen}
                      className="flex items-center gap-2 bg-brand hover:bg-brand-deep disabled:opacity-70 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {isLoading ? "Generating…" : isOpen ? "Hide report" : report ? "View report" : "Generate report"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-4">
                      <div className="flex items-center justify-between gap-3 bg-paper border border-slate-line rounded-xl p-3 shadow-sm flex-wrap">
                        <span className="text-xs font-semibold text-slate-muted">Export & Actions:</span>
                        <div className="flex items-center gap-2">
                          <a
                            href={reportService.getExportReportUrl(g.id, "csv")}
                            download
                            className="inline-flex items-center gap-1.5 text-xs font-medium bg-cloud hover:bg-slate-200 text-slate-ink px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-brand" /> Export CSV
                          </a>
                          <a
                            href={reportService.getExportReportUrl(g.id, "html")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-soft hover:bg-brand-soft/80 text-brand-deep px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Printer className="w-3.5 h-3.5 text-brand" /> Print / Save PDF
                          </a>
                        </div>
                      </div>
                      <WeeklyNarrativeCard narrative={narrativeData[g.id]} loading={narrativeLoadingId === g.id} />
                      {hasError ? (
                        <ErrorState
                          message={`Couldn't generate the AI report for ${g.name}.`}
                          onRetry={() => generateReport(g.id)}
                        />
                      ) : (
                        <AIReportView groupName={g.name} data={report} loading={isLoading} error={false} />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <p className="text-xs text-slate-muted pt-2">
          Reports are compiled from AI analysis of group chat activity only — private conversations are never included.
        </p>
      </main>
    </>
  );
};

export default Reports;
