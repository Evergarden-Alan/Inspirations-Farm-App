import { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import {
  BilibiliError,
  isValidBilibiliBvid,
  isValidBilibiliCid,
  resolveBilibiliAudio,
} from "@/lib/bilibili";
import {
  createFocusRelayUrl,
  FocusRelayConfigError,
} from "@/lib/focus-relay-ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const EXAMPLE_BVID = "BV1f53B6qEB6";
const EXAMPLE_CID = "40377256216";

class PayloadTooLargeError extends Error {}

async function readJsonBody(req: NextRequest, maxBytes = 2_048): Promise<unknown> {
  if (!req.body) throw new SyntaxError("Missing request body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(payload, { ...init, headers });
}

function deny(): Response {
  return json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!validatePin(req)) return deny();
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 2_048) {
    return json({ ok: false, error: "INVALID_REQUEST" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ ok: false, error: "INVALID_REQUEST" }, { status: 413 });
    }
    return json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
  }
  const bvid = typeof body === "object" && body !== null && "bvid" in body
    ? (body as { bvid?: unknown }).bvid
    : null;
  const cid = typeof body === "object" && body !== null && "cid" in body
    ? (body as { cid?: unknown }).cid
    : null;
  if (!isValidBilibiliBvid(bvid) || !isValidBilibiliCid(cid)) {
    return json({ ok: false, error: "INVALID_TRACK" }, { status: 400 });
  }

  const allowedBvid = process.env.FOCUS_AUDIO_PROBE_BVID ?? EXAMPLE_BVID;
  const allowedCid = process.env.FOCUS_AUDIO_PROBE_CID ?? EXAMPLE_CID;
  if (bvid !== allowedBvid || cid !== allowedCid) {
    return json({ ok: false, error: "TRACK_NOT_ALLOWED" }, { status: 403 });
  }

  const relayBaseUrl = process.env.FOCUS_AUDIO_RELAY_BASE_URL;
  const relaySecret = process.env.FOCUS_AUDIO_RELAY_SIGNING_SECRET;
  if (!relayBaseUrl || !relaySecret) {
    return json({ ok: false, error: "RELAY_NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const audio = await resolveBilibiliAudio(bvid, cid);
    const ticket = createFocusRelayUrl({
      baseUrl: relayBaseUrl,
      secret: relaySecret,
      bvid,
      cid,
      nowSeconds,
      requireHttps: process.env.NODE_ENV === "production",
    });
    return json({
      ok: true,
      audio: {
        url: ticket.url,
        mimeType: audio.mimeType,
        expiresAt: ticket.expiresAt,
      },
      diagnostics: {
        mimeType: audio.mimeType,
        codecs: audio.codecs,
        bandwidth: audio.bandwidth,
        cdnHost: audio.cdnHost,
        deadline: audio.deadline,
        deadlineRemainingSeconds: audio.deadline === null
          ? null
          : audio.deadline - nowSeconds,
        relayHost: new URL(relayBaseUrl).host,
      },
    });
  } catch (error) {
    if (error instanceof BilibiliError) {
      return json({ ok: false, error: error.code }, { status: error.status });
    }
    if (error instanceof FocusRelayConfigError) {
      console.error("[FOCUS_AUDIO_PROBE] Invalid relay configuration");
      return json({ ok: false, error: "RELAY_NOT_CONFIGURED" }, { status: 503 });
    }
    console.error("[FOCUS_AUDIO_PROBE] Unexpected probe failure", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "AUDIO_NOT_AVAILABLE" }, { status: 502 });
  }
}
