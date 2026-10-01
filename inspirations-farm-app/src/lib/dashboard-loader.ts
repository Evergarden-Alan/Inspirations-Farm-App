import {
  getInspirations,
  getTodos,
  syncCompletedIdeas,
} from "@/lib/data";
import type { DailyTask } from "@/lib/github";

export type DailyWorkspaceData =
  | {
      exists: true;
      path?: string;
      sha?: string;
      content?: string;
      tasks?: DailyTask[];
    }
  | { exists: false };

/**
 * Reconcile Obsidian-side task completions before seeding Today. The response
 * intentionally exposes only the daily journal needed by this route; the
 * inspiration list is an internal input to reconciliation.
 */
export async function loadTodayWorkspace(): Promise<{ daily: DailyWorkspaceData }> {
  const [todos, ideas] = await Promise.all([getTodos(), getInspirations()]);

  const completedIdeaIds = (todos.tasks ?? [])
    .filter((task: DailyTask) => task.done && task.sourceIdeaId)
    .map((task: DailyTask) => task.sourceIdeaId!);

  if (completedIdeaIds.length > 0) {
    const activeIds = new Set(ideas.map((idea) => idea.id));
    const needsSync = completedIdeaIds.filter((id) => activeIds.has(id));

    if (needsSync.length > 0) {
      console.log(
        `[dashboard-loader] Reconciling ${needsSync.length} ideas completed in Obsidian…`,
      );
      const result = await syncCompletedIdeas(needsSync);
      console.log(
        `[dashboard-loader] Synced ${result.synced}, errors: ${result.errors.length}`,
      );
    }
  }

  const daily = todos.exists
    ? {
        exists: true as const,
        path: todos.path,
        sha: todos.sha,
        content: todos.content,
        tasks: todos.tasks,
      }
    : { exists: false as const };

  return { daily };
}

export async function loadJottingsWorkspace() {
  const todos = await getTodos();

  return {
    notes: {
      notes: todos.notes ?? [],
      dailyExists: todos.exists,
    },
  };
}
