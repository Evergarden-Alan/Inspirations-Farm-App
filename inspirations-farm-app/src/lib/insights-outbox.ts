/**
 * Insights outbox — localStorage write-ahead queue for verify/crown submits.
 *
 * The event id IS the idempotency key: replaying a stored payload can only
 * ever produce `200 already`, so blind retries are safe. Non-idempotent
 * operations must never enter this queue (see the /api/attachment precedent).
 */

const OUTBOX_KEY = "insights_outbox_v1";

export type OutboxKind = "verify" | "crown";

export interface OutboxEntry {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  addedAt: string; // ISO
}

function readAll(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: OutboxEntry[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  window.dispatchEvent(
    new CustomEvent("insights:outbox", { detail: { count: entries.length } })
  );
}

/** Persist BEFORE the network call (write-ahead). */
export function outboxAdd(id: string, kind: OutboxKind, payload: Record<string, unknown>): void {
  const entries = readAll().filter((e) => e.id !== id);
  entries.push({ id, kind, payload, addedAt: new Date().toISOString() });
  writeAll(entries);
}

export function outboxMarkSynced(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

export function outboxPendingCount(): number {
  return readAll().length;
}

export function outboxPending(): OutboxEntry[] {
  return readAll();
}

/** Replay every pending entry through `send`. Returns how many are still
 *  pending afterwards (send throws → entry stays for the next attempt). */
export async function outboxReplay(
  send: (entry: OutboxEntry) => Promise<void>
): Promise<number> {
  const entries = readAll();
  for (const entry of [...entries]) {
    try {
      await send(entry);
      outboxMarkSynced(entry.id);
    } catch (err) {
      if (err instanceof Error && err.name === "AuthError") break; // lock screen takes over
      // keep entry — next open / online event retries
    }
  }
  return outboxPendingCount();
}
