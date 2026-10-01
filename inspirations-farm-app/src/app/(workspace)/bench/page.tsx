import { ErrorBoundary } from "@/components/app-shell/error-boundary";
import { VerifyBench } from "@/features/verification/verify-bench";
import { getInsightBench } from "@/lib/data";
import type { BenchBoard } from "@/lib/insights-board";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BenchPage() {
  const board = await getInsightBench().catch((error) => {
    console.error("[bench-page] fetch failed:", error);
    return null as BenchBoard | null;
  });

  return (
    <ErrorBoundary>
      <VerifyBench initialBoard={board} />
    </ErrorBoundary>
  );
}
