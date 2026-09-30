import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import {
  type InsightsServiceDependencies,
  InsightsServiceError,
  applyVerification,
} from "@/lib/insights-service";
import type { Verdict } from "@/lib/insights";

// Three-write chain worst case (retries × backoff) — never the default 10s.
export const maxDuration = 60;

/** Degrade margin: stop after write-① when past ~70% of the window, leaving
 *  ~30% headroom (plan 01 §2 服务端时限). */
const DEGRADE_AFTER_MS = 42_000;

const VERDICTS: readonly string[] = ["confirm", "refute", "unobserved"];

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** Lazy dynamic import — unit tests outside the Next runtime skip it. */
async function revalidate(): Promise<void> {
  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/");
  } catch {
    /* not in the Next runtime */
  }
}

/** Route factory — tests inject service deps (plan 03 · T3.2 手法). */
export function createVerifyRoute(deps: InsightsServiceDependencies = {}) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) return deny();
    try {
      const body = await req.json();
      const insightId = typeof body.insightId === "string" ? body.insightId : "";
      const verdict = body.verdict as Verdict;
      const clientEventId =
        typeof body.clientEventId === "string" ? body.clientEventId : "";
      if (!insightId || !VERDICTS.includes(verdict) || !clientEventId) {
        return Response.json(
          { ok: false, error: "insightId, verdict and clientEventId are required" },
          { status: 400 }
        );
      }
      // Source contract: date YYYY-MM-DD, anchor HHmm (4 digits, no colon).
      // Anything else must 400 here — an invalid source would otherwise fall
      // through to parseVerifications as a permanently damaged line.
      const source =
        body.source &&
        typeof body.source.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.source.date) &&
        (body.source.anchor === null ||
          (typeof body.source.anchor === "string" && /^\d{4}$/.test(body.source.anchor)))
          ? { date: body.source.date, anchor: body.source.anchor }
          : null;
      if (body.source && !source) {
        return Response.json(
          { ok: false, error: "source must be { date: YYYY-MM-DD, anchor: HHmm | null }" },
          { status: 400 }
        );
      }

      const result = await applyVerification(
        {
          insightId,
          verdict,
          note: typeof body.note === "string" ? body.note : null,
          source,
          clientEventId,
          deadlineMs: Date.now() + DEGRADE_AFTER_MS,
        },
        deps
      );
      await revalidate();
      return Response.json(result);
    } catch (err: unknown) {
      if (err instanceof InsightsServiceError) {
        return Response.json(
          { ok: false, error: err.message, code: err.code },
          { status: err.status }
        );
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }
  return POST;
}

export const POST = createVerifyRoute();
