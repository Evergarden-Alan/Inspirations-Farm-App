import { getBeijingDateTimeString, getBeijingTimestamp } from "@/lib/beijing-time";
import { insertIntoDailyNotesSection } from "@/lib/markdown-utils";
import { GitHubApiError, withConflictRetry } from "@/lib/github-client";
import { getCorpus } from "@/lib/chat/corpus-cache";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo } from "@/lib/chat/repos";
import { AI_COMMIT_PREFIX, JournalMissingError, WriteForbiddenError } from "@/lib/chat/write-core";
import type { WriteResult } from "@/lib/chat/plan-writes";

function beijingClock(): string {
  return getBeijingDateTimeString().slice(11); // "YYYY-MM-DD HH:mm:ss" → "HH:mm:ss"
}

/** 向某天 Daily 的「## 今日杂记」追加一条时间戳记录。只能追加：insert 到
 *  现有节内，frontmatter 与其余内容原样保留；日记缺失 → JournalMissingError
 *  （AI 不代建日记）。先试当月顶层路径，未中则按 `/${date}.md` 后缀搜全树
 *  （兼容按月归档布局）。 */
export async function appendJournalEntry(
  repo: ChatRepo,
  date: string,
  text: string,
  io: ChatGithubIo,
  time?: string
): Promise<WriteResult> {
  if (repo.id !== "note") {
    throw new WriteForbiddenError("append_journal 只允许 note 仓库");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new WriteForbiddenError(`日期格式应为 YYYY-MM-DD，收到：${date}`);
  }
  return withConflictRetry(async () => {
    const flat = `Journal/Daily/${date}.md`;
    let path = flat;
    let journal: { sha: string; content: string };
    try {
      journal = await io.getFile(repo, flat);
    } catch (err: unknown) {
      if (err instanceof GitHubApiError && err.status === 404) {
        const suffix = `/${date}.md`;
        const tree = await io.listMdPaths(repo);
        const archived = tree.find((p) => p.endsWith(suffix));
        if (!archived) {
          throw new JournalMissingError(
            `当日日记不存在：${flat}（AI 不代建日记；请改记最近已有的一天，或提示用户手动创建）`
          );
        }
        path = archived;
        journal = await io.getFile(repo, archived);
      } else {
        throw err;
      }
    }
    const next = insertIntoDailyNotesSection(journal.content, time ?? beijingClock(), text);
    const res = await io.putFile(repo, path, next, `${AI_COMMIT_PREFIX}日记杂记 ${date}`, journal.sha);
    getCorpus(repo.id)?.files.set(path, next); // 写穿透：追加内容立即可检索
    return { path, commit: res.commit, url: res.url };
  });
}

export interface InspirationCardInput {
  title: string;
  body: string;
  tags?: string[];
  priority?: string;
}

/** 在 Inspirations/ 新建灵感卡（新文件 = 追加型）。frontmatter 形状与
 *  createInspiration 一致；同名冲突（422）最多重试 2 次加序号后缀。 */
export async function appendInspirationCard(
  repo: ChatRepo,
  card: InspirationCardInput,
  io: ChatGithubIo,
  timestamp?: string
): Promise<WriteResult> {
  if (repo.id !== "note") {
    throw new WriteForbiddenError("append_inspiration 只允许 note 仓库");
  }
  const ts = timestamp ?? getBeijingTimestamp();
  const yaml = (name: string) =>
    [
      "---",
      "type: inspiration",
      "status: active",
      `create: ${getBeijingDateTimeString()}`,
      `priority: ${card.priority ?? "p2"}`,
      `tags: [${(card.tags ?? []).join(", ")}]`,
      "---",
      "",
      `# ${card.body}`,
    ].join("\n");

  let attempt = 0;
  for (;;) {
    const name = attempt === 0 ? `AI-${ts}.md` : `AI-${ts}-${attempt + 1}.md`;
    const path = `Inspirations/${name}`;
    try {
      const res = await io.putFile(repo, path, yaml(name), `${AI_COMMIT_PREFIX}灵感：${card.title}`);
      const entry = getCorpus(repo.id);
      entry?.files.set(path, yaml(name));
      if (entry && !entry.treePaths.includes(path)) entry.treePaths.push(path);
      return { path, commit: res.commit, url: res.url };
    } catch (err: unknown) {
      const status = err instanceof GitHubApiError ? err.status : 0;
      if (status === 422 && attempt < 2) {
        attempt++;
        continue;
      }
      throw err;
    }
  }
}
