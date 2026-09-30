import assert from "node:assert/strict";
import test from "node:test";

import {
  InsightsStaleReadError,
  appendVerification,
  createInsightFile,
  readInsightFile,
  readRecentJournals,
  readVerifications,
  readVerificationsUntilVisible,
  updateInsightFrontmatter,
} from "../src/lib/insights-github.ts";
import { GitHubConflictError } from "../src/lib/github-client.ts";
import { parseVerifications } from "../src/lib/insights-config.ts";

const ID = "INS-20260930-213501";

function verifyEvent(overrides = {}) {
  return {
    id: "ev-20260930213501-2f8a",
    type: "verify",
    ts: "2026-09-30T21:35:01+08:00",
    insight: ID,
    verdict: "confirm",
    source: { date: "2026-09-30", anchor: "2105" },
    note: "n",
    ...overrides,
  };
}

/** In-memory vault: paths → {sha, content, failNextWith?}. Simulates the
 *  Contents API conflict contract (stale sha → GitHubConflictError). */
function memoryVault(initial = {}) {
  const files = new Map(
    Object.entries(initial).map(([path, content]) => [
      path,
      { sha: `${path}-sha-1`, content },
    ])
  );
  let version = 1;
  return {
    files,
    /** dep-injectable readFile/writeFile with conflict simulation */
    readFile: async (path) => {
      const f = files.get(path);
      return f ? { sha: f.sha, content: f.content } : { sha: null, content: "" };
    },
    writeFile: async (path, message, content, sha) => {
      const f = files.get(path);
      const currentSha = f ? f.sha : null;
      if (sha !== currentSha) {
        // stale replica wrote with an old sha → 409
        throw new GitHubConflictError(`GitHub API error 409 (${path})`);
      }
      version++;
      const next = { sha: `${path}-sha-${version}`, content };
      files.set(path, next);
      return { sha: next.sha };
    },
    /** Simulate the read-replica lag: serve a frozen copy of the stream for
     *  the next N reads (fresh SHA + stale content — the dangerous combo). */
    staleCopies: null,
  };
}

// ── appendVerification ──────────────────────────────────

test("append: creates the stream with one line when missing", async () => {
  const vault = memoryVault();
  const ev = verifyEvent();
  const result = await appendVerification(ev, vault);
  assert.ok(result.sha);
  const parsed = parseVerifications(vault.files.get("Insights/verifications.jsonl").content);
  assert.equal(parsed.valid.length, 1);
  assert.deepEqual(parsed.valid[0], ev);
});

test("append: adds to existing stream without clobbering", async () => {
  const vault = memoryVault();
  await appendVerification(verifyEvent(), vault);
  await appendVerification(verifyEvent({ id: "ev-b", ts: "2026-10-01T08:00:00+08:00", verdict: "refute" }), vault);
  const parsed = parseVerifications(vault.files.get("Insights/verifications.jsonl").content);
  assert.equal(parsed.valid.length, 2);
  assert.deepEqual(parsed.valid.map((e) => e.verdict), ["confirm", "refute"]);
});

test("append: retries on 409 and re-applies the same transform (withConflictRetry)", async () => {
  const vault = memoryVault();
  await appendVerification(verifyEvent(), vault);
  const rawWrite = vault.writeFile;
  let firstCall = true;
  vault.writeFile = async (path, message, content, sha) => {
    if (firstCall) {
      firstCall = false;
      // concurrent write lands between our GET and PUT
      await rawWrite(path, "concurrent", vault.files.get(path).content + "\n", vault.files.get(path).sha);
      // now our PUT carries a stale sha → 409
      throw new GitHubConflictError("GitHub API error 409");
    }
    return rawWrite(path, message, content, await (async () => (await vault.readFile(path)).sha)());
  };
  const second = verifyEvent({ id: "ev-b", ts: "2026-10-01T08:00:00+08:00", verdict: "refute" });
  const result = await appendVerification(second, vault);
  assert.ok(result.sha);
  const parsed = parseVerifications(vault.files.get("Insights/verifications.jsonl").content);
  // BOTH the concurrent line and our retried append survived
  assert.equal(parsed.valid.length, 2);
  assert.deepEqual(parsed.valid.map((e) => e.id), ["ev-20260930213501-2f8a", "ev-b"]);
});

test("append: canonical commit message can be supplied by the service layer", async () => {
  const vault = memoryVault();
  const written = [];
  const rawWrite = vault.writeFile;
  vault.writeFile = async (path, message, content, sha) => {
    written.push(message);
    return rawWrite(path, message, content, sha);
  };
  await appendVerification(verifyEvent(), vault, "verify(INS-20260930-213501): confirm +1 (vc=1)");
  assert.equal(written[0], "verify(INS-20260930-213501): confirm +1 (vc=1)");
});

// ── readVerificationsUntilVisible (the stale-read guard) ──

test("visibility guard: returns once the event id is visible", async () => {
  const vault = memoryVault();
  const ev = verifyEvent();
  await appendVerification(ev, vault);
  const parsed = await readVerificationsUntilVisible(ev.id, vault, [0, 0, 0]);
  assert.equal(parsed.valid.length, 1);
});

