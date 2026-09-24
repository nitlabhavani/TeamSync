import { createContext, useCallback, useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import * as groupService from "../services/groupService";

export const GroupContext = createContext(null);

export const GroupProvider = ({ children }) => {
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading] = useState(false);
  const { joinGroup, leaveGroup, subscribeGroupEvent } = useSocket();

  // STEP 34 — Notification -> exact group chat navigation. When a
  // group-message notification is clicked, we stash the {groupId, messageId}
  // it points at here (reusing this already-existing app-wide group context,
  // the same pattern activeGroupId already uses, instead of introducing a
  // new state mechanism or relying on parsing query strings through the
  // router-compat shim). GroupDetails.jsx reads it via
  // consumePendingMessageTarget once its messages for that exact groupId
  // have loaded, then it's cleared — so switching groups afterwards, or a
  // second visit to the same chat, never re-triggers a stale scroll/highlight.
  const [pendingMessageTarget, setPendingMessageTargetState] = useState(null);

  const setPendingMessageTarget = useCallback((target) => {
    setPendingMessageTargetState(target && target.groupId ? target : null);
  }, []);

  // Only returns (and clears) the target when it actually matches the group
  // being viewed — e.g. the user clicked a notification for Group A but
  // navigated to Group B via the sidebar before it loaded, or a stale target
  // never got cleared, we must not scroll to a message that has nothing to
  // do with the group currently on screen.
  const consumePendingMessageTarget = useCallback(
    (groupId) => {
      if (!pendingMessageTarget || String(pendingMessageTarget.groupId) !== String(groupId)) return null;
      const { messageId } = pendingMessageTarget;
      setPendingMessageTargetState(null);
      return messageId || null;
    },
    [pendingMessageTarget]
  );

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await groupService.getGroups();
      setGroups(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!groups.length) return;
    groups.forEach((group) => joinGroup(group.id));
    return () => {
      groups.forEach((group) => leaveGroup(group.id));
    };
  }, [groups, joinGroup, leaveGroup]);

  useEffect(() => {
    const unsubUpload = subscribeGroupEvent("group:file:uploaded", () => fetchGroups().catch(() => {}));
    const unsubDelete = subscribeGroupEvent("group:file:deleted", () => fetchGroups().catch(() => {}));
    return () => {
      unsubUpload?.();
      unsubDelete?.();
    };
  }, [fetchGroups, subscribeGroupEvent]);

  return (
    <GroupContext.Provider
      value={{
        groups,
        loading,
        fetchGroups,
        activeGroupId,
        setActiveGroupId,
        setPendingMessageTarget,
        consumePendingMessageTarget,
      }}
    >
      {children}
    </GroupContext.Provider>
  );
};
