import assert from "node:assert/strict";
import test from "node:test";

import { signTicket, verifyTicket } from "../src/ticket.mjs";

const SECRET = "0123456789abcdef0123456789abcdef";
const TICKET = {
  bvid: "BV1f53B6qEB6",
  cid: "40377256216",
  exp: 1_800_000_000,
};

test("ticket signatures are stable and validate exact track fields", () => {
  const sig = signTicket(SECRET, TICKET);
  assert.equal(sig, "VMuhsd6yJk72EborXrbdJRcdY3ed1A-fErK3rIZwYWs");
  assert.deepEqual(
    verifyTicket({ ...TICKET, sig }, {
      secrets: [SECRET],
      now: 1_799_999_000,
      maxTtlSeconds: 2_000,
    }),
    { ok: true }
  );
  assert.equal(
    verifyTicket({ ...TICKET, cid: "40377256217", sig }, {
      secrets: [SECRET],
      now: 1_799_999_000,
      maxTtlSeconds: 2_000,
    }).code,
    "INVALID_RELAY_TOKEN"
  );
});

test("expired and excessively long tickets are rejected before streaming", () => {
  const sig = signTicket(SECRET, TICKET);
  assert.equal(
    verifyTicket({ ...TICKET, sig }, { secrets: [SECRET], now: TICKET.exp + 10 }).code,
    "EXPIRED_RELAY_TOKEN"
  );
  assert.equal(
    verifyTicket({ ...TICKET, sig }, {
      secrets: [SECRET],
      now: TICKET.exp - 10_000,
      maxTtlSeconds: 100,
    }).code,
    "INVALID_RELAY_TOKEN"
  );
});
