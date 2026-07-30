import { createHmac } from "node:crypto";

import { isValidBilibiliBvid, isValidBilibiliCid } from "./bilibili";

export interface FocusRelayTicketInput {
  bvid: string;
  cid: string;
  exp: number;
}

export class FocusRelayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FocusRelayConfigError";
  }
}

export function focusRelayTicketPayload(input: FocusRelayTicketInput): string {
  return `v1\n${input.bvid}\n${input.cid}\n${input.exp}`;
}

export function signFocusRelayTicket(
  secret: string,
  input: FocusRelayTicketInput
): string {
  if (secret.length < 32) {
    throw new FocusRelayConfigError("The relay signing secret must contain at least 32 characters");
  }
  if (!isValidBilibiliBvid(input.bvid) || !isValidBilibiliCid(input.cid)) {
    throw new TypeError("Cannot sign an invalid BVID or CID");
  }
  if (!Number.isSafeInteger(input.exp) || input.exp <= 0) {
    throw new TypeError("Cannot sign an invalid expiry");
  }
  return createHmac("sha256", secret)
    .update(focusRelayTicketPayload(input))
    .digest("base64url");
}

export function createFocusRelayUrl(options: {
  baseUrl: string;
  secret: string;
  bvid: string;
  cid: string;
  nowSeconds?: number;
  ttlSeconds?: number;
  requireHttps?: boolean;
}): { url: string; expiresAt: number } {
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl);
  } catch {
    throw new FocusRelayConfigError("FOCUS_AUDIO_RELAY_BASE_URL is not a valid URL");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new FocusRelayConfigError("The relay base URL must be an HTTP(S) URL without credentials");
  }
  if (baseUrl.search || baseUrl.hash) {
    throw new FocusRelayConfigError("The relay base URL cannot contain a query or hash");
  }
  if (options.requireHttps && baseUrl.protocol !== "https:") {
    throw new FocusRelayConfigError("Production relay URLs must use HTTPS");
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const ttlSeconds = options.ttlSeconds ?? 21_600;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 28_800) {
    throw new FocusRelayConfigError("The relay ticket TTL must be between 60 and 28800 seconds");
  }
  const ticket = {
    bvid: options.bvid,
    cid: options.cid,
    exp: nowSeconds + ttlSeconds,
  };
  const signature = signFocusRelayTicket(options.secret, ticket);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  const relayUrl = new URL(`v1/audio/${ticket.bvid}`, baseUrl);
  relayUrl.searchParams.set("cid", ticket.cid);
  relayUrl.searchParams.set("exp", String(ticket.exp));
  relayUrl.searchParams.set("sig", signature);

  return { url: relayUrl.toString(), expiresAt: ticket.exp * 1_000 };
}
