import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../hooks/useAuth";
import { createPeerConnection, getLocalMedia, stopStream, isWebRTCSupported } from "../services/webrtc";

export const CallContext = createContext(null);

/**
 * PRIVATE VOICE/VIDEO CALLING — state machine
 * =============================================
 * IDLE -> CALLING -> (ACCEPTED) -> CONNECTING -> CONNECTED -> ENDED
 *                  -> REJECTED / MISSED / CANCELLED / FAILED
 *      -> RINGING (incoming) -> ACCEPTED -> CONNECTING -> CONNECTED -> ENDED
 *
 * This is deliberately the ONLY place in the frontend that touches
 * RTCPeerConnection / getUserMedia / the private-call:* socket events. It is
 * mounted once at the app root (see routes/__root.tsx) specifically so an
 * incoming call can still ring even if the recipient isn't currently on the
 * private-chat page with that peer — exactly like the existing
 * `notification:new` / `direct:message` events already reach the user
 * app-wide via the same `user:${uid}` socket room.
 *
 * Deliberately never wired into any group context, group route, or group
 * socket room — see sockets/callSignaling.js on the backend for the
 * matching guarantee server-side.
 */
export const CallProvider = ({ children }) => {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [call, setCall] = useState(null); // { callId, peer, type, direction, status, startedAt }
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const callRef = useRef(null); // mirrors `call` for use inside socket callbacks without stale closures
  const pendingCandidatesRef = useRef([]); // ICE candidates that arrive before remoteDescription is set

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const cleanupMedia = useCallback(() => {
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    pcRef.current?.close();
    pcRef.current = null;
    pendingCandidatesRef.current = [];
    setMuted(false);
    setCameraOff(false);
  }, []);

  /** Moves to a terminal state, cleans up media, and auto-clears the call banner shortly after. */
  const settle = useCallback(
    (status, extra = {}) => {
      setCall((prev) => (prev ? { ...prev, status, ...extra } : prev));
      cleanupMedia();
      const clearAfter = status === "CONNECTED" ? 0 : 4000;
      setTimeout(() => {
        setCall((prev) => (prev && prev.status === status ? null : prev));
      }, clearAfter);
    },
    [cleanupMedia]
  );

  const attachPeerConnectionHandlers = useCallback(
    (pc, callId) => {
      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket?.emit("private-call:ice-candidate", { callId, candidate: event.candidate });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          socket?.emit("private-call:connected", { callId });
          setCall((prev) => (prev && prev.callId === callId ? { ...prev, status: "CONNECTED", startedAt: prev.startedAt || Date.now() } : prev));
        } else if (pc.connectionState === "failed") {
          socket?.emit("private-call:failed", { callId, reason: "ice-failed" });
          setError("Unable to establish the call. Please try again.");
          settle("FAILED");
        }
      };
    },
    [socket, settle]
  );

  // ---- Outgoing call ----
  const startCall = useCallback(
    async (peer, type) => {
      if (!socket || callRef.current) return; // one active call at a time (also enforced server-side)
      if (!peer || !peer.id) return;
      if (user?.id && String(peer.id) === String(user.id)) {
        setError("You cannot start a call with yourself.");
        return;
      }
      setError(null);
      try {
        const stream = await getLocalMedia(type);
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (err) {
        setError(err.message);
        return;
      }

      socket.emit("private-call:call", { toUserId: peer.id, type }, (ack) => {
        if (!ack?.ok) {
          setError(ack?.error || "Unable to start the call.");
          cleanupMedia();
          return;
        }
        setCall({ callId: ack.callId, peer, type, direction: "outgoing", status: "CALLING", startedAt: null });
      });
    },
    [socket, cleanupMedia]
  );

  const cancelCall = useCallback(() => {
    if (!call) return;
    socket?.emit("private-call:cancel", { callId: call.callId });
    settle("CANCELLED");
  }, [call, socket, settle]);

  // ---- Incoming call ----
  const acceptCall = useCallback(async () => {
    if (!call || call.direction !== "incoming") return;
    setError(null);
    try {
      const stream = await getLocalMedia(call.type);
      localStreamRef.current = stream;
      setLocalStream(stream);
    } catch (err) {
      setError(err.message);
      socket?.emit("private-call:reject", { callId: call.callId });
      settle("FAILED");
      return;
    }
    socket?.emit("private-call:accept", { callId: call.callId }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || "Unable to answer the call.");
        settle("FAILED");
        return;
      }
      setCall((prev) => (prev ? { ...prev, status: "ACCEPTED" } : prev));
    });
  }, [call, socket, settle]);

  const rejectCall = useCallback(() => {
    if (!call) return;
    socket?.emit("private-call:reject", { callId: call.callId });
    settle("REJECTED");
  }, [call, socket, settle]);

  const endCall = useCallback(() => {
    if (!call) return;
    socket?.emit("private-call:end", { callId: call.callId });
    settle("ENDED");
  }, [call, socket, settle]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCameraOff(next);
  }, [cameraOff]);

  // ---- The caller creates the offer once the callee has accepted ----
  const createOfferAsCaller = useCallback(
    async (callId) => {
      const pc = createPeerConnection();
      pcRef.current = pc;
      attachPeerConnectionHandlers(pc, callId);
      localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket?.emit("private-call:offer", { callId, sdp: offer });
    },
    [socket, attachPeerConnectionHandlers]
  );

  const handleOfferAsCallee = useCallback(
    async (callId, sdp) => {
      const pc = createPeerConnection();
      pcRef.current = pc;
      attachPeerConnectionHandlers(pc, callId);
      localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
      await pc.setRemoteDescription(sdp);
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* stale/duplicate candidate — safe to ignore */
        }
      }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit("private-call:answer", { callId, sdp: answer });
      setCall((prev) => (prev && prev.callId === callId ? { ...prev, status: "CONNECTING" } : prev));
    },
    [socket, attachPeerConnectionHandlers]
  );

  // ---- Socket event wiring ----
  useEffect(() => {
    if (!socket) return undefined;

    const isCurrent = (callId) => callRef.current?.callId === callId;

    const onIncoming = ({ callId, fromUserId, fromUser, type }) => {
      if (callRef.current) {
        // Already on a call or ringing — notify server we're busy
        socket?.emit("private-call:reject", { callId, reason: "busy" });
        return;
      }
      setError(null);
      const peerData = fromUser
        ? { id: fromUserId, name: fromUser.name, avatar: fromUser.avatar, color: fromUser.color }
        : { id: fromUserId };
      setCall({
        callId,
        peer: peerData,
        type,
        direction: "incoming",
        status: "RINGING",
        startedAt: null,
      });
    };

    const onAccepted = ({ callId }) => {
      if (!isCurrent(callId)) return;
      setCall((prev) => ({ ...prev, status: "CONNECTING" }));
      createOfferAsCaller(callId);
    };

    const onRejected = ({ callId }) => {
      if (!isCurrent(callId)) return;
      settle("REJECTED");
    };

    const onCancelled = ({ callId }) => {
      if (!isCurrent(callId)) return;
      settle("CANCELLED");
    };

    const onEnded = ({ callId }) => {
      if (!isCurrent(callId)) return;
      settle("ENDED");
    };

    const onMissed = ({ callId }) => {
      if (!isCurrent(callId)) return;
      settle("MISSED");
    };

    const onFailed = ({ callId }) => {
      if (!isCurrent(callId)) return;
      setError("Unable to establish the call. Please try again.");
      settle("FAILED");
    };

    const onOffer = ({ callId, sdp }) => {
      if (!isCurrent(callId) || callRef.current.status !== "ACCEPTED") return;
      handleOfferAsCallee(callId, sdp);
    };

    const onAnswer = async ({ callId, sdp }) => {
      if (!isCurrent(callId) || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(sdp);
        for (const candidate of pendingCandidatesRef.current) {
          try {
            await pcRef.current.addIceCandidate(candidate);
          } catch {
            /* stale or duplicate candidate */
          }
        }
        pendingCandidatesRef.current = [];
        setCall((prev) => (prev && prev.callId === callId ? { ...prev, status: "CONNECTING" } : prev));
      } catch (err) {
        console.error("[CallContext] onAnswer setRemoteDescription error:", err);
      }
    };

    const onIceCandidate = async ({ callId, candidate }) => {
      if (!isCurrent(callId)) return;
      if (!pcRef.current || !pcRef.current.remoteDescription) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await pcRef.current.addIceCandidate(candidate);
      } catch {
        /* duplicate/out-of-order candidate — safe to ignore */
      }
    };

    socket.on("private-call:incoming", onIncoming);
    socket.on("private-call:accepted", onAccepted);
    socket.on("private-call:rejected", onRejected);
    socket.on("private-call:cancelled", onCancelled);
    socket.on("private-call:ended", onEnded);
    socket.on("private-call:missed", onMissed);
    socket.on("private-call:failed", onFailed);
    socket.on("private-call:offer", onOffer);
    socket.on("private-call:answer", onAnswer);
    socket.on("private-call:ice-candidate", onIceCandidate);

    return () => {
      socket.off("private-call:incoming", onIncoming);
      socket.off("private-call:accepted", onAccepted);
      socket.off("private-call:rejected", onRejected);
      socket.off("private-call:cancelled", onCancelled);
      socket.off("private-call:ended", onEnded);
      socket.off("private-call:missed", onMissed);
      socket.off("private-call:failed", onFailed);
      socket.off("private-call:offer", onOffer);
      socket.off("private-call:answer", onAnswer);
      socket.off("private-call:ice-candidate", onIceCandidate);
    };
  }, [socket, settle, createOfferAsCaller, handleOfferAsCallee]);

  // Browser refresh / tab close: best-effort tell the peer, then release
  // hardware immediately rather than waiting on the server's disconnect
  // handler. The server-side cleanup (sockets/index.js `disconnect`) is the
  // authoritative backstop if this never fires (e.g. the tab is killed).
  useEffect(() => {
    const onBeforeUnload = () => {
      const current = callRef.current;
      if (!current || !socket) return;
      const event =
        current.status === "CALLING" || current.status === "RINGING"
          ? current.direction === "outgoing"
            ? "private-call:cancel"
            : "private-call:reject"
          : "private-call:end";
      socket.emit(event, { callId: current.callId });
      stopStream(localStreamRef.current);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [socket]);

  // Component unmount safety net (root-mounted, so this mainly matters for
  // fast-refresh in dev, but costs nothing to keep).
  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <CallContext.Provider
      value={{
        call,
        localStream,
        remoteStream,
        muted,
        cameraOff,
        error,
        clearError,
        webrtcSupported: isWebRTCSupported(),
        startCall,
        cancelCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMute,
        toggleCamera,
        currentUserId: user?.id,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};
