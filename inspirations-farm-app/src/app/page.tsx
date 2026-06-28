"use client";

import { useState, useEffect, useRef } from "react";
import { InspirationFeed } from "./inspiration-feed";
import { DailyDashboard } from "./daily-dashboard";
import { JottingsCard } from "./jottings-card";
import { LockScreen } from "./lock-screen";
import { hasPin, apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const reconciled = useRef(false);

  // ── Lock screen ────────────────────────────────────
  useEffect(() => {
    if (hasPin()) {
      setUnlocked(true);
    }
    setChecking(false);

    function handleAuthExpired() {
      setUnlocked(false);
    }
    window.addEventListener("auth:expired", handleAuthExpired);
    return () => window.removeEventListener("auth:expired", handleAuthExpired);
  }, []);

  // ── Obsidian reconciliation ─────────────────────────
  // When a user checks off a linked task in Obsidian and pushes to GitHub,
  // the inspiration's status doesn't update automatically. This effect
  // compares today's completed tasks against active inspirations and
  // archives any that were finished in Obsidian.
  useEffect(() => {
    if (!unlocked || reconciled.current) return;

    async function reconcile() {
      try {
        const today = getBeijingDateString();
        const [dailyRes, ideaRes] = await Promise.all([
          apiFetch(`/api/daily?date=${today}`),
          apiFetch("/api/github"),
        ]);
        const dailyData = await dailyRes.json();
        const ideaData = await ideaRes.json();

        if (!dailyData.ok || !ideaData.ok) return;

        // Completed tasks that link to an inspiration
        const completedIdeaIds: string[] = (dailyData.tasks || [])
          .filter((t: { done: boolean; sourceIdeaId: string | null }) => t.done && t.sourceIdeaId)
          .map((t: { sourceIdeaId: string }) => t.sourceIdeaId);

        if (completedIdeaIds.length === 0) return;

        // Active inspirations (still show in the feed)
        const activeIds = new Set(
          (ideaData.items || []).map((i: { id: string }) => i.id)
        );

        // Which completed tasks have inspirations that are still active?
        const needsSync = completedIdeaIds.filter((id: string) => activeIds.has(id));

        if (needsSync.length > 0) {
          console.log(`[reconcile] Syncing ${needsSync.length} ideas completed in Obsidian...`);
          const syncRes = await apiFetch("/api/github", {
            method: "POST",
            body: JSON.stringify({ action: "syncIdeas", ideaIds: needsSync }),
          });
          const syncData = await syncRes.json();
          if (syncData.ok && syncData.synced > 0) {
            console.log(`[reconcile] Done — ${syncData.synced} archived`);
            window.dispatchEvent(new CustomEvent("inspiration:updated"));
          }
        }
      } catch (err) {
        if (!(err instanceof AuthError)) {
          console.warn("[reconcile] Silent error:", err);
        }
      }
    }

    reconciled.current = true;
    reconcile();
  }, [unlocked]);

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

      {/* Responsive layout: single column mobile, two columns desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto p-4 pb-24">
        {/* Left column: Schedule + Jottings */}
        <div className="flex flex-col gap-6">
          <DailyDashboard />
          <JottingsCard />
        </div>

        {/* Right column: Inspiration Pool */}
        <div className="flex flex-col gap-6">
          <InspirationFeed />
        </div>
      </div>
    </div>
  );
}
