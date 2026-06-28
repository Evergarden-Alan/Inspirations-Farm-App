import { Suspense } from "react";
import { Home } from "./home";
import { DashboardSkeleton } from "./dashboard-skeleton";
import DashboardContent from "./dashboard-content";

/**
 * Force-dynamic — every request hits GitHub for absolute real-time data.
 * No static generation, no ISR, no client-side cache.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Server Component shell.
 *
 * <Home> handles the PIN lock screen (client-side).
 * <Suspense> streams the skeleton immediately, then swaps in the real
 * dashboard once the server finishes fetching + reconciling data.
 */
export default function Page() {
  return (
    <Home>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </Home>
  );
}
