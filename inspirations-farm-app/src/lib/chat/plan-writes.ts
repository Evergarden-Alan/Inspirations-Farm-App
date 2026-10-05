import { withConflictRetry } from "@/lib/github-client";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo } from "@/lib/chat/repos";
import { WriteForbiddenError } from "@/lib/chat/write-core";

export interface WriteResult {
  path: string;
  commit: string;
  url: string | null;
}

/** review 仓库可写性：这是 AI 直改计划的唯一闸门——note 仓库永远走追加层。 */
export function assertReviewWritable(repo: ChatRepo, path: string): void {
  if (repo.id !== "review") {
    throw new WriteForbiddenError("计划文件只允许写入 review 仓库");
  }
  if (!path.endsWith(".md")) {
    throw new WriteForbiddenError(`只允许写 .md 文件，收到：${path}`);
  }
  if (path.includes("..") || path.startsWith("/")) {
    throw new WriteForbiddenError(`非法路径：${path}`);
  }
}

/** 整文件替换写计划：单文件单 commit（[ai-chat] 前缀），409 由 withConflictRetry
 *  消化（重 GET 新 sha 再重放）。 */
export async function updatePlanFile(
  repo: ChatRepo,
  path: string,
  newContent: string,
  reason: string,
  io: ChatGithubIo
): Promise<WriteResult> {
  assertReviewWritable(repo, path);
  return withConflictRetry(async () => {
    const cur = await io.getFile(repo, path); // 404 → GitHubApiError 上抛，工具层转错误文本
    const res = await io.putFile(repo, path, newContent, `[ai-chat] ${reason}`, cur.sha);
    return { path, commit: res.commit, url: res.url };
  });
}

/** 回滚一次 AI 写入：取父提交的文件内容 PUT 回去。内容已等于父版本 → 幂等空操作。 */
export async function revertPlanFile(
  repo: ChatRepo,
  path: string,
  commitSha: string,
  io: ChatGithubIo
): Promise<WriteResult & { alreadyReverted: boolean }> {
  assertReviewWritable(repo, path);
  return withConflictRetry(async () => {
    const commit = await io.getCommit(repo, commitSha);
    const parentSha = commit.parents[0];
    if (!parentSha) throw new WriteForbiddenError("该提交没有父提交，无法回滚");
    const parentFile = await io.getFileAtRef(repo, path, parentSha);
    const cur = await io.getFile(repo, path);
    if (cur.content === parentFile.content) {
      return { path, commit: commitSha, url: null, alreadyReverted: true };
    }
    const res = await io.putFile(
      repo,
      path,
      parentFile.content,
      `[ai-chat] revert ${commitSha.slice(0, 7)} ${path}`,
      cur.sha
    );
    return { path, commit: res.commit, url: res.url, alreadyReverted: false };
  });
}
