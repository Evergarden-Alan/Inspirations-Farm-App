/**
 * Insights domain — daily-journal integration.
 *
 * Behavior records (📌) and verification traces (✅/❌/👀) are journal lines
 * shaped like jottings notes (`- **HH:mm** …`), so the desktop Obsidian side
 * can write them by hand and the parsers below read them back.
 *
 * Layout invariant (plan 01 §2): after ANY successful write below, the
 * ## 行为记录 heading sits BEFORE the ## 今日杂记 heading. The section is
 * created by the vault template (primary) or right here (fallback for old
 * diaries / template misses) — never after 杂记, which would reintroduce the
 * H2-sibling swallowing bug this domain was designed around.
 */

import {
  collectCodeLines,
  findHeadingLine,
  findSectionEndLine,
  parseMarkdownAst,
} from "./markdown-utils";
import type { Verdict } from "./insights";

// ── Parsing (full-file scan) ────────────────────────────

export type BehaviorLineKind = "behavior" | "trace";

export interface BehaviorRecord {
  /** `HH:mm` from the bullet. */
  time: string;
  kind: BehaviorLineKind;
  /** Trace verdict (✅/❌/👀); null for plain 📌 behavior lines. */
  verdict: Verdict | null;
  /** `INS-…` id for trace lines; null otherwise. */
  insightId: string | null;
  /** Line content after the marker (trimmed). */
  text: string;
  /** 0-based line index (cross-referenced with evidence anchors). */
  lineNumber: number;
}

const BEHAVIOR_LINE_RE =
  /^-\s+\*\*(\d{2}:\d{2})\*\*\s+(📌|✅|❌|👀)\s+(.*)$/;

const TRACE_EMOJI: Record<string, Verdict> = {
  "✅": "confirm",
  "❌": "refute",
  "👀": "unobserved",
};

export const VERDICT_EMOJI: Record<Verdict, string> = {
  confirm: "✅",
  refute: "❌",
  unobserved: "👀",
};

/**
 * Parse 📌 behavior lines and ✅/❌/👀 verification traces from a diary.
 *
 * FULL-FILE scan, deliberately not bounded to the ## 行为记录 section: the
 * desktop side writes behavior lines wherever it is natural (usually 杂记),
 * and the lines are lexically unambiguous (marker-anchored regex), so a wider
 * scan only adds tolerance, never false positives. Code blocks and frontmatter
 * are excluded via mdast so example lines inside them don't match.
 */
export function parseBehaviorRecords(content: string): BehaviorRecord[] {
  const lines = content.split("\n");
  const codeLines = collectCodeLines(parseMarkdownAst(content));
  const records: BehaviorRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (codeLines.has(i + 1)) continue; // 1-based code-line set
    const m = BEHAVIOR_LINE_RE.exec(lines[i]);
    if (!m) continue;
    const [, time, marker, text] = m;
    if (marker === "📌") {
      records.push({ time, kind: "behavior", verdict: null, insightId: null, text: text.trim(), lineNumber: i });
      continue;
    }
    const verdict = TRACE_EMOJI[marker];
    const insightMatch = /^INS-\d{8}-\d{6}\b/.exec(text);
    records.push({
      time,
      kind: "trace",
      verdict,
      insightId: insightMatch ? insightMatch[0] : null,
      text: text.trim(),
      lineNumber: i,
    });
  }
  return records;
}

// ── Line builders ───────────────────────────────────────

export interface TraceInput {
  time: string; // HH:mm (Beijing, capture at submit)
  verdict: Verdict;
  insightId: string;
  statement: string;
  note: string | null;
}

/** Build the trace line: `- **21:35** ✅ INS-… 早睡→下午不犯困：符合预期`. */
export function buildTraceLine(trace: TraceInput): string {
  const emoji = VERDICT_EMOJI[trace.verdict];
  const note = trace.note ? `：${trace.note}` : "";
  return `- **${trace.time}** ${emoji} ${trace.insightId} ${trace.statement}${note}`;
}

