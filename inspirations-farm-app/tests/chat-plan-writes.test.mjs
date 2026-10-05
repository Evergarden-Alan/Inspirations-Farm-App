import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_COMMIT_PREFIX,
  WriteForbiddenError,
} from "../src/lib/chat/write-core.ts";
import { revertPlanFile, updatePlanFile } from "../src/lib/chat/plan-writes.ts";
import { GitHubConflictError } from "../src/lib/github-client.ts";

const review = { id: "review", owner: "a", repo: "review_status-", label: "复习计划库" };
const note = { id: "note", owner: "a", repo: "Note", label: "日记/灵感库" };

function fakeIo(state) {
  // state: { files: Map<path, {sha, content}>, puts: [] }
  return {
    getFile: async (repo, path) => {
      const f = state.files.get(path);
      if (!f) throw new Error("404");
      return { ...f };
    },
    putFile: async (repo, path, content, message, sha) => {
      if (state.conflictOnce && !state.conflicted) {
        state.conflicted = true;
        throw new GitHubConflictError("stale sha");
      }
      state.puts.push({ path, content, message, sha });
      const commit = "c" + state.puts.length;
      state.files.set(path, { sha: "s-" + commit, content });
      return { commit, url: `https://github.com/a/${repo.repo}/commit/${commit}` };
    },
    getCommit: async (repo, sha) => ({ parents: [state.parents[sha] ?? "root"] }),
    getFileAtRef: async (repo, path, ref) => {
      const f = state.atRef.get(`${path}@${ref}`);
      if (!f) throw new Error("404 at ref");
      return { ...f };
    },
    listMdPaths: async () => [],
  };
}

test("updatePlanFile writes with [ai-chat] prefix and returns commit", async () => {
  const state = { files: new Map([["数学/w40/本周复习计划.md", { sha: "s0", content: "旧" }]]), puts: [] };
  const res = await updatePlanFile(
    review, "数学/w40/本周复习计划.md", "新内容", "套卷提前至周三", fakeIo(state)
  );
  assert.equal(res.commit, "c1");
  assert.ok(res.url.includes("/commit/c1"));
  assert.equal(state.puts[0].message, `${AI_COMMIT_PREFIX}套卷提前至周三`);
  assert.equal(state.puts[0].sha, "s0");
});

test("updatePlanFile retries once on 409 with fresh sha", async () => {
  const state = {
    files: new Map([["数学/w40/本周复习计划.md", { sha: "s0", content: "旧" }]]),
    puts: [], conflictOnce: true,
  };
  const io = fakeIo(state);
  const res = await updatePlanFile(review, "数学/w40/本周复习计划.md", "新", "调整", io);
  assert.equal(res.commit, "c1");
  assert.equal(state.puts[0].sha, "s0", "重试时用重 GET 的新 sha");
});

test("updatePlanFile forbids note repo, non-md and traversal", async () => {
  const io = fakeIo({ files: new Map(), puts: [] });
  await assert.rejects(
    () => updatePlanFile(note, "Journal/Daily/x.md", "c", "r", io),
    WriteForbiddenError
  );
  await assert.rejects(
    () => updatePlanFile(review, "数学/w40/计划.txt", "c", "r", io),
    WriteForbiddenError
  );
  await assert.rejects(
    () => updatePlanFile(review, "../escape.md", "c", "r", io),
    WriteForbiddenError
  );
});

test("revertPlanFile restores parent content and is idempotent", async () => {
  const parent = { sha: "p0", content: "父版本" };
  const state = {
    files: new Map([["数学/w40/本周复习计划.md", { sha: "s1", content: "AI改过的" }]]),
    puts: [], parents: { "cAI": "p0" },
    atRef: new Map([["数学/w40/本周复习计划.md@p0", parent]]),
  };
  const io = fakeIo(state);
  const res = await revertPlanFile(review, "数学/w40/本周复习计划.md", "cAI", io);
  assert.equal(res.alreadyReverted, false);
  assert.equal(state.puts[0].content, "父版本");
  assert.equal(state.puts[0].message, `${AI_COMMIT_PREFIX}revert cAI 数学/w40/本周复习计划.md`);

  // 再滚一次：当前内容已等于父版本 → 幂等空操作
  const again = await revertPlanFile(review, "数学/w40/本周复习计划.md", "cAI", {
    ...io,
    getFile: async () => ({ sha: "s2", content: "父版本" }),
  });
  assert.equal(again.alreadyReverted, true);
});

test("writes go through to corpus cache so AI never reads its own stale write", async () => {
  const state = { files: new Map([["数学/w40/本周复习计划.md", { sha: "s0", content: "旧" }]]), puts: [] };
  const io = fakeIo(state);
  io.listMdPaths = async () => ["数学/w40/本周复习计划.md"];
  const { ensureCorpus, getCorpus } = await import("../src/lib/chat/corpus-cache.ts");
  await ensureCorpus(review, io, { force: true, now: () => Date.now() });

  const path = "数学/w40/本周复习计划.md";
  await updatePlanFile(review, path, "新内容", "写入后缓存同步", io);
  assert.equal(getCorpus("review")?.files.get(path), "新内容", "update 后缓存即新值");

  const parent = { sha: "p0", content: "父版本内容" };
  await revertPlanFile(review, path, "c1", {
    ...io,
    getCommit: async () => ({ parents: ["p0"] }),
    getFileAtRef: async () => parent,
  });
  assert.equal(getCorpus("review")?.files.get(path), "父版本内容", "revert 后缓存同步父版本");
});
