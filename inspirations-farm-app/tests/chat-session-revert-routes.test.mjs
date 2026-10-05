import assert from "node:assert/strict";
import test from "node:test";

import { createChatSessionRoute } from "../src/app/api/chat/session/route.ts";
import { createChatRevertRoute } from "../src/app/api/chat/revert/route.ts";

const PIN = "135791";

function req(body, headers = { "x-app-pin": PIN }) {
  return { headers: new Headers(headers), json: async () => body };
}

test.before(() => {
  process.env.APP_PIN = PIN;
  process.env.REPO_OWNER = "a";
  process.env.REPO_NAME = "Note";
  process.env.REVIEW_REPO_OWNER = "a";
  process.env.REVIEW_REPO_NAME = "review_status-";
});
test.after(() => {
  for (const k of ["APP_PIN", "REPO_OWNER", "REPO_NAME", "REVIEW_REPO_OWNER", "REVIEW_REPO_NAME"]) {
    delete process.env[k];
  }
});

test("session route: 401 without PIN", async () => {
  const { POST } = createChatSessionRoute({ ensure: async () => ({}) });
  assert.equal((await POST(req({}, {}))).status, 401);
});

test("session route: reports coverage and degraded on partial failure", async () => {
  let calls = 0;
  const { POST } = createChatSessionRoute({
    ensure: async (repo) => {
      calls++;
      if (repo.id === "review") throw new Error("github down");
      return { files: new Map(), treePaths: ["a.md"], fetchedAt: 1, partial: false };
    },
  });
  const res = await POST(req({}));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.degraded, true, "review 失败 → degraded");
  assert.equal(calls, 2);
  assert.ok(typeof body.hotSetChars === "number");
});

test("revert route: 401 / 400 / happy path with injected revert", async () => {
  const calls = [];
  const { POST } = createChatRevertRoute({
    revert: async (repo, path, commit) => {
      calls.push({ repo: repo.id, path, commit });
      return { path, commit: "cNew", url: "u", alreadyReverted: false };
    },
  });
  assert.equal((await POST(req({}, {}))).status, 401);
  assert.equal((await POST(req({ repoId: "review" }))).status, 400);
  assert.equal((await POST(req({ repoId: "note", path: "x.md", commit: "c" }))).status, 400);

  const res = await POST(req({ repoId: "review", path: "数学/w40/本周复习计划.md", commit: "cAI" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.commit, "cNew");
  assert.equal(calls[0].repo, "review");
});
