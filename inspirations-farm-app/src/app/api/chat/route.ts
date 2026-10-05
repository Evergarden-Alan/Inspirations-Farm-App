import type { NextRequest } from "next/server";
import { convertToModelMessages, stepCountIs, streamText } from "ai";

import { validatePin } from "@/lib/auth";
import { ChatConfigError, getChatRepos } from "@/lib/chat/repos";
import { warmIfStale } from "@/lib/chat/corpus-cache";
import { createChatGithubIo } from "@/lib/chat/github-chat";
import { createChatTools } from "@/lib/chat/tools";
import { buildSystemFromCache } from "@/lib/chat/prompt";
import { createChatModel } from "@/lib/chat/model";

// Vercel Hobby 上限 60s：冷启动语料装载 + 多步工具链都在预算内（spec §4 时限纪律）。
export const maxDuration = 60;

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** 路由工厂：测试注入 model/tools/system 全离线。 */
export function createChatRoute(
  deps: {
    model?: unknown;
    tools?: Record<string, unknown>;
    system?: string | Promise<string>;
  } = {}
) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) return deny();

    let body: { messages?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ ok: false, error: "messages required" }, { status: 400 });
    }

    let model: unknown;
    try {
      model = deps.model ?? createChatModel();
    } catch (err: unknown) {
      if (err instanceof ChatConfigError) {
        return Response.json({ ok: false, error: err.message }, { status: 503 });
      }
      throw err;
    }

    // 依赖全注入（测试）→ 完全不触碰默认上下文（不读 env、不建 GitHub IO）
    async function resolveDeps(): Promise<{ tools: Record<string, unknown>; system: string }> {
      if (deps.tools !== undefined && deps.system !== undefined) {
        return { tools: deps.tools, system: await deps.system };
      }
      const repos = getChatRepos();
      const io = createChatGithubIo();
      // 冷实例上模块级缓存为空（session 暖的可能是另一实例）：小预算尽力装载
      await warmIfStale(repos, io);
      return {
        tools: deps.tools ?? createChatTools({ repos, io }),
        system: await (deps.system ?? (await buildSystemFromCache(repos, io, new Date())).system),
      };
    }
    const { tools, system } = await resolveDeps();

    const result = streamText({
      model: model as Parameters<typeof streamText>[0]["model"],
      system,
      messages: convertToModelMessages(body.messages),
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      stopWhen: stepCountIs(12),
      temperature: 0.3,
    });
    return result.toUIMessageStreamResponse();
  }

  return { POST };
}

export const { POST } = createChatRoute();
