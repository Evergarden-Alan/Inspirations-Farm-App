import assert from "node:assert/strict";
import test from "node:test";

import {
  InsightsServiceError,
  applyVerification,
  createInsightFromText,
  crownInsight,
} from "../src/lib/insights-service.ts";
import { GitHubConflictError } from "../src/lib/github-client.ts";
import matter from "gray-matter";
import { MATTER_OPTS } from "../src/lib/markdown-utils.ts";
import { InsightsStaleReadError } from "../src/lib/insights-github.ts";
import { parseVerifications } from "../src/lib/insights-config.ts";

const ID = "INS-20260930-213501";
const EV = "ev-20260930213501-2f8a";
const STREAM = "Insights/verifications.jsonl";

function insFrontmatter(overrides = {}) {
  return {
    type: "insight",
    id: ID,
    statement: "早睡→下午不犯困",
    status: "hypothesis",
    verify_count: 0,
    falsify_count: 0,
    last_verified: null,
    created: "2026-09-30",
    topics: [],
    sources: [],
    related: [],
    ...overrides,
  };
}

/** Full harness: memory vault + call log + injectable failure points. */
function harness(opts = {}) {
  const files = new Map(Object.entries(opts.files ?? {}));
  let version = 1;
  const calls = { writes: [], diaryTraces: [] };
  const readFile = async (path) => {
    const f = files.get(path);
    return f ? { sha: f.sha, content: f.content } : { sha: null, content: "" };
  };
  const writeFile = async (path, message, content, sha) => {
    calls.writes.push({ path, message });
    const f = files.get(path);
    const currentSha = f ? f.sha : null;
    if (sha !== currentSha) throw new GitHubConflictError("GitHub API error 409 (stale)");
    version++;
    const next = { sha: `${path}-sha-${version}`, content };
    files.set(path, next);
    return { sha: next.sha };
  };
  const deps = {
    gh: { readFile, writeFile, today: () => "2026-09-30" },
    recentJournals: async () => [
      { date: "2026-09-30", exists: true, content: "- **21:05** 📌 上床睡觉\n" },
      { date: "2026-09-29", exists: false, content: "" },
      { date: "2026-09-28", exists: false, content: "" },
    ],
    readInsight: async (id) => {
      const f = files.get(`Insights/${id}.md`);
      if (!f) return null;
      const parsed = matter(f.content, MATTER_OPTS); // real parse path, date-safe
      return { sha: f.sha, frontmatter: parsed.data, body: parsed.content };
    },
    diaryTrace: async (trace) => {
      if (opts.failDiary) throw new Error("diary write failed (injected)");
      calls.diaryTraces.push(trace);
    },
    now: () => new Date("2026-09-30T13:35:01Z"),
    backoffMs: [0, 0, 0],
  };
  // stale replica injection: first N reads of the stream return old content
  if (opts.staleReads) {
    const realRead = deps.gh.readFile;
    let served = 0;
    deps.gh.readFile = async (path) => {
      const f = await realRead(path);
      if (path === STREAM && served++ < opts.staleReads) {
        return { sha: f.sha, content: "" }; // fresh sha + stale content
      }
      return f;
    };
  }
  return { files, calls, deps };
}

