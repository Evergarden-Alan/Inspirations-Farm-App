import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getDailyJournal,
  createDailyJournal,
  updateDailyJournal,
  modifyDailyJournal,
  insertIntoDailySection,
  insertIntoDailyNotesSection,
} from "@/lib/github";
import { validatePin } from "@/lib/auth";
import { getBeijingDateTimeString } from "@/lib/beijing-time";

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
 *   { date } — creates a new daily journal file
 *   { ideaId, ideaTitle, date } — pushes an inspiration into today's journal
 */
export async function POST(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const body = await req.json();

    // ── Add daily note ────────────────────────────
    if (body.action === "addNote") {
      const date = body.date;
      const content = body.content;
      if (!date || !content) {
        return Response.json(
          { ok: false, error: "Missing 'date' or 'content'" },
          { status: 400 }
        );
      }

      // Extract HH:mm from Beijing datetime (e.g. "2026-06-19 14:30:00" → "14:30")
      const bjTime = getBeijingDateTimeString();
      const time = bjTime.slice(11, 16);

      // Read-modify-write with 409 retry: a stale SHA (GitHub read-replica lag
      // right after a prior write) is retried by re-fetching fresh content.
      const result = await modifyDailyJournal(date, (c) =>
        insertIntoDailyNotesSection(c, time, content)
      );
      // addNote's modifier never aborts, so result is non-null in practice.
      if (!result) {
        return Response.json({ ok: false, error: "Note not added" }, { status: 500 });
      }

      revalidatePath("/");
      return Response.json({ ok: true, sha: result.sha, time });
    }

    // ── Push inspiration to daily ──────────────────
    if (body.ideaId && body.ideaTitle) {
      const date = body.date;
      if (!date || typeof date !== "string") {
        return Response.json(
          { ok: false, error: "Missing 'date' field" },
          { status: 400 }
        );
      }

      const taskLine = `- [ ] [[${body.ideaId}|${body.ideaTitle}]]`;

      // Read-modify-write with 409 retry. The modifier aborts (returns null) if
      // the ideaId is already present (duplicate), so the dedup check is
      // re-evaluated on each retry against fresh content.
      const result = await modifyDailyJournal(date, (c) =>
        c.includes(body.ideaId) ? null : insertIntoDailySection(c, taskLine)
      );

      if (result === null) {
        // Modifier aborted: ideaId already present (duplicate).
        return Response.json(
          { ok: false, error: "该灵感已在今日日程中", duplicate: true },
          { status: 409 }
        );
      }

      revalidatePath("/");
      return Response.json({ ok: true, sha: result.sha });
    }

    // ── Create journal ─────────────────────────────
    const { date } = body;
    if (!date || typeof date !== "string") {
      return Response.json(
        { ok: false, error: "Missing or invalid 'date' field" },
        { status: 400 }
      );
    }

    const result = await createDailyJournal(date);
    revalidatePath("/");
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
    revalidatePath("/");
    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
