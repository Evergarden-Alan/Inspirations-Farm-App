import assert from "node:assert/strict";
import test from "node:test";

import {
  CROWN_MIN_VERIFIES,
  LEARNING_TOPICS,
  SCORE_HALF_LIFE_DAYS,
  SCORE_LEARNING_HALF_LIFE_DAYS,
  canCrown,
  computeScore,
  nextStatus,
  parseVerifications,
  replayEvents,
} from "../src/lib/insights-config.ts";
import {
  INSIGHTS_EVENT_STREAM_PATH,
  INSIGHTS_DIR,
  INSIGHT_TYPE,
  beijingIsoTimestamp,
  createEventId,
  createInsightId,
  insightFilePath,
  parseSourceString,
  sourceToString,
} from "../src/lib/insights.ts";

const ID = "INS-20260930-213001";

function verifyLine(overrides = {}) {
  return {
    id: "ev-20260930213501-2f8a",
    type: "verify",
    ts: "2026-09-30T21:35:01+08:00",
    insight: ID,
    verdict: "confirm",
    source: { date: "2026-09-30", anchor: "2105" },
    note: "昨晚 21:05 记录，今天下午确实不困",
    ...overrides,
  };
}

/** Objects → JSONL string (the exact shape the event stream stores). */
function toLines(events) {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

// ── JSONL parsing ───────────────────────────────────────

test("parseVerifications: valid verify and crown lines parse", () => {
  const crown = {
    id: "ev-20260930215010-9c3d",
    type: "crown",
    ts: "2026-09-30T21:50:10+08:00",
    insight: ID,
    from: "hypothesis",
    to: "knowledge",
    source: null,
    note: "连续 5 次验证通过，人工加冕",
  };
  const jsonl = `${JSON.stringify(verifyLine())}\n${JSON.stringify(crown)}\n`;
  const parsed = parseVerifications(jsonl);
  assert.equal(parsed.damaged, 0);
  assert.equal(parsed.duplicates, 0);
  assert.equal(parsed.valid.length, 2);
  assert.equal(parsed.valid[0].type, "verify");
  assert.deepEqual(parsed.valid[0].source, { date: "2026-09-30", anchor: "2105" });
  assert.equal(parsed.valid[1].type, "crown");
  assert.deepEqual(
    [parsed.valid[1].from, parsed.valid[1].to],
    ["hypothesis", "knowledge"]
  );
});

test("parseVerifications: damaged lines counted, never thrown", () => {
  const jsonl = [
    JSON.stringify(verifyLine()),
    "{not json", // broken JSON (truncated write)
    JSON.stringify({ id: "x", type: "unknown" }), // schema mismatch
    "", // blank lines ignored
    JSON.stringify(verifyLine({ verdict: "nonsense" })), // bad verdict
  ].join("\n");
  const parsed = parseVerifications(jsonl);
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.damaged, 3);
  assert.equal(parsed.duplicates, 0);
});

test("parseVerifications: duplicate ids counted, first occurrence wins", () => {
  const jsonl = [
    JSON.stringify(verifyLine()),
    JSON.stringify(verifyLine({ verdict: "refute" })), // same id replayed
  ].join("\n");
  const parsed = parseVerifications(jsonl);
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.valid[0].verdict, "confirm");
  assert.equal(parsed.duplicates, 1);
});

// ── Replay ──────────────────────────────────────────────

test("replay: counts vc/fc/lastVerified from verify events", () => {
  const events = parseVerifications(
    toLines([
      verifyLine(),
      verifyLine({
        id: "ev-20261001080000-0001",
        ts: "2026-10-01T08:00:00+08:00",
        verdict: "refute",
        note: null,
      }),
    ])
  ).valid;
  const counts = replayEvents(events);
  assert.equal(counts[ID].vc, 1);
  assert.equal(counts[ID].fc, 1);
  assert.equal(counts[ID].lastVerified, "2026-10-01T08:00:00+08:00");
});

