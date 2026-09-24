import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "@/lib/router-compat";
import {
  Users,
  Sparkles,
  ListChecks,
  ListTodo,
  MessagesSquare,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  BarChart3,
  Layers,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import SectionHeading from "../../components/dashboard/SectionHeading";
import ActivityChart from "../../components/analytics/ActivityChart";
import ContributionChart from "../../components/analytics/ContributionChart";
import ContributionRanking from "../../components/ai/ContributionRanking";
import ProjectCompletion from "../../components/ai/ProjectCompletion";
import TeamPerformanceTable from "../../components/ai/TeamPerformanceTable";
import ProjectCompletionPrediction from "../../components/ai/ProjectCompletionPrediction";
import GroupChatAISummary from "../../components/ai/GroupChatAISummary";
import RecommendationPanel from "../../components/ai/RecommendationPanel";
import ProactiveAlerts from "../../components/ai/ProactiveAlerts";
import MeetingActionItems from "../../components/ai/MeetingActionItems";
import { useGroups } from "../../hooks/useGroups";
import * as analyticsService from "../../services/analyticsService";
import * as aiService from "../../services/aiService";
import * as teamRiskService from "../../services/teamRiskService";
import { getInitials, classNames } from "../../utils/helperFunctions";
import { statusStyle, statusLabel } from "../../utils/aiStatus";
import { ROUTES } from "../../utils/constants";

const KpiSkeleton = () => (
  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const ChartSkeleton = () => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
    <div className="h-4 w-40 bg-cloud rounded mb-4 animate-pulse" />
    <div className="h-[220px] bg-cloud/60 rounded-xl animate-pulse" />
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

const TeamAnalytics = () => {
  const { groups, loading: groupsLoading } = useGroups();
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState(null);

  // Real /groups/:id/analytics payload: { series: [{date, messages, tasksCompleted}],
  // contribution: [{name, color, tasks, done, messages}], totals: {messages, meetings, tasks, completed} }.
  // Fetched directly here (analyticsService.getGroupAnalytics is the existing, unmodified export) so this
  // page can read the real field names — the getActivityData/getContributionData wrapper helpers look for
  // "activity"/"activitySeries"/"contributions" keys that the API never returns, so they always resolved to
  // an empty array. That pre-existing mismatch is fixed only here, without touching analyticsService.js or
  // any shared chart component, since analyticsService.js and ActivityChart/ContributionChart are also used
  // by the Student Performance page.
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(false);

  // STEP 4D/4E/4F/4G/4J — guide-facing Step 3 project-performance analysis
  // for the whole team (no studentId, so the engine returns every member).
  const [aiPerf, setAiPerf] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState(null);

  // Step 15 — AI Team Risk & Early Warning System.
  const [teamRisk, setTeamRisk] = useState(null);
  const [teamRiskLoading, setTeamRiskLoading] = useState(true);
  const [teamRiskError, setTeamRiskError] = useState(false);

  useEffect(() => {
    if (!groupId && groups[0]) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const loadAnalytics = useCallback(() => {
    if (!groupId) return;
    setAnalyticsLoading(true);
    setAnalyticsError(false);
    analyticsService
      .getGroupAnalytics(groupId)
      .then(setAnalytics)
      .catch(() => setAnalyticsError(true))
      .finally(() => setAnalyticsLoading(false));
  }, [groupId]);

  useEffect(loadAnalytics, [loadAnalytics]);

  const loadAiPerf = useCallback(() => {
    if (!groupId) return undefined;
    let alive = true;
    setAiLoading(true);
    setAiError(null);
    aiService
      .getProjectPerformance(groupId)
      .then((data) => alive && setAiPerf(data))
      .catch((err) => alive && setAiError(err.message))
      .finally(() => alive && setAiLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId]);

  useEffect(loadAiPerf, [loadAiPerf]);

  const loadTeamRisk = useCallback(() => {
    if (!groupId) return;
    setTeamRiskLoading(true);
    setTeamRiskError(false);
    teamRiskService
      .getTeamRisk(groupId)
      .then(setTeamRisk)
      .catch(() => setTeamRiskError(true))
      .finally(() => setTeamRiskLoading(false));
  }, [groupId]);

  useEffect(loadTeamRisk, [loadTeamRisk]);

  const activeGroup = groups.find((g) => g.id === groupId);

  const activitySeries = useMemo(
    () => (analytics?.series || []).map((s) => ({ day: s.date, messages: s.messages })),
    [analytics]
  );

  // Contribution share = this member's share of total tracked activity (assigned tasks + messages)
  // across the group, as a percentage. Built only from real counts already in `analytics.contribution`
  // (name/tasks/done/messages) — the page previously mapped to `member`/`value` fields that don't exist
  // in the API response, so every bar/row silently rendered `undefined`/NaN. This restores real data.
  const contributionRows = useMemo(() => {
    const rows = analytics?.contribution || [];
    const totalActivity = rows.reduce((sum, r) => sum + (r.tasks || 0) + (r.messages || 0), 0);
    return rows.map((r) => ({
      member: r.name || "Unassigned",
      value: totalActivity > 0 ? Math.round(((r.tasks || 0) + (r.messages || 0)) / totalActivity * 100) : 0,
    }));
  }, [analytics]);

  const totals = analytics?.totals || null;
  const tasksPending = totals ? Math.max((totals.tasks || 0) - (totals.completed || 0), 0) : null;

  const teamHealth = useMemo(() => {
    const predictions = aiPerf?.performancePrediction || [];
    if (!predictions.length) return null;
    const counts = { ON_TRACK: 0, AT_RISK: 0, BEHIND: 0, INSUFFICIENT_DATA: 0 };
    predictions.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return counts;
  }, [aiPerf]);

  const overdueCount = useMemo(
    () => (aiPerf?.studentAnalysis || []).reduce((sum, s) => sum + (s.overdueWork || []).length, 0),
    [aiPerf]
  );

  return (
    <>
      <Navbar
        title="Team analytics"
        subtitle="Monitor team performance, collaboration, workload, and project progress."
      />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-6xl w-full mx-auto">
        {/* Group / project selector */}
        {groupsLoading ? (
          <div className="flex gap-2 flex-wrap">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 w-32 rounded-full border border-slate-line bg-paper animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No teams available yet"
            subtitle="Create a group to start tracking its analytics."
            action={
              <button
                onClick={() => navigate(ROUTES.GUIDE_GROUP_MANAGEMENT)}
                className="mt-1 text-xs font-semibold text-brand hover:text-brand-deep"
              >
                Manage groups
              </button>
            }
          />
        ) : (
          <div className="flex gap-2 flex-wrap">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupId(g.id)}
                className={classNames(
                  "flex items-center gap-2 text-sm font-medium pl-3 pr-3.5 py-2 rounded-full border transition-colors",
                  groupId === g.id
                    ? "bg-brand text-white border-brand"
                    : "border-slate-line text-slate-muted hover:text-slate-ink hover:border-brand"
                )}
              >
                <span
                  className={classNames(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0",
                    groupId === g.id ? "bg-white/20 text-white" : "bg-brand-soft text-brand-deep"
                  )}
                >
                  {getInitials(g.name)}
                </span>
                {g.name}
                <span className={groupId === g.id ? "text-white/70" : "text-slate-muted"}>
                  · {g.memberIds?.length || 0}
                </span>
              </button>
            ))}
          </div>
        )}

        {groupId && (
          <>
            {/* KPI overview */}
            <SectionHeading title="Overview" />
            {analyticsLoading ? (
              <KpiSkeleton />
            ) : analyticsError ? (
              <ErrorState message="Couldn't load this team's analytics." onRetry={loadAnalytics} />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard label="Members" value={activeGroup?.memberIds?.length ?? 0} icon={Users} tone="brand" />
                <StatsCard
                  label="Collaboration score"
                  value={activeGroup?.collaborationScore ?? 0}
                  icon={Sparkles}
                  tone="amber"
                />
                <StatsCard label="Tasks completed" value={totals?.completed ?? "—"} icon={ListChecks} tone="mint" />
                <StatsCard label="Tasks pending" value={tasksPending ?? "—"} icon={ListTodo} tone="brand" />
                <StatsCard label="Messages" value={totals?.messages ?? "—"} icon={MessagesSquare} tone="brand" />
                {!aiLoading && !aiError && (
                  <>
                    <StatsCard
                      label="At-risk members"
                      value={(teamHealth?.AT_RISK || 0) + (teamHealth?.BEHIND || 0)}
                      icon={ShieldAlert}
                      tone="coral"
                    />
                    <StatsCard label="Overdue tasks" value={overdueCount} icon={AlertTriangle} tone="coral" />
                  </>
                )}
              </div>
            )}

            {/* Team performance (activity trend + AI member table) */}
            <section className="space-y-4">
              <SectionHeading icon={BarChart3} title="Team performance" />
              {analyticsLoading ? (
                <ChartSkeleton />
              ) : analyticsError ? (
                <ErrorState message="Couldn't load activity data." onRetry={loadAnalytics} />
              ) : activitySeries.every((p) => !p.messages) ? (
                <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
                  <p className="text-sm text-slate-muted">No performance data available yet.</p>
                </div>
              ) : (
                <ActivityChart data={activitySeries} />
              )}

              <TeamPerformanceTable
                studentAnalysis={aiPerf?.studentAnalysis || []}
                performancePrediction={aiPerf?.performancePrediction || []}
                loading={aiLoading}
                error={aiError}
              />
            </section>

            {/* Team health / risk */}
            <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
              <div className="mb-4">
                <SectionHeading icon={ShieldAlert} title="Team health" />
              </div>
              {aiLoading ? (
                <div className="grid sm:grid-cols-3 gap-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[64px] rounded-xl bg-cloud/60 animate-pulse" />
                  ))}
                </div>
              ) : aiError ? (
                <ErrorState message="AI analysis is temporarily unavailable." onRetry={loadAiPerf} />
              ) : !teamHealth || (teamHealth.AT_RISK === 0 && teamHealth.BEHIND === 0 && teamHealth.ON_TRACK === 0) ? (
                <EmptyState icon={ShieldCheck} title="Everything looks on track" subtitle="No risk signals detected yet." />
              ) : teamHealth.AT_RISK === 0 && teamHealth.BEHIND === 0 ? (
                <EmptyState icon={ShieldCheck} title="Everything looks on track" subtitle="No members are currently at risk." />
              ) : (
                <div className="grid sm:grid-cols-4 gap-3">
                  {["ON_TRACK", "AT_RISK", "BEHIND", "INSUFFICIENT_DATA"].map((key) =>
                    teamHealth[key] > 0 ? (
                      <div key={key} className="rounded-xl border border-slate-line p-3.5">
                        <span className={classNames("text-xs font-semibold px-2 py-0.5 rounded-full", statusStyle(key))}>
                          {statusLabel(key)}
                        </span>
                        <p className="text-2xl font-display font-semibold text-slate-ink mt-2">{teamHealth[key]}</p>
                        <p className="text-xs text-slate-muted">member{teamHealth[key] > 1 ? "s" : ""}</p>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </section>

            {/* AI Team Risk — Step 15 */}
            <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
              <div className="mb-4">
                <SectionHeading icon={ShieldAlert} title="AI Team Risk" />
              </div>
              {teamRiskLoading ? (
                <div className="grid sm:grid-cols-3 gap-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[64px] rounded-xl bg-cloud/60 animate-pulse" />
                  ))}
                </div>
              ) : teamRiskError ? (
                <ErrorState message="Couldn't load team risk data." onRetry={loadTeamRisk} />
              ) : !teamRisk || teamRisk.riskLevel === "INSUFFICIENT_DATA" ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="Not enough data yet"
                  subtitle={teamRisk?.reasons?.[0] || "Assign tasks to start tracking risk for this group."}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <p className="font-display text-2xl font-bold text-slate-ink">
                        {teamRisk.riskScore}
                        <span className="text-sm font-medium text-slate-muted">/100</span>
                      </p>
                      <span
                        className={classNames(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          teamRisk.riskLevel === "LOW"
                            ? "bg-mint-soft text-mint"
                            : teamRisk.riskLevel === "MODERATE"
                            ? "bg-amber-soft text-amber"
                            : "bg-coral-soft text-coral"
                        )}
                      >
                        {teamRisk.riskLevel}
                      </span>
                    </div>
                    <div className="text-xs text-slate-muted">
                      {teamRisk.riskTrend === "WORSENING" && <span className="text-coral">↑ Worsening</span>}
                      {teamRisk.riskTrend === "IMPROVING" && <span className="text-mint">↓ Improving</span>}
                      {teamRisk.riskTrend === "STABLE" && <span>→ Stable</span>}
                      {teamRisk.riskTrend === "INSUFFICIENT_DATA" && <span>Insufficient trend data</span>}
                      {teamRisk.trendMessage && <p className="mt-0.5">{teamRisk.trendMessage}</p>}
                    </div>
                  </div>

                  {teamRisk.warnings?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-muted mb-2">Warning breakdown</p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {teamRisk.warnings.map((w, i) => (
                          <div key={i} className="rounded-xl border border-slate-line p-3">
                            <p className="text-xs font-semibold text-slate-ink">{w.title}</p>
                            <p className="text-xs text-slate-muted mt-0.5">{w.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {teamRisk.studentRisks?.some((s) => s.riskLevel !== "ON_TRACK") && (
                    <div>
                      <p className="text-xs font-semibold text-slate-muted mb-2">Student risk overview</p>
                      <div className="space-y-1.5">
                        {teamRisk.studentRisks
                          .filter((s) => s.riskLevel !== "ON_TRACK")
                          .map((s) => (
                            <div
                              key={s.studentId}
                              className="flex items-center justify-between text-sm border border-slate-line rounded-lg px-3 py-2"
                            >
                              <span className="text-slate-ink">{s.reasons?.[0]}</span>
                              <span
                                className={classNames(
                                  "text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2",
                                  s.riskLevel === "CRITICAL"
                                    ? "bg-coral-soft text-coral"
                                    : s.riskLevel === "AT_RISK"
                                    ? "bg-amber-soft text-amber"
                                    : "bg-cloud text-slate-muted"
                                )}
                              >
                                {s.riskLevel.replace("_", " ")}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* STEP 16 — Proactive AI Alerts (deadline nudges + collaboration) */}
            {teamRisk && (
              <ProactiveAlerts
                earlyWarnings={teamRisk.earlyWarnings || []}
                collaborationRisks={teamRisk.collaborationRisks || []}
              />
            )}

            {/* STEP 16 — Meeting Action Items */}
            {groupId && <MeetingActionItems groupId={groupId} />}

            {/* Workload / contribution */}
            <section className="space-y-4">
              <SectionHeading icon={Layers} title="Workload &amp; contribution" />
              {analyticsLoading ? (
                <div className="grid lg:grid-cols-2 gap-5">
                  <ChartSkeleton />
                  <ChartSkeleton />
                </div>
              ) : analyticsError ? (
                <ErrorState message="Couldn't load contribution data." onRetry={loadAnalytics} />
              ) : contributionRows.length === 0 ? (
                <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
                  <p className="text-sm text-slate-muted">No workload data available yet.</p>
                </div>
              ) : (
                <div className="grid lg:grid-cols-2 gap-5">
                  <ContributionChart data={contributionRows} />
                  <ContributionRanking data={contributionRows} />
                </div>
              )}
              {activeGroup && <ProjectCompletion progress={activeGroup.progress ?? 0} />}
            </section>

            {/* AI insights */}
            <section className="space-y-4">
              <SectionHeading title="AI team insights" />
              <div className="grid lg:grid-cols-2 gap-5">
                <ProjectCompletionPrediction
                  data={aiPerf?.projectCompletionPrediction}
                  loading={aiLoading}
                  error={aiError}
                />
                <GroupChatAISummary data={aiPerf?.chatAnalysis} loading={aiLoading} error={aiError} />
              </div>
              {!aiLoading && !aiError && (aiPerf?.recommendations || []).length > 0 && (
                <RecommendationPanel recommendations={aiPerf.recommendations} />
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
};

export default TeamAnalytics;
