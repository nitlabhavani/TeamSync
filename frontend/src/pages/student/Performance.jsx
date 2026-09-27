import { useEffect, useMemo, useState, useCallback } from "react";
import {
  MessagesSquare,
  FolderOpen,
  CheckCircle2,
  Sparkles,
  Award,
  ListTodo,
  Clock,
  AlertTriangle,
  RefreshCw,
  Users,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import SectionHeading from "../../components/dashboard/SectionHeading";
import ActivityChart from "../../components/analytics/ActivityChart";
import WeeklyPerformanceChart from "../../components/analytics/WeeklyPerformanceChart";
import MonthlyPerformanceChart from "../../components/analytics/MonthlyPerformanceChart";
import ContributionChart from "../../components/analytics/ContributionChart";
import PerformancePrediction from "../../components/ai/PerformancePrediction";
import ProjectCompletion from "../../components/ai/ProjectCompletion";
import StudentAIPerformance from "../../components/ai/StudentAIPerformance";
import ProjectCompletionPrediction from "../../components/ai/ProjectCompletionPrediction";
import FileEvidenceList from "../../components/ai/FileEvidenceList";
import { useGroups } from "../../hooks/useGroups";
import { useAuth } from "../../hooks/useAuth";
import { useNavigate } from "@/lib/router-compat";
import * as analyticsService from "../../services/analyticsService";
import * as aiService from "../../services/aiService";
import { formatFileSize } from "../../utils/helperFunctions";
import { ROUTES } from "../../utils/constants";

const MetricCard = ({ icon: Icon, label, value, hint, tone }) => (
  <div className="group relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-xl">
    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand via-purple-500 to-mint opacity-70 group-hover:opacity-100 transition-opacity" />
    <div className="flex items-start justify-between mb-3">
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-xs transition-transform duration-300 group-hover:scale-110 ${tone}`}>
        <Icon className="w-5 h-5" />
      </span>
      {hint && <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-muted bg-cloud px-2 py-0.5 rounded-full">{hint}</span>}
    </div>
    <p className="text-2xl sm:text-3xl font-display font-bold text-slate-ink leading-tight">{value}</p>
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-muted mt-1">{label}</p>
  </div>
);

const MetricCardSkeleton = () => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-4 animate-pulse">
    <span className="w-9 h-9 rounded-lg bg-cloud mb-3 block" />
    <div className="h-6 w-14 rounded bg-cloud" />
    <div className="h-3 w-20 rounded bg-cloud mt-2" />
  </div>
);

const ChartSkeleton = ({ label }) => (
  <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    {label && <p className="text-sm font-medium text-slate-ink mb-4">{label}</p>}
    <div className="h-[220px] rounded-lg bg-cloud animate-pulse" />
  </div>
);

const Performance = () => {
  const { groups } = useGroups();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState(null);
  const [activity, setActivity] = useState([]);
  const [contribution, setContribution] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);
  const [meError, setMeError] = useState("");
  const [range, setRange] = useState("weekly");
  const [trend, setTrend] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);

  // STEP 4A/4B/4C — real Step 3 AI analysis for the signed-in student.
  // The backend ignores/overrides any client-supplied studentId for
  // non-guide callers, so this always resolves to "my own" analysis.
  const [aiPerf, setAiPerf] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState(null);

  const [groupDataLoading, setGroupDataLoading] = useState(false);
  const [groupDataError, setGroupDataError] = useState("");

  useEffect(() => {
    if (!groupId && groups[0]) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const loadMe = useCallback(() => {
    setMeLoading(true);
    setMeError("");
    analyticsService
      .getMyPerformance()
      .then(setMe)
      .catch((err) => {
        setMe(null);
        setMeError(err.message || "Performance summary could not be loaded.");
      })
      .finally(() => setMeLoading(false));
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Weekly / monthly performance graphs come from the backend trend endpoint.
  useEffect(() => {
    let alive = true;
    setTrendLoading(true);
    analyticsService
      .getPerformanceTrend(range)
      .then((t) => alive && setTrend(t.points))
      .catch(() => alive && setTrend([]))
      .finally(() => alive && setTrendLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  const loadGroupData = useCallback(() => {
    if (!groupId) return;
    let alive = true;
    setGroupDataLoading(true);
    setGroupDataError("");
    Promise.all([
      analyticsService.getActivityData(groupId),
      analyticsService.getContributionData(groupId),
      aiService.getPerformancePrediction(groupId),
    ])
      .then(([a, c, p]) => {
        if (!alive) return;
        setActivity(a);
        setContribution(c);
        setPrediction(p);
      })
      .catch((err) => {
        if (!alive) return;
        setGroupDataError(err.message || "Group performance data could not be loaded.");
      })
      .finally(() => alive && setGroupDataLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId]);

  useEffect(() => {
    loadGroupData();
  }, [loadGroupData]);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setAiLoading(true);
    setAiError(null);
    aiService
      .getProjectPerformance(groupId, user?.id)
      .then((data) => alive && setAiPerf(data))
      .catch((err) => alive && setAiError(err.message))
      .finally(() => alive && setAiLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId, user?.id]);

  const activeGroup = groups.find((g) => g.id === groupId);
  const myWork = aiPerf?.studentAnalysis?.find((w) => w.studentId === user?.id) || aiPerf?.studentAnalysis?.[0];
  const myPrediction =
    aiPerf?.performancePrediction?.find((p) => p.studentId === user?.id) || aiPerf?.performancePrediction?.[0];
  const myFiles = aiPerf?.fileAnalysis || [];

  // The group-risk prediction card (PerformancePrediction) expects
  // predictedCompletion/confidence/weeksRemaining, but the endpoint behind
  // aiService.getPerformancePrediction() only ever returns
  // { score, level, drivers, stats, onTrack }. Rather than render the card
  // with "undefined" in place of missing fields, only show it once the
  // fields it actually needs are present — an honest "unavailable" state
  // otherwise, per the no-misleading-values rule. (getPerformancePrediction
  // itself is untouched — this is a presentation-only guard.)
  const predictionDisplayReady =
    prediction && prediction.predictedCompletion != null && prediction.confidence != null;

  const badges = me?.badges || [];
  const totals = me?.totals;
  const hasTaskTotals = totals && totals.tasks != null;
  const pendingTasks = hasTaskTotals ? Math.max(totals.tasks - totals.completed - (totals.overdue || 0), 0) : null;

  const activeWarnings = useMemo(
    () => (aiPerf?.warnings || []).filter((w) => w.status === "active"),
    [aiPerf]
  );
  const recommendations = aiPerf?.recommendations || [];

  return (
    <>
      <Navbar title="Performance" subtitle="AI-analyzed collaboration insight across your groups." />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6">
        {/* Overview KPIs */}
        <SectionHeading title="Overview" />
        {meError ? (
          <div className="flex items-center justify-between gap-3 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
              <p className="text-sm text-coral truncate">Performance summary could not be loaded — {meError}</p>
            </div>
            <button
              onClick={loadMe}
              className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-paper border border-coral/30 px-3 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {meLoading ? (
              <>
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
                <MetricCardSkeleton />
              </>
            ) : (
              <>
                <MetricCard
                  icon={MessagesSquare}
                  label="Messages sent"
                  value={me?.activity?.messages ?? 0}
                  hint="Across every group and DM"
                  tone="bg-brand-soft text-brand"
                />
                <MetricCard
                  icon={FolderOpen}
                  label="Files shared"
                  value={me?.activity?.filesShared ?? 0}
                  hint={formatFileSize(me?.activity?.bytesShared || 0)}
                  tone="bg-amber-soft text-amber"
                />
                <MetricCard
                  icon={CheckCircle2}
                  label="Tasks completed"
                  value={me?.totals?.completed ?? 0}
                  hint={`${me?.totals?.onTimeRate ?? 0}% on time`}
                  tone="bg-mint-soft text-mint"
                />
                <MetricCard
                  icon={Sparkles}
                  label="Collaboration score"
                  value={me?.collaborationScore ?? 0}
                  hint={`Peer rating ${me?.peerScore ?? 0}/5`}
                  tone="bg-coral-soft text-coral"
                />
              </>
            )}
          </div>
        )}

        {/* Task breakdown + badges — real fields already returned by getMyPerformance() */}
        {!meLoading && !meError && (hasTaskTotals || badges.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {hasTaskTotals && (
              <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                <div className="mb-3.5">
                  <SectionHeading icon={ListTodo} title="Task performance" />
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xl font-semibold text-slate-ink">{totals.completed}</p>
                    <p className="text-xs text-slate-muted mt-0.5">Completed</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-slate-ink">{pendingTasks}</p>
                    <p className="text-xs text-slate-muted mt-0.5">Pending</p>
                  </div>
                  <div>
                    <p className={`text-xl font-semibold ${totals.overdue > 0 ? "text-coral" : "text-slate-ink"}`}>
                      {totals.overdue ?? 0}
                    </p>
                    <p className="text-xs text-slate-muted mt-0.5">Overdue</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-muted mb-1.5">
                  <span>On-time rate</span>
                  <span className="font-mono font-semibold text-slate-ink">{totals.onTimeRate ?? 0}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-cloud overflow-hidden">
                  <div className="h-full bg-mint" style={{ width: `${totals.onTimeRate ?? 0}%` }} />
                </div>
              </div>
            )}

            {badges.length > 0 && (
              <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                <div className="mb-3.5">
                  <SectionHeading icon={Award} title="Badges earned" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <span
                      key={b.id || b._id || i}
                      className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1.5 text-xs font-medium text-mint"
                    >
                      {b.emoji && <span>{b.emoji}</span>} {b.label || b.name || "Badge"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Trends */}
        <div className="flex items-center justify-between">
          <SectionHeading title="Performance graphs" />
          <div className="flex gap-1 bg-cloud rounded-full p-1">
            {["weekly", "monthly"].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full capitalize transition-colors ${
                  range === r ? "bg-paper text-brand shadow-sm" : "text-slate-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {range === "weekly" ? (
          <WeeklyPerformanceChart data={trend} loading={trendLoading} />
        ) : (
          <MonthlyPerformanceChart data={trend} loading={trendLoading} />
        )}

        {/* Group-scoped performance */}
        {groups.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
            <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
              <Users className="w-5 h-5 text-slate-muted" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-ink">No project groups yet</p>
              <p className="text-xs text-slate-muted mt-1 max-w-sm">
                Project-level performance and AI analysis appear here once you're part of a group.
              </p>
            </div>
            <button
              onClick={() => navigate(ROUTES.STUDENT_GROUPS)}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep transition-colors"
            >
              Go to groups
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGroupId(g.id)}
                  className={`text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${
                    groupId === g.id ? "bg-brand text-white border-brand" : "border-slate-line text-slate-muted"
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>

            {groupDataError && (
              <div className="flex items-center justify-between gap-3 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
                  <p className="text-sm text-coral truncate">Group performance data could not be loaded — {groupDataError}</p>
                </div>
                <button
                  onClick={loadGroupData}
                  className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-paper border border-coral/30 px-3 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            )}

            {!groupDataError && (
              <div className="grid lg:grid-cols-2 gap-5">
                {groupDataLoading ? (
                  <>
                    <ChartSkeleton label="Weekly message activity" />
                    <ChartSkeleton label="Contribution by member" />
                  </>
                ) : (
                  <>
                    <ActivityChart data={activity} />
                    <ContributionChart data={contribution} />
                  </>
                )}
              </div>
            )}

            {!groupDataError && (predictionDisplayReady || activeGroup) && (
              <div className="grid lg:grid-cols-2 gap-5">
                {predictionDisplayReady && <PerformancePrediction data={prediction} />}
                {activeGroup && <ProjectCompletion progress={activeGroup.progress} />}
              </div>
            )}

            {groupId && (
              <>
                <div className="pt-2">
                  <SectionHeading icon={Sparkles} title="AI project performance" />
                </div>
                <div className="grid lg:grid-cols-2 gap-5">
                  <StudentAIPerformance work={myWork} prediction={myPrediction} loading={aiLoading} error={aiError} />
                  <div className="space-y-5">
                    <ProjectCompletionPrediction
                      data={aiPerf?.projectCompletionPrediction}
                      loading={aiLoading}
                      error={aiError}
                    />
                    {!aiLoading && !aiError && <FileEvidenceList files={myFiles} />}
                  </div>
                </div>

                {/* AI recommendations & warnings — real values from
                    aiPerf.recommendations / aiPerf.warnings, previously
                    fetched but never displayed anywhere on this page. */}
                {!aiLoading && !aiError && (recommendations.length > 0 || activeWarnings.length > 0) && (
                  <div className="grid lg:grid-cols-2 gap-5">
                    {recommendations.length > 0 && (
                      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
                        <div className="flex items-center gap-2 mb-3">
                          <Lightbulb className="w-4 h-4 text-brand" />
                          <p className="text-sm font-medium text-slate-ink">AI recommendations</p>
                        </div>
                        <ul className="space-y-1.5">
                          {recommendations.map((r, i) => (
                            <li key={i} className="text-sm text-slate-ink flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {activeWarnings.length > 0 && (
                      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
                        <div className="flex items-center gap-2 mb-3">
                          <ShieldAlert className="w-4 h-4 text-coral" />
                          <p className="text-sm font-medium text-slate-ink">AI warnings</p>
                        </div>
                        <ul className="space-y-2">
                          {activeWarnings.map((w, i) => (
                            <li
                              key={i}
                              className={`rounded-lg px-3 py-2 text-sm flex items-start gap-2 ${
                                w.severity === "high" ? "bg-coral-soft text-coral" : "bg-amber-soft text-amber"
                              }`}
                            >
                              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              {w.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
};

export default Performance;
