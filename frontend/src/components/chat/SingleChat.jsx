import { useEffect, useRef, useState } from "react";
import { Search, X, AlertTriangle, RefreshCw, MessagesSquare } from "lucide-react";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import ChatInput from "./ChatInput";
import ChatHeader from "./ChatHeader";
import { formatDay } from "../../utils/dateFormatter";
import { useCall } from "../../hooks/useCall";

const MessageSkeleton = () => (
  <div className="space-y-3 animate-pulse">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
        <div className={`h-9 rounded-2xl bg-slate-line/60 ${i % 2 === 0 ? "w-1/2" : "w-2/5"}`} />
      </div>
    ))}
  </div>
);

/** True when `a` and `b` (ISO/date-like values) fall on different calendar days. */
const isNewDay = (a, b) => {
  if (!b) return true;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() !== db.getFullYear() || da.getMonth() !== db.getMonth() || da.getDate() !== db.getDate()
  );
};

/**
 * `peer.dept`/`peer.role` are the same real directory fields Groups.jsx
 * already shows for a person (see services/userDirectory.js) — no presence/
 * online-status field exists anywhere in the app, so the header no longer
 * claims one.
 */
const peerSubtitle = (peer) => [peer.dept, peer.role].filter(Boolean).join(" · ") || "Direct message";

const SingleChat = ({
  peer,
  currentUserId,
  messages,
  isTyping,
  onSend,
  onTyping,
  onDelete,
  loading = false,
  error = null,
  onRetry,
  onBack,
  backTo = "/app/messages",
}) => {
  const bottomRef = useRef(null);
  const [query, setQuery] = useState("");
  // PRIVATE CHAT ONLY — SingleChat is never rendered for a group
  // conversation (see GroupChat.jsx, which renders its own header directly
  // and never imports SingleChat), so this is the sole place startCall is
  // ever wired up.
  const { call, webrtcSupported, startCall } = useCall();

  useEffect(() => {
    if (!query) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping, query]);

  const visible = query.trim()
    ? messages.filter((m) => (m.text || "").toLowerCase().includes(query.trim().toLowerCase()))
    : messages;

  return (
    <div className="flex flex-col h-full min-h-0 bg-cloud">
      <ChatHeader
        title={peer.name}
        subtitle={peerSubtitle(peer)}
        color={peer.color}
        isGroup={false}
        backTo={backTo}
        onBack={onBack}
        onVoiceCall={() => startCall(peer, "voice")}
        onVideoCall={() => startCall(peer, "video")}
        callDisabled={!!call || !webrtcSupported}
        callDisabledReason={!webrtcSupported ? "Calling isn't supported in this browser" : call ? "A call is already in progress" : undefined}
      />

      <div className="px-4 sm:px-6 pt-3">
        <div className="max-w-3xl mx-auto flex items-center gap-2 bg-paper border border-slate-line rounded-full px-3.5 py-2 focus-within:border-brand/50 transition-colors">
          <Search className="w-4 h-4 text-slate-muted shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages…"
            aria-label="Search messages in this conversation"
            className="flex-1 bg-transparent outline-none text-sm min-w-0"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search">
              <X className="w-4 h-4 text-slate-muted" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-5 min-h-0">
        <div className="max-w-3xl mx-auto">
          {loading ? (
            <MessageSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center text-center gap-2.5 border border-dashed border-coral/30 bg-coral-soft/60 rounded-xl2 py-10 px-6">
              <span className="w-10 h-10 rounded-full bg-paper flex items-center justify-center">
                <AlertTriangle className="w-4.5 h-4.5 text-coral" />
              </span>
              <p className="text-sm font-medium text-coral">Couldn't load this conversation</p>
              <p className="text-xs text-slate-muted max-w-xs">{error}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-full bg-paper border border-coral/30 px-3.5 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors mt-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              )}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-12 px-6">
              <span className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
                <MessagesSquare className="w-5 h-5 text-slate-muted" />
              </span>
              <p className="text-sm font-medium text-slate-ink">Start the conversation</p>
              <p className="text-xs text-slate-muted max-w-xs">
                Send {peer.name} a message — private chats are never analyzed by AI.
              </p>
            </div>
          ) : (
            <>
              {query && (
                <p className="text-xs text-slate-muted mb-3">
                  {visible.length} message{visible.length === 1 ? "" : "s"} matching “{query}”
                </p>
              )}
              {visible.length === 0 && query && (
                <p className="text-sm text-slate-muted text-center py-8">No messages match “{query}”.</p>
              )}
              {visible.map((msg, idx) => {
                const isOwn = msg.senderId === currentUserId;
                const prev = visible[idx - 1];
                const showDateSeparator = !query && isNewDay(msg.time, prev?.time);
                return (
                  <div key={msg.id}>
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-4" role="separator">
                        <span className="text-[11px] font-medium text-slate-muted bg-paper border border-slate-line rounded-full px-3 py-1">
                          {formatDay(msg.time)}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      message={msg}
                      isOwn={isOwn}
                      sender={peer}
                      onDelete={onDelete}
                      readByOthers={(msg.readBy || []).some((r) => String(r) !== String(currentUserId))}
                    />
                  </div>
                );
              })}
              {isTyping && !query && <TypingIndicator name={peer.name} />}
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput
        onSend={onSend}
        onTyping={onTyping}
        placeholder={`Message ${peer.name}…`}
        peerUserId={peer.id}
        currentUserId={currentUserId}
        scope="direct"
      />
    </div>
  );
};

export default SingleChat;
