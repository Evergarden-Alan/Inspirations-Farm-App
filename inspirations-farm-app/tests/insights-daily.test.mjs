import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  behaviorSectionOrderOk,
  buildBehaviorLine,
  buildTraceLine,
  ensureBehaviorSection,
  insertBehaviorRecord,
  insertBehaviorTrace,
  parseBehaviorRecords,
} from "../src/lib/insights-daily.ts";
import { parseDailyNotes } from "../src/lib/markdown-utils.ts";

const TEMPLATE_DIARY = `---
tags:
  - diary
date: 2026-09-30
---

# 本日总结

## 行为记录

- **22:30** 📌 上床睡觉

## 今日杂记

- **10:00** 买牛奶
`;

const OLD_DIARY_NO_SECTION = `# 本日总结

## 今日杂记

- **10:00** 买牛奶
`;

const HETEROGENEOUS_DIARY = `随手记的一天

- 没有任何标准节
`;

const TRACE = {
  time: "21:35",
  verdict: "confirm",
  insightId: "INS-20260930-213501",
  statement: "早睡→下午不犯困",
  note: "符合预期",
};

// ── Line builders ───────────────────────────────────────

test("buildTraceLine: `- **HH:mm** ✅ INS-… statement：note`", () => {
  assert.equal(
    buildTraceLine(TRACE),
    "- **21:35** ✅ INS-20260930-213501 早睡→下午不犯困：符合预期"
  );
  assert.equal(
    buildTraceLine({ ...TRACE, verdict: "refute", note: null }),
    "- **21:35** ❌ INS-20260930-213501 早睡→下午不犯困"
  );
  assert.equal(buildBehaviorLine("23:05", "上床睡觉"), "- **23:05** 📌 上床睡觉");
});

test("buildBehaviorLine: multi-line text serializes continuation lines tab-indented", () => {
  // Same continuation convention as jottings notes (markdown-utils): extra
  // lines go below the bullet tab-indented, empty lines collapse.
  assert.equal(
    buildBehaviorLine("21:30", "跑步 3km\n\n配速 5'40\""),
    "- **21:30** 📌 跑步 3km\n\t配速 5'40\""
  );
});

// ── Parsing (full-file scan) ────────────────────────────

test("parseBehaviorRecords: full-file scan reads markers in ANY section", () => {
  // 📌 written into 杂记 (the desktop-natural spot) must be found even though
  // the 行为记录 section is elsewhere; section purity is a WRITE rule only.
  const diary = `# 本日总结

## 行为记录

- **22:30** 📌 上床睡觉

## 今日杂记

- **10:00** 买牛奶
- **23:05** 📌 刷牙（手写进杂记也要被读到）
`;
  const records = parseBehaviorRecords(diary);
  assert.deepEqual(
    records.map((r) => [r.time, r.kind]),
    [
      ["22:30", "behavior"],
      ["23:05", "behavior"],
    ]
  );
});

test("parseBehaviorRecords: trace lines carry verdict + insight id", () => {
  const withTrace = insertBehaviorTrace(TEMPLATE_DIARY, TRACE);
  const records = parseBehaviorRecords(withTrace);
  const trace = records.find((r) => r.kind === "trace");
  assert.ok(trace);
  assert.equal(trace.verdict, "confirm");
  assert.equal(trace.insightId, "INS-20260930-213501");
  assert.match(trace.text, /早睡→下午不犯困：符合预期$/);
});

test("parseBehaviorRecords: non-marker lines and code blocks are ignored", () => {
  const diary = `## 今日杂记

- **10:00** 买牛奶（无标记，不算行为行）

\`\`\`
- **12:00** 📌 代码块里的示例行不算
\`\`\`

- **23:05** 📌 真行为行
`;
  const records = parseBehaviorRecords(diary);
  assert.deepEqual(
    records.map((r) => r.time),
    ["23:05"]
  );
});

// ── Section creation rules (plan 01 §2 建节规则) ─────────

