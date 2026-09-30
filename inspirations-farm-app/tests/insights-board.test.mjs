import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard } from "../src/lib/insights-board.ts";

const TODAY = "2026-10-01";
const BUILT_AT = "2026-10-01T09:00:00+08:00";

function fm(id, overrides = {}) {
  return {
    type: "insight",
    id,
    statement: `命题 ${id}`,
    status: "hypothesis",
    verify_count: 0,
    falsify_count: 0,
    last_verified: null,
    created: "2026-09-28",
    topics: [],
    sources: [],
    related: [],
    ...overrides,
  };
}

function verifyEvent(id, insight, overrides = {}) {
  return {
    id,
    type: "verify",
    ts: `2026-09-30T21:${String(10 + insight.length).slice(0, 2)}:00+08:00`,
    insight,
    verdict: "confirm",
    source: null,
    note: null,
    ...overrides,
  };
}

const BEHAVIOR = [
  {
    date: "2026-09-30",
    records: [
      { time: "2105", kind: "behavior", verdict: null, insightId: null, text: "上床睡觉", lineNumber: 3 },
      { time: "2105", kind: "behavior", verdict: null, insightId: null, text: "备用行为行", lineNumber: 4 },
      { time: "2200", kind: "trace", verdict: "confirm", insightId: "INS-A", text: "INS-A 命题：ok", lineNumber: 5 },
    ],
  },
];

test("board: five sections route by status; counters come from the replay", () => {
  const board = buildBoard({
    frontmatters: {
      "INS-K": fm("INS-K", { status: "knowledge", verify_count: 5 }),
      "INS-A": fm("INS-A", { verify_count: 2 }),
      "INS-B": fm("INS-B"),
      "INS-F": fm("INS-F", { status: "falsified" }),
    },
    events: [
      ...Array.from({ length: 2 }, (_, i) =>
        verifyEvent(`ev-a${i}`, "INS-A", { ts: `2026-09-3${i}T21:00:00+08:00` })
      ),
      verifyEvent("ev-k1", "INS-K", {
        type: "crown",
        from: "hypothesis",
        to: "knowledge",
        ts: "2026-09-30T22:00:00+08:00",
      }),
    ],
    damagedEvents: 1,
    duplicateEvents: 2,
    behaviorByDate: BEHAVIOR,
    today: TODAY,
    builtAt: BUILT_AT,
  });
  assert.deepEqual(board.knowledge.map((c) => c.id), ["INS-K"]);
  assert.deepEqual(board.falsified.map((c) => c.id), ["INS-F"]);
  // INS-A (vc=2, recent) outranks INS-B (vc=0)
  assert.deepEqual(board.todayTop.map((c) => c.id), ["INS-A", "INS-B"]);
  // sprout: created <7d, vc=0, hypothesis only
  assert.deepEqual(board.sprouts.map((c) => c.id), ["INS-B"]);
  assert.equal(board.damagedEvents, 1);
  assert.equal(board.duplicateEvents, 2);
  // behavior flow passes through (3 entries, newest day first)
  assert.equal(board.behaviorFlow.length, 3);
  assert.equal(board.behaviorFlow[2].kind, "trace");
});

test("board: todayTop caps at 15", () => {
  const frontmatters = {};
  for (let i = 0; i < 20; i++) frontmatters[`INS-${String(i).padStart(2, "0")}`] = fm(`INS-${String(i).padStart(2, "0")}`);
  const board = buildBoard({
    frontmatters,
    events: [],
    damagedEvents: 0,
    duplicateEvents: 0,
    behaviorByDate: [],
    today: TODAY,
    builtAt: BUILT_AT,
  });
  assert.equal(board.todayTop.length, 15);
});

test("board: sprouts expire after 7 days", () => {
  const board = buildBoard({
    frontmatters: { "INS-OLD": fm("INS-OLD", { created: "2026-09-01" }) },
    events: [],
    damagedEvents: 0,
    duplicateEvents: 0,
    behaviorByDate: [],
    today: TODAY,
    builtAt: BUILT_AT,
  });
  assert.deepEqual(board.sprouts, []);
  assert.equal(board.todayTop.length, 1); // still active, just not a sprout
});

test("board: evidence lookback flags same-minute ambiguity, never picks silently", () => {
  const board = buildBoard({
    frontmatters: {
      "INS-A": fm("INS-A", { sources: ["Journal/Daily/2026-09-30.md@2105"] }),
      "INS-C": fm("INS-C", { sources: ["Journal/Daily/2026-09-30.md@2300"] }),
      "INS-D": fm("INS-D", { sources: ["Journal/Daily/2026-09-29.md@2105"] }),
    },
    events: [],
    damagedEvents: 0,
    duplicateEvents: 0,
    behaviorByDate: [...BEHAVIOR, { date: "2026-09-29", records: [] }],
    today: TODAY,
    builtAt: BUILT_AT,
  });
  const ambiguous = board.todayTop.find((c) => c.id === "INS-A").evidence[0];
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.candidates.length, 2); // 人工确认 — both listed
  const missing = board.todayTop.find((c) => c.id === "INS-C").evidence[0];
  assert.equal(missing.missing, true); // no record at 23:00 anymore
  const absentDay = board.todayTop.find((c) => c.id === "INS-D").evidence[0];
  assert.equal(absentDay.missing, true);
});

test("board: unparseable source strings surface as missing, never hidden", () => {
  const board = buildBoard({
    frontmatters: { "INS-X": fm("INS-X", { sources: ["hand-edited-string"] }) },
    events: [],
    damagedEvents: 0,
    duplicateEvents: 0,
    behaviorByDate: [],
    today: TODAY,
    builtAt: BUILT_AT,
  });
  const ev = board.todayTop.find((c) => c.id === "INS-X").evidence[0];
  assert.equal(ev.missing, true);
  assert.equal(ev.raw, "hand-edited-string");
});
