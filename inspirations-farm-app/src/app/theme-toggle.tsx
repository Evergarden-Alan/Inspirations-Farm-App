"use client";

import { Sun, Moon, Clock } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function cycleTheme() {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("auto");
    else setTheme("light");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      className="size-9 text-[var(--farm-muted)] hover:text-[var(--farm-ink)] transition-colors"
      aria-label="切换主题"
      title={
        theme === "auto"
          ? "自动（根据时间）"
          : theme === "light"
            ? "亮色模式"
            : "暗色模式"
      }
    >
      {theme === "auto" && <Clock className="size-4" />}
      {theme === "light" && <Sun className="size-4" />}
      {theme === "dark" && <Moon className="size-4" />}
    </Button>
  );
}
