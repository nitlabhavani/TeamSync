import { createContext, useCallback, useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../hooks/useAuth";
import { getToken } from "../lib/apiClient";
import * as notificationService from "../services/notificationService";
import * as toastService from "../services/toastService";

export const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
  const { user, loading } = useAuth() || {};
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (loading || !user || !getToken()) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const { items, unread } = await notificationService.getNotifications();
      setNotifications(items);
      setUnreadCount(unread);
    } catch {
      /* not signed in yet or token expired */
    }
  }, [user, loading]);

  useEffect(() => {
    if (loading || !user || !getToken()) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [user, loading, refresh]);

  const { subscribeGroupEvent, subscribeUserEvent } = useSocket();

  useEffect(() => {
    const unsubUploaded = subscribeGroupEvent("group:file:uploaded", () => refresh().catch(() => {}));
    const unsubDeleted = subscribeGroupEvent("group:file:deleted", () => refresh().catch(() => {}));
    const unsubAiReady = subscribeUserEvent("guide:file:ai-ready", () => refresh().catch(() => {}));
    const unsubNew = subscribeUserEvent("notification:new", (doc) => {
      if (!doc) return;
      const notification = {
        ...doc,
        id: doc.id || doc._id,
        time: doc.createdAt || doc.time,
      };
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev];
      });
      if (!notification.read) setUnreadCount((c) => c + 1);
    });
    return () => {
      unsubUploaded?.();
      unsubDeleted?.();
      unsubAiReady?.();
      unsubNew?.();
    };
  }, [refresh, subscribeGroupEvent, subscribeUserEvent]);

  const markAsRead = useCallback(async (id) => {
    let wasUnread = false;
    setNotifications((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        if (!n.read) wasUnread = true;
        return { ...n, read: true };
      })
    );
    // Only decrement for a genuine unread -> read transition, so re-opening
    // an already-read notification (or a stale double click) can never push
    // the count below the server's real count until the next refresh().
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    await notificationService.markRead(id).catch(() => {});
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await notificationService.markAllRead().catch(() => {});
  }, []);

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, markAsRead, markAllAsRead, refresh }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
