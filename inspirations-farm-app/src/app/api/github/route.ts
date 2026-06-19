import { NextRequest } from "next/server";
import {
  listInspirationsWithContent,
  createInspiration,
  deleteFile,
  updateFileStatus,
} from "@/lib/github";

/**
 * GET /api/github
 * Lists all inspiration files with content and parsed metadata.
 */
export async function GET(_req: NextRequest) {
  try {
    const items = await listInspirationsWithContent();
    return Response.json({ ok: true, items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/github
 * Creates a new timestamp-named .md file under Inspirations/ with YAML frontmatter.
 *
 * Body: { content: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { content } = await req.json();

    if (!content || typeof content !== "string") {
      return Response.json(
        { ok: false, error: "Missing or invalid 'content' field" },
        { status: 400 }
      );
    }

    // YYYY-MM-DD-HHmmss → e.g. 2026-06-19-143025
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestamp = [
      now.getFullYear(),
      "-",
      pad(now.getMonth() + 1),
      "-",
      pad(now.getDate()),
      "-",
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join("");

    const filename = `${timestamp}.md`;
    const result = await createInspiration(filename, content);

    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/github
 * Deletes a file from the Inspirations/ directory.
 *
 * Body: { path: string, sha: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { path, sha } = await req.json();

    if (!path || !sha) {
      return Response.json(
        { ok: false, error: "Missing 'path' or 'sha' field" },
        { status: 400 }
      );
    }

    await deleteFile(path, sha);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * PUT /api/github
 * Updates the status field of a file's YAML frontmatter.
 *
 * Body: { path: string, sha: string, status: string }
 */
export async function PUT(req: NextRequest) {
  try {
    const { path, sha, status } = await req.json();

    if (!path || !sha || !status) {
      return Response.json(
        { ok: false, error: "Missing 'path', 'sha', or 'status' field" },
        { status: 400 }
      );
    }

    const result = await updateFileStatus(path, sha, status);
    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
