/**
 * Insights domain — invariant checking & reconcile.
 *
 * Detection and repair are SEPARATE operations (plan 01 §2): GET dryRun only
 * ever reads and reports; POST reconcile is the explicit, per-file-commit
 * repair. Nothing here auto-repairs on read — a silent fix would swallow the
 * signal that tells us drift recurs.
 *
 * Compared fields per INS: verify_count / falsify_count / last_verified /
 * status (sticky-falsified merged) / sources — not just the counters.
 * Conflict markers (<<<<<<< from obsidian-git pull races) are scanned over the
 * same recent-journal window the bench reads (v1 scope: last 3 days; older
 * files are cold and get pulled clean by the desktop's 1-min cycle).
 */

import {
  type InsightEvent,
  type InsightStatus,
  sourceToString,
} from "./insights";
import { replayEvents } from "./insights-config";
import {
  type InsightsGithubDeps,
  readAllInsightFrontmatters,
  readRecentJournals,
  readVerifications,
  updateInsightFrontmatter,
} from "./insights-github";

export interface DriftEntry {
  insightId: string;
  field: "verify_count" | "falsify_count" | "last_verified" | "status" | "sources";
  fileValue: unknown;
  replayValue: unknown;
}

export interface InvariantReport {
  drift: DriftEntry[];
  /** Lines in recent journals that still carry unresolved merge markers. */
  conflictMarkers: { date: string; line: number }[];
  damagedLines: number;
  duplicateEvents: number;
  events: number;
  /** Scope note for the UI — what this report did and did not look at. */
  scope: string;
}

const CONFLICT_MARKER_RE = /^<{7}(\s|$)/;

export async function checkInvariant(
  deps: InsightsGithubDeps = {}
): Promise<InvariantReport> {
  const [frontmatters, stream, journals] = await Promise.all([
    readAllInsightFrontmatters(deps),
    readVerifications(deps),
    readRecentJournals(3, deps),
  ]);
  const counts = replayEvents(stream.parsed.valid);

  const drift: DriftEntry[] = [];
  for (const [id, fm] of Object.entries(frontmatters)) {
    const replayed = counts[id];
    if (!replayed) continue; // no events → nothing to reconcile against
    if (fm.verify_count !== replayed.vc) {
      drift.push({ insightId: id, field: "verify_count", fileValue: fm.verify_count, replayValue: replayed.vc });
    }
    if (fm.falsify_count !== replayed.fc) {
      drift.push({ insightId: id, field: "falsify_count", fileValue: fm.falsify_count, replayValue: replayed.fc });
    }
    const fileLast = typeof fm.last_verified === "string" ? fm.last_verified : null;
    const replayLast = replayed.lastVerified?.slice(0, 10) ?? null;
    if (fileLast !== replayLast) {
      drift.push({ insightId: id, field: "last_verified", fileValue: fileLast, replayValue: replayLast });
    }
    // status: replay owns it, except the sticky manual falsified (crown only)
    const expectedStatus: InsightStatus =
      fm.status === "falsified" && replayed.status !== "knowledge"
        ? "falsified"
        : replayed.status;
    if (fm.status !== expectedStatus) {
      drift.push({ insightId: id, field: "status", fileValue: fm.status, replayValue: expectedStatus });
    }
    // sources: rebuild from the stream (write-② owns the field)
    const expectedSources: string[] = [];
    for (const ev of stream.parsed.valid) {
      if (ev.type !== "verify" || ev.insight !== id || !ev.source) continue;
      const s = sourceToString(ev.source);
      if (s && !expectedSources.includes(s)) expectedSources.push(s);
    }
    const fileSources = Array.isArray(fm.sources) ? (fm.sources as string[]) : [];
    if (JSON.stringify(fileSources) !== JSON.stringify(expectedSources)) {
      drift.push({ insightId: id, field: "sources", fileValue: fileSources, replayValue: expectedSources });
    }
  }

  const conflictMarkers: InvariantReport["conflictMarkers"] = [];
  for (const j of journals) {
    j.content.split("\n").forEach((line, idx) => {
      if (CONFLICT_MARKER_RE.test(line)) conflictMarkers.push({ date: j.date, line: idx + 1 });
    });
  }

  return {
    drift,
    conflictMarkers,
    damagedLines: stream.parsed.damaged,
    duplicateEvents: stream.parsed.duplicates,
    events: stream.parsed.valid.length,
    scope: "INS frontmatter vs event stream (all files) + merge markers in the last 3 daily journals",
  };
}

export interface ReconcileResult {
  reconciled: string[];
  skipped: string[];
  detail: string;
}

/** Explicit repair: rewrite each drifted INS from the replayed stream, one
 *  commit per file (`Reconcile INS-x from events (vc=n fc=m)`). */
export async function reconcile(
  deps: InsightsGithubDeps = {}
): Promise<ReconcileResult> {
  const report = await checkInvariant(deps);
  const perFile = new Map<string, DriftEntry[]>();
  for (const entry of report.drift) {
    perFile.set(entry.insightId, [...(perFile.get(entry.insightId) ?? []), entry]);
  }

  const reconciled: string[] = [];
  const skipped: string[] = [];
  for (const [id, entries] of perFile) {
    const fields: Record<string, unknown> = {};
    for (const e of entries) fields[e.field] = e.replayValue;
    try {
      await updateInsightFrontmatter(
        id,
        fields as Parameters<typeof updateInsightFrontmatter>[1],
        deps
      );
      reconciled.push(id);
    } catch {
      skipped.push(id); // 409-exhaustion etc. — reported, never silent
    }
  }

  const vc = (id: string) => {
    const e = perFile.get(id)?.find((d) => d.field === "verify_count");
    return e ? e.replayValue : "?";
  };
  const fc = (id: string) => {
    const e = perFile.get(id)?.find((d) => d.field === "falsify_count");
    return e ? e.replayValue : "?";
  };
  return {
    reconciled,
    skipped,
    detail: reconciled.length
      ? reconciled.map((id) => `Reconcile ${id} from events (vc=${vc(id)} fc=${fc(id)})`).join("; ")
      : "no drift to reconcile",
  };
}

export type { InsightEvent };
