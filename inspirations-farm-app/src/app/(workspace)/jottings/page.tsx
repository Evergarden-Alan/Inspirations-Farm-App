import { JottingsCard } from "@/features/jottings/jottings-card";
import { loadJottingsWorkspace } from "@/lib/dashboard-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function JottingsPage() {
  const { notes } = await loadJottingsWorkspace();

  return <JottingsCard initialNotes={notes} />;
}
