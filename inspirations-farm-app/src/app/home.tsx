"use client";

import { useState, useEffect } from "react";
import { LockScreen } from "./lock-screen";
import { CaptureFab } from "./capture-fab";
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
    if (hasPin()) {
      setUnlocked(true);
    }

    function handleAuthExpired() {
      setUnlocked(false);
    }
    window.addEventListener("auth:expired", handleAuthExpired);
    return () => window.removeEventListener("auth:expired", handleAuthExpired);
  }, []);

  const today = getBeijingDateString();

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2 min-h-[52px]">
          <h1 className="text-lg font-semibold tracking-tight text-slate-800 shrink-0">
            Inspirations Farm
          </h1>
          <span className="text-xs text-slate-400 font-mono tabular-nums shrink-0">
            {today}
          </span>
        </div>
      </header>

      {/* Dashboard is always rendered so Suspense can stream */}
      {children}

      {/* FAB — mobile quick-capture (hidden on desktop) */}
      {unlocked && <CaptureFab />}

      {/* Lock overlay — covers everything until PIN is verified */}
      {!unlocked && (
        <div className="fixed inset-0 z-50">
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </div>
      )}
    </div>
  );
}
