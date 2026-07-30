import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getDailyJournal,
  createDailyJournal,
  updateDailyJournal,
  modifyDailyJournal,
  insertIntoDailySection,
  insertIntoDailyNotesSection,
  loadDiaryTemplate,
  parseTasks,
  locateTask,
  stripStalePlaceholder,
  GitHubConflictError,
  type DailyTaskLocator,
} from "@/lib/github";
import { validatePin } from "@/lib/auth";
import { getBeijingDateTimeString } from "@/lib/beijing-time";
import { deleteTaskSubtreeAtLine } from "@/lib/cascade";
import {
  applyFocusSessionDurations,
  FocusSessionApplyError,
  type FocusDurationWrite,
} from "@/lib/focus-session";

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function isDailyTaskLocator(value: unknown): value is DailyTaskLocator {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<DailyTaskLocator>;
  return (
    typeof task.lineNumber === "number" &&
    Number.isInteger(task.lineNumber) &&
    task.lineNumber >= 0 &&
    typeof task.text === "string" &&
    typeof task.indent === "string" &&
    (typeof task.parentText === "string" || task.parentText === null)
  );
}

function isDurationSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
      return Response.json({
        ok: true,
        path: result.path,
        sha: result.sha,
        content: result.content,
        time,
      });
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
      // Use regex to avoid substring false positives (e.g. "2026-07-01-123456"
      // incorrectly matching "2026-07-01-1234567").
      const result = await modifyDailyJournal(date, (c) => {
        const linkPattern = new RegExp(`\\[\\[${body.ideaId}(?:\\||\\]\\])`, "g");
        return linkPattern.test(c) ? null : insertIntoDailySection(c, taskLine);
      });

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

    // Use the shared real diary template (placeholder stripped - no rollover
    // tasks to inject) so a web-created journal matches a rollover-created one
    // instead of falling back to a hardcoded skeleton.
    const result = await createDailyJournal(
      date,
      stripStalePlaceholder(await loadDiaryTemplate(date))
    );
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
    const status = err instanceof GitHubConflictError ? 409 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}

/**
 * PATCH /api/daily
 * Atomically applies every duration from one completed focus session.
 */
export async function PATCH(req: NextRequest) {
  if (!validatePin(req)) return deny();

  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
    }

    const candidate = body as {
      action?: unknown;
      date?: unknown;
      sessionId?: unknown;
      sessions?: unknown;
    };
    if (
      candidate.action !== "saveFocusSession" ||
      typeof candidate.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ||
      typeof candidate.sessionId !== "string" ||
      candidate.sessionId.length === 0 ||
      candidate.sessionId.length > 200 ||
      !Array.isArray(candidate.sessions) ||
      candidate.sessions.length === 0 ||
      candidate.sessions.length > 100
    ) {
      return Response.json({ ok: false, error: "Invalid focus session" }, { status: 400 });
    }

    const writes: FocusDurationWrite[] = [];
    for (const value of candidate.sessions) {
      if (!value || typeof value !== "object") {
        return Response.json({ ok: false, error: "Invalid focus target" }, { status: 400 });
      }
      const session = value as {
        task?: unknown;
        baseDurationSeconds?: unknown;
        additionalSeconds?: unknown;
      };
      if (
        !isDailyTaskLocator(session.task) ||
        !isDurationSeconds(session.baseDurationSeconds) ||
        !isDurationSeconds(session.additionalSeconds)
      ) {
        return Response.json({ ok: false, error: "Invalid focus target" }, { status: 400 });
      }
      writes.push({
        task: session.task,
        baseDurationSeconds: session.baseDurationSeconds,
        additionalSeconds: session.additionalSeconds,
      });
    }

    const result = await modifyDailyJournal(candidate.date, (content) =>
      applyFocusSessionDurations(content, writes)
    );
    if (!result) {
      return Response.json({ ok: false, error: "Focus session was not saved" }, { status: 500 });
    }

    revalidatePath("/");
    return Response.json({
      ok: true,
      sessionId: candidate.sessionId,
      path: result.path,
      sha: result.sha,
      content: result.content,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof FocusSessionApplyError || err instanceof GitHubConflictError
      ? 409
      : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}

/**
 * DELETE /api/daily
 * Deletes one task and its nested subtasks from today's journal.
 */
export async function DELETE(req: NextRequest) {
  if (!validatePin(req)) return deny();

  try {
    const { date, task } = (await req.json()) as {
      date?: string;
      task?: Partial<DailyTaskLocator>;
    };

    if (!date || typeof date !== "string" || !isDailyTaskLocator(task)) {
      return Response.json(
        { ok: false, error: "Missing or invalid task locator" },
        { status: 400 }
      );
    }

    const locator = task as DailyTaskLocator;
    const result = await modifyDailyJournal(date, (content) => {
      const target = locateTask(parseTasks(content), locator);
      if (!target) return null;
      return deleteTaskSubtreeAtLine(content, target.lineNumber);
    });

    revalidatePath("/");
    return Response.json(
      result
        ? { ok: true, sha: result.sha, content: result.content }
        : { ok: true, alreadyDeleted: true }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
