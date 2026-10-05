import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import { ensureCorpus, corpusCoverage } from "@/lib/chat/corpus-cache";
import { createChatGithubIo, getCoreRateLimitRemaining } from "@/lib/chat/github-chat";
import { listChatProviders } from "@/lib/chat/model";
import { buildSystemFromCache } from "@/lib/chat/prompt";
import { getChatRepos } from "@/lib/chat/repos";

// 45s 共享装载预算远超平台默认 10s——不声明就会被中途杀掉（同 insights 路由先例）。
export const maxDuration = 60;

/** 一次全量装载约需 500+ 请求（review 146 + note 363 + 热集）；低于这个余量
 *  就别硬拉——把最后一点配额留给用户的正常读写。 */
const MIN_QUOTA_FOR_LOAD = 600;

/** 引导端点：暖语料缓存（45s 共享预算）+ 装配热集，返回覆盖率与降级状态。
 *  单仓库失败不整体失败——degraded:true 让前端亮「数据截至」横幅。
 *  配额不足时跳过装载（免费 /rate_limit 预检），把重置时间透传给前端。 */
export function createChatSessionRoute(
  deps: {
    ensure?: typeof ensureCorpus;
    quotaCheck?: () => Promise<{ remaining: number; resetAt: number } | null>;
  } = {}
) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const repos = getChatRepos();
    const io = createChatGithubIo();
    const ensure = deps.ensure ?? ensureCorpus;
    const quotaCheck = deps.quotaCheck ?? getCoreRateLimitRemaining;

    let degraded = false;
    const quota = await quotaCheck().catch(() => null);
    if (quota && quota.remaining < MIN_QUOTA_FOR_LOAD) {
      const { system } = await buildSystemFromCache(repos, io, new Date());
      return Response.json({
        ok: true,
        fetchedAt: new Date().toISOString(),
        coverage: { note: corpusCoverage("note"), review: corpusCoverage("review") },
        degraded: true,
        hotSetChars: system.length,
        providers: listChatProviders().filter((p) => p.hasKey).map((p) => p.id),
        quota,
      });
    }

    const deadline = Date.now() + 45_000;
    for (const repo of [repos.review, repos.note]) {
      try {
        await ensure(repo, io, { budgetMs: Math.max(5_000, deadline - Date.now()) });
      } catch (err: unknown) {
        console.error(`[chat/session] corpus ${repo.id} failed:`, err);
        degraded = true;
      }
    }

    const { system, hotSet } = await buildSystemFromCache(repos, io, new Date());
    return Response.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      coverage: { note: corpusCoverage("note"), review: corpusCoverage("review") },
      degraded: degraded || hotSet.degraded,
      hotSetChars: system.length,
      providers: listChatProviders().filter((p) => p.hasKey).map((p) => p.id),
      quota,
    });
  }

  return { POST };
}

export const { POST } = createChatSessionRoute();
