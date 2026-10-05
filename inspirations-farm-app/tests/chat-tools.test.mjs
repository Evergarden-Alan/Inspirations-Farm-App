import assert from "node:assert/strict";
import test from "node:test";

import { searchCorpus } from "../src/lib/chat/search.ts";
import { createChatTools } from "../src/lib/chat/tools.ts";
import { ensureCorpus } from "../src/lib/chat/corpus-cache.ts";
import { WriteForbiddenError } from "../src/lib/chat/write-core.ts";

function io(state) {
  return {
    getFile: async (repo, path) => {
      if (state.files[path] === undefined) throw new Error("404");
      return { sha: "s", content: state.files[path] };
    },
    putFile: async (repo, path, content, message, sha) => {
      state.puts.push({ repo: repo.id, path, content, message, sha });
      return { commit: "c" + state.puts.length, url: "u" + state.puts.length };
    },
    getCommit: async () => ({ parents: ["p0"] }),
    getFileAtRef: async (repo, path) => {
      const f = state.atRef?.[path];
      if (!f) throw new Error("404");
      return f;
    },
    listMdPaths: async () => state.tree,
  };
}

const REVIEW = { id: "review", owner: "a", repo: "r", label: "复习计划库" };
const NOTE = { id: "note", owner: "a", repo: "n", label: "日记/灵感库" };

test("searchCorpus matches literal query with line numbers and glob", async () => {
  const state = {
    tree: ["数学/w40/本周复习计划.md", "英语/w40/本周复习计划.md", "记忆库/心理/x.md"],
    files: {
      "数学/w40/本周复习计划.md": "周一：套卷\n周二：错题\n",
      "英语/w40/本周复习计划.md": "周一：阅读\n",
      "记忆库/心理/x.md": "状态一般\n",
    },
  };
  await ensureCorpus(REVIEW, io(state), { force: true, now: () => Date.now() });
  const { getCorpus } = await import("../src/lib/chat/corpus-cache.ts");
  const all = searchCorpus(getCorpus("review"), "周一");
  assert.equal(all.matches.length, 2);
  assert.equal(all.matches[0].lines[0].no, 1);
  const onlyMath = searchCorpus(getCorpus("review"), "周一", { glob: "数学/**" });
  assert.equal(onlyMath.matches.length, 1);
  assert.equal(onlyMath.matches[0].path, "数学/w40/本周复习计划.md");
});

test("tools: read_file returns cached content; miss returns ok:false error text", async () => {
  const state = {
    tree: ["a.md"], files: { "a.md": "AAA" },
  };
  await ensureCorpus(REVIEW, io(state), { force: true, now: () => Date.now() });
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const hit = await tools.read_file.execute({ repo: "review", path: "a.md" }, {});
  assert.equal(hit.ok, true);
  assert.equal(hit.content, "AAA");
  const miss = await tools.read_file.execute({ repo: "review", path: "nope.md" }, {});
  assert.equal(miss.ok, false);
  assert.ok(typeof miss.error === "string" && miss.error.length > 0);
});

test("tools: update_plan_file enforces review-only at tool layer and never throws", async () => {
  const state = {
    files: { "数学/w40/本周复习计划.md": "旧" },
    puts: [], tree: ["数学/w40/本周复习计划.md"],
  };
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const bad = await tools.update_plan_file.execute(
    { path: "Journal/Daily/2026-10-05.md", new_content: "x", reason: "测试注入" }, {}
  );
  assert.equal(bad.ok, false, "note 路径在 review 仓库不存在 → 文件级 404 转错误文本");
  // 直接对 note 仓库调用底层函数确认拒绝（提示注入也绕不过工具层）
  const { updatePlanFile } = await import("../src/lib/chat/plan-writes.ts");
  await assert.rejects(() => updatePlanFile(NOTE, "x.md", "c", "r", io(state)), WriteForbiddenError);

  const good = await tools.update_plan_file.execute(
    { path: "数学/w40/本周复习计划.md", new_content: "新", reason: "测试调整" }, {}
  );
  assert.equal(good.ok, true);
  assert.equal(good.commit, "c1");
  assert.equal(state.puts[0].message, "[ai-chat] 测试调整");
});

test("tools: append_journal routes to note repo with structured result", async () => {
  const daily = "# 本日总结\n\n## 今日杂记\n";
  const state = { files: { "Journal/Daily/2026-10-05.md": daily }, puts: [], tree: ["Journal/Daily/2026-10-05.md"] };
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const res = await tools.append_journal.execute(
    { date: "2026-10-05", text: "记一条", time: "09:00:00" }, {}
  );
  assert.equal(res.ok, true);
  assert.equal(res.path, "Journal/Daily/2026-10-05.md");
  assert.ok(state.puts[0].message.startsWith("[ai-chat]"));
});

test("tools: list_tree filters by dir prefix", async () => {
  const state = { files: {}, tree: ["数学/w40/本周复习计划.md", "英语/w40/本周复习计划.md"], puts: [] };
  await ensureCorpus(REVIEW, io(state), { force: true, now: () => Date.now() });
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const res = await tools.list_tree.execute({ repo: "review", dir: "数学" }, {});
  assert.deepEqual(res.paths, ["数学/w40/本周复习计划.md"]);
});

test("tools: missing corpus surfaces explicit error, never silent empty success", async () => {
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io({ files: {}, tree: [] }) });
  // 本文件此前只装载过 review；note 此时无缓存条目 → 必须显式报错
  const tree = await tools.list_tree.execute({ repo: "note" }, {});
  assert.equal(tree.ok, false, "缓存缺失 → 明确报错而非空列表");
  assert.ok(/未装载|权限|引导/.test(tree.error));
  const search = await tools.search_text.execute({ repo: "note", query: "x" }, {});
  assert.equal(search.ok, false, "search_text 同样不许静默空成功");
});
