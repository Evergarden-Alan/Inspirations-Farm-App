import { tool } from "ai";
import { z } from "zod";

import { getCorpus, readThrough } from "@/lib/chat/corpus-cache";
import { appendInspirationCard, appendJournalEntry } from "@/lib/chat/journal-writes";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import { updatePlanFile } from "@/lib/chat/plan-writes";
import type { ChatRepo } from "@/lib/chat/repos";
import { searchCorpus } from "@/lib/chat/search";

export interface ChatToolDeps {
  repos: { note: ChatRepo; review: ChatRepo };
  io: ChatGithubIo;
}

const repoEnum = z.enum(["note", "review"]);

/** 六个服务端工具。错误契约：execute 永不 throw —— 失败返回
 *  `{ ok: false, error }`（模型可自纠，流不断）。写权在底层函数强制。 */
export function createChatTools(deps: ChatToolDeps) {
  const repoOf = (id: "note" | "review"): ChatRepo => deps.repos[id];

  return {
    read_file: tool({
      description: "读取仓库中一个 markdown 文件的全文。缓存优先，未命中回源 GitHub。",
      inputSchema: z.object({ repo: repoEnum, path: z.string() }),
      execute: async ({ repo, path }) => {
        try {
          const r = repoOf(repo);
          const content = await readThrough(r, path, deps.io);
          if (content === null) {
            return { ok: false as const, error: `文件不存在或不可读：${path}` };
          }
          return { ok: true as const, path, content };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    search_text: tool({
      description:
        "在语料缓存内全文搜索。默认字面匹配；'re:' 前缀为正则。glob 如 '数学/**'、'Journal/Daily/*.md'。",
      inputSchema: z.object({ repo: repoEnum, query: z.string(), glob: z.string().optional() }),
      execute: async ({ repo, query, glob }) => {
        try {
          const entry = getCorpus(repoOf(repo).id);
          const result = searchCorpus(entry, query, { glob });
          return {
            ok: true as const,
            ...result,
            partial: entry?.partial ?? false,
            note: entry?.partial
              ? "语料为部分装载，结果可能不全；可用 list_tree + read_file 精确读取"
              : undefined,
          };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    list_tree: tool({
      description: "列出仓库 .md 路径（可按目录前缀过滤）。",
      inputSchema: z.object({ repo: repoEnum, dir: z.string().optional() }),
      execute: async ({ repo, dir }) => {
        const entry = getCorpus(repoOf(repo).id);
        const paths = (entry?.treePaths ?? []).filter(
          (p) => !dir || p.startsWith(dir.endsWith("/") ? dir : `${dir}/`)
        );
        return { ok: true as const, paths };
      },
    }),

    update_plan_file: tool({
      description:
        "改写复习计划仓库的一个 .md 文件（整文件替换为新版本）。一次调用 = 一个 [ai-chat] commit，可从 UI 回滚。改计划必须保留/更新「修订依据」。",
      inputSchema: z.object({
        path: z.string(),
        new_content: z.string().min(1),
        reason: z.string().min(4).describe("一句话修订依据，会进 commit message"),
      }),
      execute: async ({ path, new_content, reason }) => {
        try {
          const res = await updatePlanFile(deps.repos.review, path, new_content, reason, deps.io);
          return { ok: true as const, ...res, note: "已提交；用户可在消息卡片一键回滚" };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    append_journal: tool({
      description:
        "向某天的 Daily 日记「## 今日杂记」追加一条时间戳记录（只能追加，不能改历史）。日记不存在会失败。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        text: z.string().min(1),
        time: z.string().optional().describe("HH:mm:ss，缺省用当前北京时间"),
      }),
      execute: async ({ date, text, time }) => {
        try {
          const res = await appendJournalEntry(deps.repos.note, date, text, deps.io, time);
          return { ok: true as const, ...res };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    append_inspiration: tool({
      description: "在 Inspirations/ 新建一张灵感卡（新文件，frontmatter 自动生成）。",
      inputSchema: z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).default([]),
        priority: z.enum(["p0", "p1", "p2", "p3"]).default("p2"),
      }),
      execute: async ({ title, body, tags, priority }) => {
        try {
          const res = await appendInspirationCard(
            deps.repos.note,
            { title, body, tags, priority },
            deps.io
          );
          return { ok: true as const, ...res };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
