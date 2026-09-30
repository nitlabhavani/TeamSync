import { io } from "socket.io-client";
import { API_URL, getToken } from "../lib/apiClient";

let socket = null;

// Group rooms the app currently wants to be a member of. socket.io-client
// reuses the same Socket object across a reconnect, but the SERVER-side room
// membership is per-connection and is lost every time the transport drops
// and re-establishes (flaky wifi, laptop sleep, backend restart, etc). Without
// replaying these joins on "connect", a reconnected client silently stops
// receiving group:message / typing / file events for every group until the
// user navigates away and back.
const joinedGroups = new Set();

export const connectSocket = () => {
  if (socket) return socket;
  const token = getToken();
  const serverUrl = API_URL.replace(/\/api$/, "");
  socket = io(serverUrl, {
    auth: { token },
    transports: ["websocket", "polling"],
    withCredentials: true,
  });
  // Fires on the initial connect AND again after every automatic reconnect.
  socket.on("connect", () => {
    joinedGroups.forEach((groupId) => socket.emit("group:join", groupId));
  });
  return socket;
};

export const disconnectSocket = () => {
  if (!socket) return;
  socket.disconnect();
  socket = null;
  joinedGroups.clear();
};

export const joinGroupRoom = (groupId) => {
  if (!groupId) return;
  joinedGroups.add(groupId);
  if (!socket) return;
  socket.emit("group:join", groupId);
};

export const leaveGroupRoom = (groupId) => {
  if (!groupId) return;
  joinedGroups.delete(groupId);
  if (!socket) return;
  socket.emit("group:leave", groupId);
};

export const onGroupEvent = (event, handler) => {
  if (!socket) return () => {};
  socket.on(event, handler);
  return () => {
    if (socket) {
      socket.off(event, handler);
    }
  };
};

export const onUserEvent = (event, handler) => {
  if (!socket) return () => {};
  socket.on(event, handler);
  return () => {
    if (socket) {
      socket.off(event, handler);
    }
  };
};
