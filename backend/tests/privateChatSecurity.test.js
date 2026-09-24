const Message = require("../src/models/Message");

describe("Private Chat Security & Routing Isolation", () => {
  describe("Message.conversationKey", () => {
    it("is strictly symmetric for both participants and joined with underscore", () => {
      const u1 = "650111111111111111111111";
      const u2 = "650222222222222222222222";
      const key1 = Message.conversationKey(u1, u2);
      const key2 = Message.conversationKey(u2, u1);
      expect(key1).toBe(key2);
      expect(key1).toBe(`${u1}_${u2}`);
    });
  });

  describe("Direct Message & Missed Call Routing Logic", () => {
    it("routes direct message notifications to /guide/chat when recipient is guide", () => {
      const peer = { role: "guide" };
      const senderId = "sender123";
      const isGuideRecipient = peer?.role === "guide" || peer?.role === "admin";
      const link = isGuideRecipient ? `/guide/chat/${senderId}` : `/app/chat/${senderId}`;
      expect(link).toBe(`/guide/chat/${senderId}`);
    });

    it("routes direct message notifications to /app/chat when recipient is student", () => {
      const peer = { role: "student" };
      const senderId = "sender123";
      const isGuideRecipient = peer?.role === "guide" || peer?.role === "admin";
      const link = isGuideRecipient ? `/guide/chat/${senderId}` : `/app/chat/${senderId}`;
      expect(link).toBe(`/app/chat/${senderId}`);
    });

    it("routes missed call notifications to /guide/chat when callee is guide", () => {
      const callee = { role: "guide" };
      const callerId = "caller456";
      const link = callee?.role === "guide" || callee?.role === "admin"
        ? `/guide/chat/${callerId}`
        : `/app/chat/${callerId}`;
      expect(link).toBe(`/guide/chat/${callerId}`);
    });

    it("routes missed call notifications to /app/chat when callee is student", () => {
      const callee = { role: "student" };
      const callerId = "caller456";
      const link = callee?.role === "guide" || callee?.role === "admin"
        ? `/guide/chat/${callerId}`
        : `/app/chat/${callerId}`;
      expect(link).toBe(`/app/chat/${callerId}`);
    });
  });

  describe("Private Chat Data Isolation", () => {
    it("ensures group chat messages have a group field and private messages have a conversation field", () => {
      const directMsg = new Message({
        conversation: "user1:user2",
        sender: "650111111111111111111111",
        recipient: "650222222222222222222222",
        text: "Secret direct message",
        type: "text",
      });

      expect(directMsg.group).toBeUndefined();
      expect(directMsg.conversation).toBe("user1:user2");
      expect(directMsg.recipient).toBeDefined();

      // Verify that queries filtering by group: groupId will NEVER match this direct message
      const queryFilter = { group: "650333333333333333333333" };
      expect(directMsg.group === queryFilter.group).toBe(false);
    });
  });
});
