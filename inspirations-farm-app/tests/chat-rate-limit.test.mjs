import assert from "node:assert/strict";
import test from "node:test";

test("githubFetchFor maps rate-limited 403 to GitHubRateLimitError with reset time", async () => {
  const { createChatGithubIo } = await import("../src/lib/chat/github-chat.ts");
  const { GitHubRateLimitError } = await import("../src/lib/github-client.ts");

  const resetEpoch = Math.floor(Date.now() / 1000) + 1800;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 403,
    headers: { get: (k) => (k.toLowerCase() === "x-ratelimit-remaining" ? "0" : String(resetEpoch)) },
    text: async () => JSON.stringify({ message: "API rate limit exceeded" }),
  }));
  try {
    const io = createChatGithubIo({ pat: "p" });
    await assert.rejects(() => io.getFile({ id: "note", owner: "a", repo: "n" }, "a.md"), (err) => {
      assert.ok(err instanceof GitHubRateLimitError);
      assert.equal(err.resetAt.getTime(), resetEpoch * 1000);
      assert.ok(/配额/.test(err.message));
      return true;
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("non-rate-limit 403 stays a plain GitHubApiError", async () => {
  const { createChatGithubIo } = await import("../src/lib/chat/github-chat.ts");
  const { GitHubApiError, GitHubRateLimitError } = await import("../src/lib/github-client.ts");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 403,
    headers: { get: (k) => (k.toLowerCase() === "x-ratelimit-remaining" ? "4213" : "0") },
    text: async () => JSON.stringify({ message: "Resource not accessible by personal access token" }),
  }));
  try {
    const io = createChatGithubIo({ pat: "p" });
    await assert.rejects(() => io.getFile({ id: "note", owner: "a", repo: "n" }, "a.md"), (err) => {
      assert.ok(err instanceof GitHubApiError);
      assert.ok(!(err instanceof GitHubRateLimitError));
      return true;
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("session route skips corpus load and reports degraded when quota is low", async () => {
  process.env.APP_PIN = "777";
  process.env.REPO_OWNER = "a";
  process.env.REPO_NAME = "Note";
  process.env.REVIEW_REPO_OWNER = "a";
  process.env.REVIEW_REPO_NAME = "review_status-";
  try {
    const { createChatSessionRoute } = await import("../src/app/api/chat/session/route.ts");
    let ensureCalls = 0;
    const { POST } = createChatSessionRoute({
      ensure: async () => {
        ensureCalls++;
        return { files: new Map(), treePaths: [], fetchedAt: 1, partial: false };
      },
      quotaCheck: async () => ({ remaining: 120, resetAt: 1_700_000_000_000 }),
    });
    const res = await POST({
      headers: new Headers({ "x-app-pin": "777" }),
      json: async () => ({}),
    });
    const body = await res.json();
    assert.equal(body.degraded, true, "配额不足 → degraded");
    assert.equal(ensureCalls, 0, "不烧剩余配额");
    assert.equal(body.quota.remaining, 120);
  } finally {
    for (const k of ["APP_PIN", "REPO_OWNER", "REPO_NAME", "REVIEW_REPO_OWNER", "REVIEW_REPO_NAME"]) {
      delete process.env[k];
    }
  }
});
