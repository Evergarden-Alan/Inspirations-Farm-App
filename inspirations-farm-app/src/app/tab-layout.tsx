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
      <div className="lg:hidden p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
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
      <div className="hidden lg:grid grid-cols-2 gap-6 max-w-7xl mx-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-6">
          {todayPanel}
          {jottingsPanel}
        </div>
        <div className="flex flex-col gap-6">
          {inspirationsPanel}
        </div>
      </div>

      {/* ── Bottom tab bar — mobile only ─────────────────── */}
      <nav
        className="fixed bottom-0 inset-x-0 z-30 lg:hidden bg-white/90 backdrop-blur-md border-t border-slate-200/60"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="主导航"
      >
        <div className="flex">
          {TABS.map(({ id, label, icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={active ? "page" : undefined}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors touch-manipulation min-h-[52px] ${
                  active
                    ? "text-emerald-600"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <span
                  className={`transition-transform duration-150 ${
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
