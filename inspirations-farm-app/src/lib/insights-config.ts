/**
 * Insights domain — pure computation rules.
 *
 * Everything here is deterministic and offline-testable: JSONL parsing with a
 * three-state outcome, event replay (the mechanism that makes frontmatter a
 * rebuildable materialized view), scoring, and the status state machine.
 *
 * Parameters are pinned constants, NOT configuration: personal tool, single
 * user, and every knob is a place for silent mis-tuning. LEARNING_TOPICS is
 * maintained by hand in this file and evolves with commits.
 */

import {
  type InsightEvent,
  type InsightSource,
  type InsightStatus,
  type Verdict,
  parseSourceString,
  sourceToString,
} from "./insights";

// ── Pinned parameters ───────────────────────────────────

/** Score decay half-life in days (default). */
export const SCORE_HALF_LIFE_DAYS = 14;
/** Score decay half-life for insights whose topics hit LEARNING_TOPICS. */
export const SCORE_LEARNING_HALF_LIFE_DAYS = 10;
/** Manual crown requires this many confirms and zero refutes. */
export const CROWN_MIN_VERIFIES = 5;

/** Topics currently under active learning — insights touching these decay
 *  slower. User-maintained constant; evolves with commits, no config surface. */
export const LEARNING_TOPICS = ["睡眠", "专注", "复盘"] as const;

// ── JSONL parsing (three-state) ─────────────────────────

export interface ParsedVerifications {
  /** Well-formed, deduplicated events in file order. */
  valid: InsightEvent[];
  /** Lines that failed schema validation — reported, never silently dropped. */
  damaged: number;
  /** Events whose id repeated an earlier line — counted, first occurrence wins. */
  duplicates: number;
}

const STATUSES: readonly InsightStatus[] = [
  "hypothesis",
  "verified",
  "falsified",
  "knowledge",
];
const VERDICTS: readonly Verdict[] = ["confirm", "refute", "unobserved"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIsoTs(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(v);
}

function isSource(v: unknown): v is InsightSource {
  return (
    isRecord(v) &&
    typeof v.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    (v.anchor === null ||
      (typeof v.anchor === "string" && /^\d{4}$/.test(v.anchor)))
  );
}

function asEvent(value: unknown): InsightEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (!isIsoTs(value.ts)) return null;
  if (typeof value.insight !== "string" || !value.insight) return null;
  if (value.source !== null && !isSource(value.source)) return null;
  if (value.note !== null && typeof value.note !== "string") return null;

  if (value.type === "verify") {
    const verdict = value.verdict as Verdict;
    if (!VERDICTS.includes(verdict)) return null;
    return {
      id: value.id,
      type: "verify",
      ts: value.ts,
      insight: value.insight,
      verdict,
      source: value.source,
      note: value.note,
    };
  }
  if (value.type === "crown") {
    const from = value.from as InsightStatus;
    const to = value.to as InsightStatus;
    if (!STATUSES.includes(from)) return null;
    if (!STATUSES.includes(to)) return null;
    return {
      id: value.id,
      type: "crown",
      ts: value.ts,
      insight: value.insight,
      from,
      to,
      source: null,
      note: value.note,
    };
  }
  return null;
}

/** Parse the verifications.jsonl content. Damaged lines and duplicate ids are
 *  counted and surfaced (so invariant can report them) but never crash the
 *  replay — a truncated final line after a failed write must not take the
 *  whole bench down. */
export function parseVerifications(jsonl: string): ParsedVerifications {
  const valid: InsightEvent[] = [];
  const seenIds = new Set<string>();
  let damaged = 0;
  let duplicates = 0;

  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      damaged++;
      continue;
    }
    const event = asEvent(raw);
    if (!event) {
      damaged++;
      continue;
    }
    if (seenIds.has(event.id)) {
      duplicates++;
      continue;
    }
    seenIds.add(event.id);
    valid.push(event);
  }

  return { valid, damaged, duplicates };
}

// ── Replay (event stream → frontmatter state) ───────────

export interface ReplayCounts {
  [insightId: string]: {
    /** confirm count. */
    vc: number;
    /** refute count. */
    fc: number;
    /** Max ts among confirm/refute events (ISO +08:00 — lexicographic order
     *  is chronological). Null when no verdict-bearing event exists. */
    lastVerified: string | null;
    status: InsightStatus;
  };
}

