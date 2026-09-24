import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import {
  Users,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  Plus,
  UserCheck,
  UserX,
  MailCheck,
  Trophy,
  ArrowDownRight,
  RefreshCw,
  ShieldCheck,
  BarChart3,
  Bell,
  MessageCircle,
  MessageCircleQuestion,
  ListTodo,
  CalendarClock,
  ClipboardCheck,
  FileUp,
  Info,
  ChevronRight,
  ClipboardList,
  CalendarRange,
  ShieldAlert,
  FlaskConical,
  Brain,
  BookMarked,
  ListChecks,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import SectionHeading from "../../components/dashboard/SectionHeading";
import TeamStatsCard from "../../components/analytics/TeamStatsCard";
import AlertCard from "../../components/dashboard/AlertCard";
import CreateGroupModal from "../../components/groups/CreateGroupModal";
import AIProjectForecastCard from "../../components/ai/AIProjectForecastCard";
import ProjectForecastPanel from "../../components/ai/ProjectForecastPanel";
import ProjectHealthCommandCenter from "../../components/ai/ProjectHealthCommandCenter";
import ProjectHealthDetailPanel from "../../components/ai/ProjectHealthDetailPanel";
import ProjectExecutionCopilot from "../../components/ai/ProjectExecutionCopilot";
import ExecutionCopilotPanel from "../../components/ai/ExecutionCopilotPanel";
import TeamPerformanceInsights from "../../components/ai/TeamPerformanceInsights";
import TeamPerformancePanel from "../../components/ai/TeamPerformancePanel";
import SprintPlannerPanel from "../../components/ai/SprintPlannerPanel";
import ConflictResolutionPanel from "../../components/guide/ConflictResolutionPanel";
import ProjectWhatIfPanel from "../../components/ai/ProjectWhatIfPanel";
import MeetingIntelligencePanel from "../../components/ai/MeetingIntelligencePanel";
import ProjectKnowledgePanel from "../../components/ai/ProjectKnowledgePanel";
import ProjectMemoryAssistant from "../../components/ai/ProjectMemoryAssistant";
import ActionableInsightsPanel from "../../components/ai/ActionableInsightsPanel";
import { useGroups } from "../../hooks/useGroups";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications } from "../../hooks/useNotifications";
import * as analyticsService from "../../services/analyticsService";
import * as alertService from "../../services/alertService";
import * as reportService from "../../services/reportService";
import * as aiService from "../../services/aiService";
import * as teamRiskService from "../../services/teamRiskService";
import * as projectForecastService from "../../services/projectForecastService";
import * as projectHealthService from "../../services/projectHealthService";
import * as projectExecutionCopilotService from "../../services/projectExecutionCopilotService";
import * as teamPerformanceService from "../../services/teamPerformanceService";
import { getInitials, classNames } from "../../utils/helperFunctions";
import { formatDay, formatRelativeTime } from "../../utils/dateFormatter";
import { ROUTES } from "../../utils/constants";

const TeamHighlight = ({ title, team, icon: Icon, tone }) => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-4">
    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
      <Icon className={`w-3.5 h-3.5 ${tone}`} /> {title}
    </p>
    {team ? (
      <>
        <p className="text-sm font-semibold text-slate-ink truncate">{team.name}</p>
        <p className="text-xs text-slate-muted truncate">{team.project}</p>
        <p className="font-mono text-sm text-brand mt-1">
          score {team.collaborationScore} · {team.progress}%
        </p>
      </>
    ) : (
      <p className="text-sm text-slate-muted">Not enough data yet</p>
    )}
  </div>
);

