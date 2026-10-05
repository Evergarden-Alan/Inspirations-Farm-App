import pLimit from "p-limit";
import { formatBeijingDate } from "@/lib/beijing-time";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo, ChatRepoId } from "@/lib/chat/repos";

export interface CorpusEntry {
  files: Map<string, string>;
  treePaths: string[];
  fetchedAt: number;
  partial: boolean;
}

const TTL_MS = 5 * 60_000;
export const LOAD_BUDGET_MS = 45_000;

const cache = new Map<ChatRepoId, CorpusEntry>();

/** 加载优先级（小者先载）。review：宏观/顶层 > 最近周计划 > 记忆库 > 其余；
 *  note：最近日记 > Inspirations > 其余。 */
export function corpusPriority(
  repoId: ChatRepoId,
  path: string,
  todayBeijing: string
): number {
  if (repoId === "review") {
    if (!path.includes("/")) return 0; // 宏观复习规划.md、总览.md 等顶层文件
    const week = /\/w(\d{2,})\//.exec(path);
    if (week) return 100 - Number(week[1]); // 周号越大越新越优先
    if (path.startsWith("记忆库/")) return 500;
    return 10_000;
  }
  const m = /(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  if (m) {
    const days = Math.max(
      0,
      Math.round((Date.parse(todayBeijing) - Date.parse(m[1])) / 86_400_000)
    );
    return 100 + Math.min(days, 3650);
  }
  if (path.startsWith("Inspirations/")) return 5_000;
  return 20_000;
}

export async function ensureCorpus(
  repo: ChatRepo,
  io: ChatGithubIo,
  opts: { budgetMs?: number; force?: boolean; now?: () => number } = {}
): Promise<CorpusEntry> {
  const now = opts.now ?? Date.now;
  const existing = cache.get(repo.id);
  if (existing && !opts.force && now() - existing.fetchedAt < TTL_MS) return existing;

  const treePaths = await io.listMdPaths(repo);
  const today = formatBeijingDate(new Date(now()));
  const deadline = now() + (opts.budgetMs ?? LOAD_BUDGET_MS);
  const files = existing?.files ?? new Map<string, string>();
  const limit = pLimit(10);
  let gaveUp = false;

  const sorted = [...treePaths].sort(
    (a, b) => corpusPriority(repo.id, a, today) - corpusPriority(repo.id, b, today)
  );
  await Promise.all(
    sorted.map((path) =>
      limit(async () => {
        if (now() > deadline) {
          gaveUp = true;
          return;
        }
        try {
          files.set(path, (await io.getFile(repo, path)).content);
        } catch {
          // 单文件 404/瞬时失败：跳过，覆盖率如实反映
        }
      })
    )
  );

  const entry: CorpusEntry = {
    files,
    treePaths,
    fetchedAt: now(),
    partial: gaveUp || files.size < treePaths.length,
  };
  cache.set(repo.id, entry);
  return entry;
}

export function getCorpus(id: ChatRepoId): CorpusEntry | null {
  return cache.get(id) ?? null;
}

export function corpusCoverage(id: ChatRepoId): {
  cached: number;
  total: number;
  fetchedAt: number | null;
  partial: boolean;
} {
  const e = cache.get(id);
  if (!e) return { cached: 0, total: 0, fetchedAt: null, partial: false };
  return {
    cached: e.files.size,
    total: e.treePaths.length,
    fetchedAt: e.fetchedAt,
    partial: e.partial,
  };
}

/** 缓存优先读取；未命中回源并写回缓存；404/非法路径 → null。 */
export async function readThrough(
  repo: ChatRepo,
  path: string,
  io: ChatGithubIo
): Promise<string | null> {
  const entry = cache.get(repo.id);
  const hit = entry?.files.get(path);
  if (hit !== undefined) return hit;
  try {
    const { content } = await io.getFile(repo, path);
    entry?.files.set(path, content);
    return content;
  } catch {
    return null;
  }
}