test("visibility guard: serves a STALE replica first (fresh sha + old content) and still recovers", async () => {
  const vault = memoryVault();
  const ev = verifyEvent();
  await appendVerification(ev, vault);
  const fresh = vault.files.get("Insights/verifications.jsonl");
  const stale = { sha: fresh.sha, content: "" }; // dangerous: new sha, old content
  const realRead = vault.readFile;
  let served = 0;
  vault.readFile = async (path) => {
    if (path === "Insights/verifications.jsonl" && served++ < 1) return stale;
    return realRead(path);
  };
  const parsed = await readVerificationsUntilVisible(ev.id, vault, [0, 0, 0]);
  assert.equal(parsed.valid.length, 1);
});

test("visibility guard: exhaustion throws InsightsStaleReadError (write-② must fail, not fake success)", async () => {
  const vault = memoryVault({ "Insights/verifications.jsonl": "" });
  await assert.rejects(
    readVerificationsUntilVisible("ev-missing", vault, [0, 1, 1]),
    InsightsStaleReadError
  );
});

// ── INS file read / frontmatter update / create ─────────

const INS_BODY = "早睡→下午不犯困\n\n## 来源\n\n- 来源：Journal/Daily/2026-09-30.md@2130\n";

function insFile(overrides = {}) {
  const fm = [
    "---",
    "type: insight",
    `id: ${ID}`,
    'statement: "早睡→下午不犯困"',
    "status: hypothesis",
    "verify_count: 0",
    "falsify_count: 0",
    "last_verified: null",
    'created: "2026-09-30"',
    "topics: []",
    "sources: []",
    "related: []",
    "---",
    "",
    INS_BODY.trimEnd(),
    "",
  ].join("\n");
  return overrides.content ?? fm;
}

test("readInsightFile: splits frontmatter and body; missing → null", async () => {
  const vault = memoryVault({ [`Insights/${ID}.md`]: insFile() });
  const file = await readInsightFile(ID, vault);
  assert.equal(file.frontmatter.id, ID);
  assert.equal(file.frontmatter.status, "hypothesis");
  assert.match(file.body, /早睡→下午不犯困/);
  assert.equal(await readInsightFile("INS-00000000-000000", vault), null);
});

test("updateInsightFrontmatter: structured field write preserves the body", async () => {
  const vault = memoryVault({ [`Insights/${ID}.md`]: insFile() });
  await updateInsightFrontmatter(
    ID,
    { verify_count: 3, status: "verified", sources: ["Journal/Daily/2026-09-30.md@2135"] },
    vault
  );
  const file = await readInsightFile(ID, vault);
  assert.equal(file.frontmatter.verify_count, 3);
  assert.equal(file.frontmatter.status, "verified");
  assert.deepEqual(file.frontmatter.sources, ["Journal/Daily/2026-09-30.md@2135"]);
  // dates stay strings, body untouched
  assert.equal(file.frontmatter.created, "2026-09-30");
  assert.match(file.body, /早睡→下午不犯困/);
});

test("updateInsightFrontmatter: missing file → 404 GitHubApiError (not silent)", async () => {
  const vault = memoryVault();
  await assert.rejects(
    updateInsightFrontmatter("INS-00000000-000000", { status: "verified" }, vault),
    /not found/
  );
});

test("createInsightFile: writes frontmatter through the date-safe opts", async () => {
  const vault = memoryVault();
  const fm = {
    type: "insight",
    id: ID,
    statement: "早睡→下午不犯困",
    status: "hypothesis",
    verify_count: 0,
    falsify_count: 0,
    last_verified: null,
    created: "2026-09-30",
    topics: ["睡眠"],
    sources: [],
    related: [],
  };
  await createInsightFile(fm, INS_BODY.trimEnd(), vault);
  const file = await readInsightFile(ID, vault);
  assert.equal(file.frontmatter.created, "2026-09-30"); // string, not Date
  assert.deepEqual(file.frontmatter.topics, ["睡眠"]);
});

// ── Recent journals window ──────────────────────────────

test("readRecentJournals: window includes today and goes back N days", async () => {
  const vault = memoryVault({
    "Journal/Daily/2026-09-30.md": "yesterday content",
    "Journal/Daily/2026-10-01.md": "today content",
  });
  const journals = await readRecentJournals(3, { ...vault, today: () => "2026-10-01" });
  assert.deepEqual(
    journals.map((j) => [j.date, j.exists]),
    [
      ["2026-10-01", true],
      ["2026-09-30", true],
      ["2026-09-29", false],
    ]
  );
});

// ── Plain read ──────────────────────────────────────────

test("readVerifications: returns raw content + parsed triple", async () => {
  const vault = memoryVault();
  await appendVerification(verifyEvent(), vault);
  const { sha, content, parsed } = await readVerifications(vault);
  assert.ok(sha);
  assert.ok(content.includes("ev-20260930213501-2f8a"));
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.damaged, 0);
});
