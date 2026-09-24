import { api, normalize } from "../lib/apiClient";

export const getNotifications = async () => {
  const data = normalize(await api.get("/notifications"));
  return {
    items: (data.items || []).map((n) => ({ ...n, time: n.createdAt || n.time })),
    unread: data.unread ?? 0,
  };
};

export const markRead = async (id) => api.post(`/notifications/${id}/read`, {});
export const markAllRead = async () => api.post("/notifications/read-all", {});
export const removeNotification = async (id) => api.del(`/notifications/${id}`);
