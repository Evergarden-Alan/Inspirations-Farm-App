import assert from "node:assert/strict";
import test from "node:test";

import {
  corpusCoverage,
  corpusPriority,
  ensureCorpus,
  getCorpus,
} from "../src/lib/chat/corpus-cache.ts";

// 直接构造 ChatRepo 形状，避免依赖 env
const review = { id: "review", owner: "a", repo: "r", label: "复习计划库" };
const note = { id: "note", owner: "a", repo: "n", label: "日记/灵感库" };

function fakeIo(paths, delayMs = 0) {
  return {
    getFile: async (repo, path) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (!paths.contents[path]) throw new Error("404");
      return { sha: "s", content: paths.contents[path] };
    },
    putFile: async () => {
      throw new Error("not used");
    },
    getCommit: async () => {
      throw new Error("not used");
    },
    getFileAtRef: async () => {
      throw new Error("not used");
    },
    listMdPaths: async () => paths.tree,
  };
}

test("ensureCorpus loads all md files within budget and caches", async () => {
  const io = fakeIo({
    tree: ["宏观复习规划.md", "数学/w39/旧.md", "数学/w40/本周复习计划.md"],
    contents: { "宏观复习规划.md": "M", "数学/w39/旧.md": "O", "数学/w40/本周复习计划.md": "W40" },
  });
  const entry = await ensureCorpus(review, io, { now: () => 1_000_000 });
  assert.equal(entry.files.get("数学/w40/本周复习计划.md"), "W40");
  assert.equal(entry.partial, false);
  assert.equal(getCorpus("review"), entry);
  assert.deepEqual(corpusCoverage("review"), {
    cached: 3,
    total: 3,
    fetchedAt: 1_000_000,
    partial: false,
  });
});

test("ensureCorpus respects TTL and force refresh", async () => {
  let clock = 1_000_000;
  const io = fakeIo({ tree: ["a.md"], contents: { "a.md": "A" } });
  const first = await ensureCorpus(review, io, { now: () => clock });
  const second = await ensureCorpus(review, io, { now: () => clock + 60_000 });
  assert.equal(first, second); // TTL 内命中缓存
  const third = await ensureCorpus(review, io, { now: () => clock + 600_000, force: false });
  assert.notEqual(first, third); // TTL 过期重载
});

test("ensureCorpus marks partial when budget exhausted, recent week first", async () => {
  // 门控 + 虚拟时钟：12 个文件、并发 10 → 前 10 个先过预算检查被门挡住；
  // 把虚拟时钟拨过 deadline 后放行，队尾 2 个（Archive 尾部）应被跳过。
  const tree = [
    "数学/w20/本周复习计划.md",
    "数学/w40/本周复习计划.md",
    "记忆库/心理/x.md",
    ...Array.from({ length: 9 }, (_, i) => `Archive/旧${i + 1}.md`),
  ];
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const io = {
    getFile: async (repo, path) => {
      await gate;
      return { sha: "s", content: "C:" + path };
    },
    putFile: async () => {
      throw new Error("not used");
    },
    getCommit: async () => {
      throw new Error("not used");
    },
    getFileAtRef: async () => {
      throw new Error("not used");
    },
    listMdPaths: async () => tree,
  };
  let virtual = 1_000;
  const promise = ensureCorpus(review, io, {
    budgetMs: 100,
    force: true, // 前面的测试可能留下 fetchedAt 在"未来"的缓存（模块级共享）
    now: () => virtual,
  });
  await new Promise((r) => setTimeout(r, 10)); // 前 10 个已过检查、在门后等待
  virtual = 1_000 + 101; // 预算耗尽
  release();
  const entry = await promise;
  assert.equal(entry.partial, true);
  assert.ok(entry.files.has("数学/w40/本周复习计划.md"), "最近周优先载入");
  assert.ok(entry.files.has("记忆库/心理/x.md"), "记忆库优先级高于 Archive");
  assert.ok(
    !entry.files.has("Archive/旧9.md") && !entry.files.has("Archive/旧10.md"),
    "队尾文件被预算截断"
  );
});

test("corpusPriority: review recent week < memory < archive; note recent daily first", () => {
  const today = "2026-10-05";
  const recentWeek = corpusPriority("review", "数学/w40/本周复习计划.md", today);
  const oldWeek = corpusPriority("review", "数学/w20/本周复习计划.md", today);
  const memory = corpusPriority("review", "记忆库/心理/x.md", today);
  const archive = corpusPriority("review", "Archive/旧.md", today);
  assert.ok(recentWeek < oldWeek);
  assert.ok(oldWeek < memory);
  assert.ok(memory < archive);

  const todayDaily = corpusPriority("note", "Journal/Daily/2026-10-05.md", today);
  const weekOldDaily = corpusPriority("note", "Journal/Daily/2026/09/2026-09-28.md", today);
  const inspiration = corpusPriority("note", "Inspirations/AI-20261005.md", today);
  assert.ok(todayDaily < weekOldDaily);
  assert.ok(weekOldDaily < inspiration);
});

test("readThrough hits cache then falls back to network on miss", async () => {
  const io = fakeIo({
    tree: ["a.md", "b.md"],
    contents: { "a.md": "A", "b.md": "B", "c.md": "C" },
  });
  await ensureCorpus(note, io, { now: () => Date.now() });
  const { readThrough } = await import("../src/lib/chat/corpus-cache.ts");
  assert.equal(await readThrough(note, "a.md", io), "A");
  assert.equal(await readThrough(note, "c.md", io), "C"); // 未在 tree 里 → 回源成功并入缓存
  assert.equal(await readThrough(note, "missing.md", io), null); // 404 → null
});
