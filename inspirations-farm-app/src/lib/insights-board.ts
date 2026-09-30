/**
 * Insights domain — bench board assembly (pure).
 *
 * Turns raw inputs (INS frontmatters, the replayed event stream, the recent
 * behavior records) into the five bench sections (plan 02 §1) with score
 * details and evidence-lookback annotations. No network, fully offline-testable;
 * data.ts feeds it, verify-bench renders it.
 */

import {
  type InsightEvent,
  type InsightStatus,
  parseSourceString,
} from "./insights";
import { computeScore, replayEvents } from "./insights-config";
import {
  LEARNING_TOPICS,
  SCORE_HALF_LIFE_DAYS,
  SCORE_LEARNING_HALF_LIFE_DAYS,
} from "./insights-config";
import type { BehaviorRecord } from "./insights-daily";

// ── Shapes ──────────────────────────────────────────────

export interface EvidenceLookback {
  /** `Journal/Daily/<date>.md@<HHmm>` as stored in frontmatter. */
  raw: string;
  date: string;
  anchor: string;
  /** Behavior records found at that exact minute (≥2 → UI must ask the human
   *  which one is the evidence — never silently pick one). */
  candidates: { time: string; text: string }[];
  ambiguous: boolean;
  /** true when no behavior record exists at that minute anymore (line edited
   *  or removed desktop-side). */
  missing: boolean;
}

export interface BenchCard {
  id: string;
  statement: string;
  status: InsightStatus;
  topics: string[];
  vc: number;
  fc: number;
  lastVerified: string | null;
  created: string;
  score: number;
  scoreDetail: {
    halfLife: number;
    learning: boolean;
    daysSince: number;
  };
  evidence: EvidenceLookback[];
}

export interface BehaviorFlowEntry {
  date: string;
  time: string;
  kind: "behavior" | "trace";
  verdict: string | null;
  insightId: string | null;
  text: string;
}

export interface BenchBoard {
  builtAt: string;
  knowledge: BenchCard[];
  /** Today's top-15 by score (hypothesis + verified; knowledge & falsified
   *  have their own sections). */
  todayTop: BenchCard[];
  /** created < 7d and vc = 0. */
  sprouts: BenchCard[];
  falsified: BenchCard[];
  /** Recent 3-day behavior + trace flow, newest day first, file order within. */
  behaviorFlow: BehaviorFlowEntry[];
  damagedEvents: number;
  duplicateEvents: number;
}

export interface BoardInput {
  frontmatters: Record<string, Record<string, unknown>>; // by insight id
  events: InsightEvent[];
  damagedEvents: number;
  duplicateEvents: number;
  /** Behavior records by journal date (YYYY-MM-DD), newest day first. */
  behaviorByDate: { date: string; records: BehaviorRecord[] }[];
  today: string; // YYYY-MM-DD Beijing
  builtAt: string; // ISO
}

const SPROUT_MAX_AGE_DAYS = 7;

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00+08:00`);
  const toMs = Date.parse(`${to}T00:00:00+08:00`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.max(0, (toMs - fromMs) / 86_400_000);
}

/** Evidence lookback for one frontmatter sources[] entry: resolve it against
 *  the behavior records and flag same-minute ambiguity instead of guessing. */
function evidenceFor(
  raw: string,
  behaviorByDate: { date: string; records: BehaviorRecord[] }[]
): EvidenceLookback | null {
  const parsed = parseSourceString(raw);
  if (!parsed) {
    // Hand-edited / legacy string — surface as missing rather than hiding it.
    return { raw, date: "", anchor: "", candidates: [], ambiguous: false, missing: true };
  }
  const day = behaviorByDate.find((d) => d.date === parsed.date);
  const anchor = parsed.anchor ?? ""; // parseSourceString guarantees @HHmm
  const candidates = (day?.records ?? [])
    .filter((r) => r.time === anchor && r.kind === "behavior")
    .map((r) => ({ time: r.time, text: r.text }));
  return {
    raw,
    date: parsed.date,
    anchor,
    candidates,
    ambiguous: candidates.length > 1,
    missing: candidates.length === 0,
  };
}

function toCard(
  id: string,
  fm: Record<string, unknown>,
  replayed: { vc: number; fc: number; lastVerified: string | null; status: InsightStatus },
  today: string,
  behaviorByDate: { date: string; records: BehaviorRecord[] }[]
): BenchCard {
  const topics = Array.isArray(fm.topics) ? (fm.topics as string[]) : [];
  const lastVerified =
    replayed.lastVerified?.slice(0, 10) ??
    (typeof fm.last_verified === "string" ? fm.last_verified : null);
  const created = typeof fm.created === "string" ? fm.created : today;
  const learning = topics.some((t) => (LEARNING_TOPICS as readonly string[]).includes(t));
  const daysSince = daysBetween(lastVerified ?? created, today);
  const sources = Array.isArray(fm.sources) ? (fm.sources as string[]) : [];
  return {
    id,
    statement: String(fm.statement ?? ""),
    // Falsified is sticky server-side; the replay never lifts it.
    status: (fm.status as InsightStatus) === "falsified" ? "falsified" : replayed.status,
    topics,
    vc: replayed.vc,
    fc: replayed.fc,
    lastVerified,
    created,
    score: computeScore({
      vc: replayed.vc,
      lastVerified,
      created,
      topics,
      today,
    }),
    scoreDetail: {
      halfLife: learning
        ? SCORE_LEARNING_HALF_LIFE_DAYS
        : SCORE_HALF_LIFE_DAYS,
      learning,
      daysSince,
    },
    evidence: sources
      .map((s) => evidenceFor(s, behaviorByDate))
      .filter((e): e is EvidenceLookback => e !== null),
  };
}

/** Assemble the bench board. Counters come from the stream replay (the
 *  frontmatter can lag); status keeps the sticky-falsified merge. */
export function buildBoard(input: BoardInput): BenchBoard {
  const counts = replayEvents(input.events);

  const cards: BenchCard[] = [];
  for (const [id, fm] of Object.entries(input.frontmatters)) {
    const replayed = counts[id] ?? {
      vc: 0,
      fc: 0,
      lastVerified: null,
      status: "hypothesis" as InsightStatus,
    };
    cards.push(toCard(id, fm, replayed, input.today, input.behaviorByDate));
  }

  const knowledge = cards.filter((c) => c.status === "knowledge");
  const falsified = cards.filter((c) => c.status === "falsified");
  const active = cards.filter((c) => c.status === "hypothesis" || c.status === "verified");
  const todayTop = [...active]
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  const sprouts = cards.filter(
    (c) =>
      c.status === "hypothesis" &&
      c.vc === 0 &&
      daysBetween(c.created, input.today) < SPROUT_MAX_AGE_DAYS
  );

  const behaviorFlow: BehaviorFlowEntry[] = input.behaviorByDate.flatMap(({ date, records }) =>
    records.map((r) => ({
      date,
      time: r.time,
      kind: r.kind,
      verdict: r.verdict,
      insightId: r.insightId,
      text: r.text,
    }))
  );

  return {
    builtAt: input.builtAt,
    knowledge,
    todayTop,
    sprouts,
    falsified,
    behaviorFlow,
    damagedEvents: input.damagedEvents,
    duplicateEvents: input.duplicateEvents,
  };
}
