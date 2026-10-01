"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Settings, Sprout } from "lucide-react";

import { CaptureFab } from "@/components/app-shell/capture-fab";
import { InductDrawer } from "@/components/app-shell/induct-drawer";
import { LockScreen } from "@/components/app-shell/lock-screen";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { ToastContainer } from "@/components/app-shell/toast";
import { hasPin } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";
import { AppNav } from "./app-nav";

/**
 * Shared workspace chrome. Pages render underneath the lock and stream
 * independently; route transitions preserve this shell and its global tools.
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    let unlockTimer: ReturnType<typeof setTimeout> | undefined;
    if (hasPin()) {
      unlockTimer = setTimeout(() => setUnlocked(true), 0);
    }

    function handleAuthExpired() {
      setUnlocked(false);
    }
    window.addEventListener("auth:expired", handleAuthExpired);
    return () => {
      if (unlockTimer) clearTimeout(unlockTimer);
      window.removeEventListener("auth:expired", handleAuthExpired);
    };
  }, []);

  const today = getBeijingDateString();
  const formattedDate = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date(`${today}T12:00:00+08:00`));

  return (
    <div className="farm-app min-h-screen font-sans antialiased">
      <header className="farm-header sticky top-0 z-20">
        <div className="mx-auto flex min-h-[68px] max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="farm-brand-mark" aria-hidden="true">
              <Sprout className="size-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="farm-kicker hidden sm:block">PERSONAL IDEA GARDEN</p>
              <h1 className="farm-display truncate text-xl font-semibold leading-none text-[var(--farm-ink)] sm:text-2xl">
                灵感农场
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="farm-date-chip">
              <CalendarDays className="size-4 text-[var(--farm-green)]" strokeWidth={1.8} />
              <div className="farm-date-copy text-right leading-tight">
                <span className="block text-xs font-medium text-[var(--farm-ink)] sm:text-sm">
                  {formattedDate}
                </span>
                <span className="hidden font-mono text-[10px] tracking-wider text-[var(--farm-muted)] sm:block">
                  {today}
                </span>
              </div>
            </div>

            <Link
              href="/settings"
              aria-label="打开设置"
              title="设置"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper)]/75 text-[var(--farm-muted)] transition-colors hover:border-[var(--farm-green)] hover:text-[var(--farm-green)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--farm-green-soft)]"
            >
              <Settings className="size-4" strokeWidth={1.8} />
            </Link>

            <ThemeToggle />
          </div>
        </div>
      </header>

      <AppNav variant="desktop" />

      <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:max-w-[960px] lg:pb-20 lg:pt-7 lg:px-8">
        {children}
      </main>

      {unlocked && <CaptureFab />}
      {unlocked && <InductDrawer />}
      <ToastContainer />
      <AppNav variant="mobile" />

      {!unlocked && (
        <div className="fixed inset-0 z-50">
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </div>
      )}
    </div>
  );
}
