"use client";

/**
 * Dashboard skeleton shown inside <Suspense> while the server
 * fetches data and streams the real content.
 *
 * Layout mirrors the two-column grid of DashboardContent / page.tsx.
 */

export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto p-4 pb-24">
      {/* ── Left column: Daily + Jottings ──────────────── */}
      <div className="flex flex-col gap-6">
        {/* Daily skeleton */}
        <div className="bg-white border border-slate-200/60 rounded-xl shadow-sm p-6 space-y-4">
          {/* Title */}
          <div className="h-5 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />

          {/* Task rows */}
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-slate-200 animate-pulse flex-shrink-0" />
                <div
                  className="h-4 bg-slate-200 rounded animate-pulse"
                  style={{ width: `${60 + i * 12}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Jottings skeleton */}
        <div className="bg-white border border-slate-200/60 rounded-xl shadow-sm p-6 space-y-4">
          <div className="h-5 w-24 bg-slate-200 rounded animate-pulse" />

          {/* Note rows */}
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-12 h-3 bg-slate-100 rounded animate-pulse flex-shrink-0 mt-0.5" />
                <div
                  className="h-4 bg-slate-200 rounded animate-pulse"
                  style={{ width: `${50 + i * 15}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right column: Inspiration Feed ──────────────── */}
      <div className="flex flex-col gap-6">
        {/* Textarea skeleton */}
        <div className="space-y-3">
          <div className="h-[80px] bg-white border border-slate-200/60 rounded-xl animate-pulse" />
          <div className="flex justify-between items-center">
            <div className="flex gap-1">
              {["p0", "p1", "p2", "p3"].map((p) => (
                <div key={p} className="w-10 h-5 bg-slate-200 rounded animate-pulse" />
              ))}
            </div>
            <div className="w-24 h-9 bg-slate-200 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Inspiration cards */}
        <div className="space-y-3">
          {[
            "border-l-red-400",
            "border-l-amber-400",
            "border-l-blue-400",
          ].map((borderColor, i) => (
            <div
              key={i}
              className={`bg-white border border-slate-200/60 rounded-xl shadow-sm overflow-hidden border-l-4 ${borderColor} p-4 space-y-3`}
            >
              {/* Title row */}
              <div className="flex items-start gap-2">
                <div className="w-16 h-3 bg-slate-100 rounded animate-pulse flex-shrink-0 mt-0.5" />
                <div
                  className="h-4 bg-slate-200 rounded animate-pulse"
                  style={{ width: `${55 + i * 10}%` }}
                />
              </div>

              {/* Content lines */}
              <div className="space-y-1.5 pl-0">
                <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
              </div>

              {/* Tags */}
              <div className="flex gap-1.5">
                <div className="w-12 h-5 bg-slate-100 rounded-full animate-pulse" />
                <div className="w-16 h-5 bg-slate-100 rounded-full animate-pulse" />
              </div>

              {/* Footer */}
              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <div className="w-14 h-3 bg-slate-100 rounded animate-pulse" />
                <div className="flex gap-1">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg animate-pulse" />
                  <div className="w-8 h-8 bg-slate-100 rounded-lg animate-pulse" />
                  <div className="w-8 h-8 bg-slate-100 rounded-lg animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
