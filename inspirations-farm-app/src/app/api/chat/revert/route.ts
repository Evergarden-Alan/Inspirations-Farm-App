import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import { createChatGithubIo } from "@/lib/chat/github-chat";
import { revertPlanFile } from "@/lib/chat/plan-writes";
import { getChatRepos } from "@/lib/chat/repos";

/** 回滚一次 [ai-chat] 计划写入：取父提交内容 PUT 回去（幂等）。 */
export function createChatRevertRoute(
  deps: { revert?: typeof revertPlanFile } = {}
) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { repoId, path, commit } = body as {
      repoId?: string;
      path?: string;
      commit?: string;
    };
    if (repoId !== "review" || typeof path !== "string" || typeof commit !== "string") {
      return Response.json(
        { ok: false, error: "repoId must be 'review', path and commit required" },
        { status: 400 }
      );
    }
    const io = createChatGithubIo();
    const revert = deps.revert ?? revertPlanFile;
    try {
      const result = await revert(getChatRepos().review, path, commit, io);
      return Response.json({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Revert failed";
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  }

  return { POST };
}

export const { POST } = createChatRevertRoute();
