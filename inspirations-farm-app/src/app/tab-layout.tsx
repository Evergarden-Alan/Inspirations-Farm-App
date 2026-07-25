"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, Lightbulb, NotebookPen } from "lucide-react";

type Tab = "today" | "inspirations" | "jottings";

interface Props {
  todayPanel: React.ReactNode;
  inspirationsPanel: React.ReactNode;
  jottingsPanel: React.ReactNode;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "today",
    label: "今日",
    icon: <CalendarDays className="w-5 h-5" />,
  },
  {
    id: "inspirations",
    label: "灵感池",
    icon: <Lightbulb className="w-5 h-5" />,
  },
  {
    id: "jottings",
    label: "杂记",
    icon: <NotebookPen className="w-5 h-5" />,
  },
];

/**
 * Layout wrapper that:
 *  - Mobile (< lg): shows one tab at a time with a fixed bottom nav bar
 *  - Desktop (lg+): 2-column grid, all panels visible, no nav bar
 */
export function TabLayout({ todayPanel, inspirationsPanel, jottingsPanel }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("today");

  const panels: Record<Tab, React.ReactNode> = {
    today: todayPanel,
    inspirations: inspirationsPanel,
    jottings: jottingsPanel,
  };

  return (
    <>
      {/* ── Mobile: single-panel view ─────────────────────── */}
      <div className="px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-5 lg:hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          >
            {panels[activeTab]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Desktop: 2-column grid ────────────────────────── */}
      <div className="mx-auto hidden max-w-[1400px] grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] items-start gap-8 px-8 pb-24 pt-6 lg:grid xl:gap-10">
        <div className="flex flex-col gap-8">
          {todayPanel}
          {jottingsPanel}
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          {inspirationsPanel}
        </div>
      </div>

      {/* ── Bottom tab bar — mobile only ─────────────────── */}
      <nav
        className="farm-mobile-nav fixed inset-x-3 z-30 mx-auto max-w-md lg:hidden"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        aria-label="主导航"
      >
        <div className="flex p-1.5">
          {TABS.map(({ id, label, icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[54px] flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-all ${
                  active
                    ? "bg-[var(--farm-green)] text-white shadow-sm"
                    : "text-[var(--farm-muted)] hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)]"
                }`}
              >
                <span
                  className={`transition-transform duration-200 ${
                    active ? "scale-110" : "scale-100"
                  }`}
                >
                  {icon}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
