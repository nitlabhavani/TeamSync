import { createContext, useCallback, useEffect, useState } from "react";
import { connectSocket, disconnectSocket, joinGroupRoom, leaveGroupRoom, onGroupEvent, onUserEvent } from "../services/socketClient";
import { useAuth } from "../hooks/useAuth";

export const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    // Re-establish the connection whenever the authenticated identity changes:
    // nothing -> logged in (fresh token), one user -> another (account switch on
    // the same tab), or logged in -> nothing (logout). Without this, the socket
    // opened at app boot (before login) never picks up a token, and logging out
    // never tears down the previous user's authenticated connection.
    disconnectSocket();
    if (!userId) {
      setSocket(null);
      return undefined;
    }
    const instance = connectSocket();
    setSocket(instance);
    return () => disconnectSocket();
  }, [userId]);

  // These intentionally depend on `socket`, not on an empty array: every
  // consumer (ChatContext, NotificationContext, GroupContext, GroupDetails)
  // subscribes/joins inside a useEffect that lists these functions as
  // dependencies. If the identity never changed, that effect only runs once
  // on mount -- which can fire before connectSocket() above has created the
  // underlying socket (child effects commit before this provider's own
  // effect), so the listener/join call silently no-ops against a null
  // socket and never retries. Depending on `socket` here makes the callback
  // identity change exactly when the socket instance changes, which causes
  // every dependent effect to correctly re-subscribe / re-join once the
  // connection actually exists (and to clean up + resubscribe on logout ->
  // login or any other socket swap).
  const joinGroup = useCallback((groupId) => {
    joinGroupRoom(groupId);
  }, [socket]);

  const leaveGroup = useCallback((groupId) => {
    leaveGroupRoom(groupId);
  }, [socket]);

  const subscribeGroupEvent = useCallback((event, handler) => onGroupEvent(event, handler), [socket]);
  const subscribeUserEvent = useCallback((event, handler) => onUserEvent(event, handler), [socket]);

  return (
    <SocketContext.Provider value={{ socket, joinGroup, leaveGroup, subscribeGroupEvent, subscribeUserEvent }}>
      {children}
    </SocketContext.Provider>
  );
};
