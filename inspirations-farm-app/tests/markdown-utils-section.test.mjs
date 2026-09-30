import assert from "node:assert/strict";
import test from "node:test";

import { parseDailyNotes } from "../src/lib/markdown-utils.ts";

// Characterization tests — pin the CURRENT section-boundary behavior so the
// T1.3 fix (any-depth headings end daily sections) flips them deliberately.
//
// Today `parseDailyNotes` ends the ## 今日杂记 section only at an H1 heading
// or `---` (headingEnds: d === 1, thematicBreakEnds: true). An H2 sibling
// section does NOT end it, so content of the next H2 section — including the
// future ## 行为记录 section — is swallowed into the jottings parse.
//
// docs/plan/insights-v1/05-evidence-check.md 新发现 2: this affects 4 call
// sites (read path too, not only writes).

const H2_SIBLING_DIARY = `# 本日总结

- [x] 早起

## 今日杂记

- **10:00** 买牛奶

## 行为记录

- **23:05** 📌 上床睡觉
`;

test("characterization: H2 sibling section content is swallowed into 今日杂记 (current bug)", () => {
  const notes = parseDailyNotes(H2_SIBLING_DIARY);
  // The 23:05 behavior line is NOT part of 今日杂记, but the d===1 boundary
  // cannot see the H2 — this pins the bug T1.3 will fix.
  assert.equal(notes.length, 2);
  assert.equal(notes[0].time, "10:00");
  assert.equal(notes[1].time, "23:05");
  assert.match(notes[1].text, /📌 上床睡觉/);
});

test("characterization: H1 heading DOES end the section", () => {
  const diary = `## 今日杂记

- **10:00** 买牛奶

# 明日计划

- **23:05** 📌 上床睡觉
`;
  const notes = parseDailyNotes(diary);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].time, "10:00");
});

test("characterization: thematic break DOES end the section", () => {
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

test("characterization: missing section parses to empty", () => {
  assert.deepEqual(parseDailyNotes("# 本日总结\n\n没有杂记节\n"), []);
});

test("characterization: template order (行为记录 BEFORE 杂记) is currently safe", () => {
  // The vault template puts ## 行为记录 before ## 今日杂记. The jottings
  // section then extends to EOF, but nothing follows it — no swallowing.
  // (Write-side rules keep this order an invariant; see plan 01 §2.)
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
