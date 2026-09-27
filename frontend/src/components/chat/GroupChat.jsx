import { useEffect, useRef, useState } from "react";
import { Search, X, AlertTriangle, RefreshCw, MessagesSquare } from "lucide-react";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import ChatInput from "./ChatInput";
import ChatHeader from "./ChatHeader";
import GroupChatBackground from "../animations/GroupChatBackground";
import { formatDay } from "../../utils/dateFormatter";
import { createHighlightController } from "../../utils/highlightController";

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

const GroupChat = ({
  group,
  members,
  currentUserId,
  messages,
  isTyping,
  onSend,
  onTyping,
  onDelete,
  loading = false,
  error = null,
  onRetry,
  highlightMessageId = null,
  onHighlightShown,
}) => {
  const bottomRef = useRef(null);
  const messageRefs = useRef({});
  const [query, setQuery] = useState("");
  const [activeHighlightId, setActiveHighlightId] = useState(null);
  // The highlight-clear timer's lifecycle lives entirely in this
  // controller (frontend/src/utils/highlightController.js), independent of
  // React props/effect dependencies — see its file header for why that's
  // required to fix the "highlight never clears" bug.
  const highlightControllerRef = useRef(null);
  if (!highlightControllerRef.current) {
    highlightControllerRef.current = createHighlightController({ onChange: setActiveHighlightId });
  }

  useEffect(() => {
    if (!query) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping, query]);

  // STEP 34 (post-verification fix) — scroll to and briefly highlight the
  // exact message a notification pointed at.
  //
  // BUG FIXED: `onHighlightShown()` synchronously clears the parent's
  // `highlightMessageId`, which changes this effect's own dependency and
  // re-runs it. The previous implementation returned the "clear the
  // highlight after 2.5s" timer as this effect's cleanup function, so that
  // cleanup fired the instant the dependency changed to null — cancelling
  // the timer before it ever cleared `activeHighlightId`, leaving the
  // message highlighted forever. The timer now lives in
  // `highlightControllerRef` (see highlightController.js), which this
  // effect only ever tells to show/clear — it never returns that timer as
  // a cleanup, so a parent-triggered re-render can't cancel it early.
  useEffect(() => {
    if (!highlightMessageId) return;
    const node = messageRefs.current[highlightMessageId];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      // A new target always fully replaces whatever highlight/timer is
      // currently in flight.
      highlightControllerRef.current.show(highlightMessageId);
    } else {
      // Message not loaded in this group's history — acknowledge the
      // target (below) without fabricating a highlight, same as before.
      highlightControllerRef.current.clearNow();
    }
    // Consume the target exactly once, whether or not the message was
    // found — the parent must never keep re-offering the same target.
    onHighlightShown?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMessageId]);

  // Switching groups (or unmounting) must never let a highlight timer
  // started for the previous group leak into the next one.
  useEffect(() => {
    return () => {
      highlightControllerRef.current?.reset();
      setActiveHighlightId(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const memberById = (id) => (members || []).find((m) => m.id === id);
  const visible = query.trim()
    ? messages.filter((m) => (m.text || "").toLowerCase().includes(query.trim().toLowerCase()))
    : messages;

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-cloud/70 overflow-hidden">
      {/* Dynamic Collaborative Multi-Node Team Animation Background */}
      <GroupChatBackground />

      <div className="relative z-10">
        <ChatHeader
          title={group.name}
          subtitle={`${members.length} member${members.length === 1 ? "" : "s"} · ${group.project}`}
          color="#4347C4"
          isGroup
          members={members}
          aiScore={group.collaborationScore}
          backTo="/app/groups"
        />

        <div className="px-4 sm:px-6 pt-3">
          <div className="max-w-3xl mx-auto flex items-center gap-2 bg-paper/85 dark:bg-[#151926]/85 backdrop-blur-md border border-slate-line/80 dark:border-white/10 rounded-full px-3.5 py-2 focus-within:border-brand/50 shadow-xs transition-colors">
            <Search className="w-4 h-4 text-slate-muted shrink-0" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages…"
              aria-label="Search messages in this group"
              className="flex-1 bg-transparent outline-none text-sm min-w-0"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X className="w-4 h-4 text-slate-muted" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-5 min-h-0">
        <div className="max-w-3xl mx-auto">
        {loading ? (
          <MessageSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center text-center gap-2.5 border border-dashed border-coral/30 bg-coral-soft/60 rounded-xl2 py-10 px-6">
            <span className="w-10 h-10 rounded-full bg-paper flex items-center justify-center">
              <AlertTriangle className="w-4.5 h-4.5 text-coral" />
            </span>
            <p className="text-sm font-medium text-coral">Couldn't load this chat</p>
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
              Say hello to {group.name} — messages here are visible to the whole group.
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
              const showSenderName = !isOwn && (!prev || prev.senderId !== msg.senderId);
              const showDateSeparator = !query && isNewDay(msg.time, prev?.time);
              return (
                <div key={msg.id} ref={(el) => { messageRefs.current[msg.id] = el; }}>
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
                    sender={memberById(msg.senderId)}
                    showSenderName={showSenderName}
                    onDelete={onDelete}
                    readByOthers={(msg.readBy || []).some((r) => String(r) !== String(currentUserId))}
                    highlighted={activeHighlightId === msg.id}
                  />
                </div>
              );
            })}
            {isTyping && !query && <TypingIndicator name="Someone" />}
          </>
        )}
        <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput
        onSend={onSend}
        onTyping={onTyping}
        placeholder={`Message ${group.name}…`}
        groupId={group.id}
        currentUserId={currentUserId}
        scope="group"
      />
    </div>
  );
};

export default GroupChat;
