import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  insertImageAfterDailyNote,
  insertIntoDailyNotesSection,
  parseDailyNotes,
} from "../src/lib/markdown-utils.ts";

// Section-boundary regression tests.
//
// History: sections used to end only at H1/`---` (headingEnds: d === 1), so an
// H2 sibling — notably ## 行为记录 next to ## 今日杂记 — never terminated the
// section and its content was swallowed (docs/plan/insights-v1/05 新发现 2).
// All four daily call sites now end sections at ANY heading depth; these tests
// pin the fixed behavior (they were characterization tests pre-T1.3).

const H2_SIBLING_DIARY = `# 本日总结

- [x] 早起

## 今日杂记

- **10:00** 买牛奶

## 行为记录

- **23:05** 📌 上床睡觉
`;

test("H2 sibling section ends 今日杂记 — its content is NOT swallowed", () => {
  const notes = parseDailyNotes(H2_SIBLING_DIARY);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].time, "10:00");
});

test("H1 heading ends the section", () => {
  const diary = `## 今日杂记

- **10:00** 买牛奶

# 明日计划

- **23:05** 📌 上床睡觉
`;
  const notes = parseDailyNotes(diary);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].time, "10:00");
});

test("thematic break ends the section", () => {
  const diary = `## 今日杂记

- **10:00** 买牛奶

---

## 行为记录

- **23:05** 📌 上床睡觉
`;
  const notes = parseDailyNotes(diary);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].time, "10:00");
});

test("missing section parses to empty", () => {
  assert.deepEqual(parseDailyNotes("# 本日总结\n\n没有杂记节\n"), []);
});

test("template order (行为记录 BEFORE 杂记) parses the jottings section only", () => {
  // The vault template puts ## 行为记录 before ## 今日杂记 (plan T0.6).
  const diary = `# 本日总结

## 行为记录

- **23:05** 📌 上床睡觉

## 今日杂记

- **10:00** 买牛奶
`;
  const notes = parseDailyNotes(diary);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].time, "10:00");
});

test("insertIntoDailyNotesSection: sibling H2 after 杂记 doesn't capture new notes", () => {
  const result = insertIntoDailyNotesSection(H2_SIBLING_DIARY, "22:15", "写日记");
  const notes = parseDailyNotes(result);
  // The new note lands inside 今日杂记 (which the 行为记录 heading now ends),
  // and the behavior section's line stays put — one behavior line, two notes.
  assert.deepEqual(
    notes.map((n) => n.time),
    ["10:00", "22:15"]
  );
  assert.match(result, /## 行为记录\n\n- \*\*23:05\*\* 📌 上床睡觉/);
});

test("insertImageAfterDailyNote: embed attaches inside 杂记 even with a sibling H2", () => {
  const result = insertImageAfterDailyNote(
    H2_SIBLING_DIARY,
    { time: "10:00", text: "买牛奶", occurrence: 0 },
    "Pasted image 20261001090000.png"
  );
  assert.ok(result);
  // Embed lands as a tab-indented continuation of the 10:00 note, above the
  // ## 行为记录 heading.
  const lines = result.split("\n");
  const embedIdx = lines.findIndex((l) => l.includes("![[Pasted image"));
  const behaviorIdx = lines.findIndex((l) => l === "## 行为记录");
  const noteIdx = lines.findIndex((l) => l.includes("10:00"));
  assert.ok(embedIdx > noteIdx && embedIdx < behaviorIdx);
  assert.equal(lines[embedIdx], "\t![[Pasted image 20261001090000.png]]");
});

// ── Real-shape diary fixture (sanitized from a live journal) ────────────
//
// Structure pinned from the actual vault: frontmatter, three H1 sections
// separated by `---`, tasks with tab-indented subtasks + ⏱/#p markers, a
// 今日杂记 section containing BOTH plain bullets (Obsidian free text) and
// **HH:mm** notes with tab-indented image-embed continuations, EOF-terminated.

const fixture = readFileSync(
  new URL("./fixtures/diary-sample.md", import.meta.url),
  "utf8"
);

test("fixture: only **HH:mm** bullets parse as notes; plain bullets ignored", () => {
  const notes = parseDailyNotes(fixture);
  assert.deepEqual(
    notes.map((n) => n.time),
    ["09:29", "21:05"]
  );
  // image embed stays a continuation of its note
  assert.match(notes[0].text, /!\\?\[\[Pasted image 20260930092919\.png\]\]/);
});

test("fixture: insert appends at the end of 今日杂记, other sections untouched", () => {
  const result = insertIntoDailyNotesSection(fixture, "22:00", "新增占位");
  const notes = parseDailyNotes(result);
  assert.deepEqual(
    notes.map((n) => n.time),
    ["09:29", "21:05", "22:00"]
  );
  // tasks survived byte-for-byte
  const taskCount = (s) => (s.match(/^- \[[ x]\] /gm) || []).length;
  assert.equal(taskCount(result), taskCount(fixture));
  // new note is the last line of the file (杂记 is EOF-terminated)
  assert.ok(result.trimEnd().endsWith("- **22:00** 新增占位"));
});
