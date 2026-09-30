const { Server } = require("socket.io");
const { verifyAccessToken } = require("../utils/token");
const Group = require("../models/Group");
const User = require("../models/User");
const { setSocketServer } = require("../services/socketService");
const { registerCallSignaling } = require("./callSignaling");
const { isOriginAllowed } = require("../config/cors");

/** True if the socket's user is a member, the guide, or an admin for this group. */
async function canAccessGroup(socket, groupId) {
  if (!groupId) return false;
  const group = await Group.findById(groupId).select("members guide");
  if (!group) return false;
  const uid = String(socket.user.sub);
  const isMember = group.members.some((m) => String(m) === uid);
  const isGuide = String(group.guide) === uid;
  return isMember || isGuide || socket.user.role === "admin";
}

// Tracks how many live sockets each user currently has open (one per browser
// tab/device). Presence must only flip to "online" on the FIRST connection
// and only flip back to "offline" once the LAST one disconnects -- otherwise
// closing one tab reports a user offline while they're still connected in
// another, and stale offline flickers show up during normal navigation.
const onlineSockets = new Map(); // userId -> Set<socketId>

/** Realtime group chat, typing indicators and presence. */
module.exports = function registerSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Socket origin not allowed by CORS"));
        }
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  setSocketServer(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = verifyAccessToken(token);
      // Mirror the REST `protect` middleware: a signed, still-valid JWT for a
      // deactivated/deleted account should not be enough to open (or keep
      // open) a live socket connection.
      const user = await User.findById(payload.sub).select("isActive");
      if (!user || !user.isActive) return next(new Error("Unauthorized socket connection"));
      socket.user = payload;
      next();
    } catch {
      next(new Error("Unauthorized socket connection"));
    }
  });

  io.on("connection", (socket) => {
    const uid = String(socket.user.sub);
    socket.join(`user:${uid}`);

    let sockets = onlineSockets.get(uid);
    if (!sockets) {
      sockets = new Set();
      onlineSockets.set(uid, sockets);
    }
    const wasOnline = sockets.size > 0;
    sockets.add(socket.id);
    if (!wasOnline) {
      io.emit("presence", { userId: uid, online: true });
    }

    socket.on("group:join", async (groupId, ack) => {
      try {
        if (!(await canAccessGroup(socket, groupId))) return ack?.({ ok: false, error: "Not authorized for this group" });
        socket.join(`group:${groupId}`);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });
    socket.on("group:leave", (groupId) => socket.leave(`group:${groupId}`));

    // NOTE: message creation intentionally happens over REST only
    // (chatController.sendGroupMessage / sendDirectMessage), which persists
    // to MongoDB, emits `group:message` / `direct:message` via
    // socketService, and fires notifyUsers() in one place. The frontend
    // (chatService.sendMessage) always posts to that REST endpoint and never
    // emits `group:message`/`direct:message` over the socket, so parallel
    // socket.on handlers for those two events were unreachable dead code
    // that duplicated (and could drift from) the REST path -- if ever
    // triggered they would create a second Message document per send and
    // skip the notification fan-out. Removed rather than kept as an unused,
    // divergent listener.

    socket.on("typing", async ({ groupId, isTyping }) => {
      if (!(await canAccessGroup(socket, groupId))) return;
      socket.to(`group:${groupId}`).emit("typing", { userId: uid, groupId, isTyping });
    });

    socket.on("typing:direct", ({ toUserId, isTyping }) => {
      if (!toUserId) return;
      socket.to(`user:${toUserId}`).emit("typing:direct", { userId: uid, isTyping });
    });

    // PRIVATE VOICE/VIDEO CALLING — scoped to `user:${uid}` rooms exactly
    // like typing:direct above. Deliberately registered here (never inside
    // group:join/group:leave) and never touches a `group:*` room — see
    // sockets/callSignaling.js for the full authorization + privacy model.
    registerCallSignaling(io, socket);

    socket.on("disconnect", () => {
      const set = onlineSockets.get(uid);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) {
        onlineSockets.delete(uid);
        io.emit("presence", { userId: uid, online: false });
      }
    });
  });

  return io;
};
