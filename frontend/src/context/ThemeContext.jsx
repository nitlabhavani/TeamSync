import { createContext, useCallback, useEffect, useState } from "react";
import * as profileService from "../services/profileService";
import { useContext } from "react";
import { AuthContext } from "./AuthContext";

export const ThemeContext = createContext(null);

const STORAGE_KEY = "teamsync_theme";
const BG_THEME_STORAGE_KEY = "teamsync_bg_theme";

export const BG_THEMES_LIGHT = [
  { id: "default", label: "Default Cloud", bg: "#f5f6fa", border: "#e6e8f0", preview: "#f5f6fa" },
  { id: "warm", label: "Warm Paper", bg: "#faf7f2", border: "#ebe5db", preview: "#faf7f2" },
  { id: "slate", label: "Cool Slate", bg: "#f1f5f9", border: "#e2e8f0", preview: "#f1f5f9" },
  { id: "pure", label: "Pure White", bg: "#ffffff", border: "#e2e8f0", preview: "#ffffff" },
];

export const BG_THEMES_DARK = [
  { id: "default", label: "Default Obsidian", bg: "#0d0f17", border: "#262a38", preview: "#0d0f17" },
  { id: "midnight", label: "Deep Midnight", bg: "#090d16", border: "#1f293d", preview: "#090d16" },
  { id: "oled", label: "Pitch OLED", bg: "#000000", border: "#1c1c21", preview: "#000000" },
  { id: "forest", label: "Cyber Forest", bg: "#06110d", border: "#182e25", preview: "#06110d" },
];

function getSystemPreference() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeToDocument(theme, bgTheme = "default") {
  if (typeof document === "undefined") return "light";
  const resolved = theme === "system" ? getSystemPreference() : theme;
  const root = document.documentElement;

  if (resolved === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }

  if (bgTheme && bgTheme !== "default") {
    root.setAttribute("data-bg-theme", bgTheme);
  } else {
    root.removeAttribute("data-bg-theme");
  }

  return resolved;
}

export const ThemeProvider = ({ children }) => {
  const auth = useContext(AuthContext);
  const user = auth?.user || null;

  const [theme, setThemeState] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && ["light", "dark", "system"].includes(saved)) {
        return saved;
      }
    }
    return "system";
  });

  const [bgTheme, setBgThemeState] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(BG_THEME_STORAGE_KEY);
      if (saved) return saved;
    }
    return "default";
  });

  const [resolvedTheme, setResolvedTheme] = useState(() => applyThemeToDocument(theme, bgTheme));

  // Keep DOM updated whenever theme or bgTheme changes
  useEffect(() => {
    const resolved = applyThemeToDocument(theme, bgTheme);
    setResolvedTheme(resolved);
  }, [theme, bgTheme]);

  // Listen to OS system color scheme changes if theme is "system"
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      if (theme === "system") {
        const resolved = applyThemeToDocument("system", bgTheme);
        setResolvedTheme(resolved);
      }
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme, bgTheme]);

  // Sync with user's saved account settings when user logs in
  useEffect(() => {
    const userTheme = user?.settings?.theme;
    if (userTheme && ["light", "dark", "system"].includes(userTheme)) {
      const localTheme = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (!localTheme) {
        setThemeState(userTheme);
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, userTheme);
        }
      }
    }
    const userBgTheme = user?.settings?.bgTheme;
    if (userBgTheme) {
      const localBg = typeof localStorage !== "undefined" ? localStorage.getItem(BG_THEME_STORAGE_KEY) : null;
      if (!localBg) {
        setBgThemeState(userBgTheme);
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(BG_THEME_STORAGE_KEY, userBgTheme);
        }
      }
    }
  }, [user]);

  const setTheme = useCallback(
    async (nextTheme, syncBackend = true) => {
      if (!["light", "dark", "system"].includes(nextTheme)) return;
      setThemeState(nextTheme);

      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, nextTheme);
      }

      const resolved = applyThemeToDocument(nextTheme, bgTheme);
      setResolvedTheme(resolved);

      if (syncBackend && user) {
        try {
          await profileService.updateSettings({ theme: nextTheme });
        } catch {
          // Ignore sync failure
        }
      }
    },
    [user, bgTheme]
  );

  const setBgTheme = useCallback(
    async (nextBgTheme, syncBackend = true) => {
      setBgThemeState(nextBgTheme);

      if (typeof localStorage !== "undefined") {
        localStorage.setItem(BG_THEME_STORAGE_KEY, nextBgTheme);
      }

      applyThemeToDocument(theme, nextBgTheme);

      if (syncBackend && user) {
        try {
          await profileService.updateSettings({ bgTheme: nextBgTheme });
        } catch {
          // Ignore sync failure
        }
      }
    },
    [user, theme]
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, bgTheme, setBgTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
