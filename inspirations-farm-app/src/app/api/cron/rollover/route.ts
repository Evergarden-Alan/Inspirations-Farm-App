import { NextRequest } from "next/server";
import { executeRollover } from "@/lib/rollover";

/**
 * GET /api/cron/rollover
 *
 * Triggered by Vercel Cron Jobs daily at 1 16 * * * (Beijing 00:01).
 * Requires Authorization: Bearer <CRON_SECRET> header.
 */
export async function GET(req: NextRequest) {
  // Auth check
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token !== secret) {
      return Response.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  try {
    const result = await executeRollover();
    const status = result.ok ? 200 : 500;
    return Response.json(result, { status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { ok: false, status: "error", error: message },
      { status: 500 }
    );
  }
}
