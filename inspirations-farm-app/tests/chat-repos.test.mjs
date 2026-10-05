import assert from "node:assert/strict";
import test from "node:test";

import { ChatConfigError, getChatRepos } from "../src/lib/chat/repos.ts";

test("getChatRepos maps note from REPO_* and review from REVIEW_REPO_*", () => {
  const repos = getChatRepos({
    REPO_OWNER: "alan",
    REPO_NAME: "Note",
    REVIEW_REPO_OWNER: "alan",
    REVIEW_REPO_NAME: "review_status-",
  });
  assert.equal(repos.note.id, "note");
  assert.equal(repos.note.repo, "Note");
  assert.equal(repos.review.id, "review");
  assert.equal(repos.review.repo, "review_status-");
});

test("getChatRepos throws ChatConfigError when REVIEW_REPO_* missing", () => {
  assert.throws(
    () => getChatRepos({ REPO_OWNER: "alan", REPO_NAME: "Note" }),
    ChatConfigError
  );
});

test("createChatGithubIo getFile decodes content and guards traversal", async () => {
  const { createChatGithubIo } = await import("../src/lib/chat/github-chat.ts");
  const calls = [];
  const io = createChatGithubIo({
    pat: "pat-test",
    fetch: async (creds, path) => {
      calls.push({ pat: creds.pat, path });
      if (path.includes("contents/a%2Fb.md")) {
        return { sha: "s1", content: btoa("hello"), encoding: "base64" };
      }
      throw new Error("unexpected " + path);
    },
  });
  const repos = getChatRepos({
    REPO_OWNER: "alan",
    REPO_NAME: "Note",
    REVIEW_REPO_OWNER: "alan",
    REVIEW_REPO_NAME: "review_status-",
  });
  const file = await io.getFile(repos.note, "a/b.md");
  assert.equal(file.sha, "s1");
  assert.equal(file.content, "hello");
  assert.equal(calls[0].pat, "pat-test");
  assert.ok(calls[0].path.startsWith("/repos/alan/Note/contents/"));
  await assert.rejects(() => io.getFile(repos.note, "../escape.md"));
});
