import {
  decodeBase64,
  encodeBase64,
  githubFetchFor,
} from "@/lib/github-client";
import type { ChatRepo } from "@/lib/chat/repos";

/** Repo-agnostic GitHub I/O for the counselor chat: the app's github.ts is
 *  hardwired to the note vault (getConfig), while chat needs the second repo
 *  too. Same Contents API shapes and CRLF normalisation as github.ts. */
export interface ChatGithubIo {
  getFile(repo: ChatRepo, path: string): Promise<{ sha: string; content: string }>;
  putFile(
    repo: ChatRepo,
    path: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<{ commit: string; url: string }>;
  getCommit(repo: ChatRepo, sha: string): Promise<{ parents: string[] }>;
  getFileAtRef(
    repo: ChatRepo,
    path: string,
    ref: string
  ): Promise<{ sha: string; content: string }>;
  listMdPaths(repo: ChatRepo): Promise<string[]>;
}

function assertSafePath(path: string): void {
  if (path.includes("..") || path.startsWith("/")) {
    throw new Error(`Invalid file path: ${path}`);
  }
}

function enc(repo: ChatRepo, path: string): string {
  return `/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(path)}`;
}

export function createChatGithubIo(
  overrides: {
    pat?: string;
    fetch?: (creds: { pat: string }, path: string, options?: RequestInit) => Promise<unknown>;
  } = {}
): ChatGithubIo {
  const pat = overrides.pat ?? process.env.GITHUB_PAT ?? "";
  const gh = overrides.fetch ?? githubFetchFor;

  async function getFile(repo: ChatRepo, path: string) {
    assertSafePath(path);
    const data = await gh<{ sha: string; content: string; encoding: string }>(
      { pat },
      enc(repo, path)
    );
    if (data.encoding !== "base64") throw new Error(`Unexpected encoding: ${data.encoding}`);
    return { sha: data.sha, content: decodeBase64(data.content).replace(/\r\n?/g, "\n") };
  }

  async function putFile(
    repo: ChatRepo,
    path: string,
    content: string,
    message: string,
    sha?: string
  ) {
    assertSafePath(path);
    const res = await gh<{ commit: { sha: string }; content: { html_url: string } }>(
      { pat },
      enc(repo, path),
      {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: encodeBase64(content),
          ...(sha ? { sha } : {}),
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
    return { commit: res.commit.sha, url: res.content.html_url };
  }

  async function getCommit(repo: ChatRepo, sha: string) {
    const res = await gh<{ parents: Array<{ sha: string }> }>(
      { pat },
      `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(sha)}`
    );
    return { parents: res.parents.map((p) => p.sha) };
  }

  async function getFileAtRef(repo: ChatRepo, path: string, ref: string) {
    assertSafePath(path);
    const data = await gh<{ sha: string; content: string; encoding: string }>(
      { pat },
      `${enc(repo, path)}?ref=${encodeURIComponent(ref)}`
    );
    if (data.encoding !== "base64") throw new Error(`Unexpected encoding: ${data.encoding}`);
    return { sha: data.sha, content: decodeBase64(data.content).replace(/\r\n?/g, "\n") };
  }

  async function listMdPaths(repo: ChatRepo) {
    const res = await gh<{
      truncated?: boolean;
      tree: Array<{ path: string; type: string }>;
    }>({ pat }, `/repos/${repo.owner}/${repo.repo}/git/trees/HEAD?recursive=1`);
    if (res.truncated) console.warn(`[chat] tree truncated for ${repo.repo}`);
    return res.tree.filter((n) => n.type === "blob" && n.path.endsWith(".md")).map((n) => n.path);
  }

  return { getFile, putFile, getCommit, getFileAtRef, listMdPaths };
}
