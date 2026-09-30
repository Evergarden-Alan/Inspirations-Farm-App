import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import { getInsightBench } from "@/lib/data";
import {
  type InsightsServiceDependencies,
  InsightsServiceError,
  createInsightFromText,
} from "@/lib/insights-service";

/** Revalidate the dashboard cache. Lazy dynamic import: outside the Next
 *  runtime (route-factory unit tests) next/cache can't resolve — no-op there. */
async function revalidate(): Promise<void> {
  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/");
  } catch {
    /* not in the Next runtime */
  }
}

// Vercel Hobby caps at 60s; the bench GET reads 1+N with p-limit(10) — never
// run this route on the default 10s budget (plan 01 §2 服务端时限).
export const maxDuration = 60;

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** Route factory so tests can inject fake service deps (plan 03 · T3.2 手法). */
export function createInsightsRoute(
  deps: (InsightsServiceDependencies & { bench?: () => Promise<unknown> }) = {}
) {
  async function GET(req: NextRequest) {
    if (!validatePin(req)) return deny();
    try {
      const board = await (deps.bench ?? getInsightBench)();
      return Response.json({ ok: true, board });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  /** POST — induct: a jottings note becomes an INS hypothesis. */
  async function POST(req: NextRequest) {
    if (!validatePin(req)) return deny();
    try {
      const body = await req.json();
      const statement = typeof body.statement === "string" ? body.statement : "";
      const topics = Array.isArray(body.topics)
        ? body.topics.filter((t: unknown): t is string => typeof t === "string")
        : [];
      const origin =
        body.origin &&
        typeof body.origin.date === "string" &&
        typeof body.origin.time === "string"
          ? { date: body.origin.date, time: body.origin.time }
          : null;

      const result = await createInsightFromText({ statement, topics, origin }, deps);
      await revalidate();
      return Response.json({ ok: true, id: result.id });
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

  return { GET, POST };
}

export const { GET, POST } = createInsightsRoute();
