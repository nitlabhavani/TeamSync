import { useContext } from "react";
import { ChatContext } from "../context/ChatContext";

export const useChat = (conversationId) => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return {
    ...ctx,
    messages: ctx.messagesByConversation[conversationId] || [],
    isTyping: !!ctx.typingByConversation[conversationId],
  };
};
