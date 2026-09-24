import { ArrowLeft, Info, ShieldCheck, Sparkles, Phone, Video } from "lucide-react";
import { getInitials } from "../../utils/helperFunctions";
import OnlineMembers from "./OnlineMembers";
import { Link } from "@/lib/router-compat";

const ChatHeader = ({
  title,
  subtitle,
  color = "#5B5FEF",
  isGroup,
  members = [],
  backTo,
  onBack,
  aiScore,
  // PRIVATE CHAT CALLING — onVoiceCall/onVideoCall are only ever passed by
  // SingleChat.jsx (private chat). GroupChat.jsx passes neither, and this
  // component additionally never renders the buttons when isGroup is true
  // regardless of what's passed in, so a future accidental wiring mistake
  // in a group screen still can't put call buttons in a group header.
  onVoiceCall,
  onVideoCall,
  callDisabled = false,
  callDisabledReason,
}) => {
  const showCallButtons = !isGroup && (onVoiceCall || onVideoCall);
  return (
    <div className="flex items-center gap-3 border-b border-slate-line bg-paper px-3 sm:px-5 py-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="md:hidden w-8 h-8 rounded-full hover:bg-cloud flex items-center justify-center shrink-0 -ml-1 text-slate-ink"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      ) : backTo ? (
        <Link
          to={backTo}
          aria-label="Back"
          className="md:hidden w-8 h-8 rounded-full hover:bg-cloud flex items-center justify-center shrink-0 -ml-1 text-slate-ink"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
      ) : null}
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
        style={{ backgroundColor: color }}
      >
        {getInitials(title)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-ink truncate">{title}</p>
        <p className="text-xs text-slate-muted truncate">{subtitle}</p>
      </div>

      {isGroup ? (
        <>
          <OnlineMembers members={members} />
          {typeof aiScore === "number" && (
            <span className="hidden sm:flex items-center gap-1.5 bg-brand-soft text-brand-deep text-xs font-semibold px-2.5 py-1.5 rounded-full ml-1">
              <Sparkles className="w-3.5 h-3.5" /> {aiScore}
            </span>
          )}
        </>
      ) : (
        <span className="hidden sm:flex items-center gap-1.5 bg-mint-soft text-mint text-xs font-semibold px-2.5 py-1.5 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5" /> Private &amp; not analyzed
        </span>
      )}

      {showCallButtons && (
        <div className="flex items-center gap-1.5">
          {onVoiceCall && (
            <button
              onClick={onVoiceCall}
              disabled={callDisabled}
              aria-label="Start voice call"
              title={callDisabled && callDisabledReason ? callDisabledReason : "Voice call"}
              className="w-8 h-8 rounded-full hover:bg-cloud disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <Phone className="w-4 h-4 text-slate-ink" />
            </button>
          )}
          {onVideoCall && (
            <button
              onClick={onVideoCall}
              disabled={callDisabled}
              aria-label="Start video call"
              title={callDisabled && callDisabledReason ? callDisabledReason : "Video call"}
              className="w-8 h-8 rounded-full hover:bg-cloud disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <Video className="w-4 h-4 text-slate-ink" />
            </button>
          )}
        </div>
      )}

      <button className="w-8 h-8 rounded-full hover:bg-cloud flex items-center justify-center">
        <Info className="w-4 h-4 text-slate-muted" />
      </button>
    </div>
  );
};

export default ChatHeader;
