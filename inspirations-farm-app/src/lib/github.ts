/**
 * GitHub REST API client wrapper.
 * All GitHub API calls go through here to keep auth and base URL centralized.
 */

import matter from "gray-matter";
import { getBeijingDateTimeString } from "./beijing-time";
import { parseBeijingTime } from "./time";

const GITHUB_API = "https://api.github.com";
const LINK_RE = /\[\[(\d{4}-\d{2}-\d{2}-\d{6})(?:\|(.*?))?\]\]/;

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
  id: string; // timestamp from filename, e.g. "2026-06-19-113201"
  title: string; // extracted from first # heading
  createdAt: string;
  status: string; // "active" | "completed" from frontmatter
  priority: string; // p0 | p1 | p2 | p3, default "p2"
  tags: string[]; // tag list, default []
  content: string; // body after # heading
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

/** Create a new .md file under Inspirations/ with the given basename and body */
export async function createInspiration(
  filename: string,
  content: string,
  priority: string = "p2",
  tags: string[] = []
): Promise<{ path: string; url: string }> {
  const { owner, repo } = getConfig();

  const tagsStr =
    tags.length > 0 ? `tags: [${tags.join(", ")}]` : "tags: []";

  const yamlBlock = [
    "---",
    "type: inspiration",
    "status: active",
    `create: ${getBeijingDateTimeString()}`,
    `priority: ${priority}`,
    tagsStr,
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
  console.log(`[getFileContent] Fetching ${filePath}`);
  const data = await githubFetch<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${filePath}`
  );
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }
  console.log(`[getFileContent] OK → ${filePath} (${data.content.length} chars b64)`);
  return Buffer.from(data.content, "base64").toString("utf-8");
}

// ── Markdown parsing ───────────────────────────────────

export interface ParsedMarkdown {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

/** Parse YAML frontmatter and body from a markdown string */
export function parseMarkdown(text: string): ParsedMarkdown {
  const { data, content } = matter(text);
  return { frontmatter: data as Record<string, string | string[]>, body: content.trim() };
}

/** Extract the first # heading text from a markdown body */
export function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.*)$/m);
  return match ? match[1].trim() : "";
}

/** Strip the first # heading line from the body */
export function stripHeading(body: string): string {
  return body.replace(/^#\s+.*\n?/m, "").trim();
}

// ── Combined listing ───────────────────────────────────

/** List inspirations with full content and parsed metadata */
export async function listInspirationsWithContent(): Promise<
  InspirationItem[]
> {
  const files = await listInspirations();

  const items = (
    await Promise.all(
      files.map(async (f) => {
        const raw = await getFileContent(f.path);
        const { frontmatter, body } = parseMarkdown(raw);
        const title = extractTitle(body);
        const content = stripHeading(body);

        // Extract create date from raw string to bypass gray-matter date coercion
        const createMatch = raw.match(/^create:\s*(.+)$/m);
        const createdAt = createMatch ? createMatch[1].trim() : String(frontmatter.create ?? "");

        const tagsRaw = frontmatter.tags;
        const tags: string[] = Array.isArray(tagsRaw)
          ? tagsRaw.filter((t: unknown) => typeof t === "string" && t.length > 0)
          : typeof tagsRaw === "string" && tagsRaw.length > 0
            ? [tagsRaw]
            : [];

        return {
          name: f.name,
          path: f.path,
          sha: f.sha,
          id: f.name.replace(/\.md$/, ""),
          title: title || content.slice(0, 40),
          createdAt,
          status: String(frontmatter.status ?? "active"),
          priority: String(frontmatter.priority || "p2"),
          tags,
          content,
        };
      })
    )
  ).filter((item) => item.status !== "completed");

  // Sort newest first by createdAt (descending)
  items.sort(
    (a, b) => parseBeijingTime(b.createdAt).getTime() - parseBeijingTime(a.createdAt).getTime()
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

// ── Archive inspiration ────────────────────────────────

/** Set an inspiration's status to completed by file path */
export async function archiveInspiration(filePath: string): Promise<void> {
  const { owner, repo } = getConfig();

  // Get current content + sha
  const data = await githubFetch<{
    sha: string;
    content: string;
    encoding: string;
  }>(`/repos/${owner}/${repo}/contents/${filePath}`);

  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }
  const raw = Buffer.from(data.content, "base64").toString("utf-8");

  // Replace status to completed
  const updated = raw.replace(/^status:\s*.*$/m, "status: completed");

  const encoded = Buffer.from(updated, "utf-8").toString("base64");

  await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Archive inspiration`,
      content: encoded,
      sha: data.sha,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Daily Journal ─────────────────────────────────────

export interface DailyTask {
  id: number;
  parentId: number | null;
  text: string; // raw text after "- [ ] " for markdown reconstruction
  displayText: string; // text shown in the UI (alias or original)
  sourceIdeaId: string | null; // extracted from [[timestamp|alias]] or null
  done: boolean;
  indentLevel: number;
  indent: string;
  lineNumber: number;
}

export interface DailyJournal {
  exists: boolean;
  path?: string;
  sha?: string;
  content?: string;
  date?: string;
  tasks?: DailyTask[];
  notes?: DailyNote[];
}

function calcIndent(ws: string): { level: number; raw: string } {
  // Tabs: each tab = 1 level. Spaces: every 2 spaces = 1 level.
  if (ws.includes("\t")) {
    const count = ws.split("\t").length - 1;
    return { level: count, raw: ws };
  }
  const count = ws.length;
  return { level: Math.floor(count / 2), raw: ws };
}

export function parseTasks(markdown: string): DailyTask[] {
  const lines = markdown.split("\n");
  const tasks: DailyTask[] = [];
  let id = 0;
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const match = line.match(/^(\s*)-\s*\[([ xX])\]\s+(.*)$/);
    if (match) {
      const { level, raw } = calcIndent(match[1]);
      const rawText = match[3].trim();

      // Parse [[timestamp|alias]] double-bracket link
      const linkMatch = rawText.match(LINK_RE);
      const sourceIdeaId = linkMatch ? linkMatch[1] : null;
      const displayText = linkMatch
        ? (linkMatch[2] || linkMatch[1])
        : rawText;

      tasks.push({
        id: id++,
        parentId: null,
        done: match[2].toLowerCase() === "x",
        text: rawText,
        displayText,
        sourceIdeaId,
        indentLevel: level,
        indent: raw,
        lineNumber: lineNum,
      });
    }
  }
  return computeParents(tasks);
}

/** Assign parentId to each task based on indentLevel */
export function computeParents(tasks: DailyTask[]): DailyTask[] {
  const stack: { id: number; level: number }[] = [];
  for (const task of tasks) {
    while (stack.length > 0 && stack[stack.length - 1].level >= task.indentLevel) {
      stack.pop();
    }
    task.parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
    stack.push({ id: task.id, level: task.indentLevel });
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

    const tasks = parseTasks(raw);
    console.log(
      `[getDailyJournal] ${date}.md exists (sha=${data.sha}, ${tasks.length} tasks)`
    );

    return {
      exists: true,
      path: filePath,
      sha: data.sha,
      content: raw,
      date: String(frontmatter.date ?? date),
      tasks,
      notes: parseDailyNotes(raw),
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("404")) {
      console.log(`[getDailyJournal] ${date}.md not found (404)`);
      return { exists: false };
    }
    console.error(`[getDailyJournal] ${date}.md error:`, err);
    throw err;
  }
}

/** Create a new daily journal file.
 *  Pass `customContent` to use a specific template (e.g. from
 *  Templates/Diary_Template.md); otherwise a sensible default is used. */
export async function createDailyJournal(
  date: string,
  customContent?: string
): Promise<{ path: string; sha: string }> {
  const { owner, repo } = getConfig();

  const template =
    customContent ??
    [
      "---",
      "tags:",
      "  - diary",
      `date: ${date}`,
      "---",
      "",
      "# 近期计划",
      "",
      "",
      "",
      "---",
      "",
      "# 当日日程",
      "",
      "",
      "---",
      "",
      "# 本日总结",
      "",
      "## 今日杂记",
      "",
      "",
    ].join("\n");

  const encoded = Buffer.from(template, "utf-8").toString("base64");
  const filePath = `Journal/Daily/${date}.md`;
  console.log(`[createDailyJournal] Creating ${filePath} (customContent=${!!customContent})`);

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

  console.log(`[createDailyJournal] OK → ${filePath} sha=${result.content.sha}`);
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

  console.log(`[updateDailyJournal] PUT ${filePath} (sha=${sha})`);
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

  console.log(`[updateDailyJournal] OK → new sha=${result.content.sha}`);
  return { sha: result.content.sha };
}

// ── Markdown line manipulation ─────────────────────────

/**
 * Insert a new subtask line into raw markdown content right after
 * the last existing subtask of the given parent task.
 *
 * @param content  Full raw markdown content
 * @param parentTask  The parent task under which to insert
 * @param subtaskText  Text for the new subtask
 * @returns Updated markdown content
 */
export function insertSubtaskLine(
  content: string,
  parentTask: DailyTask,
  subtaskText: string
): string {
  const lines = content.split("\n");
  const parentIndentLen = parentTask.indent.length;
  const subIndent = parentTask.indent + "    "; // 4 spaces per level
  const newLine = `${subIndent}- [ ] ${subtaskText}`;

  // Start from the parent line, scan forward to find the last subtask
  let insertAt = parentTask.lineNumber;

  for (let i = parentTask.lineNumber + 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)-\s*\[/);
    if (match) {
      // Task line — check if it's a deeper subtask
      if (match[1].length > parentIndentLen) {
        insertAt = i;
      } else {
        break; // back to same or shallower level — stop
      }
    } else if (line.trim() === "") {
      insertAt = i; // blank line — skip over it
    } else {
      break; // non-task, non-blank line — stop
    }
  }

  lines.splice(insertAt + 1, 0, newLine);
  return lines.join("\n");
}

