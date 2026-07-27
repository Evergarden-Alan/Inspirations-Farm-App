"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";

function getAutoTheme(): ResolvedTheme {
  const hour = new Date().getHours();
  // 18:00 - 次日 6:00 为暗色
  return hour >= 18 || hour < 6 ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("auto");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    // SSR 时返回 light，客户端 hydrate 后会立即更新
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return getAutoTheme();
  });

  // 初始化：从 localStorage 读取
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "auto") {
      setTheme(stored);
    }
  }, []);

  // 应用主题到 DOM
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "auto" ? getAutoTheme() : theme;

    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    setResolvedTheme(resolved);

    // 更新 theme-color meta 标签
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolved === "dark" ? "#1a1f1c" : "#f2efe4");
    }

    // auto 模式下，每分钟检查一次时间（捕获 6:00/18:00 切换点）
    if (theme === "auto") {
      const interval = setInterval(() => {
        const newResolved = getAutoTheme();
        if (newResolved !== resolved) {
          setResolvedTheme(newResolved);
          if (newResolved === "dark") {
            root.classList.add("dark");
          } else {
            root.classList.remove("dark");
          }
          // 更新 meta
          const m = document.querySelector('meta[name="theme-color"]');
          if (m) {
            m.setAttribute(
              "content",
              newResolved === "dark" ? "#1a1f1c" : "#f2efe4"
            );
          }
        }
      }, 60000); // 每分钟

      return () => clearInterval(interval);
    }
  }, [theme]);

  function setThemeWithStorage(newTheme: Theme) {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  }

  return { theme, resolvedTheme, setTheme: setThemeWithStorage };
}
