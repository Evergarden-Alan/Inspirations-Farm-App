/**
 * GitHub REST API client wrapper.
 * All GitHub API calls go through here to keep auth and base URL centralized.
 */

const GITHUB_API = "https://api.github.com";

function getConfig() {
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

async function githubFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { pat } = getConfig();
  const url = `${GITHUB_API}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub API error ${res.status}: ${body.slice(0, 500)}`
    );
  }

  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────

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

export interface InspirationItem {
  name: string;
  path: string;
  sha: string;
  createdAt: string;
  status: string; // "active" | "completed" from frontmatter
  content: string;
}

// ── API methods ────────────────────────────────────────

/** List files in the Inspirations/ directory */
export async function listInspirations(): Promise<FileListItem[]> {
  const { owner, repo } = getConfig();
  const items = await githubFetch<GitHubContentItem[]>(
    `/repos/${owner}/${repo}/contents/Inspirations`
  );

  return items
    .filter((item) => item.type === "file")
    .map(({ name, path, sha, size }) => ({ name, path, sha, size }));
}

/** Format a date as YYYY-MM-DD HH:mm:ss (local time) */
function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

/** Create a new .md file under Inspirations/ with the given basename and body */
export async function createInspiration(
  filename: string,
  content: string
): Promise<{ path: string; url: string }> {
  const { owner, repo } = getConfig();

  const yamlBlock = [
    "---",
    "type: inspiration",
    "status: active",
    `create: ${formatDate(new Date())}`,
    "---",
    "",
    `# ${content}`,
  ].join("\n");
  const encoded = Buffer.from(yamlBlock, "utf-8").toString("base64");

  const fullPath = `Inspirations/${filename}`;

  const result = await githubFetch<{ content: { path: string; html_url: string } }>(
    `/repos/${owner}/${repo}/contents/${fullPath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Add ${filename}`,
        content: encoded,
      }),
      headers: { "Content-Type": "application/json" },
    }
  );

  return { path: result.content.path, url: result.content.html_url };
}

// ── Content fetching ───────────────────────────────────

/** Fetch and decode a single file's raw text content from the repo */
export async function getFileContent(filePath: string): Promise<string> {
  const { owner, repo } = getConfig();
  const data = await githubFetch<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${filePath}`
  );
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }
  return Buffer.from(data.content, "base64").toString("utf-8");
}

// ── Markdown parsing ───────────────────────────────────

interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

/** Parse YAML frontmatter and body from a markdown string */
export function parseMarkdown(text: string): ParsedMarkdown {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text };

  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }

  // Strip leading "# " heading if present
  let body = match[2].trim();
  if (body.startsWith("# ")) {
    body = body.slice(2);
  }

  return { frontmatter: fm, body };
}

// ── Combined listing ───────────────────────────────────

/** List inspirations with full content and parsed metadata */
export async function listInspirationsWithContent(): Promise<
  InspirationItem[]
> {
  const files = await listInspirations();

  const items = await Promise.all(
    files.map(async (f) => {
      const raw = await getFileContent(f.path);
      const { frontmatter, body } = parseMarkdown(raw);
      return {
        name: f.name,
        path: f.path,
        sha: f.sha,
        createdAt: frontmatter.create ?? "",
        status: frontmatter.status ?? "active",
        content: body,
      };
    })
  );

  // Sort newest first by createdAt (descending)
  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return items;
}

// ── Delete ────────────────────────────────────────────

/** Delete a file from the repo by path and sha */
export async function deleteFile(
  filePath: string,
  sha: string
): Promise<void> {
  const { owner, repo } = getConfig();
  await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "DELETE",
    body: JSON.stringify({
      message: `Delete ${filePath}`,
      sha,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Update status ─────────────────────────────────────

/** Update the status field in a file's YAML frontmatter */
export async function updateFileStatus(
  filePath: string,
  sha: string,
  newStatus: string
): Promise<{ path: string; url: string }> {
  const { owner, repo } = getConfig();

  // Fetch current content
  const raw = await getFileContent(filePath);

  // Replace the status line in YAML frontmatter
  const updated = raw.replace(
    /^status:\s*.*$/m,
    `status: ${newStatus}`
  );

  const encoded = Buffer.from(updated, "utf-8").toString("base64");

  const result = await githubFetch<{ content: { path: string; html_url: string } }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Update status to ${newStatus}`,
        content: encoded,
        sha,
      }),
      headers: { "Content-Type": "application/json" },
    }
  );

  return { path: result.content.path, url: result.content.html_url };
}

// ── Daily Journal ─────────────────────────────────────

export interface DailyTask {
  text: string;
  done: boolean;
}

export interface DailyJournal {
  exists: boolean;
  path?: string;
  sha?: string;
  content?: string;
  date?: string;
  tasks?: DailyTask[];
}

function parseTasks(markdown: string): DailyTask[] {
  const lines = markdown.split("\n");
  const tasks: DailyTask[] = [];
  for (const line of lines) {
    const match = line.match(/^-\s*\[([ xX])\]\s+(.*)$/);
    if (match) {
      tasks.push({
        done: match[1].toLowerCase() === "x",
        text: match[2].trim(),
      });
    }
  }
  return tasks;
}

/** Get or check existence of the daily journal for a given date */
export async function getDailyJournal(date: string): Promise<DailyJournal> {
  const { owner, repo } = getConfig();
  const filePath = `Journal/Daily/${date}.md`;

  try {
    const data = await githubFetch<{
      sha: string;
      content: string;
      encoding: string;
    }>(`/repos/${owner}/${repo}/contents/${filePath}`);

    if (data.encoding !== "base64") {
      throw new Error(`Unexpected encoding: ${data.encoding}`);
    }
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const { frontmatter } = parseMarkdown(raw);

    return {
      exists: true,
      path: filePath,
      sha: data.sha,
      content: raw,
      date: frontmatter.date ?? date,
      tasks: parseTasks(raw),
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("404")) {
      return { exists: false };
    }
    throw err;
  }
}

/** Create a new daily journal file */
export async function createDailyJournal(
  date: string
): Promise<{ path: string; sha: string }> {
  const { owner, repo } = getConfig();

  const yamlBlock = [
    "---",
    "type: daily",
    `date: ${date}`,
    `created: ${formatDate(new Date())}`,
    "---",
    "",
  ].join("\n");

  const encoded = Buffer.from(yamlBlock, "utf-8").toString("base64");
  const filePath = `Journal/Daily/${date}.md`;

  const result = await githubFetch<{ content: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Create daily journal for ${date}`,
        content: encoded,
      }),
      headers: { "Content-Type": "application/json" },
    }
  );

  return { path: filePath, sha: result.content.sha };
}

/** Update a daily journal file with new content */
export async function updateDailyJournal(
  filePath: string,
  sha: string,
  content: string
): Promise<{ sha: string }> {
  const { owner, repo } = getConfig();

  const encoded = Buffer.from(content, "utf-8").toString("base64");

  const result = await githubFetch<{ content: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Update daily journal`,
        content: encoded,
        sha,
      }),
      headers: { "Content-Type": "application/json" },
    }
  );

  return { sha: result.content.sha };
}
