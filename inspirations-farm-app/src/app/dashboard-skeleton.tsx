"use client";

const shimmer = "farm-skeleton animate-pulse rounded-full";

function PanelHeading({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="farm-skeleton-accent h-10 w-10 animate-pulse rounded-[0.9rem_0.9rem_0.35rem_0.9rem]" />
      <div className="space-y-2">
        <div className={`${shimmer} h-2 w-16`} />
        <div className={`${shimmer} h-5 ${wide ? "w-32" : "w-24"}`} />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-start gap-8 px-4 pb-32 pt-5 sm:px-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:px-8 lg:pb-24 lg:pt-6 xl:gap-10">
      <div className="flex flex-col gap-8">
        <div className="farm-panel space-y-6 p-6">
          <PanelHeading />
          <div className={`${shimmer} h-1.5 w-full`} />
          <div className="space-y-4 pt-1">
            {[74, 88, 61, 79].map((width, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className={`${shimmer} h-5 w-5 shrink-0`} />
                <div className={`${shimmer} h-4`} style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
          <div className="flex gap-3 border-t border-[var(--farm-line)] pt-4">
            <div className={`${shimmer} h-11 flex-1 rounded-xl`} />
            <div className="farm-skeleton-accent h-11 w-11 animate-pulse rounded-[0.9rem_0.9rem_0.35rem_0.9rem]" />
          </div>
        </div>

        <div className="farm-panel hidden space-y-6 p-6 lg:block">
          <PanelHeading />
          {[1, 2, 3].map((item) => (
            <div key={item} className="flex gap-3">
              <div className={`${shimmer} h-3 w-10 shrink-0`} />
              <div className={`${shimmer} h-3`} style={{ width: `${48 + item * 10}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden min-w-0 space-y-5 lg:block">
        <PanelHeading wide />
        <div className="farm-capture-zone space-y-3">
          <div className={`${shimmer} h-4 w-36`} />
          <div className="farm-skeleton h-24 animate-pulse rounded-2xl" />
          <div className="flex justify-between">
            <div className={`${shimmer} h-8 w-40`} />
            <div className="farm-skeleton-accent h-11 w-28 animate-pulse rounded-[0.9rem_0.9rem_0.35rem_0.9rem]" />
          </div>
        </div>

        {[0, 1, 2].map((item) => (
          <div key={item} className="farm-panel farm-seed-card farm-seed-p2 space-y-3 p-5">
            <div className="flex justify-between gap-4">
              <div className={`${shimmer} h-5`} style={{ width: `${50 + item * 9}%` }} />
              <div className={`${shimmer} h-4 w-8`} />
            </div>
            <div className={`${shimmer} h-3 w-full`} />
            <div className={`${shimmer} h-3 w-3/4`} />
            <div className="flex gap-2 pt-1">
              <div className={`${shimmer} h-5 w-12`} />
              <div className={`${shimmer} h-5 w-16`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