/** Build a plain behavior line: `- **23:05** 📌 上床睡觉`.
 *  Multi-line text continues tab-indented below the bullet (same convention
 *  as jottings notes); blank lines collapse. */
export function buildBehaviorLine(time: string, text: string): string {
  const [firstLine, ...continuations] = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [
    `- **${time}** 📌 ${firstLine}`,
    ...continuations.map((line) => `\t${line}`),
  ].join("\n");
}

// ── Section writing ─────────────────────────────────────

const SECTION_TITLE = "行为记录";
const JOTTINGS_TITLE = "今日杂记";

/** Locate (or create) the ## 行为记录 section and append `line` at its end.
 *
 *  - Section exists → line goes at the section's end (before trailing blanks).
 *  - Section missing, 杂记 exists → section is created immediately BEFORE the
 *    杂记 heading (the pinned insertion point — after 杂记 would sit inside the
 *    previous "extends-to-EOF" parse and invite sibling-swallow regressions).
 *  - Neither exists → section is appended at EOF (no H2 sibling to collide). */
function appendToBehaviorSection(content: string, line: string): string {
  const lines = content.split("\n");
  const root = parseMarkdownAst(content);
  const sectionLine = findHeadingLine(root, SECTION_TITLE); // 1-based, -1 if absent

  if (sectionLine !== -1) {
    const endLine = findSectionEndLine(
      root,
      sectionLine,
      // Any heading ends this section — the next sibling must not absorb our
      // line (same fixed rule as the daily parsers).
      { headingEnds: () => true, thematicBreakEnds: false },
      lines.length + 1
    );
    const sectionStart = sectionLine - 1; // 0-based
    let insertAt = endLine - 1; // 0-based; === lines.length when EOF
    while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") {
      insertAt--;
    }
    lines.splice(insertAt, 0, line);
    return lines.join("\n");
  }

  // No section — create it before ## 今日杂记 when that exists.
  const jottingsLine = findHeadingLine(root, JOTTINGS_TITLE);
  if (jottingsLine !== -1) {
    const insertAt = jottingsLine - 1; // 0-based, at the 杂记 heading
    lines.splice(insertAt, 0, "", `## ${SECTION_TITLE}`, "", line, "");
    return lines.join("\n");
  }

  // Heterogeneous diary without either section — append a fresh section at EOF.
  return content.trimEnd() + `\n\n## ${SECTION_TITLE}\n\n${line}\n`;
}

/** Append a verification trace line to the diary (write-③ of the chain). */
export function insertBehaviorTrace(content: string, trace: TraceInput): string {
  return appendToBehaviorSection(content, buildTraceLine(trace));
}

/** Append a 📌 behavior line to the diary (record mode, T4.3). */
export function insertBehaviorRecord(content: string, time: string, text: string): string {
  return appendToBehaviorSection(content, buildBehaviorLine(time, text));
}

/** Guarantee the ## 行为记录 section exists (empty is fine) without writing a
 *  line — used by paths that only need the section present (e.g. template
 *  backfill). No-op when the section already exists. */
export function ensureBehaviorSection(content: string): string {
  const root = parseMarkdownAst(content);
  if (findHeadingLine(root, SECTION_TITLE) !== -1) return content;
  const lines = content.split("\n");
  const jottingsLine = findHeadingLine(root, JOTTINGS_TITLE);
  if (jottingsLine !== -1) {
    lines.splice(jottingsLine - 1, 0, "", `## ${SECTION_TITLE}`, "");
    return lines.join("\n");
  }
  return content.trimEnd() + `\n\n## ${SECTION_TITLE}\n`;
}

/** Invariant check for tests and the invariant endpoint: the 行为记录 heading
 *  must precede the 今日杂记 heading (either may be absent). */
export function behaviorSectionOrderOk(content: string): boolean {
  const root = parseMarkdownAst(content);
  const behavior = findHeadingLine(root, SECTION_TITLE);
  const jottings = findHeadingLine(root, JOTTINGS_TITLE);
  if (behavior === -1 || jottings === -1) return true;
  return behavior < jottings;
}
