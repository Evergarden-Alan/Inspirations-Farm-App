import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskLocator,
  insertImageAfterDailyNote,
  insertIntoDailyNotesSection,
  locateTask,
  parseDailyNotes,
  parseTasks,
  setTaskFocusDurationAtLine,
  transformWikilinkImages,
} from "../src/lib/markdown-utils.ts";

test("focus duration is written to the selected line before priority metadata", () => {
  const content = [
    "# 当日日程",
    "- [ ] 第一件事 #p1",
    "- [ ] 第二件事",
  ].join("\n");

  const updated = setTaskFocusDurationAtLine(content, 1, "25m");
  const lines = updated.split("\n");
  assert.equal(lines[0], "# 当日日程");
  assert.equal(lines[1], "- [ ] 第一件事 ⏱️25m #p1");
  assert.equal(lines[2], "- [ ] 第二件事");

  const [task] = parseTasks(updated);
  assert.equal(task.displayText, "第一件事");
  assert.equal(task.priority, "p1");
  assert.equal(task.focusDuration, "25m");
});

test("task metadata parser accepts both legacy suffix orders", () => {
  const tasks = parseTasks([
    "- [x] 优先任务 #p0 ⏱️1h05m",
    "- [x] 次要任务 ⏱️8m #p3",
  ].join("\n"));

  assert.deepEqual(
    tasks.map(({ displayText, priority, focusDuration }) => ({
      displayText,
      priority,
      focusDuration,
    })),
    [
      { displayText: "优先任务", priority: "p0", focusDuration: "1h05m" },
      { displayText: "次要任务", priority: "p3", focusDuration: "8m" },
    ]
  );
});

test("an explicit p2 remains p2 when duration follows it on a child task", () => {
  const tasks = parseTasks([
    "- [ ] 父任务 #p0",
    "  - [ ] 子任务 #p2 ⏱️9m",
  ].join("\n"));

  assert.equal(tasks[1].priority, "p2");
  assert.equal(tasks[1].focusDuration, "9m");
});

test("writing a new duration replaces the previous marker", () => {
  const content = "- [ ] 复盘 ⏱️12m #p2";
  const updated = setTaskFocusDurationAtLine(content, 0, "1h03m");

  assert.equal(updated, "- [ ] 复盘 ⏱️1h03m #p2");
  assert.equal(parseTasks(updated)[0].focusDuration, "1h03m");
});

test("focus duration append mode adds to the existing marker", () => {
  const content = "- [ ] 复盘 ⏱️12m #p2";
  const updated = setTaskFocusDurationAtLine(content, 0, "1h03m", true);

  assert.equal(updated, "- [ ] 复盘 ⏱️1h15m #p2");
  assert.equal(parseTasks(updated)[0].focusDuration, "1h15m");
});

test("task locators disambiguate duplicate child text by parent after lines shift", () => {
  const original = [
    "- [ ] A",
    "  - [ ] 相同任务",
    "- [ ] B",
    "  - [ ] 相同任务",
  ].join("\n");
  const originalTasks = parseTasks(original);
  const locator = createTaskLocator(originalTasks[3], originalTasks);

  const shiftedTasks = parseTasks(`- [ ] 新任务\n${original}`);
  const located = locateTask(shiftedTasks, locator);

  assert.equal(located?.lineNumber, 4);
  assert.equal(located?.parentId, shiftedTasks[3].id);
  assert.equal(shiftedTasks[3].displayText, "B");
});

test("task locators still resolve after focus metadata is written", () => {
  const original = "- [ ] 阅读文档 #p1";
  const tasks = parseTasks(original);
  const locator = createTaskLocator(tasks[0], tasks);
  const updated = setTaskFocusDurationAtLine(original, 0, "18m");
  const located = locateTask(parseTasks(updated), locator);

  assert.equal(located?.displayText, "阅读文档");
  assert.equal(located?.focusDuration, "18m");
  assert.equal(located?.priority, "p1");
});

test("invalid line or duration leaves markdown unchanged", () => {
  const content = "# 当日日程\n- [ ] 任务";
  assert.equal(setTaskFocusDurationAtLine(content, 0, "5m"), content);
  assert.equal(setTaskFocusDurationAtLine(content, 1, "invalid"), content);
});

