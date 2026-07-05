import { getTodos, getInspirations, syncCompletedIdeas } from "@/lib/data";
import { DailyDashboard } from "./daily-dashboard";
import { InspirationFeed } from "./inspiration-feed";
import { JottingsCard } from "./jottings-card";
import { TabLayout } from "./tab-layout";
import type { DailyTask } from "@/lib/github";

/**
 * Server Component — fetches all dashboard data in parallel,
 * reconciles Obsidian-side task completions, and streams the
 * resolved state to client components.
 */
export default async function DashboardContent() {
  // ── 1. Concurrent fetch ──────────────────────────
  const [todos, ideas] = await Promise.all([
    getTodos(),
    getInspirations(),
  ]);

  // ── 2. Reconciliation: find Obsidian-completed tasks ─
  const completedIdeaIds: string[] = (todos.tasks ?? [])
    .filter((t: DailyTask) => t.done && t.sourceIdeaId)
    .map((t: DailyTask) => t.sourceIdeaId!);

  let syncedIds: Set<string> = new Set();

  if (completedIdeaIds.length > 0) {
    // Which completed tasks have inspirations that are still active?
    const activeIds = new Set(ideas.map((i) => i.id));
    const needsSync = completedIdeaIds.filter((id) => activeIds.has(id));

    if (needsSync.length > 0) {
      console.log(
        `[DashboardContent] Reconciling ${needsSync.length} ideas completed in Obsidian…`
      );
      const result = await syncCompletedIdeas(needsSync);
      console.log(
        `[DashboardContent] Synced ${result.synced}, errors: ${result.errors.length}`
      );
      syncedIds = new Set(needsSync);
    }
  }

  // ── 3. In-memory filter — remove synced inspirations ─
  const reconciledIdeas =
    syncedIds.size > 0
      ? ideas.filter((i) => !syncedIds.has(i.id))
      : ideas;

  // ── 4. Map data for client components ────────────
  const dailyData = todos.exists
    ? {
        exists: true as const,
        path: todos.path,
        sha: todos.sha,
        content: todos.content,
        tasks: todos.tasks,
      }
    : { exists: false as const };

  const notesData = {
    notes: todos.notes ?? [],
    dailyExists: todos.exists,
  };

  return (
    <TabLayout
      todayPanel={<DailyDashboard initialDaily={dailyData} />}
      inspirationsPanel={<InspirationFeed initialItems={reconciledIdeas} />}
      jottingsPanel={<JottingsCard initialNotes={notesData} />}
    />
  );
}