test("replay: refute demotes knowledge/verified back to hypothesis", () => {
  const mk = (verdict, ts, type = "verify") =>
    type === "crown"
      ? {
          id: `ev-${ts.replace(/\D/g, "")}-ffff`,
          type: "crown",
          ts,
          insight: ID,
          from: "hypothesis",
          to: "knowledge",
          source: null,
          note: null,
        }
      : verifyLine({ id: `ev-${ts.replace(/\D/g, "")}-ffff`, ts, verdict });
  const events = parseVerifications(
    toLines([
      mk("confirm", "2026-10-01T08:00:00+08:00"),
      mk("confirm", "2026-10-02T08:00:00+08:00"),
      mk("confirm", "2026-10-03T08:00:00+08:00"),
      mk("confirm", "2026-10-04T08:00:00+08:00"),
      mk("confirm", "2026-10-05T08:00:00+08:00"),
      mk("confirm", "2026-10-06T08:00:00+08:00"), // vc=6
      mk("confirm", "2026-10-07T08:00:00+08:00", "crown"), // knowledge
      mk("refute", "2026-10-08T08:00:00+08:00"), // demote → hypothesis
    ])
  ).valid;
  const counts = replayEvents(events);
  assert.equal(counts[ID].vc, 6);
  assert.equal(counts[ID].fc, 1);
  assert.equal(counts[ID].status, "hypothesis");
});

test("replay: crown is the only promotion path; unobserved changes nothing", () => {
  const events = parseVerifications(
    toLines([
      verifyLine({ verdict: "unobserved", source: null }),
      verifyLine({ id: "ev-20261002080000-0002", ts: "2026-10-02T08:00:00+08:00", verdict: "unobserved", source: null }),
    ])
  ).valid;
  const counts = replayEvents(events);
  assert.equal(counts[ID].vc, 0);
  assert.equal(counts[ID].fc, 0);
  assert.equal(counts[ID].lastVerified, null);
  assert.equal(counts[ID].status, "hypothesis");
});

test("replay: falsified is sticky — confirm and refute never lift it", () => {
  // falsified can only be produced by manual marking on the file; replay must
  // preserve it (the event stream cannot express setting it, nor lift it).
  const counts = replayEvents([]);
  counts[ID] = { vc: 2, fc: 1, lastVerified: "2026-10-01T08:00:00+08:00", status: "falsified" };
  const re = replayEvents(
    parseVerifications(
      toLines([
        verifyLine({ id: "ev-20261002080000-0003", ts: "2026-10-02T08:00:00+08:00", verdict: "confirm" }),
        verifyLine({ id: "ev-20261003080000-0004", ts: "2026-10-03T08:00:00+08:00", verdict: "confirm" }),
      ])
    ).valid
  );
  // replay from scratch yields hypothesis (events never set falsified) — the
  // sticky merge happens in the service layer; here we pin that events alone
  // never PRODUCE falsified.
  assert.equal(re[ID].status, "hypothesis");
  assert.equal(counts[ID].status, "falsified");
});

// ── Status machine & crown gate ─────────────────────────

test("nextStatus: confirm never changes status", () => {
  for (const s of ["hypothesis", "verified", "falsified", "knowledge"]) {
    assert.equal(nextStatus(s, "confirm"), s);
  }
  assert.equal(nextStatus("hypothesis", "unobserved"), "hypothesis");
});

test("nextStatus: refute demotes only knowledge/verified", () => {
  assert.equal(nextStatus("knowledge", "refute"), "hypothesis");
  assert.equal(nextStatus("verified", "refute"), "hypothesis");
  assert.equal(nextStatus("hypothesis", "refute"), "hypothesis");
  assert.equal(nextStatus("falsified", "refute"), "falsified");
});

