/**
 * Insights domain — service layer: the ONLY write entry points.
 *
 * applyVerification is the three-write chain (plan 01 §2):
 *   ① event stream first (single source of truth, idempotency key)
 *   ② frontmatter rebuild via replay of the visible stream (write-② target)
 *   ③ journal trace, fail-soft
 * Every failure has a defined semantics (the failure matrix) — nothing rolls
 * back write-①, the outbox on the client side makes retries safe.
 *
 * Dependency injection mirrors FocusPlaylistServiceDependencies: every network
 * touch is an optional parameter defaulting to the real implementation, so the
 * failure matrix runs offline in milliseconds.
 */

import {
  type InsightEvent,
  type InsightFrontmatter,
  type InsightSource,
  type InsightStatus,
  type Verdict,
  beijingIsoTimestamp,
  createInsightId,
  sourceToString,
} from "./insights";
import { canCrown, replayEvents } from "./insights-config";
import {
  type InsightsGithubDeps,
  type InsightFile,
  appendVerification,
  createInsightFile,
  readInsightFile,
  readVerifications,
  readVerificationsUntilVisible,
  updateInsightFrontmatter,
} from "./insights-github";
import {
  type TraceInput,
  insertBehaviorTrace,
} from "./insights-daily";
import { getBeijingDateString, formatBeijingDate } from "./beijing-time";
import { modifyDailyJournal } from "./github";

// ── Errors ──────────────────────────────────────────────

export type InsightsServiceErrorCode =
  | "VERIFY_CONFLICT"
  | "INSIGHT_WRITE_FAILED"
  | "INSIGHT_NOT_FOUND"
  | "NOT_CROWNABLE"
  | "INVALID_STATEMENT";

export class InsightsServiceError extends Error {
  readonly code: InsightsServiceErrorCode;
  readonly status: number;

  constructor(code: InsightsServiceErrorCode, message: string, status: number) {
    super(message);
    this.name = "InsightsServiceError";
    this.code = code;
    this.status = status;
  }
}

// ── Dependency surface ──────────────────────────────────

export interface InsightsServiceDependencies {
  /** Vault IO shared by the github primitives (offline tests inject a map). */
  gh?: InsightsGithubDeps;
  appendEvent?: typeof appendVerification;
  readStream?: typeof readVerifications;
  readUntilVisible?: typeof readVerificationsUntilVisible;
  updateFrontmatter?: typeof updateInsightFrontmatter;
  readInsight?: typeof readInsightFile;
  writeInsightFile?: typeof createInsightFile;
  /** Write-③: append the trace line to the journal. Default: the real
   *  modifyDailyJournal (conflict retry + template create + backoff built in). */
  diaryTrace?: (trace: TraceInput) => Promise<void>;
  /** Clock for event ts / ids / created dates. */
  now?: () => Date;
  /** Visibility-guard backoff budget (tests shrink it to [0]). */
  backoffMs?: number[];
}

// ── Shared helpers ──────────────────────────────────────

type Resolved = Required<Pick<InsightsServiceDependencies, "now" | "backoffMs">> &
  InsightsServiceDependencies;

function resolveDeps(deps: InsightsServiceDependencies = {}): Resolved {
  return { now: deps.now ?? (() => new Date()), backoffMs: deps.backoffMs ?? [0, 500, 1000], ...deps };
}

/** Status merge rule (pinned): the event-stream replay owns the status EXCEPT
 *  that `falsified` is sticky — a manual falsified verdict has no event (v1
 *  has no compensation mechanism), so replay alone would silently lift it.
 *  Only a crown event outranks the sticky marker. */
function mergedStatus(fileStatus: InsightStatus | undefined, replayed: InsightStatus): InsightStatus {
  if (fileStatus === "falsified" && replayed !== "knowledge") return "falsified";
  return replayed;
}

/** sources[] strings for one insight from the replayed stream — dedup keeps
 *  the bench rendering sane when the same evidence backs multiple verifies. */
