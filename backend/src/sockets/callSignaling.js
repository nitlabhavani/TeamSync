const CallLog = require("../models/CallLog");
const User = require("../models/User");
const { notifyUsers } = require("../services/notificationService");
const { CallSessionManager, STATES, validateCallTarget } = require("../services/callService");

/**
 * PRIVATE VOICE/VIDEO CALL SIGNALING
 * ===================================
 *
 * Reuses the existing authenticated socket connection (see sockets/index.js
 * — `socket.user` is already verified there, and every socket already sits
 * in a `user:${uid}` room). No new auth mechanism, no new transport: this
 * module only adds a handful of event handlers scoped to those same
 * per-user rooms, exactly like the existing `typing:direct` event.
 *
 * Every event is scoped to exactly the two participants of a given callId —
 * never `io.emit`, never a group room, never broadcast. A user cannot act on
 * a call they are not part of (see CallSessionManager.transition).
 *
 * This module is intentionally NEVER wired into group rooms, group
 * controllers, or any AI pipeline. Nothing here writes a Message document,
 * calls processGroupMessageForTasks, analyzeGroupMessageForConflicts, or any
 * other group/AI hook — see FINAL_PRIVATE_CALL_REPORT.md "Privacy model".
 */

const manager = new CallSessionManager();

async function persistCallLog(session, extra = {}) {
  try {
    await CallLog.create({
      caller: session.callerId,
      receiver: session.calleeId,
      type: session.type,
      status: extra.status || session.state.toLowerCase(),
      startedAt: session.acceptedAt ? new Date(session.acceptedAt) : null,
      endedAt: new Date(),
      durationSeconds: session.connectedAt ? Math.max(0, Math.round((Date.now() - session.connectedAt) / 1000)) : 0,
    });
  } catch (err) {
    // Call history is a nice-to-have, never allowed to break signaling itself.
    // eslint-disable-next-line no-console
    console.error(`[call] failed to persist call log for ${session.callId}: ${err.message}`);
  }
}

async function notifyMissed(session) {
  await persistCallLog(session, { status: "missed" });
  let link = `/app/chat/${session.callerId}`;
  try {
    const callee = await User.findById(session.calleeId).select("role").lean();
    if (callee?.role === "guide" || callee?.role === "admin") {
      link = `/guide/chat/${session.callerId}`;
    }
  } catch {
    /* fallback to /app/chat */
  }
  await notifyUsers([session.calleeId], {
    title: "Missed call",
    type: "call",
    body: `You missed a ${session.type} call`,
    link,
  });
}

/** Registers private-call:* handlers on a single already-authenticated socket. */
function registerCallSignaling(io, socket) {
  const uid = String(socket.user.sub);

  const emitToUser = (userId, event, payload) => io.to(`user:${userId}`).emit(event, payload);

  const otherParty = (session) => (session.callerId === uid ? session.calleeId : session.callerId);

  socket.on("private-call:call", async ({ toUserId, type }, ack) => {
    try {
      if (!["voice", "video"].includes(type)) return ack?.({ ok: false, error: "Invalid call type" });
      await validateCallTarget(uid, toUserId);

      const session = manager.create({
        callerId: uid,
        calleeId: toUserId,
        type,
        onRingTimeout: (s) => {
          emitToUser(s.callerId, "private-call:missed", { callId: s.callId });
          emitToUser(s.calleeId, "private-call:missed", { callId: s.callId });
          notifyMissed(s);
        },
      });

      const caller = await User.findById(uid).select("name avatar color");
      emitToUser(toUserId, "private-call:incoming", {
        callId: session.callId,
        fromUserId: uid,
        fromUser: {
          id: uid,
          name: caller?.name || "Team Member",
          avatar: caller?.avatar || null,
          color: caller?.color || "#5B5FEF",
        },
        type,
      });
      ack?.({ ok: true, callId: session.callId });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("private-call:accept", ({ callId }, ack) => {
    try {
      const session = manager.transition(callId, uid, STATES.ACCEPTED, [STATES.RINGING]);
      emitToUser(otherParty(session), "private-call:accepted", { callId });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("private-call:reject", ({ callId }, ack) => {
    try {
      const session = manager.transition(callId, uid, STATES.REJECTED, [STATES.RINGING]);
      emitToUser(otherParty(session), "private-call:rejected", { callId });
      persistCallLog(session, { status: "rejected" });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("private-call:cancel", ({ callId }, ack) => {
    try {
      const session = manager.transition(callId, uid, STATES.CANCELLED, [STATES.RINGING]);
      emitToUser(otherParty(session), "private-call:cancelled", { callId });
      persistCallLog(session, { status: "cancelled" });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on("private-call:end", ({ callId }, ack) => {
    try {
      const session = manager.getSession(callId);
      const wasConnected = session?.state === STATES.CONNECTED || session?.state === STATES.ACCEPTED;
      const ended = manager.transition(callId, uid, STATES.ENDED, [STATES.ACCEPTED, STATES.CONNECTED]);
      emitToUser(otherParty(ended), "private-call:ended", { callId });
      if (wasConnected) persistCallLog(ended, { status: "ended" });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  // Signals the media connection actually came up (post offer/answer/ICE).
  socket.on("private-call:connected", ({ callId }) => {
    const session = manager.getSession(callId);
    if (!session) return;
    manager.transition(callId, uid, STATES.CONNECTED, [STATES.ACCEPTED]);
  });

  socket.on("private-call:failed", ({ callId, reason }) => {
    try {
      const session = manager.transition(callId, uid, STATES.FAILED, [
        STATES.RINGING,
        STATES.ACCEPTED,
        STATES.CONNECTED,
      ]);
      emitToUser(otherParty(session), "private-call:failed", { callId, reason });
      persistCallLog(session, { status: "failed" });
    } catch {
      /* stale callId — nothing to clean up */
    }
  });

  // ---- WebRTC signaling passthrough (offer/answer/ICE) ----
  // These never touch call *state* — they are just relayed to the other
  // participant of this specific callId, after verifying the sender is
  // actually one of its two participants.
  const relay = (event) => (payload = {}) => {
    const { callId } = payload;
    const session = manager.getSession(callId);
    if (!session) return; // stale/unknown call — drop silently
    if (uid !== session.callerId && uid !== session.calleeId) return; // not a participant
    emitToUser(otherParty(session), event, { ...payload, fromUserId: uid });
  };
  socket.on("private-call:offer", relay("private-call:offer"));
  socket.on("private-call:answer", relay("private-call:answer"));
  socket.on("private-call:ice-candidate", relay("private-call:ice-candidate"));

  // Browser refresh / navigation-away / tab close / connection drop: end
  // whatever call this socket's user was part of rather than leaving stale
  // RINGING/CONNECTED state behind.
  socket.on("disconnect", () => {
    const session = manager.endAllForUser(uid);
    if (!session) return;
    const other = otherParty(session);
    if (session.state === STATES.MISSED) {
      emitToUser(other, "private-call:missed", { callId: session.callId });
      notifyMissed(session);
    } else {
      emitToUser(other, "private-call:ended", { callId: session.callId, reason: "peer-disconnected" });
      persistCallLog(session, { status: "ended" });
    }
  });
}

module.exports = { registerCallSignaling, manager };