test("focus metadata updates preserve an existing daily jotting", () => {
  const content = [
    "# 当日日程",
    "- [ ] 背单词",
    "",
    "---",
    "",
    "# 本日总结",
    "",
    "## 今日杂记",
    "",
  ].join("\n");
  const withNote = insertIntoDailyNotesSection(content, "21:17", "今天的复盘");
  const [task] = parseTasks(withNote);
  const updated = setTaskFocusDurationAtLine(withNote, task.lineNumber, "19m");

  const notes = parseDailyNotes(updated);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].time, "21:17");
  assert.equal(notes[0].text, "今天的复盘");
  assert.match(updated, /- \[ \] 背单词 ⏱️19m/);
});

test("full daily updates send the caller SHA without a preflight replacement", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    pat: process.env.GITHUB_PAT,
    owner: process.env.REPO_OWNER,
    repo: process.env.REPO_NAME,
  };
  const requests = [];

  process.env.GITHUB_PAT = "test-token";
  process.env.REPO_OWNER = "test-owner";
  process.env.REPO_NAME = "test-repo";
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ content: { sha: "server-result-sha" } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey = key === "pat" ? "GITHUB_PAT" : key === "owner" ? "REPO_OWNER" : "REPO_NAME";
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  });

  const { updateDailyJournal } = await import("../src/lib/github.ts");
  const result = await updateDailyJournal(
    "Journal/Daily/2026-07-28.md",
    "caller-sha",
    "latest caller content"
  );

  assert.deepEqual(result, { sha: "server-result-sha" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "PUT");
  assert.equal(JSON.parse(requests[0].options.body).sha, "caller-sha");
});

// ── Daily notes: continuation-aware parsing + image insertion ────────────

const NOTES_DOC = [
  "---",
  "date: 2026-09-13",
  "---",
  "# 当日日程",
  "",
  "- [ ] 任务一",
  "",
  "---",
  "# 本日总结",
  "",
  "## 今日杂记",
  "",
  "- **09:30** 早上想到的",
  "\t![[Pasted image 20260913093015.png]]",
  "- **14:00** 中午的截图",
  "- 昨天（9/12 周六）数学是主线：CO 5.2.2 指令周期数据流 18:57 勾选、真实完成",
  "- **14:00** 中午的截图",
  "",
  "稍后的顶格普通段落",
].join("\n");

test("parseDailyNotes keeps indented continuation lines with the note above", () => {
  const notes = parseDailyNotes(NOTES_DOC);

  // Column-0 plain bullets (AI planning notes) are NOT notes and NOT
  // continuations — the 14:00 note's text is its first line only.
  assert.deepEqual(
    notes.map((n) => n.text),
    [
      "早上想到的\n![[Pasted image 20260913093015.png]]",
      "中午的截图",
      "中午的截图",
    ]
  );
  assert.deepEqual(notes.map((n) => n.time), ["09:30", "14:00", "14:00"]);

  // Line anchors: bullet + continuation endLine; duplicates carry own indices.
  assert.equal(notes[0].lineNumber, 12);
  assert.equal(notes[0].endLine, 13);
  assert.equal(notes[1].lineNumber, 14);
  assert.equal(notes[1].endLine, 14);
});

test("parseDailyNotes returns [] when the section is missing", () => {
  assert.deepEqual(parseDailyNotes("# 别的文档\n\n- **09:30** 不是一个杂记章节里的"), []);
});

test("insertImageAfterDailyNote splices a tab-indented embed after the anchored note", () => {
  const updated = insertImageAfterDailyNote(
    NOTES_DOC,
    { time: "09:30", text: "早上想到的", occurrence: 0 },
    "Pasted image 20260913221301.png"
  );
  const lines = updated.split("\n");

  // Lands AFTER the existing continuation line (below the first image).
  assert.equal(lines[14], "\t![[Pasted image 20260913221301.png]]");
  // Byte-exact elsewhere.
  assert.equal(lines[12], "- **09:30** 早上想到的");
  assert.equal(lines[13], "\t![[Pasted image 20260913093015.png]]");
  assert.equal(lines[15], "- **14:00** 中午的截图");
  // Round-trip: the note now carries both embeds.
  const [note] = parseDailyNotes(updated);
  assert.equal(
    note.text,
    "早上想到的\n![[Pasted image 20260913093015.png]]\n![[Pasted image 20260913221301.png]]"
  );
});

