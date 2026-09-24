const crypto = require("crypto");
const User = require("../models/User");
const ApiError = require("../utils/apiError");

/**
 * PRIVATE CALL AUTHORIZATION + SESSION STATE
 * ===========================================
 *
 * This mirrors the existing direct-message authorization model in
 * chatController (sendDirectMessage/directMessages): any two authenticated,
 * active users may reach each other 1:1 — there is no separate "friends" or
 * "shared group" gate in this codebase for private chat, so calling does not
 * invent a stricter rule than messaging already has. What this DOES add on
 * top of that baseline is everything messaging never needed: caller !=
 * target, target must exist and be active, and — critically — a call must
 * never be reachable through a group route or a group id (see
 * validateCallTarget below, which only ever accepts two bare user ids).
 *
 * Call state itself is intentionally NOT persisted to MongoDB while a call
 * is ringing/active — it lives in this in-memory map, keyed by callId, for
 * the lifetime of the process. Only the final outcome (see
 * models/CallLog.js) is written once a call ends, and only minimal
 * metadata — never media, never signaling payloads.
 */

const STATES = Object.freeze({
  RINGING: "RINGING",
  ACCEPTED: "ACCEPTED",
  CONNECTED: "CONNECTED",
  ENDED: "ENDED",
  REJECTED: "REJECTED",
  MISSED: "MISSED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
});

const RING_TIMEOUT_MS = 45_000;

/**
 * callId -> { callId, callerId, calleeId, type, state, createdAt, timer }
 * userId -> callId (enforces "only one active private call session per user")
 */
class CallSessionManager {
  constructor() {
    this.sessions = new Map();
    this.userToCall = new Map();
  }

  /** True if this user is already in a non-terminal call session. */
  isUserBusy(userId) {
    const callId = this.userToCall.get(String(userId));
    if (!callId) return false;
    const session = this.sessions.get(callId);
    return !!session && this._isActive(session.state);
  }

  _isActive(state) {
    return state === STATES.RINGING || state === STATES.ACCEPTED || state === STATES.CONNECTED;
  }

  getSession(callId) {
    return this.sessions.get(callId) || null;
  }

  getActiveCallIdForUser(userId) {
    return this.userToCall.get(String(userId)) || null;
  }

  /**
   * Starts a new ringing session between callerId and calleeId. Throws if
   * either participant already has an active call — this is what enforces
   * "only one active private call session per user" and "no duplicate call
   * attempts" (see race-condition requirements in the spec).
   */
  create({ callerId, calleeId, type, onRingTimeout }) {
    callerId = String(callerId);
    calleeId = String(calleeId);
    if (this.isUserBusy(callerId)) throw ApiError.badRequest("You already have an active call");
    if (this.isUserBusy(calleeId)) throw ApiError.badRequest("User is on another call");

    const callId = crypto.randomUUID();
    const session = {
      callId,
      callerId,
      calleeId,
      type,
      state: STATES.RINGING,
      createdAt: Date.now(),
      acceptedAt: null,
      connectedAt: null,
    };
    session.timer = setTimeout(() => {
      const current = this.sessions.get(callId);
      if (current && current.state === STATES.RINGING) {
        current.state = STATES.MISSED;
        onRingTimeout?.(current);
        this._release(current);
      }
    }, RING_TIMEOUT_MS);
    if (session.timer.unref) session.timer.unref();

    this.sessions.set(callId, session);
    this.userToCall.set(callerId, callId);
    this.userToCall.set(calleeId, callId);
    return session;
  }

  /** Only a participant may transition a call's state. Returns the updated session. */
  transition(callId, userId, nextState, allowedFrom) {
    const session = this.sessions.get(callId);
    if (!session) throw ApiError.notFound("Call session not found");
    const uid = String(userId);
    if (uid !== session.callerId && uid !== session.calleeId) {
      throw ApiError.forbidden("Not a participant of this call");
    }
    if (!allowedFrom.includes(session.state)) {
      // Stale/duplicate/out-of-order signaling event — ignore rather than throw,
      // so a duplicate accept/reject/cancel can never corrupt state.
      return session;
    }
    clearTimeout(session.timer);
    session.state = nextState;
    if (nextState === STATES.ACCEPTED) session.acceptedAt = Date.now();
    if (nextState === STATES.CONNECTED) session.connectedAt = Date.now();
    if (!this._isActive(nextState)) this._release(session);
    return session;
  }

  _release(session) {
    clearTimeout(session.timer);
    if (this.userToCall.get(session.callerId) === session.callId) this.userToCall.delete(session.callerId);
    if (this.userToCall.get(session.calleeId) === session.callId) this.userToCall.delete(session.calleeId);
    // Keep the terminal session around briefly for late duplicate events to
    // resolve against (transition() no-ops on non-allowed states); a full
    // sweep isn't required for correctness since callIds are single-use
    // UUIDs and the map is bounded by concurrent+recent call volume.
    setTimeout(() => this.sessions.delete(session.callId), 30_000).unref?.();
  }

  /** Force-ends any active call a (now-disconnected) user was part of. */
  endAllForUser(userId, resultState = STATES.ENDED) {
    const callId = this.getActiveCallIdForUser(userId);
    if (!callId) return null;
    const session = this.sessions.get(callId);
    if (!session) return null;
    const state = session.state === STATES.RINGING ? STATES.MISSED : resultState;
    clearTimeout(session.timer);
    session.state = state;
    this._release(session);
    return session;
  }
}

/**
 * Validates a bare {callerId, calleeId} pair. Deliberately takes only user
 * ids — there is no code path anywhere that lets a groupId stand in for one
 * of these, so "using a groupId to authorize a private call" is not a
 * partially-blocked case to sanitize, it's simply not an accepted shape.
 */
async function validateCallTarget(callerId, calleeId) {
  if (!callerId || !calleeId) throw ApiError.badRequest("Caller and callee are required");
  callerId = String(callerId);
  calleeId = String(calleeId);
  if (callerId === calleeId) throw ApiError.badRequest("Cannot call yourself");

  const callee = await User.findById(calleeId).select("_id isActive name avatar color");
  if (!callee || !callee.isActive) throw ApiError.notFound("User not found");
  return callee;
}

module.exports = {
  STATES,
  RING_TIMEOUT_MS,
  CallSessionManager,
  validateCallTarget,
};