const NOTIF_TYPE_CONFIG = {
  chat: { icon: MessageCircle, tone: "brand" },
  task: { icon: ListTodo, tone: "brand" },
  meeting: { icon: CalendarClock, tone: "brand" },
  review: { icon: ClipboardCheck, tone: "brand" },
  file: { icon: FileUp, tone: "brand" },
  risk: { icon: AlertTriangle, tone: "coral" },
  system: { icon: Info, tone: "neutral" },
};
const NOTIF_TONE_STYLES = {
  brand: "bg-brand-soft text-brand",
  coral: "bg-coral-soft text-coral",
  neutral: "bg-cloud text-slate-muted",
};
const notifConfigFor = (type) => NOTIF_TYPE_CONFIG[type] || NOTIF_TYPE_CONFIG.system;

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const TeamCardSkeleton = () => (
  <div className="space-y-3">
    {[0, 1, 2].map((i) => (
      <div key={i} className="h-[76px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const EmptyState = ({ icon: Icon, title, subtitle, action }) => (
  <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-10 px-6">
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
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 shrink-0 transition-colors"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

const GuideDashboard = () => {
  const { groups, loading: groupsLoading, fetchGroups } = useGroups();
  const { user } = useAuth();
  const { notifications } = useNotifications();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState(false);
  const [latestReport, setLatestReport] = useState(null);
  const [dailyReport, setDailyReport] = useState(null);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [reportHistory, setReportHistory] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [teamRisk, setTeamRisk] = useState(null);
  const [teamRiskLoading, setTeamRiskLoading] = useState(true);
  const [teamRiskError, setTeamRiskError] = useState(false);
  // STEP 19 — AI Project Progress Forecast & Early Intervention System.
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState(false);
  const [forecastDetailsOpen, setForecastDetailsOpen] = useState(false);

  const [projectHealth, setProjectHealth] = useState(null);
  const [projectHealthLoading, setProjectHealthLoading] = useState(true);
  const [projectHealthError, setProjectHealthError] = useState(false);
  const [projectHealthDetailsOpen, setProjectHealthDetailsOpen] = useState(false);

  const [executionCopilot, setExecutionCopilot] = useState(null);
  const [executionCopilotLoading, setExecutionCopilotLoading] = useState(true);
  const [executionCopilotError, setExecutionCopilotError] = useState(false);
  const [executionCopilotDetailsOpen, setExecutionCopilotDetailsOpen] = useState(false);

  const [teamPerformance, setTeamPerformance] = useState(null);
  const [teamPerformanceLoading, setTeamPerformanceLoading] = useState(true);
  const [teamPerformanceError, setTeamPerformanceError] = useState(false);
  const [teamPerformanceDetailsOpen, setTeamPerformanceDetailsOpen] = useState(false);
  // STEP 23 — AI Sprint Planner card is collapsed by default; the panel
  // itself owns all data-fetching/generation state (nothing to preload).
  const [sprintPlannerOpen, setSprintPlannerOpen] = useState(false);
  // STEP 24 — AI Conflict Resolution card is collapsed by default; the
  // panel itself owns all data-fetching/action state.
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  // STEP 25 — AI What-If Simulator card is collapsed by default; the panel
  // itself owns all data-fetching/simulation state (read-only, nothing to
  // preload here).
  const [whatIfPanelOpen, setWhatIfPanelOpen] = useState(false);
  // STEP 26 — AI Meeting Intelligence card is collapsed by default; the
  // panel itself owns all data-fetching/analysis state (nothing to preload
  // here — analysis is always user-triggered, never run automatically).
  const [meetingIntelligenceOpen, setMeetingIntelligenceOpen] = useState(false);
  const [projectMemoryAssistantOpen, setProjectMemoryAssistantOpen] = useState(false);
  const [actionableInsightsOpen, setActionableInsightsOpen] = useState(false);
  // STEP 27 — AI Project Knowledge card is collapsed by default; the panel
  // itself owns all data-fetching/search state (search is user-triggered,
  // extraction is user-triggered — nothing to preload here).
  const [projectKnowledgeOpen, setProjectKnowledgeOpen] = useState(false);

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    setStatsError(false);
    analyticsService
      .getTeamStats()
      .then(setStats)
      .catch(() => setStatsError(true))
      .finally(() => setStatsLoading(false));
  }, []);

  const loadAlerts = useCallback(() => {
    setAlertsLoading(true);
    setAlertsError(false);
    alertService
      .getGuideAlerts()
      .then(setAlerts)
      .catch(() => setAlertsError(true))
      .finally(() => setAlertsLoading(false));
  }, []);

  useEffect(loadStats, [loadStats]);
  useEffect(loadAlerts, [loadAlerts]);

  const [selectedGroupId, setSelectedGroupId] = useState(null);

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  // AI Summary for selected group
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(true);
  const [aiSummaryError, setAiSummaryError] = useState(false);

  const loadAiSummary = useCallback(async () => {
    if (!selectedGroupId) {
      setAiSummaryLoading(false);
      return;
    }
    setAiSummaryLoading(true);
    setAiSummaryError(false);
    try {
      const data = await aiService.getGroupAiSummary(selectedGroupId);
      setAiSummary(data);
    } catch (error) {
      console.error("Failed to load group AI summary", error);
      setAiSummary(null);
      setAiSummaryError(true);
    } finally {
      setAiSummaryLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadAiSummary();
  }, [selectedGroupId, groupsLoading, loadAiSummary]);

  const loadReports = useCallback(async () => {
    if (!selectedGroupId) {
      setReportsLoading(false);
      return;
    }
    setReportsLoading(true);
    setReportsError(false);
    try {
      const [latest, daily, weekly, monthly, history] = await Promise.all([
        reportService.getLatestGroupReport(selectedGroupId),
        reportService.getGroupPeriodReport(selectedGroupId, "daily"),
        reportService.getGroupPeriodReport(selectedGroupId, "weekly"),
        reportService.getGroupPeriodReport(selectedGroupId, "monthly"),
        reportService.getGroupReportHistory(selectedGroupId),
      ]);
      setLatestReport(latest);
      setDailyReport(daily);
      setWeeklyReport(weekly);
      setMonthlyReport(monthly);
      setReportHistory(history || []);
    } catch (error) {
      console.error("Failed to load guide AI reports", error);
      setLatestReport(null);
      setDailyReport(null);
      setWeeklyReport(null);
      setMonthlyReport(null);
      setReportHistory([]);
      setReportsError(true);
    } finally {
      setReportsLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadReports();
  }, [selectedGroupId, groupsLoading, loadReports]);

  const loadTeamRisk = useCallback(async () => {
    if (!selectedGroupId) {
      setTeamRiskLoading(false);
      return;
    }
    setTeamRiskLoading(true);
    setTeamRiskError(false);
    try {
      const data = await teamRiskService.getTeamRisk(selectedGroupId);
      setTeamRisk(data);
    } catch (error) {
      console.error("Failed to load AI team risk", error);
      setTeamRisk(null);
      setTeamRiskError(true);
    } finally {
      setTeamRiskLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadTeamRisk();
  }, [selectedGroupId, groupsLoading, loadTeamRisk]);

  const loadForecast = useCallback(async () => {
    if (!selectedGroupId) {
      setForecastLoading(false);
      return;
    }
    setForecastLoading(true);
    setForecastError(false);
    try {
      const data = await projectForecastService.getProjectForecast(selectedGroupId);
      setForecast(data);
    } catch (error) {
      console.error("Failed to load AI project forecast", error);
      setForecast(null);
      setForecastError(true);
    } finally {
      setForecastLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadForecast();
  }, [selectedGroupId, groupsLoading, loadForecast]);

  // STEP 20 — AI Project Health Command Center.
  const loadProjectHealth = useCallback(async () => {
    if (!selectedGroupId) {
      setProjectHealthLoading(false);
      return;
    }
    setProjectHealthLoading(true);
    setProjectHealthError(false);
    try {
      const data = await projectHealthService.getProjectHealth(selectedGroupId);
      setProjectHealth(data);
    } catch (error) {
      console.error("Failed to load AI project health", error);
      setProjectHealth(null);
      setProjectHealthError(true);
    } finally {
      setProjectHealthLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadProjectHealth();
  }, [selectedGroupId, groupsLoading, loadProjectHealth]);

  // STEP 21 — AI Execution Copilot.
  const loadExecutionCopilot = useCallback(async () => {
    if (!selectedGroupId) {
      setExecutionCopilotLoading(false);
      return;
    }
    setExecutionCopilotLoading(true);
    setExecutionCopilotError(false);
    try {
      const data = await projectExecutionCopilotService.getExecutionCopilot(selectedGroupId);
      setExecutionCopilot(data);
    } catch (error) {
      console.error("Failed to load AI execution copilot", error);
      setExecutionCopilot(null);
      setExecutionCopilotError(true);
    } finally {
      setExecutionCopilotLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadExecutionCopilot();
  }, [selectedGroupId, groupsLoading, loadExecutionCopilot]);

  // STEP 22 — AI Team Performance.
  const loadTeamPerformance = useCallback(async () => {
    if (!selectedGroupId) {
      setTeamPerformanceLoading(false);
      return;
    }
    setTeamPerformanceLoading(true);
    setTeamPerformanceError(false);
    try {
      const data = await teamPerformanceService.getTeamPerformance(selectedGroupId);
      setTeamPerformance(data);
    } catch (error) {
      console.error("Failed to load AI team performance", error);
      setTeamPerformance(null);
      setTeamPerformanceError(true);
    } finally {
      setTeamPerformanceLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!groupsLoading && selectedGroupId) loadTeamPerformance();
  }, [selectedGroupId, groupsLoading, loadTeamPerformance]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleCreated = async (group, invited) => {
    await fetchGroups();
    loadStats();
    setToast(
      invited
        ? `"${group.name}" created — ${invited} invitation${invited > 1 ? "s" : ""} sent.`
        : `"${group.name}" created.`
    );
  };

  const n = (v) => (v ?? v === 0 ? v : "—");

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || groups[0] || null,
    [groups, selectedGroupId]
  );

  const atRiskNames = useMemo(
    () => new Set((stats?.atRisk || []).map((r) => r.group)),
    [stats]
  );

  const recentActivity = notifications.slice(0, 5);

  return (
    <>
      <Navbar title="Guide overview" subtitle="Monitor every project group at a glance" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-6xl w-full mx-auto">
        {/* Welcome header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-semibold text-slate-ink">
              {greeting}, {user?.name || "Guide"}
            </h1>
            <p className="text-sm text-slate-muted mt-1">
              {alerts.length > 0
                ? `${alerts.length} item${alerts.length > 1 ? "s" : ""} may need your attention today.`
                : "Everything looks on track across your groups."}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" /> Create group
          </button>
        </div>

        {toast && <p className="text-sm text-mint bg-mint-soft rounded-lg px-4 py-3">{toast}</p>}

        {/* KPI overview */}
        {statsLoading ? (
          <KpiSkeleton />
        ) : statsError ? (
          <ErrorState message="Couldn't load your overview stats." onRetry={loadStats} />
        ) : (
          <>
            {stats && <TeamStatsCard {...stats} />}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatsCard label="Total groups" value={stats?.totalGroups ?? groups.length} icon={Users} tone="brand" />
              <StatsCard label="Total students" value={n(stats?.studentCount)} icon={Users} tone="brand" />
              <StatsCard label="Active members" value={n(stats?.activeMembers)} icon={UserCheck} tone="mint" />
              <StatsCard label="Inactive members" value={n(stats?.inactiveMembers)} icon={UserX} tone="coral" />
              <StatsCard label="Pending invitations" value={n(stats?.pendingInvitations)} icon={MailCheck} tone="amber" />
              <StatsCard label="AI alerts" value={alerts.length} icon={AlertTriangle} tone="coral" />
              <StatsCard label="Collaboration score" value={n(stats?.avgScore)} icon={Sparkles} tone="amber" />
              <StatsCard
                label="Performance score"
                value={
                  latestReport?.students?.length
                    ? `${Math.round(
                        latestReport.students.reduce((sum, s) => sum + s.overall, 0) /
                          latestReport.students.length
                      )}/100`
                    : "—"
                }
                icon={TrendingUp}
                tone="mint"
              />
            </div>
          </>
        )}

        {!statsLoading && !statsError && (
          <div className="grid sm:grid-cols-2 gap-4">
            <TeamHighlight title="Top performing team" team={stats?.topTeam} icon={Trophy} tone="text-mint" />
            <TeamHighlight
              title="Least active team"
              team={stats?.leastActiveTeam}
              icon={ArrowDownRight}
              tone="text-coral"
            />
          </div>
        )}

        {/* Team overview */}
        <section className="space-y-3">
          <SectionHeading icon={Users} title="Your groups" />
          {groupsLoading ? (
            <TeamCardSkeleton />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No groups yet"
              subtitle="Create your first group to start tracking student progress."
              action={
                <button
                  onClick={() => setModalOpen(true)}
                  className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-brand-deep"
                >
                  <Plus className="w-3.5 h-3.5" /> Create group
                </button>
              }
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => navigate(ROUTES.GUIDE_GROUP_MANAGEMENT)}
                  className="w-full text-left bg-paper border border-slate-line hover:border-brand rounded-xl2 px-4 py-3.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-brand-deep flex items-center justify-center text-white text-sm font-semibold shrink-0">
                      {getInitials(g.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-ink truncate">{g.name}</p>
                      <p className="text-xs text-slate-muted truncate">
                        {g.project} · {g.memberIds?.length || 0} members
                      </p>
                    </div>
                    {atRiskNames.has(g.name) && (
                      <span className="text-[10px] font-semibold text-coral bg-coral-soft rounded-full px-2 py-0.5 shrink-0">
                        At risk
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3 text-xs">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-slate-muted mb-1">
                        <span>Progress</span>
                        <span className="font-medium text-slate-ink">{g.progress ?? 0}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-cloud overflow-hidden">
                        <div
                          className="h-full bg-brand rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, g.progress ?? 0))}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm font-semibold text-brand">{g.collaborationScore ?? 0}</p>
                      <p className="text-[10px] text-slate-muted">score</p>
                    </div>
                  </div>
                  {g.expectedCompletion && (
                    <p className="text-[11px] text-slate-muted mt-2">
                      Due {formatDay(g.expectedCompletion)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Active Group Inspector */}
        {groups.length > 0 && (
          <section className="space-y-3 bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">Deep-Dive Group Inspector</p>
                <h2 className="text-base font-semibold text-slate-ink">Inspecting Team: {selectedGroup?.name || "Select Group"}</h2>
                <p className="text-xs text-slate-muted">Project: {selectedGroup?.project || "—"}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className={classNames(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      selectedGroupId === g.id
                        ? "bg-brand text-white border-brand shadow-sm"
                        : "border-slate-line bg-cloud/50 text-slate-ink hover:border-brand"
                    )}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Project Summary card */}
            <div className="mt-4 pt-4 border-t border-slate-line">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                  <Sparkles className="w-4 h-4" /> AI Project Synthesis
                </span>
                {aiSummary?.dataSufficiency === "INSUFFICIENT_DATA" && (
                  <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                    Insufficient Activity
                  </span>
                )}
              </div>
              {aiSummaryLoading ? (
                <div className="h-16 bg-cloud/60 rounded-xl animate-pulse" />
              ) : aiSummaryError ? (
                <p className="text-xs text-coral">Failed to load AI summary for this group.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-ink leading-relaxed">
                    {aiSummary?.summary || "No AI summary available yet."}
                  </p>
                  {aiSummary?.recommendations?.length > 0 && (
                    <div className="bg-brand-soft/40 border border-brand/20 rounded-lg p-3">
                      <p className="text-xs font-semibold text-brand mb-1">AI Recommendation:</p>
                      <p className="text-xs text-slate-ink">{aiSummary.recommendations[0]}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-muted flex-wrap">
                    <span>Tasks: {aiSummary?.metrics?.totalTasks ?? 0}</span>
                    <span>Completed: {aiSummary?.metrics?.completedTasks ?? 0}</span>
                    <span>Overdue: {aiSummary?.metrics?.overdueTasks ?? 0}</span>
                    <span>Risk Level: <strong className="text-slate-ink">{aiSummary?.metrics?.riskLevel || "—"}</strong></span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* AI Team Risk — Step 15 */}
        <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
          <div className="mb-3">
            <SectionHeading icon={AlertTriangle} title={`AI Team Risk — ${selectedGroup?.name || "Team"}`} />
          </div>
          {teamRiskLoading ? (
            <div className="h-[120px] rounded-xl2 border border-slate-line bg-cloud/60 animate-pulse" />
          ) : teamRiskError ? (
            <ErrorState message="Couldn't load the AI team risk assessment." onRetry={loadTeamRisk} />
          ) : !teamRisk || !groups.length ? (
            <EmptyState
              icon={ShieldCheck}
              title="No risk data yet"
              subtitle="Create a group and assign tasks to start tracking team risk."
            />
          ) : teamRisk.riskLevel === "INSUFFICIENT_DATA" ? (
            <EmptyState
              icon={Info}
              title="Not enough activity yet"
              subtitle={teamRisk.reasons?.[0] || "Assign tasks to start tracking risk for this group."}
            />
          ) : (
            (() => {
              const LEVEL_STYLES = {
                LOW: { text: "text-mint", bg: "bg-mint-soft", label: "LOW RISK" },
                MODERATE: { text: "text-amber", bg: "bg-amber-soft", label: "MODERATE RISK" },
                HIGH: { text: "text-coral", bg: "bg-coral-soft", label: "HIGH RISK" },
                CRITICAL: { text: "text-coral", bg: "bg-coral-soft", label: "CRITICAL RISK" },
              };
              const style = LEVEL_STYLES[teamRisk.riskLevel] || LEVEL_STYLES.LOW;
              const trendLabel =
                teamRisk.riskTrend === "WORSENING"
                  ? "↑ Worsening"
                  : teamRisk.riskTrend === "IMPROVING"
                  ? "↓ Improving"
                  : teamRisk.riskTrend === "STABLE"
                  ? "→ Stable"
                  : "Insufficient trend data";
              return (
                <div className="grid md:grid-cols-[auto,1fr] gap-5">
                  <div className={classNames("rounded-xl2 p-4 flex flex-col items-center justify-center min-w-[140px]", style.bg)}>
                    <p className={classNames("font-display text-3xl font-bold", style.text)}>
                      {teamRisk.riskScore}
                      <span className="text-base font-medium text-slate-muted">/100</span>
                    </p>
                    <p className={classNames("text-xs font-semibold mt-1", style.text)}>{style.label}</p>
                    <p className="text-[11px] text-slate-muted mt-1">{trendLabel}</p>
                  </div>
                  <div className="space-y-3">
                    {teamRisk.reasons?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-muted mb-1.5">Why this team is at risk</p>
                        <ul className="space-y-1">
                          {teamRisk.reasons.slice(0, 3).map((r, i) => (
                            <li key={i} className="text-sm text-slate-ink flex gap-1.5">
                              <span className="text-coral">•</span> {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-muted">
                      <span>{teamRisk.warnings?.length ?? 0} active warning(s)</span>
                      {teamRisk.affectedStudents?.length > 0 && (
                        <span>{teamRisk.affectedStudents.length} student(s) need attention</span>
                      )}
                    </div>
                    {teamRisk.recommendations?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-muted mb-1">Recommended</p>
                        <p className="text-sm text-slate-ink">{teamRisk.recommendations[0]}</p>
                      </div>
                    )}
                    <button
                      onClick={() => navigate(ROUTES.GUIDE_TEAM_ANALYTICS || "/guide/analytics")}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-deep transition-colors"
                    >
                      View full analytics <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </section>

        {/* Project signals — Steps 19-22, grouped as compact summary cards instead of
            four full-width stacked sections. Each card's own onViewDetails toggle is
            unchanged; the detail panel below simply spans the full grid width. */}
        <section className="space-y-3">
          <SectionHeading title="Project signals" subtitle="AI forecast, health, execution and performance at a glance" />
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <AIProjectForecastCard
                forecast={forecast}
                loading={forecastLoading}
                error={forecastError}
                onViewDetails={() => setForecastDetailsOpen((v) => !v)}
              />
            </div>
            <div>
              <ProjectHealthCommandCenter
                health={projectHealth}
                loading={projectHealthLoading}
                error={projectHealthError}
                onViewDetails={() => setProjectHealthDetailsOpen((v) => !v)}
              />
            </div>
            <div>
              <ProjectExecutionCopilot
                copilot={executionCopilot}
                loading={executionCopilotLoading}
                error={executionCopilotError}
                onViewDetails={() => setExecutionCopilotDetailsOpen((v) => !v)}
              />
            </div>
            <div>
              <TeamPerformanceInsights
                performance={teamPerformance}
                loading={teamPerformanceLoading}
                error={teamPerformanceError}
                onViewDetails={() => setTeamPerformanceDetailsOpen((v) => !v)}
              />
            </div>
          </div>

          {forecastDetailsOpen && (
            <ProjectForecastPanel
              forecast={forecast}
              recommendations={forecast?.recommendations || []}
              loading={forecastLoading}
              error={forecastError}
            />
          )}
          {projectHealthDetailsOpen && (
            <ProjectHealthDetailPanel health={projectHealth} loading={projectHealthLoading} error={projectHealthError} />
          )}
          {executionCopilotDetailsOpen && (
            <ExecutionCopilotPanel copilot={executionCopilot} loading={executionCopilotLoading} error={executionCopilotError} />
          )}
          {teamPerformanceDetailsOpen && (
            <TeamPerformancePanel performance={teamPerformance} loading={teamPerformanceLoading} error={teamPerformanceError} />
          )}
        </section>

        {/* AI project tools — Steps 23-29, grouped under one labeled section as a
            compact 2-column grid of toggle cards instead of seven stacked full-width
            sections. Each card still owns its own open/close state and only fetches
            data once opened, exactly as before — only the layout changed. An open
            card spans the full row so its panel has room. */}
        <section className="space-y-3">
          <SectionHeading title="AI project tools" subtitle="Open any tool to run it against this group's real data" />
          <div className="grid lg:grid-cols-2 gap-4">
            <div className={sprintPlannerOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setSprintPlannerOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <CalendarRange className="w-4 h-4 text-brand" /> AI Sprint Planner
                  </p>
                  <span className="text-xs font-semibold text-brand">{sprintPlannerOpen ? "Hide" : "Open"}</span>
                </button>
                {!sprintPlannerOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    Plan a realistic sprint from your team's existing tasks, dependencies, workload and risk — preview before anything changes.
                  </p>
                )}
                {sprintPlannerOpen && selectedGroupId && (
                  <div className="mt-4">
                    <SprintPlannerPanel groupId={selectedGroupId} />
                  </div>
                )}
              </div>
            </div>

            <div className={meetingIntelligenceOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setMeetingIntelligenceOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <Brain className="w-4 h-4 text-brand" /> AI Meeting Intelligence
                  </p>
                  <span className="text-xs font-semibold text-brand">{meetingIntelligenceOpen ? "Hide" : "Open"}</span>
                </button>
                {!meetingIntelligenceOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    Turn meeting discussions into structured project actions — summary, decisions, action items,
                    blockers and more, straight from group meeting data. Nothing is changed automatically.
                  </p>
                )}
                {meetingIntelligenceOpen && selectedGroupId && (
                  <div className="mt-4">
                    <MeetingIntelligencePanel
                      groupId={selectedGroupId}
                      onViewConflicts={() => {
                        setConflictPanelOpen(true);
                        document.getElementById("conflict-resolution-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div id="conflict-resolution-section" className={conflictPanelOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setConflictPanelOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <ShieldAlert className="w-4 h-4 text-brand" /> AI Conflict Resolution
                  </p>
                  <span className="text-xs font-semibold text-brand">{conflictPanelOpen ? "Hide" : "Open"}</span>
                </button>
                {!conflictPanelOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    AI-assisted detection of ownership disputes, conflicting instructions, unresolved blockers and
                    more from your group chat — review and resolve, nothing is changed automatically.
                  </p>
                )}
                {conflictPanelOpen && selectedGroupId && (
                  <div className="mt-4">
                    <ConflictResolutionPanel groupId={selectedGroupId} />
                  </div>
                )}
              </div>
            </div>

            <div className={projectKnowledgeOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setProjectKnowledgeOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <BookMarked className="w-4 h-4 text-brand" /> AI Project Knowledge
                  </p>
                  <span className="text-xs font-semibold text-brand">{projectKnowledgeOpen ? "Hide" : "Open"}</span>
                </button>
                {!projectKnowledgeOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    Search decisions, requirements, and important project context. Extraction from group chat is
                    user-triggered and every candidate stays under review until a guide or team leader confirms it.
                  </p>
                )}
                {projectKnowledgeOpen && selectedGroupId && (
                  <div className="mt-4">
                    <ProjectKnowledgePanel groupId={selectedGroupId} isGuideOrLeader />
                  </div>
                )}
              </div>
            </div>

            <div className={projectMemoryAssistantOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setProjectMemoryAssistantOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <MessageCircleQuestion className="w-4 h-4 text-brand" /> AI Project Memory Assistant
                  </p>
                  <span className="text-xs font-semibold text-brand">{projectMemoryAssistantOpen ? "Hide" : "Open"}</span>
                </button>
                {!projectMemoryAssistantOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    Ask grounded questions about project decisions, tasks, meetings, risks and current project
                    status — answers only ever come from this group's own stored project information.
                  </p>
                )}
                {projectMemoryAssistantOpen && selectedGroupId && (
                  <div className="mt-4">
                    <ProjectMemoryAssistant groupId={selectedGroupId} />
                  </div>
                )}
              </div>
            </div>

            <div className={actionableInsightsOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setActionableInsightsOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <ListChecks className="w-4 h-4 text-brand" /> AI Actionable Insights
                  </p>
                  <span className="text-xs font-semibold text-brand">{actionableInsightsOpen ? "Hide" : "Open"}</span>
                </button>
                {!actionableInsightsOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    Prioritized recommendations based on current project evidence — overdue/blocked tasks, risk,
                    forecast, health, conflicts, meeting follow-ups and more, deduplicated into one ranked list.
                    Review-only, nothing is changed automatically.
                  </p>
                )}
                {actionableInsightsOpen && selectedGroupId && (
                  <div className="mt-4">
                    <ActionableInsightsPanel groupId={selectedGroupId} />
                  </div>
                )}
              </div>
            </div>

            <div className={whatIfPanelOpen ? "lg:col-span-2" : ""}>
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel h-full">
                <button onClick={() => setWhatIfPanelOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
                    <FlaskConical className="w-4 h-4 text-brand" /> AI What-If Simulator
                  </p>
                  <span className="text-xs font-semibold text-brand">{whatIfPanelOpen ? "Hide" : "Open"}</span>
                </button>
                {!whatIfPanelOpen && (
                  <p className="text-sm text-slate-muted mt-2">
                    Ask "what would happen if…" — simulate a deadline change, reassignment, or status update against
                    your team's real Risk/Forecast/Health scores. Simulation only — nothing is ever changed.
                  </p>
                )}
                {whatIfPanelOpen && selectedGroupId && (
                  <div className="mt-4">
                    <ProjectWhatIfPanel groupId={selectedGroupId} members={selectedGroup?.members || []} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Performance / analytics preview */}
        <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
          <div className="mb-3">
            <SectionHeading icon={BarChart3} title="AI report summary" />
          </div>
          {reportsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[52px] rounded-xl border border-slate-line bg-cloud/60 animate-pulse" />
              ))}
            </div>
          ) : reportsError ? (
            <ErrorState message="Couldn't load AI reports for this group." onRetry={loadReports} />
          ) : !latestReport && !dailyReport && !weeklyReport && !monthlyReport ? (
            <EmptyState
              icon={BarChart3}
              title="No AI reports available yet"
              subtitle="Reports appear here once enough group activity has been analyzed."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-sm">
              <div>
                <p className="text-slate-muted">Daily completion</p>
                <p className="font-semibold text-slate-ink">{dailyReport?.prediction?.completion ?? "—"}%</p>
              </div>
              <div>
                <p className="text-slate-muted">Weekly completion</p>
                <p className="font-semibold text-slate-ink">{weeklyReport?.prediction?.completion ?? "—"}%</p>
              </div>
              <div>
                <p className="text-slate-muted">Monthly completion</p>
                <p className="font-semibold text-slate-ink">{monthlyReport?.prediction?.completion ?? "—"}%</p>
              </div>
              <div>
                <p className="text-slate-muted">Latest collaboration</p>
                <p className="font-semibold text-slate-ink">{latestReport?.collaborationScore ?? "—"}%</p>
              </div>
              <div>
                <p className="text-slate-muted">Weekly generated</p>
                <p className="font-semibold text-slate-ink">
                  {weeklyReport?.generatedAt ? formatDay(weeklyReport.generatedAt) : "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-muted">Monthly generated</p>
                <p className="font-semibold text-slate-ink">
                  {monthlyReport?.generatedAt ? formatDay(monthlyReport.generatedAt) : "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-muted">Daily generated</p>
                <p className="font-semibold text-slate-ink">
                  {dailyReport?.generatedAt ? formatDay(dailyReport.generatedAt) : "—"}
                </p>
              </div>
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Alerts / attention required */}
          <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-4">
              <AlertTriangle className="w-4 h-4 text-coral" /> Attention required
            </p>
            {alertsLoading ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[52px] rounded-lg bg-cloud/60 animate-pulse" />
                ))}
              </div>
            ) : alertsError ? (
              <ErrorState message="Couldn't load alerts." onRetry={loadAlerts} />
            ) : alerts.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="Everything looks on track" subtitle="No active alerts right now." />
            ) : (
              <div className="space-y-2.5">
                {alerts.slice(0, 4).map((a) => (
                  <AlertCard
                    key={a.id}
                    severity={a.severity}
                    message={a.message}
                    time={a.time}
                    groupName={a.groupName}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-4">
              <Bell className="w-4 h-4 text-brand" /> Recent activity
            </p>
            {recentActivity.length === 0 ? (
              <EmptyState icon={Bell} title="No recent activity" subtitle="New activity will show up here." />
            ) : (
              <div className="space-y-2.5">
                {recentActivity.map((item) => {
                  const { icon: Icon, tone } = notifConfigFor(item.type);
                  return (
                    <div key={item.id} className="flex items-start gap-3">
                      <span
                        className={classNames(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                          NOTIF_TONE_STYLES[tone]
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-slate-ink truncate">{item.title}</p>
                        <p className="text-xs text-slate-muted">{formatRelativeTime(item.time)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent report history */}
          <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-4">
              <ClipboardList className="w-4 h-4 text-brand" /> Recent report history
            </p>
            {reportsLoading ? (
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <div key={i} className="h-[86px] rounded-2xl bg-cloud/60 animate-pulse" />
                ))}
              </div>
            ) : reportHistory.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No report history yet"
                subtitle="Persisted reports will appear here over time."
              />
            ) : (
              <div className="space-y-3">
                {reportHistory.slice(0, 6).map((report) => (
                  <div key={`${report.period}-${report.periodStart}`} className="rounded-2xl bg-cloud p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-muted">{report.period}</p>
                    <p className="text-sm font-semibold text-slate-ink">{report.payload.group.name}</p>
                    <p className="text-xs text-slate-muted">
                      {formatDay(report.periodStart)} – {formatDay(report.periodEnd)}
                    </p>
                    <p className="text-sm text-slate-ink mt-2">Completion {report.payload.prediction?.completion ?? "—"}%</p>
                    <p className="text-sm text-slate-muted">Collab {report.payload.collaborationScore ?? "—"}%</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <section className="space-y-3">
          <SectionHeading title="Quick actions" />
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "View Team Analytics", icon: BarChart3, route: ROUTES.GUIDE_TEAM_ANALYTICS },
              { label: "Manage Groups", icon: Users, route: ROUTES.GUIDE_GROUP_MANAGEMENT },
              { label: "View Alerts", icon: AlertTriangle, route: ROUTES.GUIDE_ALERTS },
              { label: "View Reports", icon: ClipboardList, route: ROUTES.GUIDE_REPORTS },
            ].map(({ label, icon: Icon, route }) => (
              <button
                key={route}
                onClick={() => navigate(route)}
                className="flex items-center justify-between gap-2 bg-paper border border-slate-line hover:border-brand rounded-xl2 px-4 py-3.5 text-left transition-colors"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-medium text-slate-ink truncate">{label}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-muted shrink-0" />
              </button>
            ))}
          </div>
        </section>
      </main>

      <CreateGroupModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </>
  );
};

export default GuideDashboard;
