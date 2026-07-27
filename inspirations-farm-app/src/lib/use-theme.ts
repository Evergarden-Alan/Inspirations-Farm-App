"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";
const THEME_EVENT = "farm:theme-change";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "auto";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function getAutoTheme(): ResolvedTheme {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6 ? "dark" : "light";
}

function subscribe(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) onStoreChange();
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
}

function applyTheme(theme: Theme, autoTheme: ResolvedTheme) {
  const resolved = theme === "auto" ? autoTheme : theme;
  const root = document.documentElement;

  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = theme;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  meta?.setAttribute("content", resolved === "dark" ? "#101914" : "#f3f0e6");
}

export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, getStoredTheme, () => "auto");
  const [autoTheme, setAutoTheme] = useState<ResolvedTheme>(() => getAutoTheme());
  const resolvedTheme = theme === "auto" ? autoTheme : theme;

  useEffect(() => {
    applyTheme(theme, autoTheme);

    if (theme !== "auto") return;
    const interval = window.setInterval(() => setAutoTheme(getAutoTheme()), 60_000);
    return () => window.clearInterval(interval);
  }, [theme, autoTheme]);

  function setTheme(newTheme: Theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // The active page can still switch themes when storage is unavailable.
    }
    applyTheme(newTheme, getAutoTheme());
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return { theme, resolvedTheme, setTheme };
}
