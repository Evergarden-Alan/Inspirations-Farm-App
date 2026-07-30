import { createHmac, timingSafeEqual } from "node:crypto";

export const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
export const CID_PATTERN = /^[1-9][0-9]{0,19}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidBvid(value) {
  return typeof value === "string" && BVID_PATTERN.test(value);
}

export function isValidCid(value) {
  return typeof value === "string" && CID_PATTERN.test(value);
}

export function ticketPayload({ bvid, cid, exp }) {
  return `v1\n${bvid}\n${cid}\n${exp}`;
}

export function signTicket(secret, ticket) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("The relay signing secret must contain at least 32 characters");
  }
  if (!isValidBvid(ticket.bvid) || !isValidCid(ticket.cid)) {
    throw new TypeError("Cannot sign an invalid BVID or CID");
  }
  if (!Number.isSafeInteger(ticket.exp) || ticket.exp <= 0) {
    throw new TypeError("Cannot sign an invalid expiry");
  }

  return createHmac("sha256", secret)
    .update(ticketPayload(ticket))
    .digest("base64url");
}

function safeSignatureEqual(actual, expected) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = SIGNATURE_PATTERN.test(actual)
    ? Buffer.from(actual)
    : Buffer.alloc(expectedBuffer.length);
  const matches = actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
  return matches && SIGNATURE_PATTERN.test(actual);
}

export function verifyTicket(ticket, options) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxTtlSeconds = options.maxTtlSeconds ?? 28_800;
  const clockSkewSeconds = options.clockSkewSeconds ?? 5;
  const secrets = options.secrets.filter(Boolean);

  if (!isValidBvid(ticket.bvid)) return { ok: false, code: "INVALID_BVID" };
  if (!isValidCid(ticket.cid)) return { ok: false, code: "INVALID_CID" };
  if (!Number.isSafeInteger(ticket.exp) || ticket.exp <= 0) {
    return { ok: false, code: "INVALID_RELAY_TOKEN" };
  }
  if (ticket.exp <= now - clockSkewSeconds) {
    return { ok: false, code: "EXPIRED_RELAY_TOKEN" };
  }
  if (ticket.exp - now > maxTtlSeconds + clockSkewSeconds) {
    return { ok: false, code: "INVALID_RELAY_TOKEN" };
  }
  if (typeof ticket.sig !== "string" || secrets.length === 0) {
    return { ok: false, code: "INVALID_RELAY_TOKEN" };
  }

  const valid = secrets.some((secret) => {
    const expected = signTicket(secret, ticket);
    return safeSignatureEqual(ticket.sig, expected);
  });
  return valid
    ? { ok: true }
    : { ok: false, code: "INVALID_RELAY_TOKEN" };
}
