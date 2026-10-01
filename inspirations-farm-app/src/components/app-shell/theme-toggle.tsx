"use client";

import { Clock3, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/lib/use-theme";

const OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "亮色模式", icon: Sun },
  { id: "auto", label: "自动模式", icon: Clock3 },
  { id: "dark", label: "暗色模式", icon: Moon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="farm-theme-switcher" role="group" aria-label="界面主题">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTheme(id)}
          aria-label={label}
          aria-pressed={theme === id}
          title={label}
          className="farm-theme-option touch-manipulation"
        >
          <Icon className="size-3.5" strokeWidth={1.9} />
        </button>
      ))}
    </div>
  );
}
