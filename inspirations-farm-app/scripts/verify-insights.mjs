#!/usr/bin/env node
/**
 * verify:insights — reconciliation & commit-invariant check (plan 03 · T3.4).
 *
 * Runs the SAME invariant logic as /api/insights/invariant, but directly
 * against GitHub with GITHUB_PAT from the environment (or .env.local) — no
 * deployed URL needed, works from a dev machine and CI alike. Phone-side
 * second entry point stays the bench UI button.
 *
 * Checks:
 *   1. Drift: replayed event stream vs INS frontmatter (all fields).
 *   2. Merge markers (<<<<<<<) in the recent-journal window.
 *   3. Commit structure on Insights/ paths:
 *        Add insight INS-x   = exactly 1 commit per insight (first commit)
 *        verify(INS-x): …    = message shape `verify(INS-x): <verdict> +1 (vc=n)`
 *        Crown INS-x …       = message shape `Crown INS-x to knowledge`
 *        Reconcile INS-x …   = message shape `Reconcile INS-x from events …`
 *
 * Usage:
 *   node scripts/verify-insights.mjs            # report only
 *   node scripts/verify-insights.mjs --fix      # reconcile drift (one commit per file)
 * Exit code: 0 clean, 1 drift/markers/bad commits found, 2 environment error.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Environment (no secret is ever printed) ─────────────

function loadEnv() {
  const env = { ...process.env };
  const envLocal = join(appRoot, ".env.local");
  if (existsSync(envLocal)) {
    for (const line of readFileSync(envLocal, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in env)) env[m[1]] = m[2];
    }
  }
  for (const key of ["GITHUB_PAT", "REPO_OWNER", "REPO_NAME"]) {
    if (!env[key]) {
      console.error(`Missing ${key} (environment or .env.local)`);
      process.exit(2);
    }
  }
  return env;
}

// ── Commit-structure invariants ─────────────────────────

const COMMIT_RULES = [
  { re: /^Add insight INS-\d{8}-\d{6} \S/, name: "induct" },
  { re: /^verify\(INS-\d{8}-\d{6}\): (confirm|refute) \+1 \(vc=\d+\)$/, name: "verify" },
  { re: /^verify\(INS-\d{8}-\d{6}\): unobserved$/, name: "verify" },
  { re: /^Crown INS-\d{8}-\d{6} to knowledge$/, name: "crown" },
  { re: /^Reconcile INS-\d{8}-\d{6} from events( \(.+\))?$/, name: "reconcile" },
];

async function github(env, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${path}`);
  }
  return res.json();
}

async function checkCommitStructure(env) {
  const commits = await github(
    env,
    `/repos/${env.REPO_OWNER}/${env.REPO_NAME}/commits?path=Insights/&per_page=100`
  );
  const bad = [];
  for (const c of commits) {
    const message = c.commit.message.split("\n")[0];
    const isInsightsCommit = COMMIT_RULES.some((r) => r.re.test(message));
    if (!isInsightsCommit) {
      bad.push({ sha: c.sha.slice(0, 8), message });
    }
  }
  return { total: commits.length, bad };
}

// ── Main ────────────────────────────────────────────────

const { register } = await import("node:module");
const { pathToFileURL } = await import("node:url");
register("./tests/register-hooks.mjs", pathToFileURL(join(appRoot, "tests", "register-hooks.mjs")));

const { checkInvariant, reconcile } = await import(
  pathToFileURL(join(appRoot, "src/lib/insights-invariant.ts"))
);

const env = loadEnv();
const fix = process.argv.includes("--fix");

let failed = false;

try {
  // 1. Drift report
  const report = await checkInvariant();
  console.log(`── insights invariant ─────────────────────────`);
  console.log(`events: ${report.events} (damaged: ${report.damagedLines}, duplicates: ${report.duplicateEvents})`);
  console.log(`scope: ${report.scope}`);
  if (report.drift.length === 0) {
    console.log("drift: none ✓");
  } else {
    failed = true;
    console.log(`drift: ${report.drift.length} field(s) ✗`);
    for (const d of report.drift) {
      console.log(
        `  ${d.insightId} ${d.field}: file=${JSON.stringify(d.fileValue)} replay=${JSON.stringify(d.replayValue)}`
      );
    }
  }

  // 2. Merge markers
  if (report.conflictMarkers.length === 0) {
    console.log("conflict markers: none ✓");
  } else {
    failed = true;
    console.log(`conflict markers: ${report.conflictMarkers.length} ✗`);
    for (const m of report.conflictMarkers) {
      console.log(`  Journal/Daily/${m.date}.md:${m.line}`);
    }
  }

  // 3. Optional repair (explicit — detection never auto-fixes)
  if (fix && report.drift.length > 0) {
    const result = await reconcile();
    console.log(`reconcile: ${result.reconciled.length} file(s) rewritten, ${result.skipped.length} skipped`);
    if (result.skipped.length > 0) failed = true;
  } else if (report.drift.length > 0) {
    console.log("(run with --fix to reconcile from the event stream)");
  }

  // 4. Commit structure on Insights/
  const commits = await checkCommitStructure(env);
  console.log(`commits on Insights/ (last ${commits.total}): ${commits.bad.length === 0 ? "shapes ✓" : `${commits.bad.length} unexpected ✗`}`);
  for (const b of commits.bad) {
    failed = true;
    console.log(`  ${b.sha} ${b.message}`);
  }
} catch (err) {
  console.error(`verify failed: ${err.message}`);
  process.exit(2);
}

process.exit(failed ? 1 : 0);
