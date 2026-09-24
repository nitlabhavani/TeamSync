import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "@/lib/router-compat";
import {
  ArrowLeft,
  Mail,
  MessagesSquare,
  FolderOpen,
  CheckCircle2,
  ListTodo,
  AlertTriangle,
  Sparkles,
  Award,
  Users,
  RefreshCw,
  Briefcase,
  Lightbulb,
  ShieldAlert,
  Clock,
  UserX,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import WeeklyPerformanceChart from "../../components/analytics/WeeklyPerformanceChart";
import MonthlyPerformanceChart from "../../components/analytics/MonthlyPerformanceChart";
import StudentAIPerformance from "../../components/ai/StudentAIPerformance";
import ProjectCompletionPrediction from "../../components/ai/ProjectCompletionPrediction";
import FileEvidenceList from "../../components/ai/FileEvidenceList";
import * as groupService from "../../services/groupService";
import * as analyticsService from "../../services/analyticsService";
import * as aiService from "../../services/aiService";
import { getInitials, formatFileSize } from "../../utils/helperFunctions";
import { statusStyle, statusLabel } from "../../utils/aiStatus";
import { ROUTES } from "../../utils/constants";

const HeaderSkeleton = () => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-6 shadow-panel">
    <div className="flex items-center gap-4">
      <div className="w-16 h-16 rounded-full bg-cloud animate-pulse shrink-0" />
      <div className="space-y-2">
        <div className="h-5 w-40 bg-cloud rounded animate-pulse" />
        <div className="h-3.5 w-56 bg-cloud/70 rounded animate-pulse" />
      </div>
    </div>
  </div>
);

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const ChartSkeleton = ({ label }) => (
  <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    {label && <p className="text-sm font-medium text-slate-ink mb-4">{label}</p>}
    <div className="h-[220px] rounded-lg bg-cloud animate-pulse" />
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
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 shrink-0 transition-colors"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

const MemberDetails = () => {
  const { memberId } = useParams();

  const [member, setMember] = useState(null);
  const [memberLoading, setMemberLoading] = useState(true);
  const [memberError, setMemberError] = useState("");

  const [group, setGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(true);

  // Real per-member rollup — messages, files, tasks, collaboration score,
  // peer score, badges. Same backend endpoint (/users/:id/performance) and
  // service (analyticsService.getMyPerformance) already used by the
  // student-facing Performance page, just scoped to this memberId instead
  // of "me". The guide-view IDOR guard on the backend (assertCanViewUser)
  // already permits a guide to view any student in one of their groups.
  const [perf, setPerf] = useState(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfError, setPerfError] = useState("");

  const [range, setRange] = useState("weekly");
  const [trend, setTrend] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);

  // STEP 3/4 AI analysis, scoped to this student via the studentId query
  // param (guides may request any student in their group — see
  // reportController.js:projectPerformance). Requires the group to be
  // resolved first.
  const [aiPerf, setAiPerf] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const loadMember = useCallback(() => {
    setMemberLoading(true);
    setMemberError("");
    groupService
      .getUser(memberId)
      .then(setMember)
      .catch((e) => {
        setMember(null);
        setMemberError(e?.message || "Member not found.");
      })
      .finally(() => setMemberLoading(false));
  }, [memberId]);

  const loadGroup = useCallback(() => {
    setGroupLoading(true);
    groupService
      .getGroups()
      .then((gs) => setGroup(gs.find((g) => g.memberIds?.includes(memberId)) || null))
      .catch(() => setGroup(null))
      .finally(() => setGroupLoading(false));
  }, [memberId]);

  const loadPerf = useCallback(() => {
    setPerfLoading(true);
    setPerfError("");
    analyticsService
      .getMyPerformance(memberId)
      .then(setPerf)
      .catch((e) => {
        setPerf(null);
        setPerfError(e?.message || "Performance summary could not be loaded.");
      })
      .finally(() => setPerfLoading(false));
  }, [memberId]);

  useEffect(() => {
    loadMember();
    loadGroup();
    loadPerf();
  }, [loadMember, loadGroup, loadPerf]);

  const loadTrend = useCallback(() => {
    setTrendLoading(true);
    analyticsService
      .getPerformanceTrend(range, memberId)
      .then((t) => setTrend(t.points || []))
      .catch(() => setTrend([]))
      .finally(() => setTrendLoading(false));
  }, [range, memberId]);

  useEffect(() => {
    loadTrend();
  }, [loadTrend]);

  const loadAiPerf = useCallback(() => {
    if (!group?.id) return;
    setAiLoading(true);
    setAiError(null);
    aiService
      .getProjectPerformance(group.id, memberId)
      .then(setAiPerf)
      .catch((e) => setAiError(e?.message || "AI analysis is temporarily unavailable."))
      .finally(() => setAiLoading(false));
  }, [group?.id, memberId]);

  useEffect(() => {
    loadAiPerf();
  }, [loadAiPerf]);

  const myWork = useMemo(
    () => aiPerf?.studentAnalysis?.find((w) => w.studentId === memberId) || aiPerf?.studentAnalysis?.[0] || null,
    [aiPerf, memberId]
  );
  const myPrediction = useMemo(
    () =>
      aiPerf?.performancePrediction?.find((p) => p.studentId === memberId) ||
      aiPerf?.performancePrediction?.[0] ||
      null,
    [aiPerf, memberId]
  );
  const myFiles = aiPerf?.fileAnalysis || [];
  const recommendations = aiPerf?.recommendations || [];
  const activeWarnings = useMemo(() => (aiPerf?.warnings || []).filter((w) => w.status === "active"), [aiPerf]);

  const badges = perf?.badges || [];
  const totals = perf?.totals;
  const hasTaskTotals = totals && totals.tasks != null;
  const pendingTasks = hasTaskTotals ? Math.max(totals.tasks - totals.completed - (totals.overdue || 0), 0) : null;

  if (memberLoading) {
    return (
      <>
        <Navbar title="Member profile" subtitle="Individual contribution and activity" />
        <main className="flex-1 px-5 md:px-8 py-6 space-y-5 max-w-4xl w-full mx-auto">
          <div className="h-4 w-28 bg-cloud rounded animate-pulse" />
          <HeaderSkeleton />
          <KpiSkeleton />
        </main>
      </>
    );
  }

  if (memberError || !member) {
    return (
      <>
        <Navbar title="Member profile" subtitle="Individual contribution and activity" />
        <main className="flex-1 px-5 md:px-8 py-6 max-w-4xl w-full mx-auto">
          <Link
            to={ROUTES.GUIDE_GROUP_MANAGEMENT}
            className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink mb-5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to groups
          </Link>
          <EmptyState
            icon={UserX}
            title="Member not found"
            subtitle={memberError || "This student's profile could not be loaded."}
            action={
              <button
                onClick={loadMember}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-brand-deep"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar title="Member profile" subtitle="Individual contribution and activity" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-5 max-w-4xl w-full mx-auto">
        <Link
          to={ROUTES.GUIDE_GROUP_MANAGEMENT}
          className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to groups
        </Link>

        {/* Member header */}
        <div className="bg-paper border border-slate-line rounded-xl2 p-6 shadow-panel">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <span
                className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-semibold shrink-0"
                style={{ backgroundColor: member.color || "#4347C4" }}
              >
                {getInitials(member.name)}
              </span>
              <div className="min-w-0">
                <p className="font-display text-xl font-semibold text-slate-ink truncate">{member.name}</p>
                <p className="text-sm text-slate-muted truncate">
                  {member.role && <span className="capitalize">{member.role}</span>}
                  {member.dept ? ` · ${member.dept}` : ""}
                  {groupLoading ? "" : group ? ` · ${group.name}` : ""}
                </p>
              </div>
            </div>
            {!aiLoading && myPrediction?.status && (
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusStyle(myPrediction.status)}`}>
                {statusLabel(myPrediction.status)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-5 flex-wrap">
            <a
              href={`mailto:${member.email}`}
              className="flex items-center gap-1.5 text-sm text-slate-ink border border-slate-line px-3.5 py-2 rounded-lg hover:border-brand transition-colors"
            >
              <Mail className="w-4 h-4" /> {member.email}
            </a>
            {group?.project && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-muted bg-cloud px-3 py-2 rounded-lg">
                <Briefcase className="w-3.5 h-3.5" /> {group.project}
              </span>
            )}
          </div>
        </div>

        {/* Performance overview */}
        {perfError ? (
          <ErrorState message={perfError} onRetry={loadPerf} />
        ) : perfLoading ? (
          <KpiSkeleton />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard label="Messages sent" value={perf?.activity?.messages ?? 0} icon={MessagesSquare} tone="brand" />
            <StatsCard
              label="Files shared"
              value={perf?.activity?.filesShared ?? 0}
              icon={FolderOpen}
              tone="amber"
              delta={formatFileSize(perf?.activity?.bytesShared || 0)}
            />
            <StatsCard
              label="Tasks completed"
              value={hasTaskTotals ? totals.completed : "—"}
              icon={CheckCircle2}
              tone="mint"
              delta={hasTaskTotals ? `${totals.onTimeRate ?? 0}% on time` : undefined}
            />
            <StatsCard
              label="Collaboration score"
              value={perf?.collaborationScore ?? 0}
              icon={Sparkles}
              tone="coral"
              delta={perf?.peerScore ? `Peer rating ${perf.peerScore}/5` : undefined}
            />
          </div>
        )}

        {/* Task breakdown + badges */}
        {!perfLoading && !perfError && (hasTaskTotals || badges.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {hasTaskTotals && (
              <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                <div className="flex items-center gap-2 mb-3.5">
                  <ListTodo className="w-4 h-4 text-brand" />
                  <p className="text-sm font-medium text-slate-ink">Task performance</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xl font-semibold text-slate-ink">{totals.completed}</p>
                    <p className="text-[11px] text-slate-muted mt-0.5">Completed</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-slate-ink">{pendingTasks}</p>
                    <p className="text-[11px] text-slate-muted mt-0.5">Pending</p>
                  </div>
                  <div>
                    <p className={`text-xl font-semibold ${totals.overdue > 0 ? "text-coral" : "text-slate-ink"}`}>
                      {totals.overdue ?? 0}
                    </p>
                    <p className="text-[11px] text-slate-muted mt-0.5">Overdue</p>
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
                <div className="flex items-center gap-2 mb-3.5">
                  <Award className="w-4 h-4 text-amber" />
                  <p className="text-sm font-medium text-slate-ink">Badges earned</p>
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

        {/* Performance graphs */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-ink">Performance graphs</p>
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

        {/* AI project performance — only once we know which group (if any) this member belongs to */}
        {!groupLoading && !group && (
          <EmptyState
            icon={Users}
            title="Not part of a group yet"
            subtitle="AI project performance analysis appears here once this student joins a team."
          />
        )}

        {group && (
          <>
            <p className="text-sm font-semibold text-slate-ink pt-2">AI project performance</p>
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
      </main>
    </>
  );
};

export default MemberDetails;
