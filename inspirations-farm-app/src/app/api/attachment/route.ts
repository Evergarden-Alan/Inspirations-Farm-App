import { NextRequest } from "next/server";

import {
  EXT_BY_TYPE,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  MIME_BY_EXT,
  RequestBodyTooLargeError,
  generateAttachmentFilename,
  getAttachmentsDir,
  isSafeAttachmentFilename,
  readLimitedBody,
  sniffImageType,
} from "@/lib/attachments";
import { validatePin } from "@/lib/auth";
import { GitHubApiError, createBinaryFile, getRawFile } from "@/lib/github";

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** Max filename-collision retries (`-2` … `-5` suffixes) on a 422. */
const MAX_NAME_RETRIES = 5;

/**
 * POST /api/attachment — upload an image (multipart FormData, field "file").
 *
 * The body is size-capped BEFORE parsing (streaming reader, 413 on overflow),
 * then the file's type is derived from magic bytes only — the client-declared
 * name/MIME is ignored — and the file is stored under a generated
 * Obsidian-convention name. A same-second name collision surfaces as GitHub
 * 422 and retries with a `-2`/`-3`… suffix.
 *
 * Responds { ok, filename, path, size }.
 */
export async function POST(req: NextRequest) {
  if (!validatePin(req)) return deny();

  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "文件过大（上限约 4MB）" }, { status: err.status });
    }
    return Response.json({ ok: false, error: "无法读取上传内容" }, { status: 400 });
  }

  try {
    // Re-parse the capped bytes as multipart (formData() on the raw request
    // would stream uncapped). Only the content-type header is needed.
    // readLimitedBody returns an exact-size array, so its underlying buffer
    // is the whole body.
    const form = await new Request(req.url, {
      method: "POST",
      headers: { "content-type": req.headers.get("content-type") ?? "" },
      body: bytes.buffer as ArrayBuffer,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ ok: false, error: "缺少文件" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return Response.json({ ok: false, error: "文件过大（上限约 4MB）" }, { status: 413 });
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageType(fileBytes);
    if (!sniffed) {
      return Response.json(
        { ok: false, error: "不支持的图片格式（仅 PNG / JPEG / WebP / GIF）" },
        { status: 415 }
      );
    }
    const ext = EXT_BY_TYPE[sniffed];
    const dir = getAttachmentsDir();

    for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt++) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const filename = generateAttachmentFilename(ext, new Date(), suffix);
      try {
        const created = await createBinaryFile(
          `${dir}/${filename}`,
          fileBytes,
          `Add attachment ${filename}`
        );
        return Response.json({
          ok: true,
          filename,
          path: created.path,
          size: fileBytes.byteLength,
        });
      } catch (err) {
        // 422 = the path already exists — same-second collision; retry with a
        // suffixed name. Anything else is a real failure.
        if (err instanceof GitHubApiError && err.status === 422 && attempt < MAX_NAME_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    // Unreachable: the loop returns or throws.
    return Response.json({ ok: false, error: "文件名冲突，请重试" }, { status: 503 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * GET /api/attachment?file=<bare filename> — proxy image bytes from the
 * private repo. The browser can't attach the x-app-pin header to <img src>,
 * so the client fetches this via apiFetch (header auth) and renders the bytes
 * as an object URL. Serves only files inside ATTACHMENTS_DIR.
 */
export async function GET(req: NextRequest) {
  if (!validatePin(req)) return deny();

  const file = req.nextUrl.searchParams.get("file");
  if (!file || !isSafeAttachmentFilename(file)) {
    return Response.json({ ok: false, error: "Invalid file" }, { status: 400 });
  }

  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  try {
    const buffer = await getRawFile(`${getAttachmentsDir()}/${file}`);
    return new Response(buffer, {
      headers: {
        "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err: unknown) {
    if (err instanceof GitHubApiError && err.status === 404) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
