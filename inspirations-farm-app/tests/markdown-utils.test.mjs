import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskLocator,
  insertIntoDailyNotesSection,
  locateTask,
  parseDailyNotes,
  parseTasks,
  setTaskFocusDurationAtLine,
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

  assert.deepEqual(parseDailyNotes(updated), [
    { time: "21:17", text: "今天的复盘" },
  ]);
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
