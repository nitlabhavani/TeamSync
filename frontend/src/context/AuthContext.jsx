import { createContext, useEffect, useState, useCallback } from "react";
import * as authService from "../services/authService";
import { loadDirectory, primeUsers, resetDirectory } from "../services/userDirectory";

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("teamsync_token") : null;
      const cached = authService.getCurrentUser();
      if (!token || !cached) {
        authService.clearSession?.();
        if (alive) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      if (alive && cached) setUser(cached);
      const fresh = await authService.refreshCurrentUser();
      if (alive) {
        setUser(fresh);
        if (fresh) {
          primeUsers([fresh]);
          loadDirectory();
        }
      }
      if (alive) setLoading(false);
    };
    boot();
    return () => {
      alive = false;
    };
  }, []);

  const afterAuth = useCallback((account) => {
    setUser(account);
    primeUsers([account]);
    loadDirectory();
    return account;
  }, []);

  /**
   * login/completeSignup both resume any pending group invitations for this
   * email server-side. `joinedGroups` (a count) rides along so the calling
   * page can tell the student they've just joined a team, without changing
   * the shape of the `user` object stored in context/localStorage.
   */
  const login = useCallback(
    async (credentials) => {
      const { user: account, joinedGroups } = await authService.login(credentials);
      return { ...afterAuth(account), joinedGroups };
    },
    [afterAuth]
  );

  const signup = useCallback(
    async (details) => authService.requestSignupOtp(details),
    []
  );

  /** Verifying the emailed OTP is what actually creates + signs in the account. */
  const completeSignup = useCallback(
    async ({ email, otp }) => {
      const { user: account, joinedGroups } = await authService.verifySignupOtp({ email, otp });
      return { ...afterAuth(account), joinedGroups };
    },
    [afterAuth]
  );

  const logout = useCallback(async () => {
    await authService.logout();
    resetDirectory();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, completeSignup, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};
