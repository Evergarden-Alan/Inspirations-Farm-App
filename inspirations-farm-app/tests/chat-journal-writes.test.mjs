import assert from "node:assert/strict";
import test from "node:test";

import {
  appendInspirationCard,
  appendJournalEntry,
} from "../src/lib/chat/journal-writes.ts";
import { AI_COMMIT_PREFIX, JournalMissingError, WriteForbiddenError } from "../src/lib/chat/write-core.ts";
import { GitHubApiError } from "../src/lib/github-client.ts";

const note = { id: "note", owner: "a", repo: "Note", label: "日记/灵感库" };
const review = { id: "review", owner: "a", repo: "review_status-", label: "复习计划库" };

function io404On(paths) {
  return {
    getFile: async (repo, path) => {
      if (paths[path]) return { sha: "s0", content: paths[path] };
      throw new GitHubApiError("GitHub API error 404", 404);
    },
    putFile: async (repo, path, content, message, sha) => {
      paths[path] = content;
      return { commit: "c9", url: `https://github.com/a/${repo.repo}/commit/c9` };
    },
    getCommit: async () => { throw new Error("-"); },
    getFileAtRef: async () => { throw new Error("-"); },
    listMdPaths: async () => Object.keys(paths),
  };
}

const DAILY = `---
tags:
  - diary
date: 2026-10-05
---

# 近期计划

# 当日日程

- [ ] 复习数学 #p1

# 本日总结

## 今日杂记

- 08:00 早读
`;

test("appendJournalEntry appends timestamped bullet into 今日杂记", async () => {
  const paths = { "Journal/Daily/2026-10-05.md": DAILY };
  const io = io404On(paths);
  const res = await appendJournalEntry(note, "2026-10-05", "和参谋聊了计划调整", io, "14:32:00");
  assert.equal(res.commit, "c9");
  assert.equal(paths["Journal/Daily/2026-10-05.md"].includes("- **14:32:00** 和参谋聊了计划调整"), true);
  assert.ok(paths["Journal/Daily/2026-10-05.md"].startsWith("---"), "frontmatter 原样保留");
  const puts = [];
  // commit message 断言（重放一次拿 message）
  const io2 = {
    ...io,
    putFile: async (repo, path, content, message, sha) => {
      puts.push(message);
      return { commit: "c9", url: "u" };
    },
  };
  await appendJournalEntry(note, "2026-10-05", "再记一条", io2, "15:00:00");
  assert.equal(puts[0], `${AI_COMMIT_PREFIX}日记杂记 2026-10-05`);
});

test("appendJournalEntry finds archived daily by date suffix", async () => {
  const paths = { "Journal/Daily/2026/09/2026-09-28.md": DAILY };
  const io = io404On(paths);
  const res = await appendJournalEntry(note, "2026-09-28", "补记", io, "10:00:00");
  assert.equal(res.path, "Journal/Daily/2026/09/2026-09-28.md");
});

test("appendJournalEntry: missing daily → JournalMissingError; review repo → forbidden", async () => {
  const io = io404On({});
  await assert.rejects(
    () => appendJournalEntry(note, "2026-10-01", "x", io),
    JournalMissingError
  );
  await assert.rejects(
    () => appendJournalEntry(review, "2026-10-05", "x", io404On({ "Journal/Daily/2026-10-05.md": DAILY })),
    WriteForbiddenError
  );
});

test("appendInspirationCard creates timestamped card with insights frontmatter", async () => {
  const paths = {};
  const io = io404On(paths);
  const res = await appendInspirationCard(
    note,
    { title: "测试灵感", body: "先做检索再做向量", tags: ["ai-chat"], priority: "p1" },
    io,
    "2026-10-05-121500"
  );
  assert.equal(res.path, "Inspirations/AI-2026-10-05-121500.md");
  const content = paths["Inspirations/AI-2026-10-05-121500.md"];
  assert.ok(content.startsWith("---\ntype: inspiration\nstatus: active\ncreate: "));
  assert.ok(content.includes("priority: p1"));
  assert.ok(content.includes("tags: [ai-chat]"));
  assert.ok(content.includes("# 先做检索再做向量"));
});

test("appendInspirationCard retries on 422 (name exists)", async () => {
  let calls = 0;
  const io = {
    getFile: async () => { throw new GitHubApiError("404", 404); },
    putFile: async (repo, path) => {
      calls++;
      if (calls === 1) throw new GitHubApiError("GitHub API error 422", 422);
      return { commit: "c2", url: "u" };
    },
    getCommit: async () => { throw new Error("-"); },
    getFileAtRef: async () => { throw new Error("-"); },
    listMdPaths: async () => [],
  };
  const res = await appendInspirationCard(note, { title: "t", body: "b" }, io, "TS");
  assert.equal(res.path, "Inspirations/AI-TS-2.md");
});