function toSourceStrings(events: InsightEvent[], insightId: string): string[] {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.type !== "verify" || ev.insight !== insightId || !ev.source) continue;
    const s = sourceToString(ev.source);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// ── applyVerification (the three-write chain) ───────────

export interface VerifyInput {
  insightId: string;
  verdict: Verdict;
  note?: string | null;
  /** Evidence picked in the UI: the journal date + behavior-line HHmm. */
  source?: InsightSource | null;
  /** Client idempotency key (outbox): `ev-…`. */
  clientEventId: string;
  /** Timeout degradation hatch (route-level maxDuration guard): after write-①
   *  succeeds, skip ②③ and let invariant/reconcile converge. The failure
   *  matrix already defines this outcome — it is not a new failure state.
   *  `deadlineMs` is an epoch bound checked right after write-①. */
  degrade?: boolean;
  deadlineMs?: number;
}

export interface VerifyResult {
  ok: true;
  already?: boolean;
  traceWritten: boolean;
  countsSynced: boolean;
}

export async function applyVerification(
  input: VerifyInput,
  deps: InsightsServiceDependencies = {}
): Promise<VerifyResult> {
  const d = resolveDeps(deps);
  const gh = d.gh ?? {};

  // 0) Single-point read: stream + INS together (one parallel round), shrinking
  //    the Contents-API replica drift surface. The 3-day evidence window is
  //    deliberately NOT read here — evidence display lives in the bench UI
  //    (data.ts) and the evidence gate is a soft UI constraint; three journal
  //    GETs per verify would only eat into the maxDuration headroom.
  const [insight, before] = await Promise.all([
    (d.readInsight ?? readInsightFile)(input.insightId, gh),
    (d.readStream ?? readVerifications)(gh),
  ]);
  if (!insight) {
    throw new InsightsServiceError("INSIGHT_NOT_FOUND", `Unknown insight: ${input.insightId}`, 404);
  }

  // 1) Idempotency: a retried/timed-out submit replays the same clientEventId.
  //    (A raced duplicate line is reported by invariant as `duplicates` and
  //    never double-counts; the stream RMW still converges.)
  if (before.parsed.valid.some((e) => e.id === input.clientEventId)) {
    return { ok: true, already: true, traceWritten: false, countsSynced: false };
  }

  // 2) Write ① — event stream first.
  const event: InsightEvent = {
    id: input.clientEventId,
    type: "verify",
    ts: beijingIsoTimestamp(d.now()),
    insight: input.insightId,
    verdict: input.verdict,
    source: input.source ?? null,
    note: input.note ?? null,
  };
  // Canonical commit message carries the CUMULATIVE post-event count —
  // replay the pre-event stream + this event (authoritative recount in ②).
  const projected = replayEvents([...before.parsed.valid, event]);
  const message =
    input.verdict === "unobserved"
      ? `verify(${input.insightId}): unobserved`
      : `verify(${input.insightId}): ${input.verdict} +1 (vc=${projected[input.insightId].vc})`;
  try {
    await (d.appendEvent ?? appendVerification)(event, gh, message);
  } catch (err) {
    // 409-exhaustion or network failure: zero local state, client keeps the
    // event in its outbox. Route maps this to 503 (VERIFY_CONFLICT).
    throw new InsightsServiceError(
      "VERIFY_CONFLICT",
      `Event stream write failed after retries: ${err instanceof Error ? err.message : "unknown"}`,
      503
    );
  }

  if (input.degrade || (input.deadlineMs !== undefined && Date.now() > input.deadlineMs)) {
    // Deliberate degradation near the function timeout — events are safe,
    // counters converge via invariant/reconcile.
    return { ok: true, traceWritten: false, countsSynced: false };
  }

  // 3) Write ② — rebuild counters from the visible stream, never from the
  //    pre-write snapshot: concurrent verifies must not lose counts.
  let countsSynced = true;
  try {
    const visible = await (d.readUntilVisible ?? readVerificationsUntilVisible)(
      input.clientEventId,
      gh,
      d.backoffMs
    );
    const counts = replayEvents(visible.valid);
    const mine = counts[input.insightId] ?? {
      vc: 0,
      fc: 0,
      lastVerified: null,
      status: "hypothesis" as InsightStatus,
    };
    await (d.updateFrontmatter ?? updateInsightFrontmatter)(
      input.insightId,
      {
        verify_count: mine.vc,
        falsify_count: mine.fc,
        last_verified: mine.lastVerified ? mine.lastVerified.slice(0, 10) : null,
        status: mergedStatus(insight.frontmatter.status, mine.status),
        sources: toSourceStrings(visible.valid, input.insightId),
      },
      gh
    );
  } catch (err) {
    // Stale-replica exhaustion or a write failure — data is safe in the
    // stream; invariant detects the drift and reconcile rewrites the file.
    console.error(
      `[insights] counts sync failed for ${input.insightId}:`,
      err instanceof Error ? err.message : err
    );
    countsSynced = false;
  }

  // 4) Write ③ — journal trace, fail-soft. INSIGHTS_TRACE_MODE: per-event
  //    (default, v1-pinned) | daily-batch (v2, undefined semantics today) | off.
  let traceWritten = true;
  const mode = process.env.INSIGHTS_TRACE_MODE ?? "per-event";
  if (mode !== "off") {
    const trace: TraceInput = {
      time: beijingIsoTimestamp(d.now()).slice(11, 16), // HH:mm Beijing
      verdict: input.verdict,
      insightId: input.insightId,
      statement: String(insight.frontmatter.statement ?? ""),
      note: input.note ?? null,
    };
    try {
      await (d.diaryTrace ?? defaultDiaryTrace)(trace, gh);
    } catch {
      traceWritten = false; // never roll back ①②
    }
  }

  return { ok: true, traceWritten, countsSynced };
}

