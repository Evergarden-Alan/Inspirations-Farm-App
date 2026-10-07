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
 * Batch-archive inspirations by ID.
 * Used when Obsidian marks a linked task as done and the server
 * needs to catch up on the inspiration side before streaming HTML.
 */
export async function syncCompletedIdeas(ids: string[]) {
  return syncIdeasState(ids);
}
