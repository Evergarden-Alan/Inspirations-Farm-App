import { NextRequest } from "next/server";
import { executeRollover } from "@/lib/rollover";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/cron/rollover
 *
 * Triggered by Vercel Cron Jobs daily at 1 16 * * * (Beijing 00:01).
 * Requires Authorization: Bearer <CRON_SECRET> header.
 *
 * In development mode (NODE_ENV === "development"), the auth check is
 * skipped so you can hit the endpoint directly in a browser for debugging:
 *   http://localhost:3000/api/cron/rollover
 *
 * ## Optional query parameters
 *
 *   dryRun=true
 *     Parse tasks & build content, but skip all GitHub writes.
 *     Returns { status: "dry-run", todayPreview, tomorrowPreview, extractedTasks }.
 *
 *   targetDate=YYYY-MM-DD
 *     Override "today" for historical rollover remediation.
 *     The script will compute "tomorrow" from this date via safe Date math.
 *     Falls back to real Beijing time when omitted.
 *
 * ## Examples
 *
 *   # Local safe test
 *   /api/cron/rollover?dryRun=true
 *
 *   # Time-machine dry run (month boundary!)
 *   /api/cron/rollover?dryRun=true&targetDate=2026-06-30
 *
 *   # Real historical rollover (BE CAREFUL)
 *   /api/cron/rollover?targetDate=2026-06-15
 */
export async function GET(req: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const params = req.nextUrl.searchParams;

  // ── Auth check ──────────────────────────────────────────
  // Accepts secret from two sources (checked in order):
  //   1. URL query param:  ?secret=<CRON_SECRET>
  //   2. Authorization header:  Bearer <CRON_SECRET>
  const secret = process.env.CRON_SECRET;
  if (secret && !isDev) {
    const providedSecret =
      params.get("secret") ||
      req.headers.get("authorization")?.split(" ")[1] ||
      null;

    if (providedSecret !== secret) {
      console.warn(
        "[cron/rollover] Auth FAILED — token mismatch." +
          ` expected_prefix=${secret.slice(0, 4)}...` +
          ` got=${providedSecret ? providedSecret.slice(0, 4) + "..." : "null"}`
      );
      return Response.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    console.log(
      "[cron/rollover] Auth OK" +
        (params.get("secret") ? " (via URL secret param)" : " (via Bearer header)")
    );
  } else if (isDev) {
    console.log("[cron/rollover] DEV mode — auth bypassed");
  } else {
    console.warn(
      "[cron/rollover] CRON_SECRET not set — auth is wide open!"
    );
  }

  // ── Parse query parameters ──────────────────────────────
  const dryRun = params.get("dryRun") === "true";
  const targetDate = params.get("targetDate");

  // Validate targetDate format
  if (targetDate !== null && !DATE_RE.test(targetDate)) {
    return Response.json(
      {
        ok: false,
        error: `Invalid targetDate "${targetDate}". Expected format: YYYY-MM-DD`,
      },
      { status: 400 }
    );
  }

  // ── Execute rollover ────────────────────────────────────
  try {
    const modeLabel = [
      dryRun ? "DRY RUN" : "LIVE",
      targetDate ? `targetDate=${targetDate}` : "real-time",
    ]
      .filter(Boolean)
      .join(", ");

    console.log(`[cron/rollover] Invoking executeRollover() [${modeLabel}]...`);
    const result = await executeRollover({ targetDate: targetDate ?? undefined, dryRun });
    const status = result.ok ? 200 : 500;

    console.log(
      "[cron/rollover] Result:",
      JSON.stringify({
        status: result.status,
        moved: result.moved,
        ok: result.ok,
        todayDate: result.todayDate,
        tomorrowDate: result.tomorrowDate,
      })
    );

    return Response.json(result, { status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/rollover] Unhandled error:", message);
    if (err instanceof Error && err.stack) {
      console.error("[cron/rollover]", err.stack);
    }
    return Response.json(
      { ok: false, status: "error", error: message },
      { status: 500 }
    );
  }
}
