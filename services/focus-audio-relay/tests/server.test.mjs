import assert from "node:assert/strict";
import test from "node:test";

import { createRelayServer } from "../src/server.mjs";
import { signTicket } from "../src/ticket.mjs";

const SECRET = "0123456789abcdef0123456789abcdef";
const BVID = "BV1f53B6qEB6";
const CID = "40377256216";

function testConfig() {
  return {
    signingSecrets: [SECRET],
    maxTicketTtlSeconds: 28_800,
    connectTimeoutMs: 1_000,
    idleTimeoutMs: 5_000,
    maxStreamMs: 10_000,
    maxConcurrent: 8,
    maxConcurrentPerIp: 4,
    maxRequestsPerMinute: 120,
    cdnSuffixes: ["example.test"],
  };
}

function ticketUrl(origin, overrides = {}) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const ticket = { bvid: BVID, cid: CID, exp, ...overrides };
  const sig = signTicket(SECRET, ticket);
  return `${origin}/v1/audio/${ticket.bvid}?cid=${ticket.cid}&exp=${ticket.exp}&sig=${sig}`;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("health check exposes no configuration", async (t) => {
  const server = createRelayServer({ config: testConfig(), logger() {} });
  t.after(() => close(server));
  const origin = await listen(server);
  const response = await fetch(`${origin}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "focus-audio-relay", version: 1 });
});

test("signed Range requests preserve media status, headers, and Referer", async (t) => {
  let upstreamRequest = null;
  const fetchImpl = async (url, init) => {
    upstreamRequest = { url, init };
    return new Response(new Uint8Array([0x66, 0x74, 0x79, 0x70]), {
      status: 206,
      headers: {
        "Content-Type": "audio/mp4",
        "Content-Length": "4",
        "Content-Range": "bytes 0-3/100",
        "Accept-Ranges": "bytes",
      },
    });
  };
  const server = createRelayServer({
    config: testConfig(),
    fetchImpl,
    logger() {},
    isAllowedUrl: () => true,
    resolveAudio: async () => ({
      urls: ["https://cdn.example.test/audio.m4s"],
      mimeType: "audio/mp4",
    }),
  });
  t.after(() => close(server));
  const origin = await listen(server);

  const response = await fetch(ticketUrl(origin), { headers: { Range: "bytes=0-3" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "audio/mp4");
  assert.equal(response.headers.get("content-range"), "bytes 0-3/100");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0x66, 0x74, 0x79, 0x70]);
  assert.equal(upstreamRequest.init.headers.Range, "bytes=0-3");
  assert.equal(upstreamRequest.init.headers.Referer, `https://www.bilibili.com/video/${BVID}/`);
});

test("invalid signatures are rejected without touching Bilibili", async (t) => {
  let resolved = false;
  const server = createRelayServer({
    config: testConfig(),
    logger() {},
    resolveAudio: async () => {
      resolved = true;
      throw new Error("must not run");
    },
  });
  t.after(() => close(server));
  const origin = await listen(server);
  const url = new URL(ticketUrl(origin));
  url.searchParams.set("sig", "A".repeat(43));

  const response = await fetch(url);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "INVALID_RELAY_TOKEN");
  assert.equal(resolved, false);
});

test("the relay tries a backup CDN before sending response headers", async (t) => {
  const visited = [];
  const server = createRelayServer({
    config: testConfig(),
    logger() {},
    isAllowedUrl: () => true,
    resolveAudio: async () => ({
      urls: ["https://primary.example.test/a", "https://backup.example.test/a"],
      mimeType: "audio/mp4",
    }),
    fetchImpl: async (url) => {
      visited.push(url);
      if (url.includes("primary")) {
        return new Response("forbidden", { status: 403, headers: { "Content-Type": "text/plain" } });
      }
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "Content-Type": "audio/mp4", "Content-Length": "2" },
      });
    },
  });
  t.after(() => close(server));
  const origin = await listen(server);

  const response = await fetch(ticketUrl(origin));
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2]);
  assert.deepEqual(visited, [
    "https://primary.example.test/a",
    "https://backup.example.test/a",
  ]);
});
