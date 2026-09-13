/**
 * Server-side attachment (image) helpers for the 今日杂记 upload feature.
 *
 * Pure functions + config + the request-body reader used by
 * /api/attachment. No business logic about journals or notes — that stays in
 * github.ts / markdown-utils.ts. Everything here is directly unit-testable
 * under the strip-types node harness.
 */

import type { NextRequest } from "next/server";

import { formatBeijingCompactTimestamp } from "./beijing-time";

/** Where uploads live in the vault. The GET proxy only serves files from this
 *  directory — it is the single source of truth for the path (clients only
 *  ever know bare filenames). */
export function getAttachmentsDir(): string {
  return process.env.ATTACHMENTS_DIR || "Assets/Sources";
}

/** Max size of a stored image. Production deploys on Vercel, whose serverless
 *  functions cap request bodies at 4.5MB — 4MB leaves headroom for the
 *  multipart envelope. The client compresses anything >1MB down to well under
 *  this, so only oversized GIF passthroughs realistically hit it. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Max raw request body (file + multipart overhead). */
export const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;

/** Image types the sniff + serve paths support. Keys are file extensions. */
export type SniffedImageType = "png" | "jpeg" | "webp" | "gif";

export const EXT_BY_TYPE: Record<SniffedImageType, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
};

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Detect an image's type from its magic bytes, ignoring the client-declared
 * MIME type / filename entirely (uploads are always renamed server-side, so a
 * spoofed name can't smuggle e.g. an HTML payload in as .png).
 *
 * jpeg: FF D8 FF · png: 89 50 4E 47 · webp: "RIFF" + 4 bytes + "WEBP" ·
 * gif: "GIF87a" / "GIF89a". Returns null for anything else.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "webp";
  }
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...bytes.slice(start, start + len));
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return "gif";
  }
  return null;
}

/**
 * Generate an Obsidian-convention attachment filename in Beijing time:
 * `Pasted image YYYYMMDDHHmmss.ext`. Matches the 597 existing files in
 * Assets/Sources so app uploads blend with Obsidian pastes. `suffix` is the
 * collision retry marker (`-2`, `-3`, …) inserted before the extension.
 */
export function generateAttachmentFilename(
  ext: string,
  now: Date = new Date(),
  suffix = ""
): string {
  return `Pasted image ${formatBeijingCompactTimestamp(now)}${suffix}.${ext}`;
}

/**
 * Validate a filename received from the client (attachImage action + GET
 * proxy). Bare filename only — no directories, no traversal, no dotfiles —
 * and a supported image extension. Accepts the styles already present in the
 * vault (spaces, CJK, WeChat names like `331735633320_.pic.jpg`).
 */
export function isSafeAttachmentFilename(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name.includes("..") || name.startsWith(".")) return false;
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

/** Error thrown by readLimitedBody on oversize/missing bodies. */
export class RequestBodyTooLargeError extends Error {
  readonly status: number;

  constructor(message: string, status = 413) {
    super(message);
    this.name = "RequestBodyTooLargeError";
    this.status = status;
  }
}

/**
 * Read a request body as raw bytes with a hard streaming cap (content-length
 * pre-check + running total + reader.cancel on overflow) — the binary variant
 * of readLimitedJsonBody's pattern. Throws RequestBodyTooLargeError (413) or
 * RequestBodyTooLargeError (400) when the body is missing.
 */
export async function readLimitedBody(
  request: NextRequest,
  maxBytes: number
): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError("Request body is too large", 413);
  }
  if (!request.body) {
    throw new RequestBodyTooLargeError("Request body is missing", 400);
  }

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
        throw new RequestBodyTooLargeError("Request body is too large", 413);
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
  return bytes;
}
