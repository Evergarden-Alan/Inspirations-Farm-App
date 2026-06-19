import { NextRequest } from "next/server";
import {
  listInspirationsWithContent,
  createInspiration,
  deleteFile,
  updateFileStatus,
  archiveInspiration,
} from "@/lib/github";
import { validatePin } from "@/lib/auth";
import { getBeijingTimestamp } from "@/lib/beijing-time";

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/**
 * GET /api/github
 * Lists all active inspiration files with content and parsed metadata.
 */
export async function GET(req: NextRequest) {
  if (!validatePin(req)) return deny();
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
 * Creates a new timestamp-named .md file under Inspirations/.
 * Body: { content: string }
 */
export async function POST(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const { content } = await req.json();

    if (!content || typeof content !== "string") {
      return Response.json(
        { ok: false, error: "Missing or invalid 'content' field" },
        { status: 400 }
      );
    }

    const filename = `${getBeijingTimestamp()}.md`;
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
 * Body: { path: string, sha: string }
 */
export async function DELETE(req: NextRequest) {
  if (!validatePin(req)) return deny();
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
 * Body (direct):  { path: string, sha: string, status: string }
 * Body (archive): { ideaId: string, status: "completed" }
 */
export async function PUT(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const body = await req.json();

    // Archive by ideaId
    if (body.ideaId) {
      const filePath = `Inspirations/${body.ideaId}.md`;
      await archiveInspiration(filePath);
      return Response.json({ ok: true, path: filePath });
    }

    // Direct update by path + sha
    const { path, sha, status } = body;
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
