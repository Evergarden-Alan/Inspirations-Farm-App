import { NextRequest } from "next/server";
import {
  getDailyJournal,
  createDailyJournal,
  updateDailyJournal,
} from "@/lib/github";
import { validatePin } from "@/lib/auth";

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/**
 * GET /api/daily?date=YYYY-MM-DD
 * Returns the daily journal for the given date, or { exists: false }.
 */
export async function GET(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const date = req.nextUrl.searchParams.get("date");
    if (!date) {
      return Response.json(
        { ok: false, error: "Missing 'date' query parameter" },
        { status: 400 }
      );
    }

    const journal = await getDailyJournal(date);
    return Response.json({ ok: true, ...journal });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/daily
 * Creates a new daily journal file.
 */
export async function POST(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const { date } = await req.json();
    if (!date || typeof date !== "string") {
      return Response.json(
        { ok: false, error: "Missing or invalid 'date' field" },
        { status: 400 }
      );
    }

    const result = await createDailyJournal(date);
    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * PUT /api/daily
 * Updates the content of a daily journal file (e.g. toggling tasks).
 */
export async function PUT(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const { path, sha, content } = await req.json();

    if (!path || !sha || content === undefined) {
      return Response.json(
        { ok: false, error: "Missing 'path', 'sha', or 'content' field" },
        { status: 400 }
      );
    }

    const result = await updateDailyJournal(path, sha, content);
    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
