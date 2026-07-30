import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyFocusPlaylistConfig,
  FocusPlaylistConfigError,
  parseFocusPlaylistConfig,
  removeFocusPlaylistConfig,
  serializeFocusPlaylistConfig,
  upsertFocusPlaylistConfig,
} from "../src/lib/focus-playlist-config.ts";
import {
  readFocusPlaylistConfigFromGitHub,
  upsertFocusPlaylistOnGitHub,
} from "../src/lib/focus-playlist-github.ts";
import { decodeBase64, encodeBase64 } from "../src/lib/github-client.ts";

const NOW = "2026-07-31T01:30:00.000Z";
const RESOLVED = {
  id: "bilibili:ugc-season:3458136",
  provider: "bilibili",
  kind: "ugc-season",
  sourceUrl: "https://www.bilibili.com/video/BV1f53B6qEB6/",
  sourceBvid: "BV1f53B6qEB6",
  canonicalUrl: "https://space.bilibili.com/31467140/lists/3458136?type=season",
  seasonId: "3458136",
  ownerMid: "31467140",
  ownerName: "Verasmelody",
  title: "新古典主义·学习｜工作｜居家｜冥想",
  cover: "https://archive.biliimg.com/bfs/archive/cover.jpg",
  itemCount: 485,
};

function savedConfig() {
  return upsertFocusPlaylistConfig(createEmptyFocusPlaylistConfig(NOW), RESOLVED, NOW).config;
}

function githubFile(config, sha = "config-sha") {
  return Response.json({
    sha,
    encoding: "base64",
    content: encodeBase64(serializeFocusPlaylistConfig(config)),
  });
}

function installGitHubMock(t, implementation) {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalEnv = {
    GITHUB_PAT: process.env.GITHUB_PAT,
    REPO_OWNER: process.env.REPO_OWNER,
    REPO_NAME: process.env.REPO_NAME,
  };
  process.env.GITHUB_PAT = "test-token";
  process.env.REPO_OWNER = "test-owner";
  process.env.REPO_NAME = "test-repo";
  globalThis.fetch = implementation;
  console.error = () => {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("versioned playlist configuration round-trips and rejects corruption", () => {
  const config = savedConfig();
  assert.deepEqual(parseFocusPlaylistConfig(serializeFocusPlaylistConfig(config)), config);
  assert.throws(
    () => parseFocusPlaylistConfig(JSON.stringify({ ...config, version: 2 })),
    (error) => error instanceof FocusPlaylistConfigError && error.code === "CONFIG_CORRUPTED"
  );
  assert.throws(
    () => parseFocusPlaylistConfig(JSON.stringify({ ...config, unexpected: true })),
    (error) => error instanceof FocusPlaylistConfigError && error.code === "CONFIG_CORRUPTED"
  );
});

test("upsert is idempotent until playlist metadata changes", () => {
  const first = upsertFocusPlaylistConfig(createEmptyFocusPlaylistConfig(NOW), RESOLVED, NOW);
  const duplicate = upsertFocusPlaylistConfig(first.config, {
    ...RESOLVED,
    sourceUrl: "https://www.bilibili.com/video/BV1Ff421B7sS/",
    sourceBvid: "BV1Ff421B7sS",
  }, "2026-07-31T01:31:00.000Z");
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.updated, false);
  assert.equal(duplicate.config, first.config);

  const refreshed = upsertFocusPlaylistConfig(first.config, {
    ...RESOLVED,
    itemCount: 486,
  }, "2026-07-31T01:32:00.000Z");
  assert.equal(refreshed.updated, true);
  assert.equal(refreshed.playlist.itemCount, 486);
  assert.equal(refreshed.playlist.addedAt, NOW);
});

test("removing a playlist preserves a valid empty configuration", () => {
  const result = removeFocusPlaylistConfig(
    savedConfig(),
    RESOLVED.id,
    "2026-07-31T01:33:00.000Z"
  );
  assert.equal(result.playlist.id, RESOLVED.id);
  assert.deepEqual(result.config.playlists, []);
  assert.doesNotThrow(() => serializeFocusPlaylistConfig(result.config));
  assert.throws(
    () => removeFocusPlaylistConfig(result.config, RESOLVED.id, NOW),
    (error) => error instanceof FocusPlaylistConfigError && error.code === "PLAYLIST_NOT_FOUND"
  );
});

test("missing GitHub configuration is created without a SHA", async (t) => {
  const requests = [];
  installGitHubMock(t, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (!options.method) return Response.json({ message: "Not Found" }, { status: 404 });
    return Response.json({ content: { sha: "created-sha" } }, { status: 201 });
  });

  const result = await upsertFocusPlaylistOnGitHub(RESOLVED, { now: NOW });
  assert.equal(result.created, true);
  assert.equal(result.written, true);
  assert.equal(requests.length, 2);
  const body = JSON.parse(requests[1].options.body);
  assert.equal("sha" in body, false);
  assert.equal(parseFocusPlaylistConfig(decodeBase64(body.content)).playlists.length, 1);
});

test("a 409 re-reads configuration and avoids a duplicate commit", async (t) => {
  const requests = [];
  let reads = 0;
  installGitHubMock(t, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (!options.method) {
      reads += 1;
      return reads === 1
        ? githubFile(createEmptyFocusPlaylistConfig(NOW), "stale-sha")
        : githubFile(savedConfig(), "fresh-sha");
    }
    return Response.json({ message: "Conflict" }, { status: 409 });
  });

  const result = await upsertFocusPlaylistOnGitHub(RESOLVED, { now: NOW });
  assert.equal(result.written, false);
  assert.equal(result.created, false);
  assert.equal(reads, 2);
  assert.equal(requests.filter((request) => request.options.method === "PUT").length, 1);
});

test("corrupted GitHub configuration is never overwritten", async (t) => {
  const requests = [];
  installGitHubMock(t, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json({
      sha: "bad-sha",
      encoding: "base64",
      content: encodeBase64('{"version":2,"updatedAt":"bad","playlists":[]}'),
    });
  });

  await assert.rejects(
    readFocusPlaylistConfigFromGitHub({ now: NOW }),
    (error) => error instanceof FocusPlaylistConfigError && error.code === "CONFIG_CORRUPTED"
  );
  assert.equal(requests.length, 1);
  assert.equal(requests.some((request) => request.options.method === "PUT"), false);
});
