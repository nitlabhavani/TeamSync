import { useEffect, useState } from "react";
import Navbar from "../../components/navbar/Navbar";
import { useNavigate } from "@/lib/router-compat";
import { useNotifications } from "../../hooks/useNotifications";
import { useGroups } from "../../hooks/useGroups";
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
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

// Matches the Notification model's real `type` enum: chat, task, meeting, review, file, risk, system.
const TYPE_CONFIG = {
  chat: { icon: MessageCircle, tone: "brand" },
  task: { icon: ListTodo, tone: "brand" },
  meeting: { icon: CalendarClock, tone: "brand" },
  review: { icon: ClipboardCheck, tone: "brand" },
  file: { icon: FileUp, tone: "brand" },
  risk: { icon: AlertTriangle, tone: "coral" },
  system: { icon: Info, tone: "neutral" },
};

const TONE_STYLES = {
  brand: "bg-brand-soft text-brand",
  coral: "bg-coral-soft text-coral",
  neutral: "bg-cloud text-slate-muted",
};

const configFor = (type) => TYPE_CONFIG[type] || TYPE_CONFIG.system;

const NotificationSkeleton = () => (
  <div className="space-y-2">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-[76px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const Notifications = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, refresh } = useNotifications();
  const { setPendingMessageTarget } = useGroups();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState(null);

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

  const handleOpen = (n) => {
    // Only this exact notification is marked read — see useNotifications /
    // NotificationContext.markAsRead, which flips a single id and never
    // touches the rest of the list.
    markAsRead(n.id);

    // STEP 34 — a group-message notification carries the exact groupId (and,
    // when available, messageId) it's about. Stash it so GroupDetails.jsx
    // can scroll to and highlight that exact message once it loads, then
    // navigate straight to that group's chat via its authoritative id —
    // never by group name (two groups can share a name). Notifications
    // created before this change (or any non-chat type, or a direct/private
    // message) simply have no `group`, so this is skipped and the existing
    // `n.link` fallback below still runs unchanged.
    if (n.type === "chat" && n.group) {
      setPendingMessageTarget({ groupId: n.group, messageId: n.message || null });
      navigate(n.link || `/app/groups/${n.group}`);
      return;
    }

    if (n.link) navigate(n.link);
  };

  return (
    <>
      <Navbar title="Notifications" subtitle="Updates from your groups, tasks, and files" />
      <main className="flex-1 px-5 md:px-8 py-6 max-w-2xl w-full mx-auto">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-brand" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-ink truncate">
                {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
              </p>
              <p className="text-xs text-slate-muted truncate">All your notifications in one place</p>
            </div>
          </div>

          {notifications.length > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand hover:underline"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all as read
            </button>
          )}
        </div>

        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3.5 mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
              <p className="text-sm text-coral truncate">Notifications could not be loaded — {loadError}</p>
            </div>
            <button
              onClick={loadNotifications}
              className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-paper border border-coral/30 px-3 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {loading ? (
          <NotificationSkeleton />
        ) : notifications.length === 0 ? (
          !loadError && (
            <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-12 px-6">
              <span className="w-11 h-11 rounded-full bg-cloud flex items-center justify-center">
                <BellOff className="w-5 h-5 text-slate-muted" />
              </span>
              <p className="text-sm font-medium text-slate-ink">You're all caught up</p>
              <p className="text-xs text-slate-muted max-w-xs">
                Updates from your groups, tasks, and files will show up here.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const { icon: Icon, tone } = configFor(n.type);
              return (
                <button
                  key={n.id}
                  onClick={() => handleOpen(n)}
                  className={classNames(
                    "w-full flex items-start gap-3 text-left rounded-xl2 border px-4 py-3.5 transition-colors",
                    n.read ? "border-slate-line bg-paper hover:border-slate-line" : "border-brand/30 bg-brand-soft hover:border-brand/50"
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
                  {!n.read && <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
};

export default Notifications;