test("insertImageAfterDailyNote disambiguates duplicate time+text by occurrence", () => {
  const first = insertImageAfterDailyNote(
    NOTES_DOC,
    { time: "14:00", text: "中午的截图", occurrence: 0 },
    "a.png"
  );
  assert.equal(first.split("\n")[15], "\t![[a.png]]");

  const second = insertImageAfterDailyNote(
    NOTES_DOC,
    { time: "14:00", text: "中午的截图", occurrence: 1 },
    "b.png"
  );
  // The duplicate 14:00 bullet is line 16; the embed goes right after it.
  assert.equal(second.split("\n")[17], "\t![[b.png]]");
});

test("insertImageAfterDailyNote handles the last note at EOF without a trailing newline", () => {
  const doc = "# 本日总结\n\n## 今日杂记\n\n- **23:59** 收尾记录";
  const updated = insertImageAfterDailyNote(
    doc,
    { time: "23:59", text: "收尾记录", occurrence: 0 },
    "late.png"
  );
  assert.equal(updated, doc + "\n\t![[late.png]]");
});

test("insertImageAfterDailyNote returns null on a missing anchor or section", () => {
  assert.equal(
    insertImageAfterDailyNote(NOTES_DOC, { time: "09:30", text: "已被编辑的文本", occurrence: 0 }, "x.png"),
    null
  );
  assert.equal(
    insertImageAfterDailyNote(NOTES_DOC, { time: "09:30", text: "早上想到的", occurrence: 5 }, "x.png"),
    null
  );
  assert.equal(
    insertImageAfterDailyNote("# 无章节", { time: "09:30", text: "任何", occurrence: 0 }, "x.png"),
    null
  );
});

test("addNote insertion still appends after image-carrying notes (existing embeds not mangled)", () => {
  const updated = insertIntoDailyNotesSection(
    NOTES_DOC,
    "22:00",
    "新的一条"
  );
  const lines = updated.split("\n");
  // Appended at the section end, before trailing blank handling — the new
  // bullet lands after the blank line that closes the last note block.
  assert.equal(lines[lines.length - 1], "- **22:00** 新的一条");
  assert.ok(updated.includes("\t![[Pasted image 20260913093015.png]]"));
});

// ── Wikilink image transform ─────────────────────────────────────────────

test("transformWikilinkImages rewrites image embeds to proxied markdown images", () => {
  const out = transformWikilinkImages(
    "看这张：![[Pasted image 20260913120000.png]] 以及 ![[(外部) 图.png]]"
  );
  // ASCII parens survive encodeURIComponent unescaped (valid query syntax);
  // CJK and spaces are percent-encoded.
  assert.equal(
    out,
    "看这张：![](/api/attachment?file=Pasted%20image%2020260913120000.png) 以及 ![](/api/attachment?file=(%E5%A4%96%E9%83%A8)%20%E5%9B%BE.png)"
  );
});

test("transformWikilinkImages keeps captions, paths and case; ignores non-images", () => {
  const out = transformWikilinkImages(
    "![[Assets/Sources/x.png|备注文字]] ![[SomeNote]] ![[doc.pdf]] [[2026-06-19-113215|链接]]"
  );
  assert.ok(out.includes('![备注文字](/api/attachment?file=x.png)'));
  assert.ok(out.includes("![[SomeNote]]"));
  assert.ok(out.includes("![[doc.pdf]]"));
  assert.ok(out.includes("[[2026-06-19-113215|链接]]"));
  // Idempotent.
  assert.equal(transformWikilinkImages(out), out);
});

test("transformWikilinkImages leaves embeds inside code untouched", () => {
  const doc = [
    "正文 ![[ok.png]]",
    "",
    "```md",
    "![[inside-fence.png]]",
    "```",
    "",
    "行内代码 `![[inline.png]]` 保留",
  ].join("\n");
  const out = transformWikilinkImages(doc);
  assert.ok(out.includes("![](/api/attachment?file=ok.png)"));
  assert.ok(out.includes("![[inside-fence.png]]"));
  assert.ok(out.includes("`![[inline.png]]`"));
});

test("transformWikilinkImages preserves numbers in prose (inline-code masking is safe)", () => {
  const out = transformWikilinkImages("共有 3 个选项，编号 42 有效");
  assert.equal(out, "共有 3 个选项，编号 42 有效");
});