function seedStream(h, events) {
  h.files.set(STREAM, { sha: "stream-sha-1", content: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
}
function seedInsight(h, fm = insFrontmatter()) {
  h.files.set(`Insights/${ID}.md`, {
    sha: "ins-sha-1",
    content: matter.stringify("body", fm), // real YAML frontmatter, like createInsightFile
  });
}
function readFm(h) {
  return matter(insFile(h).content, MATTER_OPTS).data;
}
function insFile(h) {
  return h.files.get(`Insights/${ID}.md`);
}

// ── Failure matrix (plan 01 §2) ─────────────────────────

test("matrix ✺ happy path: writes land jsonl → frontmatter → diary, counts correct", async () => {
  const h = harness();
  seedInsight(h);
  const result = await applyVerification(
    { insightId: ID, verdict: "confirm", note: "符合", source: { date: "2026-09-30", anchor: "2105" }, clientEventId: EV },
    h.deps
  );
  assert.deepEqual(result, { ok: true, traceWritten: true, countsSynced: true });
  // order: stream first, then INS, diary via the injected trace hook
  const paths = h.calls.writes.map((w) => w.path);
  assert.deepEqual(paths, [STREAM, `Insights/${ID}.md`]);
  assert.equal(h.calls.diaryTraces.length, 1);
  assert.equal(h.calls.diaryTraces[0].insightId, ID);
  // stream content
  const parsed = parseVerifications(h.files.get(STREAM).content);
  assert.equal(parsed.valid.length, 1);
  // frontmatter rebuilt from the visible stream
  const fm = readFm(h);
  assert.equal(fm.verify_count, 1);
  assert.equal(fm.status, "hypothesis");
  assert.equal(fm.last_verified, "2026-09-30");
  assert.deepEqual(fm.sources, ["Journal/Daily/2026-09-30.md@2105"]);
});

test("matrix 格① write-① fails → VERIFY_CONFLICT 503, zero other writes", async () => {
  const h = harness();
  seedInsight(h);
  // 409 exhaustion: every stream write conflicts even after withConflictRetry
  h.deps.gh.writeFile = async () => {
    throw new GitHubConflictError("GitHub API error 409");
  };
  await assert.rejects(
    applyVerification({ insightId: ID, verdict: "confirm", clientEventId: EV }, h.deps),
    (err) => err instanceof InsightsServiceError && err.code === "VERIFY_CONFLICT" && err.status === 503
  );
  // no frontmatter / diary writes happened
  assert.deepEqual(h.calls.writes, []);
  assert.equal(h.calls.diaryTraces.length, 0);
});

test("matrix 格③ write-② fails → countsSynced:false, event persists, write-③ still runs", async () => {
  const h = harness();
  seedInsight(h);
  h.deps.gh.writeFile = async (path, message, content, sha) => {
    if (path !== STREAM) throw new Error("frontmatter write failed (injected)");
    const f = h.files.get(path);
    const next = { sha: path + "-sha-x", content };
    h.files.set(path, next);
    return { sha: next.sha };
  };
  const result = await applyVerification(
    { insightId: ID, verdict: "confirm", clientEventId: EV },
    h.deps
  );
  assert.equal(result.countsSynced, false);
  assert.equal(result.traceWritten, true);
  assert.equal(parseVerifications(h.files.get(STREAM).content).valid.length, 1);
});

test("matrix 格③b stale replica exhausted → InsightsStaleReadError path → countsSynced:false, no fake success", async () => {
  const h = harness({ staleReads: 99 });
  seedInsight(h);
  const result = await applyVerification(
    { insightId: ID, verdict: "confirm", clientEventId: EV },
    h.deps
  );
  assert.equal(result.countsSynced, false);
  // frontmatter untouched (never replayed over the stale copy)
  const fm = readFm(h);
  assert.equal(fm.verify_count, 0);
  // diary trace still ran (independent of ②)
  assert.equal(h.calls.diaryTraces.length, 1);
});

test("matrix 格④ write-③ fails → traceWritten:false, result still ok", async () => {
  const h = harness({ failDiary: true });
  seedInsight(h);
  const result = await applyVerification(
    { insightId: ID, verdict: "confirm", clientEventId: EV },
    h.deps
  );
  assert.equal(result.ok, true);
  assert.equal(result.traceWritten, false);
  assert.equal(result.countsSynced, true);
});

test("matrix 格⑤ duplicate clientEventId → already:true, zero writes", async () => {
  const h = harness();
  seedInsight(h);
  seedStream(h, [
    { id: EV, type: "verify", ts: "2026-09-30T21:35:01+08:00", insight: ID, verdict: "confirm", source: null, note: null },
  ]);
  const before = h.calls.writes.length;
  const result = await applyVerification(
    { insightId: ID, verdict: "confirm", clientEventId: EV },
    h.deps
  );
  assert.deepEqual(result, { ok: true, already: true, traceWritten: false, countsSynced: false });
  assert.equal(h.calls.writes.length, before);
});

test("matrix 格⑦ degrade hatch: only write-① runs, outcome matches the failure matrix", async () => {
  const h = harness();
  seedInsight(h);
  const result = await applyVerification(
    { insightId: ID, verdict: "confirm", clientEventId: EV, degrade: true },
    h.deps
  );
  assert.deepEqual(h.calls.writes.map((w) => w.path), [STREAM]);
  assert.deepEqual(result, { ok: true, traceWritten: false, countsSynced: false });
});

test("matrix: unknown insight → INSIGHT_NOT_FOUND 404", async () => {
  const h = harness();
  await assert.rejects(
    applyVerification({ insightId: ID, verdict: "confirm", clientEventId: EV }, h.deps),
    (err) => err instanceof InsightsServiceError && err.code === "INSIGHT_NOT_FOUND"
  );
});

// ── Status semantics through the chain ──────────────────

test("falsified is sticky: replay alone would say hypothesis, file stays falsified", async () => {
  const h = harness();
  seedStream(h, [
    { id: "ev-p", type: "verify", ts: "2026-09-29T21:00:00+08:00", insight: ID, verdict: "confirm", source: null, note: null },
  ]);
  seedInsight(h, insFrontmatter({ status: "falsified" }));
  await applyVerification(
    { insightId: ID, verdict: "confirm", clientEventId: EV },
    h.deps
  );
  const fm = readFm(h);
  assert.equal(fm.status, "falsified"); // sticky — no event can lift it in v1
});

test("refute demotes knowledge via replay (frontmatter follows the stream)", async () => {
  const h = harness();
  seedStream(h, [
    ...fiveConfirms(),
    { id: "ev-k", type: "crown", ts: "2026-09-29T21:00:00+08:00", insight: ID, from: "hypothesis", to: "knowledge", source: null, note: null },
  ]);
  seedInsight(h, insFrontmatter({ status: "knowledge", verify_count: 5 }));
  const result = await applyVerification(
    { insightId: ID, verdict: "refute", clientEventId: EV },
    h.deps
  );
  assert.equal(result.countsSynced, true);
  const fm = readFm(h);
  assert.equal(fm.status, "hypothesis"); // knowledge demoted by the refute
  assert.equal(fm.falsify_count, 1);
  assert.equal(fm.verify_count, 5);
});

// ── crownInsight ────────────────────────────────────────

function fiveConfirms() {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `ev-c${i}`,
    type: "verify",
    ts: `2026-09-2${i}T21:00:00+08:00`,
    insight: ID,
    verdict: "confirm",
    source: null,
    note: null,
  }));
}

