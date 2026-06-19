"use client";

import { useState, useEffect } from "react";
import { InspirationFeed } from "./inspiration-feed";
import { DailyDashboard } from "./daily-dashboard";
import { LockScreen } from "./lock-screen";
import { hasPin } from "@/lib/api";

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If PIN exists in localStorage, assume unlocked
    if (hasPin()) {
      setUnlocked(true);
    }
    setChecking(false);

    // Listen for 401 responses from apiFetch
    function handleAuthExpired() {
      setUnlocked(false);
    }
    window.addEventListener("auth:expired", handleAuthExpired);
    return () => window.removeEventListener("auth:expired", handleAuthExpired);
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    );
  }

  if (!unlocked) {
    return <LockScreen onUnlock={() => setUnlocked(true)} />;
  }

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

      {/* Two-column responsive grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto p-4 pb-24">
        {/* Left — Daily Dashboard */}
        <aside className="order-1 lg:order-1">
          <DailyDashboard />
        </aside>

        {/* Right — Inspirations Pool */}
        <main className="order-2 lg:order-2">
          <InspirationFeed />
        </main>
      </div>
    </div>
  );
}
