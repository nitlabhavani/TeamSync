import { useEffect, useMemo, useState } from "react";
import {
  MessagesSquare,
  FolderOpen,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  ListTodo,
  CalendarClock,
  Clock,
  Calendar,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import SectionHeading from "../../components/dashboard/SectionHeading";
import RecentActivity from "../../components/dashboard/RecentActivity";
import ProjectProgress from "../../components/dashboard/ProjectProgress";
import AttentionNeeded from "../../components/ai/AttentionNeeded";
import { useNavigate } from "@/lib/router-compat";
import { ROUTES } from "../../utils/constants";
import { useAuth } from "../../hooks/useAuth";
import { useGroups } from "../../hooks/useGroups";
import { useNotifications } from "../../hooks/useNotifications";
import * as reportService from "../../services/reportService";
import * as teamRiskService from "../../services/teamRiskService";
import * as projectForecastService from "../../services/projectForecastService";
import * as teamPerformanceService from "../../services/teamPerformanceService";
import * as taskService from "../../services/taskService";
import { TASK_PRIORITIES } from "../../services/workspaceData";
import StudentProgressCard from "../../components/ai/StudentProgressCard";
import TeamPerformanceInsights from "../../components/ai/TeamPerformanceInsights";

/**
 * Same status → kanban-column mapping used on the Tasks page
 * (pages/student/Tasks.jsx#columnForStatus) — duplicated here as a small
 * pure display helper only, so the dashboard's "done" / "not done" split
 * matches the Tasks board exactly without importing page-local code.
 */
const columnForStatus = (status) => {
  if (status === "completed") return "done";
  if (["submitted", "ai_review", "guide_review", "changes_requested"].includes(status)) return "review";
  if (status === "rejected") return "todo";
  if (["backlog", "todo", "in_progress", "review", "done"].includes(status)) return status;
  return "todo";
};

const dayDiff = (iso) => Math.round((new Date(iso).getTime() - Date.now()) / 86400000);

const DueChip = ({ due }) => {
  const d = dayDiff(due);
  const tone = d < 0 ? "bg-coral-soft text-coral" : d <= 2 ? "bg-amber-soft text-amber" : "bg-cloud text-slate-muted";
  const label = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "Due today" : `${d}d left`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${tone}`}>
      <Clock className="w-3 h-3" /> {label}
    </span>
  );
};

const TASK_STATUS_ROWS = [
  { key: "todo", label: "To do", tone: "bg-slate-muted" },
  { key: "in_progress", label: "In progress", tone: "bg-amber" },
  { key: "review", label: "In review", tone: "bg-brand" },
  { key: "done", label: "Done", tone: "bg-mint" },
];

const StudentDashboard = () => {
  const { user } = useAuth();
  const { groups, loading } = useGroups();
  const { notifications } = useNotifications();
  const navigate = useNavigate();
  const [myGroup] = groups;
  const [latestReport, setLatestReport] = useState(null);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [performanceScore, setPerformanceScore] = useState(null);
  const [assignedTasks, setAssignedTasks] = useState(0);
  const [taskCompletion, setTaskCompletion] = useState(0);
  // Step 15 — the student only ever sees their OWN actionable risk status,
  // never another student's data (see teamRiskController.js#shapeForStudent).
  const [myRisk, setMyRisk] = useState(null);
  // STEP 16 — additive, same "own data only" response shape (see
  // teamRiskController.js#shapeForStudent).
  const [myEarlyWarnings, setMyEarlyWarnings] = useState([]);
  const [myCollaboration, setMyCollaboration] = useState(null);
  // STEP 19 — student-safe-only progress card (see
  // projectForecastController.js#buildStudentProgress).
  const [myProgress, setMyProgress] = useState(null);
  const [myProgressLoading, setMyProgressLoading] = useState(true);
  const [myProgressError, setMyProgressError] = useState(false);
  // STEP 22 — student-safe-only performance card (see
  // teamPerformanceService.js#shapeForStudent — own score/level/strengths/
  // improvement areas/recommended action only, never peer data).
  const [myPerformance, setMyPerformance] = useState(null);
  const [myPerformanceLoading, setMyPerformanceLoading] = useState(true);
  const [myPerformanceError, setMyPerformanceError] = useState(false);
  // Task progress + upcoming deadlines — reuses the existing, already
  // group-member-visible GET /groups/:groupId/tasks endpoint (the same one
  // pages/student/Tasks.jsx calls), filtered client-side to the current
  // user's own assignments. No new backend/API surface.
  const [myTasks, setMyTasks] = useState([]);
  const [myTasksLoading, setMyTasksLoading] = useState(true);
  const [myTasksError, setMyTasksError] = useState(false);

  useEffect(() => {
    if (!myGroup) {
      setMyProgressLoading(false);
      return undefined;
    }
    let alive = true;
    setMyProgressLoading(true);
    projectForecastService
      .getProjectForecast(myGroup.id)
      .then((data) => {
        if (!alive) return;
        setMyProgress(data?.myProgress || null);
        setMyProgressError(false);
      })
      .catch(() => {
        if (!alive) return;
        setMyProgress(null);
        setMyProgressError(true);
      })
      .finally(() => {
        if (alive) setMyProgressLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [myGroup]);

  useEffect(() => {
    if (!myGroup) {
      setMyPerformanceLoading(false);
      return undefined;
    }
    let alive = true;
    setMyPerformanceLoading(true);
    teamPerformanceService
      .getTeamPerformance(myGroup.id)
      .then((data) => {
        if (!alive) return;
        setMyPerformance(data?.myPerformance || null);
        setMyPerformanceError(false);
      })
      .catch(() => {
        if (!alive) return;
        setMyPerformance(null);
        setMyPerformanceError(true);
      })
      .finally(() => {
        if (alive) setMyPerformanceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [myGroup]);

  useEffect(() => {
    if (!myGroup) return undefined;
    let alive = true;
    teamRiskService
      .getTeamRisk(myGroup.id)
      .then((data) => {
        if (!alive) return;
        setMyRisk(data?.myRisk || null);
        setMyEarlyWarnings(data?.myEarlyWarnings || []);
        setMyCollaboration(data?.myCollaboration || null);
      })
      .catch(() => {
        if (!alive) return;
        setMyRisk(null);
        setMyEarlyWarnings([]);
        setMyCollaboration(null);
      });
    return () => {
      alive = false;
    };
  }, [myGroup]);

  useEffect(() => {
    if (!myGroup || !user) return undefined;
    let alive = true;

    const loadReports = async () => {
      try {
        const [latest, weekly, monthly] = await Promise.all([
          reportService.getLatestGroupReport(myGroup.id),
          reportService.getGroupPeriodReport(myGroup.id, "weekly"),
          reportService.getGroupPeriodReport(myGroup.id, "monthly"),
        ]);
        if (!alive) return;
        setLatestReport(latest);
        setWeeklyReport(weekly);
        setMonthlyReport(monthly);
        const self = latest?.students?.find((s) => s.userId === String(user.id || user._id));
        setPerformanceScore(self?.overall ?? null);
        const myTaskStats = latest?.students?.find((s) => s.userId === String(user.id || user._id));
        setAssignedTasks(myTaskStats?.tasksAssigned ?? 0);
        setTaskCompletion(myTaskStats?.taskCompletion ?? 0);
      } catch (error) {
        console.error("Failed to load AI report data", error);
        if (alive) {
          setLatestReport(null);
          setWeeklyReport(null);
          setMonthlyReport(null);
          setPerformanceScore(null);
        }
      }
    };

    loadReports();
    return () => {
      alive = false;
    };
  }, [myGroup, user]);

  useEffect(() => {
    if (!myGroup || !user) {
      setMyTasksLoading(false);
      return undefined;
    }
    let alive = true;
    setMyTasksLoading(true);
    setMyTasksError(false);
    taskService
      .getTasks(myGroup.id)
      .then((tasks) => {
        if (!alive) return;
        const mine = (tasks || []).filter((t) => String(t.assigneeId) === String(user.id || user._id));
        setMyTasks(mine);
      })
      .catch((error) => {
        console.error("Failed to load task board for dashboard", error);
        if (!alive) return;
        setMyTasks([]);
        setMyTasksError(true);
      })
      .finally(() => {
        if (alive) setMyTasksLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [myGroup, user]);

  const taskStatusCounts = useMemo(() => {
    const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };
    myTasks.forEach((t) => {
      const col = columnForStatus(t.status);
      if (counts[col] != null) counts[col] += 1;
    });
    return counts;
  }, [myTasks]);

  const upcomingDeadlines = useMemo(
    () =>
      myTasks
        .filter((t) => columnForStatus(t.status) !== "done" && t.due)
        .sort((a, b) => new Date(a.due) - new Date(b.due))
        .slice(0, 4),
    [myTasks]
  );


  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  return (
    <>
      <Navbar
        title={`Welcome back, ${user?.name?.split(" ")[0] || "there"}`}
        subtitle={myGroup ? `${myGroup.name} · ${myGroup.project || "Your project"}` : "Here's what's happening across your projects"}
      />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-6xl w-full mx-auto">
        {/* Welcome & Quick Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
          <div>
            <h1 className="font-display text-lg sm:text-xl font-semibold text-slate-ink">
              {greeting}, {user?.name?.split(" ")[0] || "Student"}!
            </h1>
            <p className="text-xs sm:text-sm text-slate-muted mt-0.5">
              {taskStatusCounts.todo + taskStatusCounts.in_progress > 0
                ? `You have ${taskStatusCounts.todo + taskStatusCounts.in_progress} pending task${taskStatusCounts.todo + taskStatusCounts.in_progress === 1 ? "" : "s"} requiring your focus today.`
                : "You are completely caught up with your project tasks!"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => navigate(ROUTES.STUDENT_TASKS)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-deep text-white text-xs sm:text-sm font-semibold shadow-sm transition-colors"
            >
              <ListTodo className="w-4 h-4" />
              <span>My Tasks</span>
            </button>
            <button
              onClick={() => navigate(ROUTES.STUDENT_CALENDAR)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cloud hover:bg-slate-line/60 text-slate-ink text-xs sm:text-sm font-medium border border-slate-line transition-colors"
            >
              <Calendar className="w-4 h-4 text-brand" />
              <span>Calendar</span>
            </button>
            {myGroup && (
              <button
                onClick={() => navigate(`/app/groups/${myGroup.id}`)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cloud hover:bg-slate-line/60 text-slate-ink text-xs sm:text-sm font-medium border border-slate-line transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-mint" />
                <span>Group Chat</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI overview */}
        <section className="space-y-3">
          <SectionHeading title="Overview" />
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatsCard label="My groups" value={loading ? "…" : groups.length} icon={MessagesSquare} tone="brand" />
            <StatsCard
              label="Assigned tasks"
              value={myTasksLoading ? "…" : myTasks.length || assignedTasks}
              icon={ListTodo}
              tone="brand"
            />
            <StatsCard
              label="Completion %"
              value={
                myTasks.length
                  ? `${Math.round((taskStatusCounts.done / myTasks.length) * 100)}%`
                  : `${taskCompletion}%`
              }
              icon={TrendingUp}
              tone="mint"
            />
            <StatsCard
              label="Performance score"
              value={performanceScore != null ? `${performanceScore}/100` : "—"}
              icon={Sparkles}
              tone="amber"
            />
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            {/* Task progress */}
            <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
              <div className="mb-3">
                <SectionHeading icon={ListTodo} title="Task progress" />
              </div>
              {myTasksLoading ? (
                <div className="h-[100px] rounded-xl border border-slate-line bg-cloud/60 animate-pulse" />
              ) : myTasksError ? (
                <div className="flex items-center justify-between gap-3 bg-coral-soft border border-coral/20 rounded-xl2 px-4 py-3.5">
                  <p className="text-sm text-coral">Couldn't load your task board.</p>
                </div>
              ) : myTasks.length === 0 ? (
                <p className="text-sm text-slate-muted">No tasks assigned to you yet in this group.</p>
              ) : (
                <div className="space-y-2.5">
                  {TASK_STATUS_ROWS.map((row) => {
                    const count = taskStatusCounts[row.key];
                    const pct = myTasks.length ? Math.round((count / myTasks.length) * 100) : 0;
                    return (
                      <div key={row.key}>
                        <div className="flex items-center justify-between text-xs text-slate-muted mb-1">
                          <span>{row.label}</span>
                          <span className="font-medium text-slate-ink">{count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-cloud overflow-hidden">
                          <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Upcoming deadlines */}
            <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
              <div className="mb-3 flex items-center justify-between gap-3">
                <SectionHeading icon={CalendarClock} title="Upcoming deadlines" />
                <button
                  onClick={() => navigate(ROUTES.STUDENT_CALENDAR)}
                  className="shrink-0 text-xs font-medium text-brand hover:text-brand-deep"
                >
                  View Calendar
                </button>
              </div>
              {myTasksLoading ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-[52px] rounded-lg bg-cloud/60 animate-pulse" />
                  ))}
                </div>
              ) : myTasksError ? (
                <p className="text-sm text-coral">Couldn't load your upcoming deadlines.</p>
              ) : upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-slate-muted">Nothing due soon — you're all caught up.</p>
              ) : (
                <ul className="space-y-2.5">
                  {upcomingDeadlines.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            TASK_PRIORITIES[t.priority]?.classes || "bg-cloud text-slate-muted"
                          }`}
                        >
                          {TASK_PRIORITIES[t.priority]?.label || t.priority}
                        </span>
                        <p className="text-sm text-slate-ink truncate">{t.title}</p>
                      </div>
                      <DueChip due={t.due} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* AI attention / progress / performance */}
            <section className="space-y-5">
              <SectionHeading icon={Sparkles} title="AI insights" subtitle="Based only on your own group activity" />
              {myRisk && (
                <div
                  className={
                    myRisk.riskLevel === "ON_TRACK"
                      ? "bg-mint-soft border border-mint/20 rounded-xl2 p-5"
                      : myRisk.riskLevel === "NEEDS_ATTENTION"
                      ? "bg-amber-soft border border-amber/20 rounded-xl2 p-5"
                      : "bg-coral-soft border border-coral/20 rounded-xl2 p-5"
                  }
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
                    {myRisk.riskLevel === "ON_TRACK" ? (
                      <>
                        <ShieldCheck className="w-4 h-4 text-mint" /> Your Progress
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-coral" /> Attention Needed
                      </>
                    )}
                  </p>
                  <p className="text-sm text-slate-ink">
                    {myRisk.riskLevel === "ON_TRACK" ? "You are currently on track." : myRisk.reasons?.[0]}
                  </p>
                  {myRisk.recommendations?.[0] && (
                    <p className="text-xs text-slate-muted mt-1.5">{myRisk.recommendations[0]}</p>
                  )}
                </div>
              )}
              {/* STEP 19 — AI Project Progress Forecast: own-progress-only card */}
              <StudentProgressCard myProgress={myProgress} loading={myProgressLoading} error={myProgressError} />
              {/* STEP 22 — 🏆 Your Performance: own-data-only card */}
              <TeamPerformanceInsights
                performance={{ myPerformance }}
                loading={myPerformanceLoading}
                error={myPerformanceError}
                isStudentView
              />
              {/* STEP 16 — own-data-only proactive alerts */}
              <AttentionNeeded earlyWarnings={myEarlyWarnings} collaboration={myCollaboration} />
            </section>

            {/* Group progress */}
            {groups.length > 0 && (
              <section className="space-y-3">
                <SectionHeading icon={FolderOpen} title="Group progress" />
                <div className="space-y-3">
                  {groups.map((g) => (
                    <ProjectProgress key={g.id} label={g.name} progress={g.progress} meta={g.project} />
                  ))}
                </div>
              </section>
            )}

            {/* Latest AI report */}
            {latestReport && (
              <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
                <div className="mb-3">
                  <SectionHeading icon={Sparkles} title="Latest AI report" />
                </div>
                <p className="text-sm text-slate-muted mb-2">
                  {latestReport.headline || "Overview of the latest collaboration snapshot."}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-muted">Completion</p>
                    <p className="font-semibold text-slate-ink">{latestReport.prediction?.completion ?? "—"}%</p>
                  </div>
                  <div>
                    <p className="text-slate-muted">Collaboration</p>
                    <p className="font-semibold text-slate-ink">{latestReport.collaborationScore ?? "—"}%</p>
                  </div>
                  <div>
                    <p className="text-slate-muted">Messages</p>
                    <p className="font-semibold text-slate-ink">{latestReport.messagesAnalyzed ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-muted">Files</p>
                    <p className="font-semibold text-slate-ink">{latestReport.filesAnalyzed ?? "—"}</p>
                  </div>
                </div>
                {latestReport.recommendations?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-line">
                    <p className="text-xs font-semibold text-slate-muted mb-2">AI suggestions</p>
                    <ul className="space-y-1.5 text-sm text-slate-muted">
                      {latestReport.recommendations.slice(0, 5).map((suggestion, index) => (
                        <li key={index} className="list-disc list-inside">
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {(weeklyReport || monthlyReport) && (
              <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
                <p className="text-sm font-semibold text-slate-ink mb-3">Persisted reports</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-muted">Weekly report</p>
                    <p className="font-semibold text-slate-ink">{weeklyReport?.prediction?.completion ?? "—"}% complete</p>
                  </div>
                  <div>
                    <p className="text-slate-muted">Monthly report</p>
                    <p className="font-semibold text-slate-ink">{monthlyReport?.prediction?.completion ?? "—"}% complete</p>
                  </div>
                  <div>
                    <p className="text-slate-muted">Weekly generated</p>
                    <p className="font-semibold text-slate-ink">
                      {weeklyReport?.generatedAt ? new Date(weeklyReport.generatedAt).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-muted">Monthly generated</p>
                    <p className="font-semibold text-slate-ink">
                      {monthlyReport?.generatedAt ? new Date(monthlyReport.generatedAt).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="space-y-5">
            <RecentActivity items={notifications} />
          </div>
        </div>
      </main>
    </>
  );
};

export default StudentDashboard;
