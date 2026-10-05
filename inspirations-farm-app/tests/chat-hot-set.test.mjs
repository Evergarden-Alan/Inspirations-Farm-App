import assert from "node:assert/strict";
import test from "node:test";

import {
  isoWeek,
  minusDays,
  resolveHotSetPaths,
  weekLabel,
} from "../src/lib/chat/hot-set.ts";

test("isoWeek handles year boundaries", () => {
  assert.deepEqual(isoWeek(new Date("2026-01-01T12:00:00+08:00")), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(new Date("2026-10-05T12:00:00+08:00")), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek(new Date("2027-01-01T12:00:00+08:00")), { year: 2026, week: 53 });
});

test("weekLabel zero-pads", () => {
  assert.equal(weekLabel({ week: 5 }), "w05");
  assert.equal(weekLabel({ week: 40 }), "w40");
});

test("minusDays crosses month", () => {
  assert.equal(minusDays("2026-10-05", 7), "2026-09-28");
  assert.equal(minusDays("2026-03-01", 1), "2026-02-28");
});

test("resolveHotSetPaths review: macro + current week plans + latest summary", () => {
  const tree = [
    "宏观复习规划.md",
    "总览.md",
    "408/w39/本周复习计划.md",
    "408/w40/本周复习计划.md",
    "数学/w40/本周复习计划.md",
    "数学/w40/本周总结.md",
    "英语/w40/本周复习计划.md",
    "数学/w39/本周总结.md",
    "记忆库/心理/x.md",
  ];
  const paths = resolveHotSetPaths("review", tree, "2026-09-30");
  assert.ok(paths.includes("宏观复习规划.md"));
  assert.ok(paths.includes("408/w40/本周复习计划.md"));
  assert.ok(paths.includes("数学/w40/本周复习计划.md"));
  assert.ok(paths.includes("英语/w40/本周复习计划.md"));
  assert.ok(paths.includes("数学/w40/本周总结.md"), "取最近周的总结");
  assert.ok(!paths.includes("数学/w39/本周总结.md"));
  assert.ok(!paths.includes("408/w39/本周复习计划.md"), "不要旧周计划");
});

test("resolveHotSetPaths note: last 7 days incl. nested monthly layout", () => {
  const tree = [
    "Journal/Daily/2026-10-04.md",
    "Journal/Daily/2026-10-05.md",
    "Journal/Daily/2026/09/2026-09-30.md",
    "Journal/Daily/2026/09/2026-09-28.md",
    "Inspirations/x.md",
  ];
  const paths = resolveHotSetPaths("note", tree, "2026-10-05");
  assert.ok(paths.includes("Journal/Daily/2026-10-05.md"));
  assert.ok(paths.includes("Journal/Daily/2026/09/2026-09-30.md"));
  assert.ok(!paths.includes("Inspirations/x.md"));
  assert.ok(paths.length <= 7);
});

test("assembleHotSet skips missing files and flags degraded when nothing loads", async () => {
  const { assembleHotSet } = await import("../src/lib/chat/hot-set.ts");
  const repos = {
    note: { id: "note", owner: "a", repo: "n", label: "日记/灵感库" },
    review: { id: "review", owner: "a", repo: "r", label: "复习计划库" },
  };
  const present = { "宏观复习规划.md": "# 宏观计划" };
  const io = {
    getFile: async (repo, path) => {
      if (present[path]) return { sha: "s", content: present[path] };
      throw new Error("404");
    },
  };
  // 预置缓存：assembleHotSet 依赖 getCorpus，测试里先用 ensureCorpus 造缓存
  const { ensureCorpus } = await import("../src/lib/chat/corpus-cache.ts");
  await ensureCorpus(repos.review, {
    getFile: io.getFile,
    putFile: async () => { throw new Error("-"); },
    getCommit: async () => { throw new Error("-"); },
    getFileAtRef: async () => { throw new Error("-"); },
    listMdPaths: async () => ["宏观复习规划.md", "数学/w40/本周复习计划.md"],
  }, { now: () => Date.now() });

  const result = await assembleHotSet(repos, io, new Date("2026-09-30T12:00:00+08:00"));
  assert.ok(result.text.includes("# 宏观计划"));
  assert.ok(result.loaded.includes("宏观复习规划.md"));
  assert.ok(
    result.missing.includes("数学/w40/本周复习计划.md"),
    "树里有但缓存缺失的文件进 missing 清单"
  );
  assert.equal(result.degraded, false);
});
