import { Phone, PhoneOff, Video } from "lucide-react";
import { getInitials } from "../../utils/helperFunctions";

/**
 * Full-screen incoming call prompt. Rendered by CallOverlay only when
 * call.status === "RINGING" and call.direction === "incoming" — i.e. only
 * ever for a private/direct call, never a group one (see CallOverlay.jsx).
 */
const IncomingCallModal = ({ peer, type, onAccept, onReject }) => (
  <div
    className="fixed inset-0 z-[100] bg-slate-ink/70 backdrop-blur-sm flex items-center justify-center px-4"
    role="dialog"
    aria-modal="true"
    aria-label={`Incoming ${type} call from ${peer.name}`}
  >
    <div className="bg-paper rounded-xl2 shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center gap-4">
      <span
        className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-semibold"
        style={{ backgroundColor: peer.color || "#5B5FEF" }}
      >
        {peer.avatar ? (
          <img src={peer.avatar} alt="" className="w-20 h-20 rounded-full object-cover" />
        ) : (
          getInitials(peer.name || "?")
        )}
      </span>
      <div>
        <p className="text-lg font-semibold text-slate-ink">{peer.name || "Unknown user"}</p>
        <p className="text-sm text-slate-muted flex items-center justify-center gap-1.5 mt-1">
          {type === "video" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          Incoming {type === "video" ? "video" : "voice"} call
        </p>
      </div>

      <div className="flex items-center gap-6 mt-4">
        <button
          onClick={onReject}
          aria-label="Reject call"
          className="w-14 h-14 rounded-full bg-coral text-white flex items-center justify-center shadow-lg hover:bg-coral/90 transition-colors focus:outline-none focus:ring-2 focus:ring-coral focus:ring-offset-2"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
        <button
          onClick={onAccept}
          aria-label="Accept call"
          className="w-14 h-14 rounded-full bg-mint text-white flex items-center justify-center shadow-lg hover:bg-mint/90 transition-colors focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2"
        >
          {type === "video" ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
        </button>
      </div>
    </div>
  </div>
);

export default IncomingCallModal;
