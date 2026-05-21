"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

interface ThemeContextType {
  isDark: boolean;
  setIsDark: (val: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  const applyThemeVars = (dark: boolean) => {
    const root = document.documentElement;
    if (dark) {
      root.style.setProperty("--bg", "#0a0a0a");
      root.style.setProperty("--text", "#f5f7fb");
      root.style.setProperty("--dim", "rgba(255,255,255,0.65)");
      root.style.setProperty("--card-bg", "rgba(12, 12, 20, 0.85)");
      root.style.setProperty("--card-border", "rgba(255, 255, 255, 0.1)");
      root.style.setProperty("--surface", "rgba(255,255,255,0.04)");
      root.style.setProperty("--surface-strong", "rgba(255,255,255,0.08)");
      root.style.setProperty("--panel", "rgba(10,10,12,0.95)");
      root.style.setProperty("--shadow-sm", "0 4px 30px rgba(0,0,0,0.4)");
      root.style.setProperty("--orange", "#ff6b2b");
      root.style.setProperty("--pink", "#ff2b85");
    } else {
      root.style.setProperty("--bg", "#f6f7fb");
      root.style.setProperty("--text", "#050505");
      root.style.setProperty("--dim", "rgba(0,0,0,0.6)");
      root.style.setProperty("--card-bg", "rgba(243, 244, 248, 0.92)");
      root.style.setProperty("--card-border", "rgba(0, 0, 0, 0.08)");
      root.style.setProperty("--surface", "rgba(235, 237, 243, 0.76)");
      root.style.setProperty("--surface-strong", "rgba(226, 229, 236, 0.92)");
      root.style.setProperty("--panel", "rgba(244,245,249,0.97)");
      root.style.setProperty("--shadow-sm", "0 4px 30px rgba(0,0,0,0.08)");
      root.style.setProperty("--orange", "#ff6b2b");
      root.style.setProperty("--pink", "#ff2b85");
    }
  };

  // Persistence (Optional but recommended)
  useEffect(() => {
    const saved = localStorage.getItem("genfy-theme");
    if (saved !== null) {
      setIsDark(saved === "dark");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("genfy-theme", isDark ? "dark" : "light");
    applyThemeVars(isDark);
    if (isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark, setIsDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