/**
 * Insert a new top-level task line into the "# 当日日程" section.
 *
 * Algorithm:
 * 1. Find "# 当日日程" heading
 * 2. Find the next "---" or "# " heading → section end
 * 3. Insert before section end (skip trailing blank lines inside the section)
 * 4. Fallback: append to end of file if heading not found
 */
export function insertIntoDailySection(
  content: string,
  taskLine: string
): string {
  const lines = content.split("\n");

  // Locate section start
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+当日日程\s*$/.test(lines[i])) {
      sectionStart = i;
      break;
    }
  }

  // Fallback: append to end
  if (sectionStart === -1) {
    return content.trimEnd() + "\n" + taskLine + "\n";
  }

  // Locate section end — next "---" or "# " after sectionStart
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || /^#\s/.test(trimmed)) {
      sectionEnd = i;
      break;
    }
  }

  // Back up past trailing blank lines so the new task sits just before them
  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  lines.splice(insertAt, 0, taskLine);
  return lines.join("\n");
}

// ── Daily Notes (今日杂记) ────────────────────────────

export interface DailyNote {
  time: string; // HH:mm
  text: string;
}

/** Extract notes from the ## 今日杂记 section */
export function parseDailyNotes(content: string): DailyNote[] {
  const lines = content.split("\n");

  // Locate ## 今日杂记
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+今日杂记\s*$/.test(lines[i])) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) return [];

  // Find section end
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^#\s/.test(t) || t === "---") {
      sectionEnd = i;
      break;
    }
  }

  const notes: DailyNote[] = [];
  const noteRe = /^-\s+\*\*(\d{2}:\d{2})\*\*\s+(.*)$/;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const match = lines[i].match(noteRe);
    if (match) {
      notes.push({ time: match[1], text: match[2].trim() });
    }
  }
  return notes;
}

