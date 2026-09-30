/**
 * Insights domain — shared constants, event/frontmatter types, and the single
 * serialization point for evidence source pointers.
 *
 * 「真知浮现」: the user records behavior lines (📌) in daily journals, turns
 * observations into causal hypotheses (INS files), verifies them against the
 * behavior record, and crowns repeated confirmations to knowledge.
 *
 * Schema lives HERE (not in a vault template file) so the type definitions and
 * the serializers can never drift apart. Dates cross the frontmatter boundary
 * as quoted strings — gray-matter would otherwise coerce them into Date
 * objects and re-serialize them in a different format.
 */

import {
  formatBeijingCompactTimestamp,
} from "./beijing-time";

// ── Vault layout & commit vocabulary ────────────────────

/** Vault directory holding all insight files (web-exclusive, Obsidian never
 *  edits these; the directory + INS- prefix separate them from Inspirations/). */
export const INSIGHTS_DIR = "Insights";

/** Application-exclusive event stream — the single source of truth. obsidian-git
 *  never writes this file, keeping the conflict surface minimal. */
export const INSIGHTS_EVENT_STREAM_PATH = "Insights/verifications.jsonl";

/** Frontmatter `type` marker on every INS file. */
export const INSIGHT_TYPE = "insight";

/** Commit message shapes asserted by scripts/verify-insights.mjs:
 *  `Add insight INS-{id} …` / `verify(INS-x): …` / `Crown INS-x …`
 *  / `Reconcile INS-x from events …`. */
export const INSIGHT_COMMIT_PREFIXES = {
  induct: "Add insight",
  verify: "verify",
  crown: "Crown",
  reconcile: "Reconcile",
} as const;

// ── Status & verdict vocabulary ─────────────────────────

export type InsightStatus =
  | "hypothesis"
  | "verified"
  | "falsified"
  | "knowledge";

export type Verdict = "confirm" | "refute" | "unobserved";

// ── Evidence source pointers ────────────────────────────

/** Evidence pointer as stored on every event: the journal date plus the
 *  HHmm anchor of the behavior line (null when the verification was made
 *  without picking evidence). */
export interface InsightSource {
  /** Beijing date, `YYYY-MM-DD`. */
  date: string;
  /** `HHmm` minute anchor of the behavior line, or null. */
  anchor: string | null;
}

/** The daily journal path prefix — matches getDailyJournal in github.ts. */
const JOURNAL_DIR = "Journal/Daily";

/**
 * Event source object → frontmatter `sources[]` string (`Journal/Daily/<date>.md@<HHmm>`).
 * THE single conversion point (parseSourceString is the reverse). Unanchored
 * evidence has no sources[] representation — callers must skip null instead of
 * inventing a format. Never build these strings anywhere else: reconcile treats
 * frontmatter sources as write-②-owned and will wipe anything it can't replay.
 */
export function sourceToString(source: InsightSource): string | null {
  if (!source.anchor) return null;
  return `${JOURNAL_DIR}/${source.date}.md@${source.anchor}`;
}

/** Inverse of sourceToString. Returns null for anything but the canonical
 *  `Journal/Daily/<date>.md@<HHmm>` shape (defensive against hand edits). */
export function parseSourceString(value: string): InsightSource | null {
  const m = /^Journal\/Daily\/(\d{4}-\d{2}-\d{2})\.md@(\d{4})$/.exec(value);
  if (!m) return null;
  return { date: m[1], anchor: m[2] };
}

// ── Events (verifications.jsonl) ────────────────────────

interface EventBase {
  /** Client-generated idempotency key: `ev-<beijingTimestamp>-<rand4>`. */
  id: string;
  /** Timezone-aware ISO string, e.g. `2026-09-30T21:35:01+08:00`. */
  ts: string;
  /** INS id the event applies to. */
  insight: string;
  /** Evidence picked at submit time (null = verified from memory). */
  source: InsightSource | null;
  /** Free-text note. */
  note: string | null;
}

export type InsightEvent = EventBase & (
  | { type: "verify"; verdict: Verdict }
  | { type: "crown"; from: InsightStatus; to: InsightStatus }
);

/** Generate a client event id: `ev-20260930213501-2f8a`. */
export function createEventId(now: Date = new Date()): string {
  const rand = Math.random().toString(16).slice(2, 6).padEnd(4, "0");
  return `ev-${formatBeijingCompactTimestamp(now)}-${rand}`;
}

/** Timezone-aware Beijing ISO timestamp (`2026-09-30T21:35:01+08:00`).
 *  Bare `HH:mm:ss` strings would make cross-device ordering ambiguous; the
 *  fixed +08:00 offset keeps lexicographic order == chronological order. */
export function beijingIsoTimestamp(now: Date = new Date()): string {
  const compact = formatBeijingCompactTimestamp(now); // YYYYMMDDHHmmss
  return (
    `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` +
    `T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}` +
    "+08:00"
  );
}

// ── INS file frontmatter ────────────────────────────────

export interface InsightFrontmatter {
  type: typeof INSIGHT_TYPE;
  id: string;
  /** Single-line causal statement, e.g. 早睡→下午不犯困. */
  statement: string;
  status: InsightStatus;
  verify_count: number;
  falsify_count: number;
  /** Beijing date `YYYY-MM-DD` of the most recent confirm/refute; null until
   *  first verification. Kept a string (never a Date) across gray-matter. */
  last_verified: string | null;
  created: string;
  topics: string[];
  /** `Journal/Daily/<date>.md@<HHmm>` strings — written ONLY by applyVerification
   *  write-② replaying the event stream (see sourceToString). Induct-time
   *  provenance lives in the body text, never here. */
  sources: string[];
  /** v1: always empty, reserved for the v2 related-graph. */
  related: string[];
}

/** INS file naming: `INS-YYYYMMDD-HHmmss.md` (Beijing time). */
export function createInsightId(now: Date = new Date()): string {
  const compact = formatBeijingCompactTimestamp(now);
  return `INS-${compact.slice(0, 8)}-${compact.slice(8)}`;
}

/** Vault path of an INS file. */
export function insightFilePath(id: string): string {
  return `${INSIGHTS_DIR}/${id}.md`;
}

/** Human-readable reference to the JSON schema of the event stream, kept in
 *  sync with InsightEvent by tests/insights-config.test.mjs. Dates/ids are
 *  plain strings — no structural types survive the JSONL round-trip. */
export const INSIGHTS_EVENT_STREAM_SCHEMA = `{"id":"ev-YYYYMMDDHHmmss-xxxx","type":"verify","ts":"YYYY-MM-DDTHH:mm:ss+08:00","insight":"INS-YYYYMMDD-HHmmss","verdict":"confirm|refute|unobserved","source":{"date":"YYYY-MM-DD","anchor":"HHmm"}|null,"note":string|null}
{"id":"ev-YYYYMMDDHHmmss-xxxx","type":"crown","ts":"YYYY-MM-DDTHH:mm:ss+08:00","insight":"INS-YYYYMMDD-HHmmss","from":InsightStatus,"to":InsightStatus,"source":null,"note":string|null}`;
