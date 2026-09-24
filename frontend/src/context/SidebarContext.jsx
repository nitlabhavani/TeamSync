import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Lightweight UI-only context for the app shell (Sidebar + Navbar).
 * Tracks:
 *  - collapsed: desktop sidebar shows icons only vs icons+labels
 *  - mobileOpen: mobile slide-in drawer visibility
 *
 * This is purely presentational state — no server data, no auth, no
 * business logic — so it's safe to reset per session.
 */
const SidebarContext = createContext(null);

const COLLAPSE_STORAGE_KEY = "teamsync.sidebar.collapsed";

export const SidebarProvider = ({ children }) => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile, toggleMobile }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within a SidebarProvider");
  return ctx;
};