test("crown: happy path — event + frontmatter, ≤2 commits in order", async () => {
  const h = harness();
  seedStream(h, fiveConfirms());
  seedInsight(h, insFrontmatter({ verify_count: 5 }));
  const result = await crownInsight({ insightId: ID, clientEventId: "ev-crown-1" }, h.deps);
  assert.deepEqual(result, { ok: true, countsSynced: true });
  assert.deepEqual(h.calls.writes.map((w) => w.path), [STREAM, `Insights/${ID}.md`]);
  assert.equal(h.calls.writes[0].message, "Crown INS-20260930-213501 to knowledge");
  const fm = readFm(h);
  assert.equal(fm.status, "knowledge");
  const events = parseVerifications(h.files.get(STREAM).content).valid;
  assert.equal(events.filter((e) => e.type === "crown").length, 1);
});

test("crown: double-click → already_crowned without a second event", async () => {
  const h = harness();
  seedStream(h, fiveConfirms());
  seedInsight(h, insFrontmatter({ status: "knowledge", verify_count: 5 }));
  const result = await crownInsight({ insightId: ID, clientEventId: "ev-crown-2" }, h.deps);
  assert.deepEqual(result, { ok: true, already_crowned: true, countsSynced: true });
  assert.deepEqual(h.calls.writes, []);
});

test("crown: gate refuses hypothesis with <5 confirms (422, no writes)", async () => {
  const h = harness();
  seedStream(h, fiveConfirms().slice(0, 4));
  seedInsight(h);
  await assert.rejects(
    crownInsight({ insightId: ID, clientEventId: "ev-crown-3" }, h.deps),
    (err) => err instanceof InsightsServiceError && err.code === "NOT_CROWNABLE" && err.status === 422
  );
  assert.deepEqual(h.calls.writes, []);
});

test("crown: gate refuses when any refute exists", async () => {
  const h = harness();
  seedStream(h, [
    ...fiveConfirms(),
    { id: "ev-r", type: "verify", ts: "2026-09-30T09:00:00+08:00", insight: ID, verdict: "refute", source: null, note: null },
  ]);
  seedInsight(h);
  await assert.rejects(
    crownInsight({ insightId: ID, clientEventId: "ev-crown-4" }, h.deps),
    NOT_CROWNABLE
  );
});

function NOT_CROWNABLE(err) {
  return err instanceof InsightsServiceError && err.code === "NOT_CROWNABLE";
}

// ── createInsightFromText (induct) ──────────────────────

test("induct: creates INS with empty sources[] and a body provenance line", async () => {
  const h = harness();
  const result = await createInsightFromText(
    {
      statement: "早睡→下午不犯困",
      topics: ["睡眠"],
      origin: { date: "2026-09-30", time: "21:05" },
    },
    h.deps
  );
  assert.match(result.id, /^INS-20260930-213501$/);
  const path = `Insights/${result.id}.md`;
  assert.equal(h.calls.writes[0].path, path);
  assert.match(h.calls.writes[0].message, /^Add insight INS-20260930-213501 早睡→下午不犯困/);
  const content = h.files.get(path).content;
  // frontmatter: sources[] empty (write-② only), created is a string date
  assert.match(content, /sources: \[\]/);
  assert.match(content, /created: '?2026-09-30'?/); // JSON_SCHEMA round-trips it as a string either way
  // body provenance
  assert.match(content, /## 来源\n\n- 来源：Journal\/Daily\/2026-09-30\.md@2105/);
});

test("induct: rejects multi-line or empty statements (400)", async () => {
  const h = harness();
  await assert.rejects(
    createInsightFromText({ statement: "两行\n不行" }, h.deps),
    (err) => err instanceof InsightsServiceError && err.code === "INVALID_STATEMENT"
  );
  await assert.rejects(
    createInsightFromText({ statement: "   " }, h.deps),
    (err) => err.code === "INVALID_STATEMENT"
  );
});
