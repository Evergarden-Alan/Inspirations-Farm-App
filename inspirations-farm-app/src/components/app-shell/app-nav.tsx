"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FlaskConical,
  Lightbulb,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

import { WORKSPACE_NAV, type WorkspaceIconId } from "./navigation-config";

const ICONS: Record<WorkspaceIconId, LucideIcon> = {
  calendar: CalendarDays,
  lightbulb: Lightbulb,
  notebook: NotebookPen,
  flask: FlaskConical,
};

function isActive(pathname: string, href: WorkspaceNavItemHref) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

type WorkspaceNavItemHref = (typeof WORKSPACE_NAV)[number]["href"];

export function AppNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();

  if (variant === "desktop") {
    return (
      <div className="sticky top-[68px] z-20 hidden border-b border-[var(--farm-line)] bg-[var(--farm-paper)]/80 backdrop-blur-md lg:block">
        <nav
          aria-label="工作区导航"
          className="mx-auto flex max-w-[1280px] items-center gap-1 px-4 sm:px-6 lg:px-8"
        >
          {WORKSPACE_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            const Glyph = ICONS[Icon];
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-11 items-center gap-2 rounded-t-xl px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--farm-green-soft)] ${
                  active
                    ? "bg-[var(--farm-paper-deep)] text-[var(--farm-ink)]"
                    : "text-[var(--farm-muted)] hover:bg-[var(--farm-paper-deep)]/70 hover:text-[var(--farm-ink)]"
                }`}
              >
                <Glyph className="size-4" strokeWidth={1.8} aria-hidden="true" />
                {label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-opacity ${
                    active ? "bg-[var(--farm-green)] opacity-100" : "opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <nav
      aria-label="主导航"
      className="farm-mobile-nav fixed inset-x-3 z-30 mx-auto max-w-md lg:hidden"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="flex p-1.5">
        {WORKSPACE_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const Glyph = ICONS[Icon];
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[54px] flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--farm-green-soft)] ${
                active
                  ? "bg-[var(--farm-green)] text-[var(--primary-foreground)] shadow-sm"
                  : "text-[var(--farm-muted)] hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)]"
              }`}
            >
              <Glyph
                className={`size-5 transition-transform duration-200 ${active ? "scale-110" : "scale-100"}`}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