/**
 * Append a timestamped note line to the ## 今日杂记 section.
 * If the section doesn't exist, creates it after # 本日总结.
 */
export function insertIntoDailyNotesSection(
  content: string,
  time: string,
  noteText: string
): string {
  const lines = content.split("\n");
  const noteLine = `- **${time}** ${noteText}`;

  // 1) Try to find ## 今日杂记
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+今日杂记\s*$/.test(lines[i])) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    // Create the section after # 本日总结
    let summaryIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^#\s+本日总结\s*$/.test(lines[i])) {
        summaryIdx = i;
        break;
      }
    }
    if (summaryIdx === -1) {
      // Fallback: append to end
      return content.trimEnd() + "\n\n## 今日杂记\n\n" + noteLine + "\n";
    }
    // Insert ## 今日杂记 heading + note after # 本日总结
    // Find the next --- or # heading to place the heading before
    let insertAt = summaryIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === "") {
      insertAt++;
    }
    lines.splice(insertAt, 0, "", "## 今日杂记", "", noteLine);
    return lines.join("\n");
  }

  // 2) Find section end
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^#\s/.test(t) || t === "---") {
      sectionEnd = i;
      break;
    }
  }

  // 3) Insert before section end, skipping trailing blanks
  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  lines.splice(insertAt, 0, noteLine);
  return lines.join("\n");
}

