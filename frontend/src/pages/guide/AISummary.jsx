import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import {
  AlertTriangle,
  CalendarClock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import ChatSummary from "../../components/ai/ChatSummary";
import RecommendationPanel from "../../components/ai/RecommendationPanel";
import AIChatBox from "../../components/ai/AIChatBox";
import AIWarningsList from "../../components/ai/AIWarningsList";
import ProjectCompletionPrediction from "../../components/ai/ProjectCompletionPrediction";
import GroupChatAISummary from "../../components/ai/GroupChatAISummary";
import { useGroups } from "../../hooks/useGroups";
import * as aiService from "../../services/aiService";
import { classNames, getInitials } from "../../utils/helperFunctions";
import { formatRelativeTime } from "../../utils/dateFormatter";
import { ROUTES } from "../../utils/constants";

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

const AISummary = () => {
  const navigate = useNavigate();
  const { groups, loading: groupsLoading } = useGroups();
  const [groupId, setGroupId] = useState(null);

  // Existing, unmodified pair of calls — group-chat text summary
  // (aiService.getChatSummary, GET /groups/:id/messages/summary) and the
  // legacy risk-based recommendation strings (aiService.getRecommendations,
  // derived from GET /groups/:id/risk). Bundled with Promise.all exactly as
  // before; the only change here is that a failure is now surfaced (it
  // previously had no .catch, so a rejected promise left the page stuck on
  // its loading skeleton forever with no way to retry).
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  // STEP 3/4 full project-performance analysis — the same
  // aiService.getProjectPerformance(groupId) already used unmodified by
  // TeamAnalytics/MemberDetails/Alerts. Powers the overview KPIs, warnings,
  // project-completion prediction, group-chat evidence, and the
  // evidence-based recommendations below. Entirely rule-based (weighted
  // scoring + thresholds in ai-engine/analyzers/performanceAnalyzer.py) —
  // the optional Random-Forest hybrid endpoint exists in the AI engine but
  // is never wired into this route, so nothing here is labeled ML/hybrid.
  const [aiPerf, setAiPerf] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState(null);

  useEffect(() => {
    if (!groupId && groups[0]) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const loadSummaryData = useCallback(() => {
    if (!groupId) return;
    setSummaryLoading(true);
    setSummaryError(false);
    Promise.all([aiService.getChatSummary(groupId), aiService.getRecommendations(groupId)])
      .then(([s, r]) => {
        setSummary(s);
        setRecommendations(r);
      })
      .catch(() => setSummaryError(true))
      .finally(() => setSummaryLoading(false));
  }, [groupId]);

  useEffect(loadSummaryData, [loadSummaryData]);

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

  const activeGroup = groups.find((g) => g.id === groupId);

  // Same counts TeamAnalytics already computes from this response — not
  // recalculated with new logic, just read from the real predictions array.
  const atRiskCount = useMemo(() => {
    const predictions = aiPerf?.performancePrediction || [];
    return predictions.filter((p) => p.status === "AT_RISK" || p.status === "BEHIND").length;
  }, [aiPerf]);

  const activeWarnings = useMemo(
    () => (aiPerf?.warnings || []).filter((w) => w.status !== "suppressed_duplicate"),
    [aiPerf]
  );

  return (
    <>
      <Navbar
        title="AI summary"
        subtitle={
          activeGroup
            ? `AI-generated insights, warnings, and recommendations for ${activeGroup.name}`
            : "AI-generated insights, warnings, and recommendations for your groups"
        }
      />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-5xl w-full mx-auto">
        {/* Group selector */}
        {groupsLoading ? (
          <div className="flex gap-2 flex-wrap">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 w-32 rounded-full border border-slate-line bg-paper animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No groups available yet"
            subtitle="Create a group to start generating AI summaries."
            action={
              <button
                onClick={() => navigate(ROUTES.GUIDE_GROUP_MANAGEMENT)}
                className="mt-1 text-xs font-semibold text-brand hover:text-brand-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
                type="button"
                onClick={() => setGroupId(g.id)}
                aria-pressed={groupId === g.id}
                className={classNames(
                  "flex items-center gap-2 text-sm font-medium pl-3 pr-3.5 py-2 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
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
              </button>
            ))}
          </div>
        )}

        {groupId && (
          <>
            {/* Overview — only real, already-returned fields from the project-performance response */}
            {aiLoading ? (
              <KpiSkeleton />
            ) : aiError ? (
              <ErrorState message="Couldn't load this group's AI analysis." onRetry={loadAiPerf} />
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard
                  label="Project completion"
                  value={
                    aiPerf?.projectCompletionPrediction?.completionPercentage != null
                      ? `${aiPerf.projectCompletionPrediction.completionPercentage}%`
                      : "—"
                  }
                  icon={CalendarClock}
                  tone="brand"
                />
                <StatsCard label="At-risk members" value={atRiskCount} icon={ShieldAlert} tone="coral" />
                <StatsCard label="Active warnings" value={activeWarnings.length} icon={AlertTriangle} tone="amber" />
                <StatsCard
                  label="Students analyzed"
                  value={aiPerf?.dataSufficiency?.studentsAnalyzed ?? 0}
                  icon={Users}
                  tone="mint"
                />
              </div>
            )}

            {/* AI chat summary — the actual returned summary text, prominently displayed */}
            <section aria-label="AI chat summary">
              {summaryError ? (
                <ErrorState message="Couldn't load the AI chat summary." onRetry={loadSummaryData} />
              ) : (
                <ChatSummary summary={summary} loading={summaryLoading} />
              )}
            </section>

            <div className="grid lg:grid-cols-2 gap-5 items-start">
              <div className="space-y-5">
                {/* Warnings */}
                <section aria-label="AI warnings">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted mb-2.5">
                    AI warnings
                  </h2>
                  {!aiLoading && !aiError && activeWarnings.length === 0 ? (
                    <EmptyState icon={ShieldCheck} title="Everything looks on track" subtitle="No active AI warnings for this group." />
                  ) : (
                    <AIWarningsList warnings={aiPerf?.warnings || []} loading={aiLoading} error={aiError} />
                  )}
                </section>

                {/* Project completion prediction */}
                <ProjectCompletionPrediction
                  data={aiPerf?.projectCompletionPrediction}
                  loading={aiLoading}
                  error={aiError}
                />

                {/* Evidence-based recommendations from the project-performance engine —
                    distinct from the chat/risk-based recommendations below, so neither
                    list is silently merged or deduplicated against the other. */}
                {!aiLoading && !aiError && (aiPerf?.recommendations || []).length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted mb-2.5">
                      Evidence-based recommendations
                    </h2>
                    <RecommendationPanel recommendations={aiPerf.recommendations} />
                  </div>
                )}
              </div>

              <div className="space-y-5">
                {/* Group chat AI analysis (progress updates, blockers, risk signals) */}
                <GroupChatAISummary data={aiPerf?.chatAnalysis} loading={aiLoading} error={aiError} />

                {/* Existing chat/risk-based recommendations — unchanged data source */}
                <section aria-label="AI recommendations">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-muted mb-2.5">
                    AI recommendations
                  </h2>
                  {summaryLoading ? (
                    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-2.5">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-3.5 bg-cloud rounded animate-pulse w-5/6" />
                      ))}
                    </div>
                  ) : summaryError ? null : recommendations.length === 0 ? (
                    <EmptyState icon={Sparkles} title="No recommendations right now" subtitle="Check back once there's more activity to analyze." />
                  ) : (
                    <RecommendationPanel recommendations={recommendations} />
                  )}
                </section>

                {/* AI chat assistant */}
                <div className="h-[460px]">
                  <AIChatBox
                    groupId={groupId}
                    summary={summary}
                    aiPerf={aiPerf}
                    recommendations={recommendations}
                  />
                </div>
              </div>
            </div>

            {aiPerf?.generatedAt && (
              <p className="text-xs text-slate-muted text-center">
                Project analysis updated {formatRelativeTime(aiPerf.generatedAt)}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
};

export default AISummary;
