import assert from "node:assert/strict";

import { ensureCorpus, getCorpus } from "../src/lib/chat/corpus-cache.ts";
import { assembleHotSet } from "../src/lib/chat/hot-set.ts";
import { searchCorpus } from "../src/lib/chat/search.ts";
import { updatePlanFile, revertPlanFile } from "../src/lib/chat/plan-writes.ts";
import { appendJournalEntry } from "../src/lib/chat/journal-writes.ts";

const REVIEW = { id: "review", owner: "a", repo: "review_status-", label: "复习计划库" };
const NOTE = { id: "note", owner: "a", repo: "Note", label: "日记/灵感库" };

// ── fixture：两个远程仓库的最小镜像 ─────────────────────
const files = {
  "宏观复习规划.md": "# 宏观三阶段\nW29-W51",
  "408/w40/本周复习计划.md": "# 408 W40\n- 周三 套卷",
  "数学/w40/本周复习计划.md": "# 数学 W40\n- 周一 错题\n- 周四 套卷",
  "英语/w40/本周复习计划.md": "# 英语 W40\n- 每天 阅读",
  "Journal/Daily/2026-10-05.md":
    "---\ntags:\n  - diary\ndate: 2026-10-05\n---\n\n# 本日总结\n\n## 今日杂记\n\n- 08:00 早读\n",
};
const puts = [];
const io = {
  getFile: async (repo, path) => {
    if (files[path] === undefined) throw new Error("404");
    return { sha: "s-" + path, content: files[path] };
  },
  putFile: async (repo, path, content, message, sha) => {
    puts.push({ repo: repo.id, path, content, message, sha });
    files[path] = content;
    return { commit: "c" + puts.length, url: `https://example/c${puts.length}` };
  },
  getCommit: async () => ({ parents: ["parent"] }),
  getFileAtRef: async (repo, path) => {
    // fixture：父版本内容固定
    return { sha: "s-parent", content: files[path] + "\n<!-- parent -->" };
  },
  listMdPaths: async () => Object.keys(files),
};

// ── 场景 1：装载 → 热集 → 检索 ──────────────────────────
await ensureCorpus(REVIEW, io, { force: true, now: () => Date.now() });
await ensureCorpus(NOTE, io, { force: true, now: () => Date.now() });
const hot = await assembleHotSet(
  { note: NOTE, review: REVIEW },
  io,
  new Date("2026-09-30T12:00:00+08:00")
);
assert.ok(hot.text.includes("数学 W40"), "热集含本周数学计划");
assert.ok(hot.text.includes("宏观三阶段"), "热集含宏观规划");

const hits = searchCorpus(getCorpus("review"), "套卷");
assert.ok(hits.matches.length >= 2, "检索命中 408 与数学的套卷");

// ── 场景 2：改计划 → [ai-chat] commit → 回滚 ─────────────
const planPath = "数学/w40/本周复习计划.md";
const original = files[planPath];
const write = await updatePlanFile(REVIEW, planPath, "# 数学 W40\n- 周二 套卷", "套卷挪至周二", io);
assert.equal(write.commit, "c1");
assert.equal(puts[0].message, "[ai-chat] 套卷挪至周二");

// 回滚父版本内容 ≠ 当前内容 → 实际写回
const rolled = await revertPlanFile(REVIEW, planPath, write.commit, {
  ...io,
  getFileAtRef: async () => ({ sha: "s-parent", content: original }),
});
assert.equal(rolled.alreadyReverted, false);
assert.equal(files[planPath], original, "回滚后内容恢复原样");
assert.ok(puts[1].message.startsWith("[ai-chat] revert"));

// ── 场景 3：日记追加（frontmatter 不动、粗体时间戳 bullet）────
await appendJournalEntry(NOTE, "2026-10-05", "参谋记录：计划已调", io, "21:10:00");
const daily = files["Journal/Daily/2026-10-05.md"];
assert.ok(daily.startsWith("---"), "frontmatter 保留");
assert.ok(daily.includes("- **21:10:00** 参谋记录：计划已调"));
assert.ok(puts[2].message === "[ai-chat] 日记杂记 2026-10-05");

console.log("verify:chat ✓ 语料/热集/检索/写入/回滚/追加 全链路离线通过");
