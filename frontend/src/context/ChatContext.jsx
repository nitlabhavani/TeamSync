import { createContext, useCallback, useEffect, useRef, useState } from "react";
import * as chatService from "../services/chatService";
import { toMessage } from "../services/chatService";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../hooks/useAuth";

export const ChatContext = createContext(null);

const TYPING_STOP_DELAY = 1800; // how long after the last keystroke we tell the peer typing has stopped
const TYPING_STALE_TIMEOUT = 4000; // safety net: clear a stuck indicator if a "stopped" event never arrives

export const ChatProvider = ({ children }) => {
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [typingByConversation, setTypingByConversation] = useState({});
  const outgoingTypingTimers = useRef({}); // debounce for events *we* emit while typing
  const incomingTypingTimers = useRef({}); // staleness guard for events *we* receive
  const { socket, subscribeGroupEvent, subscribeUserEvent } = useSocket();
  const { user } = useAuth();

  const loadGroupMessages = useCallback(async (groupId, limit) => {
    const data = await chatService.getGroupMessages(groupId, limit);
    setMessagesByConversation((prev) => ({ ...prev, [groupId]: data }));
    chatService.markRead({ conversationId: groupId, scope: "group" });
    return data;
  }, []);

  const loadPrivateMessages = useCallback(async (userId) => {
    const data = await chatService.getPrivateMessages(userId);
    setMessagesByConversation((prev) => ({ ...prev, [userId]: data }));
    chatService.markRead({ conversationId: userId, scope: "direct" });
    return data;
  }, []);

  const sendMessage = useCallback(async ({ conversationId, senderId, text, scope = "group", attachments }) => {
    const optimistic = {
      id: `temp_${Date.now()}`,
      senderId,
      text,
      attachments: attachments || [],
      time: new Date().toISOString(),
      pending: true,
    };
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), optimistic],
    }));
    const saved = await chatService.sendMessage({ conversationId, text, scope, attachments });
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).map((m) => (m.id === optimistic.id ? saved : m)),
    }));
    return saved;
  }, []);

  /** Soft-deletes a message the current user owns and drops it from the view. */
  const deleteMessage = useCallback(async (conversationId, messageId) => {
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).filter((m) => m.id !== messageId),
    }));
    try {
      await chatService.deleteMessage(messageId);
    } catch {
      /* keep the optimistic removal; a reload restores the truth */
    }
  }, []);

  const markConversationRead = useCallback((conversationId, scope = "group") => {
    chatService.markRead({ conversationId, scope });
  }, []);

  /** Called while the local user is typing; tells the peer over the existing typing/typing:direct events. */
  const notifyTyping = useCallback(
    (conversationId, scope = "group") => {
      if (!socket) return;
      const event = scope === "direct" ? "typing:direct" : "typing";
      const payload =
        scope === "direct" ? { toUserId: conversationId, isTyping: true } : { groupId: conversationId, isTyping: true };
      socket.emit(event, payload);

      clearTimeout(outgoingTypingTimers.current[conversationId]);
      outgoingTypingTimers.current[conversationId] = setTimeout(() => {
        socket.emit(event, { ...payload, isTyping: false });
      }, TYPING_STOP_DELAY);
    },
    [socket]
  );

  // Backward-compatible alias used by existing chat pages (GroupDetails.jsx, PrivateChat.jsx).
  const simulateTyping = useCallback(
    (conversationId, scope = "group") => notifyTyping(conversationId, scope),
    [notifyTyping]
  );

  const setPeerTyping = useCallback((conversationId, isTyping) => {
    setTypingByConversation((prev) => ({ ...prev, [conversationId]: isTyping }));
    clearTimeout(incomingTypingTimers.current[conversationId]);
    if (isTyping) {
      incomingTypingTimers.current[conversationId] = setTimeout(() => {
        setTypingByConversation((prev) => ({ ...prev, [conversationId]: false }));
      }, TYPING_STALE_TIMEOUT);
    }
  }, []);

  // Live message + typing delivery over the existing socket events, so open
  // chat windows update without a refresh instead of only on next fetch.
  useEffect(() => {
    const appendIncoming = (conversationId, raw) => {
      const msg = toMessage(raw);
      if (String(msg.senderId) === String(user?.id)) return; // our own send is already handled optimistically
      setMessagesByConversation((prev) => {
        const existing = prev[conversationId] || [];
        if (existing.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [conversationId]: [...existing, msg] };
      });
    };

    const unsubGroupMessage = subscribeGroupEvent("group:message", (raw) => {
      const groupId = raw?.group;
      if (groupId) appendIncoming(String(groupId), raw);
    });

    const unsubDirectMessage = subscribeUserEvent("direct:message", (raw) => {
      const senderId = raw?.sender?.id || raw?.sender?._id || raw?.sender;
      if (senderId) appendIncoming(String(senderId), raw);
    });

    const unsubGroupTyping = subscribeGroupEvent("typing", ({ userId, groupId, isTyping }) => {
      if (String(userId) === String(user?.id) || !groupId) return;
      setPeerTyping(String(groupId), !!isTyping);
    });

    const unsubDirectTyping = subscribeUserEvent("typing:direct", ({ userId, isTyping }) => {
      if (!userId) return;
      setPeerTyping(String(userId), !!isTyping);
    });

    return () => {
      unsubGroupMessage?.();
      unsubDirectMessage?.();
      unsubGroupTyping?.();
      unsubDirectTyping?.();
    };
  }, [subscribeGroupEvent, subscribeUserEvent, user?.id, setPeerTyping]);

  return (
    <ChatContext.Provider
      value={{
        messagesByConversation,
        typingByConversation,
        loadGroupMessages,
        loadPrivateMessages,
        sendMessage,
        deleteMessage,
        markConversationRead,
        simulateTyping,
        notifyTyping,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