test("rule ①: template diary (section exists) → line appended in-section, order kept", () => {
  const result = insertBehaviorTrace(TEMPLATE_DIARY, TRACE);
  assert.ok(behaviorSectionOrderOk(result));
  const lines = result.split("\n");
  const traceIdx = lines.findIndex((l) => l.includes("✅ INS-20260930-213501"));
  const jottingsIdx = lines.findIndex((l) => l === "## 今日杂记");
  const pinnedIdx = lines.findIndex((l) => l.includes("22:30"));
  // trace sits inside 行为记录: after the pinned line, before 杂记
  assert.ok(traceIdx > pinnedIdx && traceIdx < jottingsIdx);
  // jottings untouched
  assert.deepEqual(parseDailyNotes(result).map((n) => n.time), ["10:00"]);
});

test("rule ②: old diary without section → created immediately BEFORE 杂记, no cross-swallow", () => {
  const result = insertBehaviorTrace(OLD_DIARY_NO_SECTION, TRACE);
  assert.ok(behaviorSectionOrderOk(result));
  // the fixed section-end rule (any-depth headings): both sections parse in isolation
  assert.deepEqual(parseDailyNotes(result).map((n) => n.time), ["10:00"]);
  const records = parseBehaviorRecords(result);
  assert.equal(records.filter((r) => r.kind === "trace").length, 1);
  const lines = result.split("\n");
  const behaviorIdx = lines.findIndex((l) => l === "## 行为记录");
  const jottingsIdx = lines.findIndex((l) => l === "## 今日杂记");
  assert.equal(behaviorIdx, jottingsIdx - 4); // "", section, "", trace, ""
});

test("rule ③: heterogeneous diary (no 杂记 either) → fresh section at EOF", () => {
  const result = insertBehaviorTrace(HETEROGENEOUS_DIARY, TRACE);
  assert.ok(behaviorSectionOrderOk(result));
  assert.match(result, /\n\n## 行为记录\n\n- \*\*21:35\*\* ✅ INS-20260930-213501/);
  const records = parseBehaviorRecords(result);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "trace");
});

test("ensureBehaviorSection: idempotent, and creates an empty section before 杂记", () => {
  assert.equal(ensureBehaviorSection(TEMPLATE_DIARY), TEMPLATE_DIARY);
  const created = ensureBehaviorSection(OLD_DIARY_NO_SECTION);
  assert.match(created, /## 行为记录\n\n## 今日杂记/);
  assert.equal(ensureBehaviorSection(created), created);
});

test("insertBehaviorRecord: 📌 line lands in the section (record mode write path)", () => {
  const result = insertBehaviorRecord(TEMPLATE_DIARY, "23:40", "关灯");
  const records = parseBehaviorRecords(result);
  assert.ok(records.some((r) => r.kind === "behavior" && r.time === "23:40" && r.text === "关灯"));
  assert.ok(behaviorSectionOrderOk(result));
});

// ── Invariant over the real-shape fixture ───────────────

const fixture = readFileSync(
  new URL("./fixtures/diary-sample.md", import.meta.url),
  "utf8"
);

test("fixture: behavior writes keep the jottings parse intact (regression)", () => {
  const withBehavior = insertBehaviorRecord(fixture, "23:05", "上床睡觉");
  const withTrace = insertBehaviorTrace(withBehavior, TRACE);
  // both parses coexist: jottings unchanged, behavior + trace present
  assert.deepEqual(parseDailyNotes(withTrace).map((n) => n.time), [
    "09:29",
    "21:05",
  ]);
  const records = parseBehaviorRecords(withTrace);
  // file order: the created 行为记录 section sits before 杂记, so the inserted
  // 📌 line and trace precede the fixture's own 📌 line (inside 杂记, at EOF).
  assert.deepEqual(
    records.map((r) => [r.time, r.kind]),
    [
      ["23:05", "behavior"],
      ["21:35", "trace"],
      ["21:05", "behavior"],
    ]
  );
  assert.ok(behaviorSectionOrderOk(withTrace));
});
