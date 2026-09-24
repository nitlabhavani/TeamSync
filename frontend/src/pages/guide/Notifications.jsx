import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import { useNavigate } from "@/lib/router-compat";
import { useNotifications } from "../../hooks/useNotifications";
import { formatRelativeTime } from "../../utils/dateFormatter";
import {
  Bell,
  BellOff,
  CheckCheck,
  MessageCircle,
  ListTodo,
  CalendarClock,
  ClipboardCheck,
  FileUp,
  AlertTriangle,
  Info,
  RefreshCw,
  Search,
  MailOpen,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

// Matches the Notification model's real `type` enum: chat, task, meeting, review, file, risk, system.
// Same mapping as the Student Notifications page, so the same notification
// reads identically regardless of which role is viewing it.
const TYPE_CONFIG = {
  chat: { icon: MessageCircle, tone: "brand", label: "Chat" },
  task: { icon: ListTodo, tone: "brand", label: "Task" },
  meeting: { icon: CalendarClock, tone: "brand", label: "Meeting" },
  review: { icon: ClipboardCheck, tone: "brand", label: "Review" },
  file: { icon: FileUp, tone: "brand", label: "File" },
  risk: { icon: AlertTriangle, tone: "coral", label: "Risk" },
  system: { icon: Info, tone: "neutral", label: "System" },
};

const TONE_STYLES = {
  brand: "bg-brand-soft text-brand",
  coral: "bg-coral-soft text-coral",
  neutral: "bg-cloud text-slate-muted",
};

const configFor = (type) => TYPE_CONFIG[type] || TYPE_CONFIG.system;

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const ListSkeleton = () => (
  <div className="space-y-2.5">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-[76px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
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
      <p className="text-sm text-coral truncate">Notifications could not be loaded — {message}</p>
    </div>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

const GuideNotifications = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, refresh } = useNotifications();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const loadNotifications = () => {
    setLoadError(null);
    return refresh()
      .catch((err) => setLoadError(err?.message || "Something went wrong"))
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    let alive = true;
    setChecking(true);
    refresh()
      .catch((err) => {
        if (alive) setLoadError(err?.message || "Something went wrong");
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = checking && notifications.length === 0 && !loadError;

  // Counts computed only from the notifications array already loaded — no
  // separate summary endpoint exists, so nothing here is fetched or
  // invented beyond what's rendered in the list below.
  const counts = useMemo(
    () => ({
      total: notifications.length,
      unread: unreadCount,
      risk: notifications.filter((n) => n.type === "risk").length,
    }),
    [notifications, unreadCount]
  );

  // Type filter options built only from types actually present in the
  // loaded notifications — a type with zero notifications isn't offered
  // as a filter.
  const typeFilters = useMemo(() => {
    const seen = new Set(notifications.map((n) => n.type));
    return [
      { id: "all", label: "All" },
      ...Array.from(seen)
        .filter(Boolean)
        .map((type) => ({ id: type, label: configFor(type).label })),
    ];
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications.filter((n) => {
      if (typeFilter !== "all" && n.type !== typeFilter) return false;
      if (q && !`${n.title || ""} ${n.body || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notifications, typeFilter, search]);

  const handleOpen = (n) => {
    markAsRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <Navbar title="Notifications" subtitle="Updates from your groups, tasks, and risk alerts" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6 max-w-6xl w-full mx-auto">
        {/* Summary KPIs — derived entirely from the loaded notifications array */}
        {loading ? (
          <KpiSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={loadNotifications} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatsCard label="Total" value={counts.total} icon={Bell} tone="brand" />
            <StatsCard label="Unread" value={counts.unread} icon={MailOpen} tone="amber" />
            <StatsCard label="Risk alerts" value={counts.risk} icon={AlertTriangle} tone="coral" />
          </div>
        )}

        {/* Filter / search — client-side only, over already-loaded real notifications */}
        {!loading && !loadError && notifications.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-cloud rounded-full px-3.5 py-2 w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-muted shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search notifications…"
                  aria-label="Search notifications"
                  className="bg-transparent text-sm outline-none flex-1 placeholder:text-slate-muted"
                />
              </div>
              {typeFilters.length > 2 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {typeFilters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTypeFilter(f.id)}
                      aria-pressed={typeFilter === f.id}
                      className={classNames(
                        "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                        typeFilter === f.id
                          ? "bg-brand text-white border-brand"
                          : "border-slate-line text-slate-muted hover:text-slate-ink hover:border-brand"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <button
                onClick={markAllAsRead}
                aria-label="Mark all notifications as read"
                className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand rounded"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all as read
              </button>
            )}
          </div>
        )}

        {/* Notification list */}
        <section aria-label="Notifications">
          {loading ? (
            <ListSkeleton />
          ) : loadError ? null : notifications.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title="You're all caught up"
              subtitle="Updates from your groups, tasks, and risk alerts will show up here."
            />
          ) : filteredNotifications.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No notifications match your filters"
              subtitle="Try a different type or search term."
            />
          ) : (
            <div className="space-y-2.5">
              {filteredNotifications.map((n) => {
                const { icon: Icon, tone } = configFor(n.type);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleOpen(n)}
                    aria-label={`${n.read ? "Read" : "Unread"} notification: ${n.title}`}
                    className={classNames(
                      "w-full flex items-start gap-3 text-left rounded-xl2 border bg-paper px-4 py-3.5 shadow-panel transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      n.read ? "border-slate-line hover:border-slate-line" : "border-brand/30 bg-brand-soft hover:border-brand/50"
                    )}
                  >
                    <span
                      className={classNames(
                        "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                        TONE_STYLES[tone] || TONE_STYLES.neutral
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={classNames("text-sm truncate", n.read ? "font-medium text-slate-ink" : "font-semibold text-slate-ink")}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-slate-muted mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-slate-muted mt-1">{formatRelativeTime(n.time)}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
};

export default GuideNotifications;
