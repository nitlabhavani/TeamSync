import { AlertTriangle } from "lucide-react";
import { useCall } from "../../hooks/useCall";
import { getUserById } from "../../services/userDirectory";
import IncomingCallModal from "./IncomingCallModal";
import ActiveCall from "./ActiveCall";

/**
 * Mounted once at the app root (see routes/__root.tsx). Renders nothing for
 * 99% of the app's lifetime — only appears while `call` is non-null, which
 * only ever happens via CallContext's private-call:* socket handlers or
 * SingleChat's call buttons. GroupChat never calls startCall and never
 * emits private-call:*, so this overlay can never be triggered from a group
 * chat — see ChatHeader.jsx / SingleChat.jsx / GroupChat.jsx for the other
 * half of that guarantee.
 */
const CallOverlay = () => {
  const {
    call,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    error,
    clearError,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    toggleMute,
    toggleCamera,
  } = useCall();

  if (!call) {
    // Setup failures (permission denied, no device, unsupported browser)
    // happen before a call session ever exists, so there's no ActiveCall to
    // show them in — surface a small dismissible toast instead of silently
    // failing.
    if (!error) return null;
    return (
      <div className="fixed bottom-4 inset-x-0 z-[100] flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto flex items-start gap-2 bg-paper border border-coral/30 text-coral text-sm rounded-xl2 shadow-lg px-4 py-3 max-w-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={clearError} aria-label="Dismiss" className="text-coral/70 hover:text-coral">
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Incoming calls only carry the peer's id over the wire — resolve the
  // rest (name/avatar/color) from the same in-memory directory the rest of
  // chat already uses (see PrivateChat.jsx / SingleChat.jsx).
  const peer = { ...getUserById(call.peer.id), ...call.peer };
  const resolvedCall = { ...call, peer };

  if (call.status === "RINGING" && call.direction === "incoming") {
    return <IncomingCallModal peer={peer} type={call.type} onAccept={acceptCall} onReject={rejectCall} />;
  }

  return (
    <ActiveCall
      call={resolvedCall}
      localStream={localStream}
      remoteStream={remoteStream}
      muted={muted}
      cameraOff={cameraOff}
      error={error}
      onCancel={cancelCall}
      onEnd={endCall}
      onToggleMute={toggleMute}
      onToggleCamera={toggleCamera}
      onDismissError={clearError}
    />
  );
};

export default CallOverlay;
