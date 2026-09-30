import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import {
  type InsightsServiceDependencies,
  InsightsServiceError,
  crownInsight,
} from "@/lib/insights-service";

// Two writes (event + frontmatter) with retries/backoff — explicit budget.
export const maxDuration = 60;

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
export function createCrownRoute(deps: InsightsServiceDependencies = {}) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) return deny();
    try {
      const body = await req.json();
      const insightId = typeof body.insightId === "string" ? body.insightId : "";
      const clientEventId =
        typeof body.clientEventId === "string" ? body.clientEventId : "";
      if (!insightId || !clientEventId) {
        return Response.json(
          { ok: false, error: "insightId and clientEventId are required" },
          { status: 400 }
        );
      }
      const result = await crownInsight(
        {
          insightId,
          note: typeof body.note === "string" ? body.note : null,
          clientEventId,
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

export const POST = createCrownRoute();
