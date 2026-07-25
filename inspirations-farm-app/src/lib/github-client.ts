/**
 * Low-level GitHub REST API client.
 *
 * Pure network concerns only: auth/config, the fetch wrapper, conflict-retry,
 * base64 codec, and the raw API response shapes. No business logic and no
 * markdown parsing — those live in github.ts (data service) and
 * markdown-utils.ts respectively.
 */

const GITHUB_API = "https://api.github.com";

/** Read GitHub credentials + repo target from the environment. */
export function getConfig() {
  const pat = process.env.GITHUB_PAT;
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;

  if (!pat || !owner || !repo) {
    throw new Error(
      "Missing required environment variables: GITHUB_PAT, REPO_OWNER, REPO_NAME"
    );
  }

  return { pat, owner, repo };
}

/** Error thrown when a GitHub write conflicts (HTTP 409) — the file's blob SHA
 *  changed between our GET and PUT. Callers can catch this and retry. */
export class GitHubConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "GitHubConflictError";
  }
}

/** Retry a write operation on HTTP 409 (stale SHA). The operation `fn` must
 *  GET the current SHA + content internally before its PUT; on a 409 the file
 *  changed between that GET and the PUT, so we retry and `fn` re-GETs the
 *  fresh SHA + content. Max 2 attempts.
 *
 *  The GET inside `fn` is necessary, not redundant: the write methods here edit
 *  YAML frontmatter, so they need the file's raw content, which callers don't
 *  supply. There is therefore no caller-held SHA to short-circuit the GET with,
 *  and this helper takes no `initialSha`. */
export async function withConflictRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      if (err instanceof GitHubConflictError) {
        // Stale SHA — retry; fn will re-GET the fresh SHA + content.
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Authorised fetch wrapper for the GitHub REST API. Centralises the base URL,
 *  auth header, API version, and no-store caching. Throws GitHubConflictError
 *  on 409 (so callers can retry) and a plain Error on other non-2xx statuses. */
export async function githubFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { pat } = getConfig();
  const url = `${GITHUB_API}${path}`;

  const res = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    const safeMessage = `GitHub API error ${res.status}`;

    // Log full error server-side for debugging, but only expose sanitized
    // message to client to prevent leaking tokens, file paths, or internal details
    console.error(`[githubFetch] ${path}:`, body.slice(0, 500));

    // 409 = stale SHA (someone wrote between our GET and PUT). Surface as a
    // typed error so callers can re-fetch the SHA and retry the write.
    if (res.status === 409) {
      throw new GitHubConflictError(safeMessage);
    }
    throw new Error(safeMessage);
  }

  return res.json() as Promise<T>;
}

// ── Base64 codec (GitHub Contents API exchanges base64-encoded UTF-8) ────

/** Encode a UTF-8 string to base64 (for GitHub Contents API PUT bodies). */
export function encodeBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

/** Decode a base64 string back to UTF-8 (for GitHub Contents API GET responses). */
export function decodeBase64(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

// ── Raw API response shapes ─────────────────────────────────────────────

export interface GitHubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: "file" | "dir";
}

export interface FileListItem {
  name: string;
  path: string;
  sha: string;
  size: number;
}
