"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CalendarDays, Settings, Sprout } from "lucide-react";
import { LockScreen } from "./lock-screen";
import { CaptureFab } from "./capture-fab";
import { ToastContainer } from "./toast";
import { ThemeToggle } from "./theme-toggle";
import { hasPin } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";

/**
 * Client component — handles PIN lock screen and renders the
 * sticky header shell.  The actual dashboard content is received
 * as `children` (pre-rendered by the server with Suspense).
 *
 * Children are ALWAYS rendered so that React Suspense can start
 * streaming the skeleton + data immediately.  When the user hasn't
 * unlocked yet, a full-screen LockScreen overlay is shown on top.
 *
 * Reconciliation runs server-side in DashboardContent;
 * this component only gates on the PIN.
 */
export function Home({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);

  // ── Lock screen ──────────────────────────────────
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
      {/* Header */}
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

      <section className="farm-intro mx-auto w-full max-w-[1280px] px-4 pb-3 pt-8 sm:px-6 sm:pt-11 lg:px-8 lg:pb-5">
        <div className="max-w-2xl">
          <p className="farm-kicker mb-2">FIELD NOTES · TODAY</p>
          <h2 className="farm-display text-[clamp(1.8rem,4vw,3.6rem)] font-medium leading-[1.08] tracking-[-0.035em] text-[var(--farm-ink)]">
            把今天，慢慢种成
            <span className="block text-[var(--farm-green)]">想要的样子。</span>
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--farm-muted)] sm:text-[15px]">
            收拢散落的念头，照看正在发生的事。每一次记录，都是下一次生长的起点。
          </p>
        </div>
      </section>

      {/* Dashboard is always rendered so Suspense can stream */}
      {children}

      {/* FAB — mobile quick-capture (hidden on desktop) */}
      {unlocked && <CaptureFab />}

      {/* Global toast notifications */}
      <ToastContainer />

      {/* Lock overlay — covers everything until PIN is verified */}
      {!unlocked && (
        <div className="fixed inset-0 z-50">
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </div>
      )}
    </div>
  );
}
