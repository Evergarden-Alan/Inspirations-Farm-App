import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import { checkInvariant, reconcile } from "@/lib/insights-invariant";

// POST repair rewrites every drifted INS (one commit per file) — the slowest
// path in the domain; explicit budget, never the default 10s (plan 01 §2).
export const maxDuration = 60;

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** GET — dry-run detection ONLY (never auto-repairs; the drift signal must
 *  stay visible). POST — explicit reconcile, one commit per drifted file. */
export async function GET(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const report = await checkInvariant();
    return Response.json({ ok: true, report });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!validatePin(req)) return deny();
  try {
    const result = await reconcile();
    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