async function defaultDiaryTrace(trace: TraceInput, gh: InsightsGithubDeps): Promise<void> {
  await modifyDailyJournal(getBeijingDateString(), (content) =>
    insertBehaviorTrace(content, trace)
  );
  void gh;
}

// ── crownInsight (manual promotion, idempotent) ─────────

export interface CrownInput {
  insightId: string;
  note?: string | null;
  clientEventId: string;
}

export interface CrownResult {
  ok: true;
  already_crowned?: boolean;
  countsSynced: boolean;
}

export async function crownInsight(
  input: CrownInput,
  deps: InsightsServiceDependencies = {}
): Promise<CrownResult> {
  const d = resolveDeps(deps);
  const gh = d.gh ?? {};

  // Re-read frontmatter right before deciding (double-click / raced crown).
  const insight = await (d.readInsight ?? readInsightFile)(input.insightId, gh);
  if (!insight) {
    throw new InsightsServiceError("INSIGHT_NOT_FOUND", `Unknown insight: ${input.insightId}`, 404);
  }
  if (insight.frontmatter.status === "knowledge") {
    return { ok: true, already_crowned: true, countsSynced: true };
  }

  // Event-level idempotency (same promise as the verify chain): a retry after
  // a partial failure (write-① landed, write-② timed out with frontmatter
  // still hypothesis) must NOT append a second crown event — that would break
  // the `crown = ≤2 commits` invariant and leave a duplicate line in the flow.
  const current = await (d.readStream ?? readVerifications)(gh);
  if (current.parsed.valid.some((e) => e.id === input.clientEventId)) {
    return { ok: true, already_crowned: true, countsSynced: false };
  }

  // Gate on replayed counts — file counters can lag a concurrent verify.
  const counts = replayEvents(current.parsed.valid)[input.insightId] ?? {
    vc: 0,
    fc: 0,
    status: "hypothesis" as InsightStatus,
  };
  const status = mergedStatus(insight.frontmatter.status, counts.status);
  if (!canCrown(status, counts.vc, counts.fc)) {
    throw new InsightsServiceError(
      "NOT_CROWNABLE",
      `Crown requires hypothesis with ≥5 confirms and 0 refutes (has status=${status} vc=${counts.vc} fc=${counts.fc})`,
      422
    );
  }

  // Write ① — crown event (the ONLY promotion path; without it reconcile
  // would drag knowledge back to hypothesis on the next rebuild).
  const event: InsightEvent = {
    id: input.clientEventId,
    type: "crown",
    ts: beijingIsoTimestamp(d.now()),
    insight: input.insightId,
    from: status,
    to: "knowledge",
    source: null,
    note: input.note ?? null,
  };
  try {
    await (d.appendEvent ?? appendVerification)(
      event,
      gh,
      `Crown ${input.insightId} to knowledge`
    );
  } catch (err) {
    throw new InsightsServiceError(
      "VERIFY_CONFLICT",
      `Event stream write failed after retries: ${err instanceof Error ? err.message : "unknown"}`,
      503
    );
  }

  // Write ② — rebuild with the crown event included.
  let countsSynced = true;
  try {
    const visibleAfter = await (d.readUntilVisible ?? readVerificationsUntilVisible)(
      input.clientEventId,
      gh,
      d.backoffMs
    );
    const countsAfter = replayEvents(visibleAfter.valid)[input.insightId];
    await (d.updateFrontmatter ?? updateInsightFrontmatter)(
      input.insightId,
      {
        verify_count: countsAfter.vc,
        falsify_count: countsAfter.fc,
        last_verified: countsAfter.lastVerified ? countsAfter.lastVerified.slice(0, 10) : null,
        status: "knowledge",
        sources: toSourceStrings(visibleAfter.valid, input.insightId),
      },
      gh
    );
  } catch (err) {
    console.error(
      `[insights] crown counts sync failed for ${input.insightId}:`,
      err instanceof Error ? err.message : err
    );
    countsSynced = false;
  }
  return { ok: true, countsSynced };
}

