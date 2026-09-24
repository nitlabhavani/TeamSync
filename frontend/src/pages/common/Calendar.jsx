import { useCallback, useEffect, useMemo, useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  addMonths,
  addWeeks,
  addDays,
  isSameMonth,
  isToday,
  format,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Users,
  Rocket,
  Flag,
  Milestone as MilestoneIcon,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Inbox,
  Download,
  Sparkles,
  CheckCircle2,
  Target,
  ArrowRight,
  X,
  FileCheck2,
  Clock,
  Bot,
  Video,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { useAuth } from "../../hooks/useAuth";
import { useGroups } from "../../hooks/useGroups";
import { useNavigate } from "@/lib/router-compat";
import { classNames } from "../../utils/helperFunctions";
import { ROUTES } from "../../utils/constants";
import * as calendarService from "../../services/calendarService";
import { getDeadlineStatus } from "../../utils/deadlineUtils";

/**
 * CALENDAR — a read-only visual aggregation of existing Task/Meeting/Sprint/
 * Milestone/project-deadline data (see calendarService.js and
 * backend/src/controllers/calendarController.js). It creates nothing of its
 * own: clicking an event always hands off to that item's real existing page.
 *
 * Used directly by both /app/calendar (student/team-leader) and
 * /guide/calendar — same pattern pages/common/Search.jsx already uses for
 * guide.search.tsx. useGroups()/useAuth() already return the right group
 * set and role, so no separate student/guide implementation is needed.
 *
 * Month/Week/Day views are hand-rolled with date-fns (already an existing
 * dependency — nothing new added) rather than pulling in a full calendar UI
 * library: an agenda-style grid is a small, well-understood amount of code,
 * and a generic calendar library would fight this app's own design tokens
 * more than it would save.
 */

const TYPE_META = {
  task: { label: "Task", icon: ListTodo, dot: "bg-brand", chip: "bg-brand-soft text-brand-deep" },
  ai_deadline: {
    label: "AI Task Deadline",
    icon: Sparkles,
    dot: "bg-purple-600",
    chip: "bg-purple-100 text-purple-800 border border-purple-200",
  },
  meeting: { label: "Meeting", icon: Users, dot: "bg-mint", chip: "bg-mint-soft text-mint" },
  sprint: { label: "Sprint", icon: Rocket, dot: "bg-amber", chip: "bg-amber-soft text-amber" },
  deadline: { label: "Deadline", icon: Flag, dot: "bg-coral", chip: "bg-coral-soft text-coral" },
  milestone: { label: "Milestone", icon: MilestoneIcon, dot: "bg-ink", chip: "bg-cloud text-slate-ink" },
};

const FILTERS = [
  { id: "all", label: "All Events" },
  { id: "ai_deadline", label: "✨ AI Deadlines" },
  { id: "task", label: "Tasks" },
  { id: "meeting", label: "Meetings" },
  { id: "sprint", label: "Sprints" },
  { id: "deadline", label: "Deadlines" },
  { id: "milestone", label: "Milestones" },
];

/** Where an event click should hand off to — every target is an existing page. */
function targetFor(event, { isGuide, groupId }) {
  switch (event.type) {
    case "task":
      return isGuide ? ROUTES.GUIDE_SUBMISSIONS : ROUTES.STUDENT_TASKS;
    case "meeting":
      // Guides have no dedicated meetings page today — Group management is
      // the closest existing workflow entry point for that group.
      return isGuide ? ROUTES.GUIDE_GROUP_MANAGEMENT : ROUTES.STUDENT_MEETINGS;
    case "sprint":
      // The sprint planner already surfaces inside the student Tasks page.
      return isGuide ? ROUTES.GUIDE_GROUP_MANAGEMENT : ROUTES.STUDENT_TASKS;
    case "deadline":
      return isGuide ? ROUTES.GUIDE_GROUP_MANAGEMENT : `/app/groups/${groupId}`;
    case "milestone":
      // Risk Radar is the existing guide page that already reads milestones.
      return isGuide ? ROUTES.GUIDE_RISK_RADAR : `/app/groups/${groupId}`;
    default:
      return null;
  }
}

const EventPill = ({ event, onClick, compact }) => {
  const isAi = Boolean(event.isAiDeadline || event.metadata?.isAiDeadline || event.type === "ai_deadline");
  const meta = isAi ? TYPE_META.ai_deadline : (TYPE_META[event.type] || TYPE_META.task);
  const status = event.metadata?.status;
  const isCompleted = status === "completed" || status === "done";
  const deadline = getDeadlineStatus(event.start || event.end);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      title={`${isAi ? "✨ AI Deadline: " : ""}${event.title}${deadline.label && !isCompleted ? ` (${deadline.label})` : ""}${event.metadata?.whatToDo ? ` — ${event.metadata.whatToDo}` : ""}`}
      className={classNames(
        "group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-all hover:opacity-85 shadow-2xs",
        isAi
          ? "bg-purple-50 text-purple-900 border border-purple-200/90 font-semibold hover:bg-purple-100 hover:border-purple-300"
          : meta.chip,
        compact && "truncate"
      )}
    >
      {isAi ? (
        <Sparkles className="h-3 w-3 shrink-0 text-purple-600 animate-pulse" />
      ) : isCompleted ? (
        <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-mint" />
      ) : (
        <span className={classNames("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
      )}
      <span className={classNames("truncate", isCompleted && "line-through opacity-70")}>{event.title}</span>
    </button>
  );
};

const EventRow = ({ event, onClick }) => {
  const isAi = Boolean(event.isAiDeadline || event.metadata?.isAiDeadline || event.type === "ai_deadline");
  const meta = isAi ? TYPE_META.ai_deadline : (TYPE_META[event.type] || TYPE_META.task);
  const Icon = meta.icon;
  const m = event.metadata || {};
  const isCompleted = m.status === "completed" || m.status === "done";
  const deadline = getDeadlineStatus(event.start || event.end);

  return (
    <button
      onClick={() => onClick(event)}
      className={classNames(
        "group flex w-full flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all hover:shadow-sm",
        isAi
          ? "border-purple-200 bg-purple-50/40 hover:border-purple-400 hover:bg-purple-50/80"
          : "border-slate-line bg-paper hover:border-brand hover:bg-brand-soft/30"
      )}
    >
      <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
        <span className={classNames("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg mt-0.5 sm:mt-0", meta.chip)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={classNames("text-sm font-semibold text-slate-ink", isCompleted && "line-through opacity-70")}>
              {event.title}
            </span>
            {isAi && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-purple-700 uppercase">
                <Sparkles className="h-2.5 w-2.5" /> AI Deadline
              </span>
            )}
            {deadline.label && !isCompleted && (
              <span className={classNames("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", deadline.tone)}>
                <Clock className="h-2.5 w-2.5" /> {deadline.label}
              </span>
            )}
            {m.earlyWarning && (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-semibold text-coral">
                <AlertTriangle className="h-2.5 w-2.5" /> {String(m.earlyWarning).replace(/_/g, " ")}
              </span>
            )}
            {m.priority && (
              <span
                className={classNames(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  m.priority === "high" || m.priority === "urgent"
                    ? "bg-coral-soft text-coral"
                    : "bg-cloud text-slate-muted"
                )}
              >
                {m.priority}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-muted">
            <span>
              {meta.label}
              {event.allDay
                ? ` · ${format(event.start, "EEE, d MMM yyyy")}`
                : ` · ${format(event.start, "EEE, d MMM · h:mm a")}`}
            </span>
            {m.deliverableType && (
              <span className="inline-flex items-center gap-1 font-medium text-purple-700">
                <Target className="h-3 w-3" /> {m.deliverableType}
              </span>
            )}
            {m.assignee?.name && (
              <span className="text-slate-muted">
                👤 {m.isMine ? "You" : m.assignee.name}
              </span>
            )}
          </div>

          {m.whatToDo && (
            <p className="mt-1 line-clamp-1 text-xs text-slate-600">
              <span className="font-medium text-slate-700">Task:</span> {m.whatToDo}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        {m.status && (
          <span
            className={classNames(
              "rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider",
              isCompleted
                ? "bg-mint-soft text-mint"
                : m.status === "review" || m.status === "in_review"
                ? "bg-amber-soft text-amber"
                : "bg-brand-soft text-brand-deep"
            )}
          >
            {m.status.replace(/_/g, " ")}
          </span>
        )}
        <span className="text-xs font-medium text-brand group-hover:translate-x-0.5 transition-transform flex items-center">
          Details <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
        </span>
      </div>
    </button>
  );
};


function exportToIcs(events, groupName) {
  if (!events || !events.length) return;
  const pad = (n) => String(n).padStart(2, "0");
  const formatDateToIcs = (d) => {
    const dt = new Date(d);
    return (
      dt.getUTCFullYear() +
      pad(dt.getUTCMonth() + 1) +
      pad(dt.getUTCDate()) +
      "T" +
      pad(dt.getUTCHours()) +
      pad(dt.getUTCMinutes()) +
      pad(dt.getUTCSeconds()) +
      "Z"
    );
  };

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TeamSync AI//Project Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${groupName || "TeamSync AI"} Schedule`,
  ];

  events.forEach((e) => {
    if (!e.start) return;
    const startStr = formatDateToIcs(e.start);
    const endStr = e.end ? formatDateToIcs(e.end) : startStr;
    const uid = (e.id || Math.random().toString(36).slice(2)) + "@teamsync.ai";
    const cleanTitle = (e.title || "Untitled Event").replace(/[,;]/g, " ");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${formatDateToIcs(new Date())}`);
    lines.push(`DTSTART:${startStr}`);
    lines.push(`DTEND:${endStr}`);
    lines.push(`SUMMARY:${cleanTitle}`);
    lines.push(`DESCRIPTION:TeamSync AI ${e.type || "event"} for ${groupName || "Team"}`);
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(groupName || "teamsync").replace(/[^a-z0-9_-]/gi, "_")}_calendar.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const Calendar = () => {
  const { user } = useAuth();
  const isGuide = user?.role === "guide" || user?.role === "admin";
  const { groups, activeGroupId } = useGroups();

  const [groupId, setGroupId] = useState(null);
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [typeFilter, setTypeFilter] = useState("all");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dayPanel, setDayPanel] = useState(null); // Date | null — "see all" for one day in month view
  const [selectedEvent, setSelectedEvent] = useState(null); // Event | null — detail modal
  const navigate = useNavigate();

  useEffect(() => {
    if (groupId || !groups.length) return;
    const active = activeGroupId && groups.some((g) => g.id === activeGroupId) ? activeGroupId : null;
    setGroupId(active || groups[0].id);
  }, [groups, groupId, activeGroupId]);

  // Visible range for the current view — this is exactly what's sent to the
  // backend, so switching months/weeks/days never fetches the group's whole
  // history at once (Part 12 of the brief).
  const range = useMemo(() => {
    if (view === "month") {
      const monthStart = startOfMonth(cursor);
      const monthEnd = endOfMonth(cursor);
      return { start: startOfWeek(monthStart), end: endOfWeek(monthEnd) };
    }
    if (view === "week") {
      return { start: startOfWeek(cursor), end: endOfWeek(cursor) };
    }
    return { start: startOfDay(cursor), end: endOfDay(cursor) };
  }, [view, cursor]);

  const load = useCallback(() => {
    if (!groupId) return;
    setLoading(true);
    setError("");
    calendarService
      .getEvents(groupId, range)
      .then(setEvents)
      .catch((err) => setError(err.message || "Couldn't load the calendar."))
      .finally(() => setLoading(false));
  }, [groupId, range]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleEvents = useMemo(() => {
    if (typeFilter === "all") return events;
    if (typeFilter === "ai_deadline") {
      return events.filter((e) => e.isAiDeadline || e.metadata?.isAiDeadline || e.type === "ai_deadline");
    }
    return events.filter((e) => e.type === typeFilter);
  }, [events, typeFilter]);

  const aiDeadlinesCount = useMemo(
    () => events.filter((e) => e.isAiDeadline || e.metadata?.isAiDeadline || e.type === "ai_deadline").length,
    [events]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const e of visibleEvents) {
      if (!e.start) continue;
      const span = eachDayOfInterval({ start: e.start, end: e.end || e.start });
      for (const day of span) {
        const key = format(day, "yyyy-MM-dd");
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(e);
      }
    }
    return map;
  }, [visibleEvents]);

  const handleEventClick = (event) => {
    setSelectedEvent(event);
  };

  const goToday = () => setCursor(new Date());
  const goPrev = () =>
    setCursor((c) => (view === "month" ? addMonths(c, -1) : view === "week" ? addWeeks(c, -1) : addDays(c, -1)));
  const goNext = () =>
    setCursor((c) => (view === "month" ? addMonths(c, 1) : view === "week" ? addWeeks(c, 1) : addDays(c, 1)));

  const headerLabel =
    view === "month"
      ? format(cursor, "MMMM yyyy")
      : view === "week"
        ? `Week of ${format(startOfWeek(cursor), "d MMM yyyy")}`
        : format(cursor, "EEEE, d MMMM yyyy");

  const group = groups.find((g) => g.id === groupId);

  return (
    <>
      <Navbar title="Calendar" subtitle="Task deadlines, meetings, sprints and milestones in one view" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-5">
        {groups.length > 1 && (
          <div className="flex gap-1.5 rounded-full bg-cloud p-1 w-fit overflow-x-auto">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupId(g.id)}
                className={classNames(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  g.id === groupId ? "bg-paper text-slate-ink shadow-sm" : "text-slate-muted hover:text-slate-ink"
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        {!groups.length && !loading && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-slate-line bg-paper py-16 text-center">
            <CalendarDays className="h-6 w-6 text-slate-muted" />
            <p className="text-sm font-medium text-slate-ink">No group yet</p>
            <p className="text-xs text-slate-muted">Join or create a group to see its calendar.</p>
          </div>
        )}

        {groupId && (
          <>
            {aiDeadlinesCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl2 border border-purple-200/80 bg-linear-to-r from-purple-50 via-indigo-50/40 to-paper px-4 py-3 text-xs text-purple-900 shadow-2xs">
                <div className="flex items-center gap-2.5 font-medium">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                    <Sparkles className="h-4 w-4 animate-pulse" />
                  </span>
                  <span>
                    <strong className="font-semibold text-purple-950">
                      {aiDeadlinesCount} AI Task Deadline{aiDeadlinesCount > 1 ? "s" : ""}
                    </strong>{" "}
                    scheduled in this view. AI sets clear deliverables and validates task submissions before completion.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setTypeFilter((f) => (f === "ai_deadline" ? "all" : "ai_deadline"))}
                  className={classNames(
                    "shrink-0 rounded-full px-3 py-1 font-semibold transition-colors shadow-2xs",
                    typeFilter === "ai_deadline"
                      ? "bg-purple-700 text-white"
                      : "bg-purple-200/70 text-purple-800 hover:bg-purple-200"
                  )}
                >
                  {typeFilter === "ai_deadline" ? "Showing AI Deadlines ✓" : "Filter AI Deadlines"}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={goPrev}
                  aria-label="Previous"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-line text-slate-ink hover:bg-cloud"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={goNext}
                  aria-label="Next"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-line text-slate-ink hover:bg-cloud"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={goToday}
                  className="rounded-lg border border-slate-line px-3 py-1.5 text-sm font-medium text-slate-ink hover:bg-cloud"
                >
                  Today
                </button>
                <h2 className="font-display text-base font-semibold text-slate-ink ml-1">{headerLabel}</h2>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="flex gap-1 rounded-full bg-cloud p-1">
                  {["month", "week", "day"].map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={classNames(
                        "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                        view === v ? "bg-paper text-slate-ink shadow-sm" : "text-slate-muted hover:text-slate-ink"
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label="Filter by event type"
                  className="rounded-full border border-slate-line bg-cloud px-3 py-2 text-sm text-slate-ink outline-none focus:border-brand"
                >
                  {FILTERS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => exportToIcs(visibleEvents, group?.name)}
                  disabled={!visibleEvents.length}
                  title="Export schedule to Apple/Google/Outlook Calendar (.ics)"
                  aria-label="Export to iCalendar (.ics)"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-line bg-paper px-3 py-2 text-sm font-medium text-slate-ink shadow-sm transition-colors hover:bg-cloud hover:border-brand disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="h-4 w-4 text-brand" />
                  <span className="hidden sm:inline">Export .ics</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center justify-between gap-3 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-coral">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
                <button
                  onClick={load}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-paper px-3 py-1.5 text-xs font-medium text-slate-ink hover:bg-cloud"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </button>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 rounded-xl2 border border-slate-line bg-paper py-16 text-slate-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading calendar…</span>
              </div>
            )}

            {!loading && !error && (
              <>
                {view === "month" && (
                  <MonthGrid
                    cursor={cursor}
                    eventsByDay={eventsByDay}
                    onEventClick={handleEventClick}
                    onShowDay={setDayPanel}
                  />
                )}
                {view === "week" && (
                  <WeekView cursor={cursor} eventsByDay={eventsByDay} onEventClick={handleEventClick} />
                )}
                {view === "day" && (
                  <DayView cursor={cursor} eventsByDay={eventsByDay} onEventClick={handleEventClick} />
                )}

                {!visibleEvents.length && (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-slate-line bg-paper py-14 text-center">
                    <Inbox className="h-5 w-5 text-slate-muted" />
                    <p className="text-sm font-medium text-slate-ink">No events scheduled</p>
                    <p className="text-xs text-slate-muted">
                      {group ? `Nothing for ${group.name} in this range.` : "Nothing in this range."}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {dayPanel && (
        <DayPanel
          day={dayPanel}
          events={eventsByDay.get(format(dayPanel, "yyyy-MM-dd")) || []}
          onClose={() => setDayPanel(null)}
          onEventClick={handleEventClick}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onNavigate={(url) => navigate(url)}
          isGuide={isGuide}
          groupId={groupId}
        />
      )}
    </>
  );
};

const MonthGrid = ({ cursor, eventsByDay, onEventClick, onShowDay }) => {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });
  const MAX_VISIBLE = 3;

  return (
    <div className="overflow-x-auto rounded-xl2 border border-slate-line bg-paper shadow-panel">
      <div className="min-w-[560px] sm:min-w-0">
        <div className="grid grid-cols-7 border-b border-slate-line bg-cloud">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-muted"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay.get(key) || [];
            const inMonth = isSameMonth(day, cursor);
            return (
              <div
                key={key}
                className={classNames(
                  "min-h-[104px] border-b border-r border-slate-line p-1.5 last:border-r-0",
                  !inMonth && "bg-cloud/40"
                )}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span
                    className={classNames(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
                      isToday(day) ? "bg-brand text-white" : inMonth ? "text-slate-ink" : "text-slate-muted"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, MAX_VISIBLE).map((e) => (
                    <EventPill key={e.id} event={e} onClick={onEventClick} compact />
                  ))}
                  {dayEvents.length > MAX_VISIBLE && (
                    <button
                      onClick={() => onShowDay(day)}
                      className="w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-slate-muted hover:text-brand"
                    >
                      +{dayEvents.length - MAX_VISIBLE} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const WeekView = ({ cursor, eventsByDay, onEventClick }) => {
  const days = eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDay.get(key) || [];
        return (
          <div key={key} className="rounded-xl2 border border-slate-line bg-paper p-3 shadow-panel">
            <p
              className={classNames(
                "mb-2 text-xs font-semibold uppercase tracking-wide",
                isToday(day) ? "text-brand" : "text-slate-muted"
              )}
            >
              {format(day, "EEE d")}
            </p>
            <div className="space-y-1.5">
              {dayEvents.length ? (
                dayEvents.map((e) => <EventPill key={e.id} event={e} onClick={onEventClick} />)
              ) : (
                <p className="text-xs text-slate-muted">No events</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DayView = ({ cursor, eventsByDay, onEventClick }) => {
  const key = format(cursor, "yyyy-MM-dd");
  const dayEvents = (eventsByDay.get(key) || []).slice().sort((a, b) => (a.start && b.start ? a.start - b.start : 0));
  return (
    <div className="space-y-2">
      {dayEvents.map((e) => (
        <EventRow key={e.id} event={e} onClick={onEventClick} />
      ))}
    </div>
  );
};

const DayPanel = ({ day, events, onClose, onEventClick }) => (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div
      className="w-full max-w-md rounded-xl2 border border-slate-line bg-paper p-4 shadow-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-slate-ink">{format(day, "EEEE, d MMMM")}</h3>
        <button onClick={onClose} className="text-xs font-medium text-slate-muted hover:text-slate-ink">
          Close
        </button>
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {events
          .slice()
          .sort((a, b) => (a.start && b.start ? a.start - b.start : 0))
          .map((e) => (
            <EventRow key={e.id} event={e} onClick={onEventClick} />
          ))}
      </div>
    </div>
  </div>
);

const EventDetailModal = ({ event, onClose, onNavigate, isGuide, groupId }) => {
  if (!event) return null;
  const [copiedLink, setCopiedLink] = useState(false);
  const isAi = Boolean(event.isAiDeadline || event.metadata?.isAiDeadline || event.type === "ai_deadline");
  const meta = isAi ? TYPE_META.ai_deadline : (TYPE_META[event.type] || TYPE_META.task);
  const Icon = meta.icon;
  const m = event.metadata || {};
  const isCompleted = m.status === "completed" || m.status === "done";
  const deadline = getDeadlineStatus(event.start || event.end);
  const targetUrl = targetFor(event, { isGuide, groupId });

  const criteriaList = Array.isArray(m.completionCriteria) && m.completionCriteria.length > 0
    ? m.completionCriteria
    : Array.isArray(m.aiPlan?.acceptanceCriteria) && m.aiPlan.acceptanceCriteria.length > 0
    ? m.aiPlan.acceptanceCriteria
    : [];

  const subtasksList = Array.isArray(m.aiPlan?.subtasks) && m.aiPlan.subtasks.length > 0
    ? m.aiPlan.subtasks
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs transition-opacity"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-line bg-paper shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={classNames("border-b px-5 py-4 flex items-start justify-between gap-3", isAi ? "bg-purple-50/70 border-purple-200" : "bg-cloud border-slate-line")}>
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className={classNames("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", meta.chip)}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {isAi && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-bold text-purple-800 border border-purple-300/80">
                    <Sparkles className="h-3 w-3 text-purple-600" /> AI Task Deadline
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-slate-muted border border-slate-line">
                  {meta.label}
                </span>
                {m.priority && (
                  <span
                    className={classNames(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      m.priority === "high" || m.priority === "urgent"
                        ? "bg-coral-soft text-coral"
                        : "bg-paper text-slate-ink border border-slate-line"
                    )}
                  >
                    {m.priority}
                  </span>
                )}
              </div>
              <h3 className="font-display text-base font-bold text-slate-ink leading-tight">
                {event.title}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-muted hover:bg-cloud hover:text-slate-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="max-h-[68vh] overflow-y-auto p-5 space-y-4 text-sm">
          {/* Due date & Assignee row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-line bg-cloud/40 p-3">
              <div className="flex items-center justify-between gap-1">
                <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-muted">
                  {isAi ? "AI Scheduled Deadline" : "Event Date"}
                </span>
                {deadline.label && !isCompleted && (
                  <span className={classNames("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", deadline.tone)}>
                    <Clock className="h-2.5 w-2.5" /> {deadline.label}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-semibold text-slate-ink text-xs">
                <Clock className="h-4 w-4 text-brand shrink-0" />
                <span>
                  {event.allDay
                    ? format(event.start, "EEEE, d MMM yyyy")
                    : format(event.start, "EEE, d MMM yyyy · h:mm a")}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-line bg-cloud/40 p-3">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-muted">
                Assignee & Status
              </span>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-semibold text-slate-ink text-xs truncate">
                  {m.assignee?.name ? (m.isMine ? "You (Student)" : m.assignee.name) : "Assigned to Group"}
                </span>
                {m.status && (
                  <span
                    className={classNames(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase shrink-0",
                      isCompleted
                        ? "bg-mint-soft text-mint"
                        : m.status === "review" || m.status === "in_review"
                        ? "bg-amber-soft text-amber"
                        : "bg-brand-soft text-brand-deep"
                    )}
                  >
                    {m.status.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Meeting Join Link Section for Meetings */}
          {event.type === "meeting" && (
            <div className="rounded-xl border border-brand/20 bg-brand-soft/30 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                  <Video className="h-4 w-4" />
                  <span>Online Meeting Access</span>
                </div>
                {m.meetingLink && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(m.meetingLink);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      } catch {}
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-line bg-paper px-2 py-0.5 text-[10px] font-medium text-slate-ink hover:bg-cloud shadow-2xs"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="h-3 w-3 text-mint" />
                        <span className="text-mint font-semibold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-slate-muted" />
                        <span>Copy link</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {m.meetingLink ? (
                <div className="space-y-2">
                  <p className="font-mono text-xs text-slate-700 truncate bg-paper/60 px-2.5 py-1.5 rounded-lg border border-slate-line/50">
                    {m.meetingLink}
                  </p>
                  <a
                    href={m.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-dark transition-colors"
                  >
                    <Video className="h-3.5 w-3.5" />
                    Join Meeting Now
                    <ExternalLink className="h-3.5 w-3.5 ml-0.5" />
                  </a>
                </div>
              ) : (
                <p className="text-xs text-slate-muted">
                  No online join link has been attached to this meeting yet.
                </p>
              )}
            </div>
          )}

          {/* Early Warning Banner if any */}
          {m.earlyWarning && (
            <div className="flex items-center gap-2.5 rounded-xl border border-coral/30 bg-coral-soft/50 p-3 text-coral text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>Warning:</strong> {String(m.earlyWarning).replace(/_/g, " ")}. Please submit deliverables before deadline to keep project on schedule.
              </span>
            </div>
          )}

          {/* What to do section */}
          {m.whatToDo && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-muted mb-1 flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-brand" /> What You Must Do
              </h4>
              <div className="rounded-xl border border-slate-line bg-paper p-3 text-slate-ink text-xs leading-relaxed">
                {m.whatToDo}
              </div>
            </div>
          )}

          {/* Expected Output & Deliverable type */}
          {(m.expectedOutput || m.deliverableType) && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-muted mb-1 flex items-center gap-1.5">
                <FileCheck2 className="h-3.5 w-3.5 text-purple-600" /> Expected Output & Deliverable
              </h4>
              <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-3 text-purple-950 space-y-1">
                {m.deliverableType && (
                  <p className="text-xs font-semibold text-purple-800">
                    Deliverable Format: <span className="underline decoration-purple-400">{m.deliverableType}</span>
                  </p>
                )}
                {m.expectedOutput && (
                  <p className="text-xs text-purple-900 leading-relaxed">
                    {m.expectedOutput}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Completion Criteria checklist */}
          {criteriaList.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-muted mb-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-mint" /> AI Acceptance & Verification Criteria
              </h4>
              <ul className="space-y-1.5 rounded-xl border border-slate-line bg-paper p-3">
                {criteriaList.map((crit, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-mint-soft text-mint font-bold text-[10px]">
                      ✓
                    </span>
                    <span>{typeof crit === "string" ? crit : crit.criteria || crit.title || JSON.stringify(crit)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI Subtasks list */}
          {subtasksList.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-muted mb-1.5 flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-purple-600" /> AI Plan Milestones / Subtasks
              </h4>
              <div className="space-y-1 rounded-xl border border-slate-line bg-paper p-2.5">
                {subtasksList.map((st, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-cloud/60">
                    <span className="font-medium text-slate-ink">{st.title || st.name}</span>
                    {st.status && (
                      <span className="text-[10px] font-semibold text-slate-muted uppercase">
                        {st.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-line bg-cloud/50 px-5 py-3.5 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-line bg-paper px-4 py-2 text-xs font-semibold text-slate-ink hover:bg-cloud transition-colors"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {event.type === "meeting" && m.meetingLink && (
              <a
                href={m.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-mint px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-mint/90 transition-colors"
              >
                <Video className="h-3.5 w-3.5" />
                Join Meeting
                <ExternalLink className="h-3 w-3 ml-0.5" />
              </a>
            )}

            {targetUrl && (
              <button
                onClick={() => {
                  onClose();
                  onNavigate(targetUrl);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand/90 transition-colors"
              >
                {isAi
                  ? "Open in Tasks to Complete & Submit"
                  : event.type === "task"
                  ? "View in Tasks"
                  : event.type === "meeting"
                  ? "Go to Meetings"
                  : "Open Event"}
                <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Calendar;
