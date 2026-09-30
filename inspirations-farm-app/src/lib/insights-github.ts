/**
 * Insights domain — GitHub primitives (the three-write arsenal).
 *
 * Every function takes optional `deps` so tests can inject an in-memory file
 * map and run fully offline (same pattern as FocusPlaylistServiceDependencies).
 * The defaults wire to githubFetch + withConflictRetry — the real network.
 *
 * The stale-read guard is the load-bearing piece: the Contents API can serve a
 * stale replica right after a write (github.ts:744 comment documents this for
 * the daily path). Replaying counters over an unconfirmed replica would write
 * OLD counts back with no error signal — so write-②'s replay input passes
 * through readVerificationsUntilVisible, which only returns once the just-
 * written event id is visible, and throws after the backoff budget is spent.
 */

import matter from "gray-matter";
import {
  GitHubApiError,
  decodeBase64,
  encodeBase64,
  getConfig,
  githubFetch,
  withConflictRetry,
} from "./github-client";
import {
  INSIGHTS_EVENT_STREAM_PATH,
  type InsightEvent,
  type InsightFrontmatter,
} from "./insights";
import { parseVerifications } from "./insights-config";
import { getBeijingDateString, formatBeijingDate } from "./beijing-time";
import {
  MATTER_OPTS,
  parseFrontmatter,
  setFrontmatterField,
} from "./markdown-utils";

// ── Dependency surface ──────────────────────────────────

export interface InsightFileRow {
  /** Blob SHA; null when the file does not exist. */
  sha: string | null;
  content: string;
}

export interface InsightsGithubDeps {
  /** Read a vault file. Default: Contents API GET (404 → null sha). */
  readFile?: (path: string) => Promise<InsightFileRow>;
  /** Write a vault file (null sha = create). Throws GitHubConflictError on 409.
   *  Default: Contents API PUT with a conventional commit message prefix. */
  writeFile?: (
    path: string,
    message: string,
    content: string,
    sha: string | null
  ) => Promise<{ sha: string }>;
  /** Beijing "today" (`YYYY-MM-DD`) anchoring the recent-journal window.
   *  Default: getBeijingDateString(). */
  today?: () => string;
}

const DEFAULT_BACKOFF_MS = [0, 500, 1000];

const defaultReadFile = async (path: string): Promise<InsightFileRow> => {
  const { owner, repo } = getConfig();
  try {
    const data = await githubFetch<{
      sha: string;
      content: string;
      encoding: string;
    }>(`/repos/${owner}/${repo}/contents/${path}`);
    if (data.encoding !== "base64") {
      throw new Error(`Unexpected encoding: ${data.encoding}`);
    }
    return { sha: data.sha, content: decodeBase64(data.content) };
  } catch (err) {
    // A missing file is a normal state here (event stream / INS not created
    // yet); only 404 maps to "absent".
    if (err instanceof GitHubApiError && err.status === 404) {
      return { sha: null, content: "" };
    }
    throw err;
  }
};

const defaultWriteFile = (
  path: string,
  message: string,
  content: string,
  sha: string | null
): Promise<{ sha: string }> => {
  const { owner, repo } = getConfig();
  return githubFetch<{ content: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: encodeBase64(content),
        ...(sha ? { sha } : {}),
      }),
      headers: { "Content-Type": "application/json" },
    }
  ).then((r) => ({ sha: r.content.sha }));
};

function resolveDeps(deps: InsightsGithubDeps = {}): Required<InsightsGithubDeps> {
  return {
    readFile: deps.readFile ?? defaultReadFile,
    writeFile: deps.writeFile ?? defaultWriteFile,
    today: deps.today ?? getBeijingDateString,
  };
}

/** Serialize one event onto the stream (single line + newline). */
function serializeEvent(ev: InsightEvent): string {
  return `${JSON.stringify(ev)}\n`;
}

// ── Write ① — event stream (the single source of truth) ─

/** Append one event to verifications.jsonl. Read-modify-write under
 *  withConflictRetry; a missing stream file is created with this first line.
 *  `message` lets the service layer emit the canonical commit shape
 *  (`verify(INS-x): confirm +1 (vc=3)`) once it has replayed the counts.
 *  409-exhaustion surfaces as GitHubConflictError → route maps to 503; the
 *  event lives in the client outbox so retrying is safe. */
export async function appendVerification(
  ev: InsightEvent,
  deps: InsightsGithubDeps = {},
  message = `verify(${ev.insight}): append event ${ev.id}`
): Promise<{ sha: string }> {
  const d = resolveDeps(deps);
  return withConflictRetry(async () => {
    const file = await d.readFile(INSIGHTS_EVENT_STREAM_PATH);
    const nextContent = file.sha === null
      ? serializeEvent(ev)
      : file.content.replace(/\n*$/, "\n") + serializeEvent(ev);
    return d.writeFile(INSIGHTS_EVENT_STREAM_PATH, message, nextContent, file.sha);
  });
}