// ── createInsightFromText (induct) ──────────────────────

export interface InductInput {
  statement: string;
  topics?: string[];
  /** Origin jotting anchor (INS body provenance line — NOT frontmatter
   *  sources[], which only the verify write-② may ever write). */
  origin?: { date: string; time: string } | null;
}

export interface InductResult {
  ok: true;
  id: string;
}

export async function createInsightFromText(
  input: InductInput,
  deps: InsightsServiceDependencies = {}
): Promise<InductResult> {
  const d = resolveDeps(deps);
  const statement = input.statement.trim();
  if (!statement || statement.includes("\n")) {
    throw new InsightsServiceError(
      "INVALID_STATEMENT",
      "A statement is required and must be a single line",
      400
    );
  }
  const id = createInsightId(d.now());
  const frontmatter: InsightFrontmatter = {
    type: "insight",
    id,
    statement,
    status: "hypothesis",
    verify_count: 0,
    falsify_count: 0,
    last_verified: null,
    created: formatBeijingDate(d.now()), // injected clock — same instant as the id
    topics: input.topics ?? [],
    sources: [], // write-② only — see the design ruling in plan 01 §3
    related: [],
  };
  const originLine = input.origin
    ? `\n\n## 来源\n\n- 来源：Journal/Daily/${input.origin.date}.md@${input.origin.time.replace(":", "")}`
    : "";
  const body = `${statement}${originLine}`;
  try {
    await (d.writeInsightFile ?? createInsightFile)(
      frontmatter,
      body,
      d.gh ?? {},
      `Add insight ${id} ${statement.slice(0, 40)}`
    );
  } catch (err) {
    // Dedicated code — induct has no "verify conflict"; a raced duplicate id
    // (GitHubConflictError) must surface, not retry.
    throw new InsightsServiceError(
      "INSIGHT_WRITE_FAILED",
      `INS file write failed: ${err instanceof Error ? err.message : "unknown"}`,
      503
    );
  }
  return { ok: true, id };
}

// ── Evidence window (shared with the bench read side) ───

export type { InsightFile };
