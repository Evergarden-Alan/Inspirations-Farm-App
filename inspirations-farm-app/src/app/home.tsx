"use client";

import { useState, useEffect } from "react";
import { LockScreen } from "./lock-screen";
import { hasPin } from "@/lib/api";

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

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">
            Inspirations Farm
          </h1>
        </div>
      </header>

      {/* Dashboard is always rendered so Suspense can stream */}
      {children}

      {/* Lock overlay — covers everything until PIN is verified */}
      {!unlocked && (
        <div className="fixed inset-0 z-50">
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </div>
      )}
    </div>
  );
}
