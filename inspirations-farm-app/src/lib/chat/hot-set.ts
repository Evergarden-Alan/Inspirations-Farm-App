import { formatBeijingDate } from "@/lib/beijing-time";
import { getCorpus, readThrough } from "@/lib/chat/corpus-cache";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo, ChatRepoId } from "@/lib/chat/repos";

/** ISO 8601 周号（周一为一周之始；含 12/29-31 可能属次年 w01 的规则）。 */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // 周日 = 7
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export function weekLabel(w: { week: number }): string {
  return `w${String(w.week).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" 回退 n 天（UTC 逐日算术，避开时区坑）。 */
export function minusDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - n));
  return dt.toISOString().slice(0, 10);
}

const REVIEW_SUBJECTS = "(?:408|数学|英语)";

/** 从全树路径解析热集文件。review：宏观 + 三科本周计划 + 最近周总结；
 *  note：近 7 天日记（兼容当月顶层与按月嵌套两种布局）。 */
export function resolveHotSetPaths(
  repoId: ChatRepoId,
  treePaths: string[],
  todayBeijing: string
): string[] {
  if (repoId === "review") {
    const label = weekLabel(isoWeek(new Date(`${todayBeijing}T12:00:00+08:00`)));
    const out: string[] = [];
    const macro = treePaths.find((p) => p === "宏观复习规划.md");
    if (macro) out.push(macro);
    for (const subject of ["408", "数学", "英语"]) {
      const plan = treePaths.find(
        (p) => p === `${subject}/${label}/本周复习计划.md`
      );
      if (plan) out.push(plan);
    }
    const summaries = treePaths
      .map((p) => {
        const m = new RegExp(`^${REVIEW_SUBJECTS}/w(\\d{2,})/.*总结.*\\.md$`).exec(p);
        return m ? { path: p, week: Number(m[1]) } : null;
      })
      .filter((x): x is { path: string; week: number } => x !== null)
      .sort((a, b) => b.week - a.week);
    if (summaries[0]) out.push(summaries[0].path);
    return out;
  }
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = minusDays(todayBeijing, i);
    const hit = treePaths.find(
      (p) => p.endsWith(`/${date}.md`) || p === `Journal/Daily/${date}.md`
    );
    if (hit) out.push(hit);
  }
  return out;
}

export interface HotSetResult {
  text: string;
  loaded: string[];
  missing: string[];
  degraded: boolean;
}

/** 组装热集 prompt 文本：仓库名 + 文件路径头 + 正文。只在缓存里取（不阻塞），
 *  缺失文件列入 missing；全部缺失 → degraded。 */
export async function assembleHotSet(
  repos: { note: ChatRepo; review: ChatRepo },
  io: ChatGithubIo,
  now: Date
): Promise<HotSetResult> {
  const today = formatBeijingDate(now);
  const blocks: string[] = [];
  const loaded: string[] = [];
  const missing: string[] = [];

  for (const repo of [repos.review, repos.note]) {
    const entry = getCorpus(repo.id);
    if (!entry) continue;
    const paths = resolveHotSetPaths(repo.id, entry.treePaths, today);
    for (const path of paths) {
      const content = await readThrough(repo, path, io);
      if (content === null) {
        missing.push(path);
        continue;
      }
      loaded.push(path);
      blocks.push(`### [${repo.label}] ${path}\n\n${content}`);
    }
  }

  return {
    text: blocks.join("\n\n---\n\n"),
    loaded,
    missing,
    degraded: loaded.length === 0,
  };
}
