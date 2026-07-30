import assert from "node:assert/strict";
import test from "node:test";

import {
  createFocusRelayUrl,
  FocusRelayConfigError,
  signFocusRelayTicket,
} from "../src/lib/focus-relay-ticket.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const TRACK = {
  bvid: "BV1f53B6qEB6",
  cid: "40377256216",
  exp: 1_800_000_000,
};

test("application signatures match the relay's stable ticket vector", () => {
  assert.equal(
    signFocusRelayTicket(SECRET, TRACK),
    "VMuhsd6yJk72EborXrbdJRcdY3ed1A-fErK3rIZwYWs"
  );
});

test("relay URLs authorize one track and never contain credentials", () => {
  const result = createFocusRelayUrl({
    baseUrl: "http://192.168.31.108:8787",
    secret: SECRET,
    bvid: TRACK.bvid,
    cid: TRACK.cid,
    nowSeconds: 1_700_000_000,
    ttlSeconds: 3_600,
  });
  const url = new URL(result.url);
  assert.equal(url.origin, "http://192.168.31.108:8787");
  assert.equal(url.pathname, `/v1/audio/${TRACK.bvid}`);
  assert.equal(url.searchParams.get("cid"), TRACK.cid);
  assert.equal(result.expiresAt, 1_700_003_600_000);
});

test("relay URLs preserve an HTTPS reverse-proxy base path", () => {
  const result = createFocusRelayUrl({
    baseUrl: "https://media.alanevergarden.xyz/focus-audio",
    secret: SECRET,
    bvid: TRACK.bvid,
    cid: TRACK.cid,
    nowSeconds: 1_700_000_000,
    ttlSeconds: 3_600,
    requireHttps: true,
  });
  const url = new URL(result.url);
  assert.equal(url.origin, "https://media.alanevergarden.xyz");
  assert.equal(url.pathname, `/focus-audio/v1/audio/${TRACK.bvid}`);
});

test("production rejects HTTP relay origins and weak secrets", () => {
  assert.throws(
    () => createFocusRelayUrl({
      baseUrl: "http://192.168.31.108:8787",
      secret: SECRET,
      bvid: TRACK.bvid,
      cid: TRACK.cid,
      requireHttps: true,
    }),
    FocusRelayConfigError
  );
  assert.throws(
    () => signFocusRelayTicket("weak", TRACK),
    FocusRelayConfigError
  );
});