// ── Stale-read guard ────────────────────────────────────

export class InsightsStaleReadError extends Error {
  constructor(eventId: string) {
    super(
      `Event ${eventId} not visible in the stream after the backoff budget — ` +
        `refusing to replay over an unconfirmed (likely stale) replica`
    );
    this.name = "InsightsStaleReadError";
  }
}

/** Read the stream, waiting until `eventId` is visible. Guards write-②: the
 *  Contents API serves stale replicas right after a PUT (silent, no error) —
 *  replaying over one would push old counters back into frontmatter. Backoff
 *  0/500/1000ms; exhaustion throws InsightsStaleReadError → callers treat the
 *  whole write-② as failed (countsSynced: false) rather than fake success. */
export async function readVerificationsUntilVisible(
  eventId: string,
  deps: InsightsGithubDeps = {},
  backoffMs: number[] = DEFAULT_BACKOFF_MS
): Promise<ReturnType<typeof parseVerifications>> {
  const d = resolveDeps(deps);
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    const delay = backoffMs[attempt];
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const file = await d.readFile(INSIGHTS_EVENT_STREAM_PATH);
    const parsed = parseVerifications(file.content);
    if (parsed.valid.some((e) => e.id === eventId)) return parsed;
  }
  throw new InsightsStaleReadError(eventId);
}

// ── Plain stream read (invariant / bench) ───────────────

/** Read + parse the stream without visibility guarantees (read-side only). */
export async function readVerifications(deps: InsightsGithubDeps = {}) {
  const d = resolveDeps(deps);
  const file = await d.readFile(INSIGHTS_EVENT_STREAM_PATH);
  return {
    sha: file.sha,
    content: file.content,
    parsed: parseVerifications(file.content),
  };
}

// ── INS file (write ② target) ──────────────────────────

export interface InsightFile {
  sha: string | null;
  frontmatter: Partial<InsightFrontmatter>;
  body: string;
}

/** Read one INS file: frontmatter via the date-safe matter opts, body verbatim. */
export async function readInsightFile(
  insightId: string,
  deps: InsightsGithubDeps = {}
): Promise<InsightFile | null> {
  const d = resolveDeps(deps);
  const path = `Insights/${insightId}.md`;
  const file = await d.readFile(path);
  if (file.sha === null) return null;
  const parsed = parseFrontmatter(file.content);
  // Body = everything after the frontmatter block.
  const body = file.content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return { sha: file.sha, frontmatter: parsed as Partial<InsightFrontmatter>, body };
}

/** Structured frontmatter update (setFrontmatterField, never whole-doc regex):
 *  re-reads under withConflictRetry, applies the patch, re-serializes. */
export async function updateInsightFrontmatter(
  insightId: string,
  updates: Partial<InsightFrontmatter>,
  deps: InsightsGithubDeps = {}
): Promise<{ sha: string }> {
  const d = resolveDeps(deps);
  const path = `Insights/${insightId}.md`;
  return withConflictRetry(async () => {
    const file = await d.readFile(path);
    if (file.sha === null) {
      throw new GitHubApiError(`INS file not found: ${insightId}`, 404);
    }
    let content = file.content;
    for (const [field, value] of Object.entries(updates)) {
      content = setFrontmatterField(content, field, value);
    }
    return d.writeFile(path, `Update INS frontmatter ${insightId}`, content, file.sha);
  });
}

/** Create the INS file (no sha — create-if-missing semantics; a 409 here means
 *  a duplicate id raced us and must surface, not retry). Frontmatter goes
 *  through the date-safe MATTER_OPTS so string dates stay strings. */
export async function createInsightFile(
  frontmatter: InsightFrontmatter,
  body: string,
  deps: InsightsGithubDeps = {}
): Promise<{ sha: string }> {
  const d = resolveDeps(deps);
  const path = `Insights/${frontmatter.id}.md`;
  const content = matter.stringify(body, frontmatter, MATTER_OPTS);
  return d.writeFile(path, `Add insight ${frontmatter.id}`, content, null);
}

// ── Recent journals (evidence window) ───────────────────

export interface RecentJournal {
  date: string;
  exists: boolean;
  content: string;
}

/** The evidence window: the last `days` daily journals INCLUDING today. The
 *  window must span days — "早睡→次日不犯困" can never be evidenced from
 *  today's diary alone. */
export async function readRecentJournals(
  days: number,
  deps: InsightsGithubDeps = {}
): Promise<RecentJournal[]> {
  const d = resolveDeps(deps);
  const result: RecentJournal[] = [];
  const base = d.today();
  const baseMs = Date.parse(`${base}T00:00:00+08:00`);
  for (let offset = 0; offset < days; offset++) {
    const date = formatBeijingDate(new Date(baseMs - offset * 86_400_000));
    const file = await d.readFile(`Journal/Daily/${date}.md`);
    result.push({ date, exists: file.sha !== null, content: file.content });
  }
  return result;
}
