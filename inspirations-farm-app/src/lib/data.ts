/**
 * Server-side data fetching layer.
 *
 * These functions call the GitHub API directly (via github.ts) —
 * they bypass the Next.js API routes and use the GITHUB_PAT env var.
 * Every call is real-time: cache is disabled at the fetch level.
 */

import {
  getDailyJournal,
  listInspirationsWithContent,
  syncIdeasState,
} from "@/lib/github";
import { getBeijingDateString } from "@/lib/beijing-time";
import {
  readAllInsightFrontmatters,
  readRecentJournals,
  readVerifications,
} from "@/lib/insights-github";
import { parseBehaviorRecords } from "@/lib/insights-daily";
import { buildBoard, type BenchBoard } from "@/lib/insights-board";

/** Fetch today's daily journal (todos) from GitHub. */
export async function getTodos() {
  const date = getBeijingDateString();
  return getDailyJournal(date);
}

/** Fetch all active inspirations from GitHub. */
export async function getInspirations() {
  return listInspirationsWithContent();
}

/**
 * Third parallel bench route (plan 03 · T3.0): INS frontmatters + event
 * stream + the 3-day behavior window, assembled into the bench board.
 * The 1+N frontmatter read is bounded at p-limit(10) inside the github layer.
 */
export async function getInsightBench(): Promise<BenchBoard> {
  const today = getBeijingDateString();
  const [frontmatters, stream, journals] = await Promise.all([
    readAllInsightFrontmatters(),
    readVerifications(),
    readRecentJournals(3),
  ]);

  const behaviorByDate = journals
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // newest day first
    .map((j) => ({ date: j.date, records: parseBehaviorRecords(j.content) }));

  return buildBoard({
    frontmatters,
    events: stream.parsed.valid,
    damagedEvents: stream.parsed.damaged,
    duplicateEvents: stream.parsed.duplicates,
    behaviorByDate,
    today,
    builtAt: new Date().toISOString(),
  });
}

/**
 * Batch-archive inspirations by ID.
 * Used when Obsidian marks a linked task as done and the server
 * needs to catch up on the inspiration side before streaming HTML.
 */
export async function syncCompletedIdeas(ids: string[]) {
  return syncIdeasState(ids);
}
