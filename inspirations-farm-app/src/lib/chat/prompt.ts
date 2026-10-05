import { assembleHotSet, type HotSetResult } from "@/lib/chat/hot-set";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import { corpusCoverage } from "@/lib/chat/corpus-cache";
import type { ChatRepo, ChatRepoId } from "@/lib/chat/repos";

export interface SystemPromptInput {
  hotSet: { text: string; degraded: boolean; missing: string[] };
  coverage: { note: string; review: string };
  nowIso: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const degrade = input.hotSet.degraded
    ? "⚠️ 热集未能装载（缓存为空或全部失败）。请用 list_tree/search_text/read_file 自行检索后再回答，并提示用户数据可能不是最新。"
    : "";
  const missing = input.hotSet.missing.length
    ? `以下热集文件未能载入：${input.hotSet.missing.join("、")}。需要时可用 read_file 读取。`
    : "";
  return `你是用户的「计划参谋」：一个嵌入在 Inspirations Farm App 里的 AI 对话助手。用户是备考 408 的学生，用 Note 仓库（Obsidian）记日记和灵感，用 review_status 仓库运营考研复习计划。你的职责：基于两个仓库的真实内容分析当前计划、讨论额外工作，并按用户指示直接调整计划文档。

当前时间：${input.nowIso}

## 语料覆盖
- review 仓库缓存：${input.coverage.review}
- note 仓库缓存：${input.coverage.note}
${degrade}
${missing}

## 热集（已预载的当前计划与近况）
${input.hotSet.text || "（空）"}

## 工具与写入纪律
- 事实性问题必须基于 read_file/search_text 的结果回答，并给出文件路径；不许凭空编造计划内容。
- update_plan_file 只能改 review 仓库的 .md；整文件替换；一次调用一个 commit（[ai-chat] 前缀自动加）。**改计划必须保留/更新文件里的「修订依据」内容**，对齐该仓库「不静默改目标」的纪律。
- append_journal 对日记**只能追加**：向某天 Daily 的「## 今日杂记」加一条时间戳记录——历史日记与当日日程绝不可改写。
- append_inspiration 在 Inspirations/ 新建卡片。
- 多文件调整拆成多次 update_plan_file 调用，每次一个可独立回滚的 commit。
- 写入失败（ok:false）时向用户说明原因，不要静默重试超过一次。
- 回答用中文，引用文件时写明路径。`;
}

/** 从（可能为空的）缓存组装系统提示词——不做网络装载，预算由路由层控制。 */
export async function buildSystemFromCache(
  repos: { note: ChatRepo; review: ChatRepo },
  io: ChatGithubIo,
  now: Date
): Promise<{ system: string; hotSet: HotSetResult }> {
  const hotSet = await assembleHotSet(repos, io, now);
  const fmt = (id: ChatRepoId) => {
    const c = corpusCoverage(id);
    return c.total === 0 ? "空（未装载）" : `${c.cached}/${c.total}${c.partial ? " (partial)" : ""}`;
  };
  return {
    hotSet,
    system: buildSystemPrompt({
      hotSet,
      coverage: { note: fmt("note"), review: fmt("review") },
      nowIso: now.toISOString(),
    }),
  };
}
