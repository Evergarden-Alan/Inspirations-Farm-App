import type { NextRequest } from "next/server";

import { BilibiliError } from "./bilibili";
import { FocusPlaylistConfigError } from "./focus-playlist-config";
import { FocusPlaylistServiceError } from "./focus-playlist-service";
import { GitHubApiError } from "./github-client";

export class RequestBodyError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export function noStoreJson(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(payload, { ...init, headers });
}

export function denyFocusPlaylistRequest(): Response {
  return noStoreJson({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
}

export async function readLimitedJsonBody(
  request: NextRequest,
  maxBytes = 4_096
): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }
  if (!request.body) throw new RequestBodyError("Request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError("Request body is too large", 413);
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
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyError("Request body is not valid JSON");
  }
}

export function focusPlaylistErrorResponse(error: unknown, context: string): Response {
  if (error instanceof RequestBodyError) {
    return noStoreJson({ ok: false, error: "INVALID_REQUEST" }, { status: error.status });
  }
  if (
    error instanceof BilibiliError
    || error instanceof FocusPlaylistConfigError
    || error instanceof FocusPlaylistServiceError
  ) {
    return noStoreJson({ ok: false, error: error.code }, { status: error.status });
  }
  if (error instanceof GitHubApiError) {
    const status = error.status === 404 ? 404 : 503;
    return noStoreJson({ ok: false, error: "GITHUB_UNAVAILABLE" }, { status });
  }
  console.error(`[${context}] Unexpected failure`, {
    error: error instanceof Error ? error.name : "UnknownError",
  });
  return noStoreJson({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
}