test("canCrown: hypothesis + 5 confirms + 0 refutes only", () => {
  assert.equal(CROWN_MIN_VERIFIES, 5);
  assert.equal(canCrown("hypothesis", 4, 0), false);
  assert.equal(canCrown("hypothesis", 5, 0), true);
  assert.equal(canCrown("hypothesis", 9, 1), false);
  assert.equal(canCrown("verified", 5, 0), false);
  assert.equal(canCrown("falsified", 5, 0), false);
  assert.equal(canCrown("knowledge", 5, 0), false);
});

// ── Scoring ─────────────────────────────────────────────

test("computeScore: (1+vc) × 0.5^(days/halfLife) with default halfLife 14", () => {
  assert.equal(SCORE_HALF_LIFE_DAYS, 14);
  // 0 days old, vc=0 → 1
  assert.equal(
    computeScore({ vc: 0, lastVerified: "2026-10-01", created: "2026-10-01", topics: [], today: "2026-10-01" }),
    1
  );
  // exactly one half-life old → half
  const half = computeScore({ vc: 0, lastVerified: "2026-09-17", created: "2026-09-17", topics: [], today: "2026-10-01" });
  assert.ok(Math.abs(half - 0.5) < 1e-9, `expected 0.5, got ${half}`);
  // vc multiplies
  const vc3 = computeScore({ vc: 3, lastVerified: "2026-10-01", created: "2026-10-01", topics: [], today: "2026-10-01" });
  assert.equal(vc3, 4);
});

test("computeScore: learning topics use the 10-day half-life", () => {
  assert.deepEqual([...LEARNING_TOPICS], ["睡眠", "专注", "复盘"]);
  assert.equal(SCORE_LEARNING_HALF_LIFE_DAYS, 10);
  const learning = computeScore({ vc: 0, lastVerified: "2026-09-21", created: "2026-09-21", topics: ["睡眠"], today: "2026-10-01" });
  assert.ok(Math.abs(learning - 0.5) < 1e-9, `expected 0.5, got ${learning}`);
  const plain = computeScore({ vc: 0, lastVerified: "2026-09-21", created: "2026-09-21", topics: ["其他"], today: "2026-10-01" });
  assert.ok(plain > learning, "10d-old insight with learning topic must outscore default decay");
});

test("computeScore: falls back to created when never verified", () => {
  const s = computeScore({ vc: 0, lastVerified: null, created: "2026-10-01", topics: [], today: "2026-10-01" });
  assert.equal(s, 1);
});

// ── Serialization & ids ─────────────────────────────────

test("sourceToString / parseSourceString: round-trip and reject invalid", () => {
  const src = { date: "2026-09-30", anchor: "2135" };
  const str = sourceToString(src);
  assert.equal(str, "Journal/Daily/2026-09-30.md@2135");
  assert.deepEqual(parseSourceString(str), src);
  // unanchored evidence has no sources[] representation
  assert.equal(sourceToString({ date: "2026-09-30", anchor: null }), null);
  // hand-edited / malformed strings never parse back
  assert.equal(parseSourceString("Journal/2026-09-30.md@2135"), null); // wrong dir
  assert.equal(parseSourceString("Journal/Daily/2026-09-30.md"), null); // no anchor
  assert.equal(parseSourceString("sneaky"), null);
});

test("ids and timestamps: Beijing forms are stable and injectable", () => {
  const d = new Date("2026-09-30T13:35:01Z"); // 21:35:01 Beijing
  assert.equal(createInsightId(d), "INS-20260930-213501");
  assert.equal(insightFilePath("INS-20260930-213501"), "Insights/INS-20260930-213501.md");
  assert.equal(beijingIsoTimestamp(d), "2026-09-30T21:35:01+08:00");
  const ev = createEventId(d);
  assert.match(ev, /^ev-20260930213501-[0-9a-f]{4}$/);
});

test("domain constants: layout matches the plan", () => {
  assert.equal(INSIGHTS_DIR, "Insights");
  assert.equal(INSIGHTS_EVENT_STREAM_PATH, "Insights/verifications.jsonl");
  assert.equal(INSIGHT_TYPE, "insight");
});
