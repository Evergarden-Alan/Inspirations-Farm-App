import assert from "node:assert/strict";
import test from "node:test";

import { createInsightsRoute } from "../src/app/api/insights/route.ts";
import { createVerifyRoute } from "../src/app/api/insights/verify/route.ts";
import { createCrownRoute } from "../src/app/api/insights/crown/route.ts";
import { InsightsServiceError } from "../src/lib/insights-service.ts";

const PIN = "135790";
const HEADERS = { "x-app-pin": PIN };

function fakeRequest(body, headers = HEADERS) {
  return {
    headers: new Headers(headers),
    json: async () => body,
  };
}

test.before(() => {
  process.env.APP_PIN = PIN;
});

test.after(() => {
  delete process.env.APP_PIN;
});

// ── /api/insights/verify ────────────────────────────────

function verifyDeps(overrides = {}) {
  return {
    readStream: async () => ({ sha: null, content: "", parsed: { valid: [], damaged: 0, duplicates: 0 } }),
    readInsight: async () => null,
    recentJournals: async () => [],
    ...overrides,
  };
}

test("verify route: 401 without the PIN", async () => {
  const POST = createVerifyRoute(verifyDeps());
  const res = await POST(fakeRequest({}, {}));
  assert.equal(res.status, 401);
});

test("verify route: 400 on missing fields", async () => {
  const POST = createVerifyRoute(verifyDeps());
  assert.equal((await POST(fakeRequest({ insightId: "INS-x" }))).status, 400);
  assert.equal((await POST(fakeRequest({ insightId: "INS-x", verdict: "nonsense", clientEventId: "e" }))).status, 400);
});

test("verify route: 503 VERIFY_CONFLICT on service conflict", async () => {
  const POST = createVerifyRoute(
    verifyDeps({
      readInsight: async () => ({ sha: "s", frontmatter: { statement: "x" }, body: "" }),
      appendEvent: async () => {
        throw new InsightsServiceError("VERIFY_CONFLICT", "stream write failed", 503);
      },
    })
  );
  const res = await POST(
    fakeRequest({ insightId: "INS-20260930-213501", verdict: "confirm", clientEventId: "ev-1" })
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "VERIFY_CONFLICT");
});

test("verify route: 200 happy path passes the service result through", async () => {
  const POST = createVerifyRoute(
    verifyDeps({
      readInsight: async () => ({ sha: "s", frontmatter: { statement: "x" }, body: "" }),
      appendEvent: async () => ({ sha: "new" }),
      readUntilVisible: async () => ({ valid: [], damaged: 0, duplicates: 0 }),
      updateFrontmatter: async () => ({ sha: "s2" }),
      diaryTrace: async () => {},
    })
  );
  const res = await POST(
    fakeRequest({ insightId: "INS-20260930-213501", verdict: "confirm", clientEventId: "ev-1" })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, traceWritten: true, countsSynced: true });
});

// ── /api/insights/crown ─────────────────────────────────

test("crown route: 422 NOT_CROWNABLE passes through with its status", async () => {
  const POST = createCrownRoute(
    verifyDeps({
      readStream: async () => ({ sha: null, content: "", parsed: { valid: [], damaged: 0, duplicates: 0 } }),
      readInsight: async () => ({ sha: "s", frontmatter: { status: "hypothesis" }, body: "" }),
    })
  );
  const res = await POST(
    fakeRequest({ insightId: "INS-20260930-213501", clientEventId: "ev-c" })
  );
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, "NOT_CROWNABLE");
});

test("crown route: 401 without PIN, 400 without fields", async () => {
  const POST = createCrownRoute(verifyDeps());
  assert.equal((await POST(fakeRequest({}, {}))).status, 401);
  assert.equal((await POST(fakeRequest({ insightId: "INS-x" }))).status, 400);
});

test("routes: service 404 passes through as HTTP 404 (verify + crown)", async () => {
  const notFound = verifyDeps({
    readInsight: async () => null,
  });
  const verify = createVerifyRoute(notFound);
  const verifyRes = await verify(
    fakeRequest({ insightId: "INS-00000000-000000", verdict: "confirm", clientEventId: "ev-nf" })
  );
  assert.equal(verifyRes.status, 404);
  assert.equal((await verifyRes.json()).code, "INSIGHT_NOT_FOUND");

  const crown = createCrownRoute({ ...notFound });
  const crownRes = await crown(
    fakeRequest({ insightId: "INS-00000000-000000", clientEventId: "ev-nf" })
  );
  assert.equal(crownRes.status, 404);
});

// ── /api/insights (induct + bench) ──────────────────────

test("insights route: POST invalid statement → 400; valid → 200 with id", async () => {
  const { POST } = createInsightsRoute({
    writeInsightFile: async () => ({ sha: "new" }),
    now: () => new Date("2026-09-30T13:35:01Z"),
  });
  const bad = await POST(fakeRequest({ statement: "a\nb" }));
  assert.equal(bad.status, 400);
  const good = await POST(fakeRequest({ statement: "早睡→下午不犯困" }));
  assert.equal(good.status, 200);
  assert.equal((await good.json()).id, "INS-20260930-213501");
});

test("insights route: GET returns the board; 401 without PIN", async () => {
  const board = { knowledge: [], todayTop: [], sprouts: [], falsified: [], behaviorFlow: [] };
  const { GET } = createInsightsRoute({ bench: async () => board });
  const res = await GET(fakeRequest(undefined, HEADERS));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).board, board);
  assert.equal((await GET(fakeRequest(undefined, {}))).status, 401);
});