function emptyCounts(): ReplayCounts[string] {
  return { vc: 0, fc: 0, lastVerified: null, status: "hypothesis" };
}

/** Rebuild per-insight counters from the event stream. Rules (pinned):
 *  - confirm → vc+1; refute → fc+1; both move lastVerified to the event ts
 *    (MAX ts, not file order — retro-added catch-up events written by hand
 *    during an outage must not drag the decay baseline backwards).
 *  - unobserved → recorded in the stream only, touches no counter/status.
 *  - refute demotes knowledge/verified → hypothesis; hypothesis stays;
 *    falsified is sticky (only manual marking sets it, nothing lifts it in v1).
 *  - crown is the ONLY promotion path: status becomes the event's `to`.
 *  A single refute does NOT set falsified — one failed prediction is not a
 *  conviction; falsified is a manual verdict. */
export function replayEvents(events: InsightEvent[]): ReplayCounts {
  const counts: ReplayCounts = {};
  for (const ev of events) {
    const c = counts[ev.insight] ?? emptyCounts();
    if (ev.type === "verify") {
      if (ev.verdict === "confirm") c.vc++;
      if (ev.verdict === "refute") c.fc++;
      if (
        ev.verdict !== "unobserved" &&
        (!c.lastVerified || ev.ts > c.lastVerified) // ISO +08:00: lex == chrono
      ) {
        c.lastVerified = ev.ts;
      }
      if (ev.verdict === "refute" && (c.status === "knowledge" || c.status === "verified")) {
        c.status = "hypothesis";
      }
    } else {
      // crown — the only promotion; trust the event's explicit transition.
      c.status = ev.to;
    }
    counts[ev.insight] = c;
  }
  return counts;
}

// ── Status state machine (write-time transition) ────────

/** Next status when a verdict lands. Complements replayEvents for the
 *  just-written event:
 *  - confirm: never changes status (falsified stays falsified — accepted v1
 *    gap, see plan 04 §4 risk 8; knowledge/verified stay).
 *  - refute: demotes knowledge/verified to hypothesis, others unchanged.
 *  - unobserved: observation only, no status change. */
export function nextStatus(current: InsightStatus, verdict: Verdict): InsightStatus {
  if (verdict === "refute" && (current === "knowledge" || current === "verified")) {
    return "hypothesis";
  }
  return current;
}

/** Crown gate: hypothesis only, enough confirms, zero refutes. A refuted
 *  hypothesis can still reach knowledge only via… nothing in v1 (compensation
 *  events are v2) — the strict gate is deliberate. */
export function canCrown(
  status: InsightStatus,
  vc: number,
  fc: number
): boolean {
  return status === "hypothesis" && vc >= CROWN_MIN_VERIFIES && fc === 0;
}

// ── Scoring ─────────────────────────────────────────────

export interface ScoreInput {
  vc: number;
  /** `YYYY-MM-DD` of last confirm/refute, or null (falls back to created). */
  lastVerified: string | null;
  /** `YYYY-MM-DD` the insight was created. */
  created: string;
  topics: string[];
  /** Injected "today" (`YYYY-MM-DD`, Beijing) — keeps the function pure. */
  today: string;
}

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00+08:00`);
  const toMs = Date.parse(`${to}T00:00:00+08:00`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.max(0, (toMs - fromMs) / 86_400_000);
}

/** score = (1 + vc) × 0.5^(days/halfLife); halfLife 14, or 10 when any topic
 *  hits LEARNING_TOPICS. Recent + verified insights surface first; old ones
 *  fade instead of cluttering the bench. */
export function computeScore(input: ScoreInput): number {
  const days = daysBetween(input.lastVerified ?? input.created, input.today);
  const learning = input.topics.some((t) =>
    (LEARNING_TOPICS as readonly string[]).includes(t)
  );
  const halfLife = learning
    ? SCORE_LEARNING_HALF_LIFE_DAYS
    : SCORE_HALF_LIFE_DAYS;
  return (1 + input.vc) * Math.pow(0.5, days / halfLife);
}

// ── Re-exports (single import surface for the domain) ───

export { parseSourceString, sourceToString };
export type { InsightEvent, InsightSource, InsightStatus, Verdict };
