"use client";

import { useState } from "react";
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

/** Mobile uses tabs; desktop reveals the same mounted panels in a grid. */
export function TabLayout({ todayPanel, inspirationsPanel, jottingsPanel }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("today");

  return (
    <>
      {/* Mount each panel once so state survives tabs and responsive breakpoints. */}
      <div className="mx-auto max-w-2xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:grid lg:max-w-[1280px] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start lg:gap-8 lg:px-8 lg:pb-24 lg:pt-6 xl:gap-10">
        <div className="flex flex-col lg:gap-8">
          <div className={activeTab === "today" ? "block" : "hidden lg:block"}>
            {todayPanel}
          </div>
          <div className={activeTab === "jottings" ? "block" : "hidden lg:block"}>
            {jottingsPanel}
          </div>
        </div>
        <div className={`${activeTab === "inspirations" ? "block" : "hidden"} min-w-0 lg:block`}>
          {inspirationsPanel}
        </div>
      </div>

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
                    ? "bg-[var(--farm-green)] text-[var(--primary-foreground)] shadow-sm"
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
