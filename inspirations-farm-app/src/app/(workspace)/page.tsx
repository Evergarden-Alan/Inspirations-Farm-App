import { DailyDashboard } from "@/features/daily/daily-dashboard";
import { loadTodayWorkspace } from "@/lib/dashboard-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TodayPage() {
  const { daily } = await loadTodayWorkspace();

  return <DailyDashboard initialDaily={daily} />;
}
