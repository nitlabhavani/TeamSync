import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, AlertTriangle } from "lucide-react";
import { getInitials } from "../../utils/helperFunctions";

const STATUS_LABEL = {
  CALLING: "Calling…",
  RINGING: "Ringing…",
  ACCEPTED: "Connecting…",
  CONNECTING: "Connecting…",
  CONNECTED: "",
  ENDED: "Call ended",
  REJECTED: "Call declined",
  MISSED: "No answer",
  CANCELLED: "Call cancelled",
  FAILED: "Call failed",
};

const formatDuration = (seconds) => {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
};

/** Attaches a MediaStream to a <video>/<audio> element (srcObject isn't a plain React prop). */
const useStreamRef = (stream) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return ref;
};

const CallDuration = ({ startedAt }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span>{formatDuration(elapsed)}</span>;
};

/**
 * Rendered by CallOverlay for every non-idle, non-incoming-ringing call
 * state — i.e. the caller's outgoing ring, the connecting phase, and the
 * live call itself (audio or video), plus a brief terminal-state banner.
 * Private-call only; see CallOverlay.jsx for where that's enforced.
 */
const ActiveCall = ({
  call,
  localStream,
  remoteStream,
  muted,
  cameraOff,
  error,
  onCancel,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onDismissError,
}) => {
  const localVideoRef = useStreamRef(localStream);
  const remoteVideoRef = useStreamRef(remoteStream);
  const remoteAudioRef = useStreamRef(call.type === "voice" ? remoteStream : null);

  const isTerminal = ["ENDED", "REJECTED", "MISSED", "CANCELLED", "FAILED"].includes(call.status);
  const isConnected = call.status === "CONNECTED";
  const isVideo = call.type === "video";

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-ink flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`${isVideo ? "Video" : "Voice"} call with ${call.peer.name || "peer"}`}
    >
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 text-white/90">
        <div>
          <p className="text-sm font-semibold">{call.peer.name || "Unknown user"}</p>
          <p className="text-xs text-white/60">
            {isConnected ? <CallDuration startedAt={call.startedAt} /> : STATUS_LABEL[call.status]}
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mb-2 flex items-start gap-2 bg-coral/20 border border-coral/40 text-coral-soft text-sm rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={onDismissError} aria-label="Dismiss error" className="text-coral-soft/80 hover:text-coral-soft">
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 relative flex items-center justify-center min-h-0">
        {isVideo ? (
          <>
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover bg-black" />
            {!remoteStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">
                <span
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-semibold"
                  style={{ backgroundColor: call.peer.color || "#5B5FEF" }}
                >
                  {getInitials(call.peer.name || "?")}
                </span>
                <p className="text-sm">{STATUS_LABEL[call.status] || "Connecting…"}</p>
              </div>
            )}
            <div className="absolute bottom-4 right-4 w-28 sm:w-40 aspect-video rounded-lg overflow-hidden border border-white/20 bg-black shadow-lg">
              {localStream && !cameraOff ? (
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/50 text-xs">Camera off</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 text-white">
            <audio ref={remoteAudioRef} autoPlay />
            <span
              className="w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-semibold"
              style={{ backgroundColor: call.peer.color || "#5B5FEF" }}
            >
              {getInitials(call.peer.name || "?")}
            </span>
            <p className="text-sm text-white/70">{isTerminal ? STATUS_LABEL[call.status] : null}</p>
          </div>
        )}
      </div>

      {!isTerminal && (
        <div className="flex items-center justify-center gap-5 py-6">
          {(isConnected || call.status === "ACCEPTED" || call.status === "CONNECTING") && (
            <button
              onClick={onToggleMute}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={muted}
              className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
          {isVideo && (isConnected || call.status === "ACCEPTED" || call.status === "CONNECTING") && (
            <button
              onClick={onToggleCamera}
              aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
              aria-pressed={cameraOff}
              className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={call.status === "CALLING" ? onCancel : onEnd}
            aria-label={call.status === "CALLING" ? "Cancel call" : "End call"}
            className="w-14 h-14 rounded-full bg-coral hover:bg-coral/90 text-white flex items-center justify-center shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-coral focus:ring-offset-2 focus:ring-offset-slate-ink"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ActiveCall;
