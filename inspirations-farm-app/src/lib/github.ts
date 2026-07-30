/**
 * High-level data service for the Inspirations Farm CMS.
 *
 * Orchestrates the low-level GitHub client (./github-client) and the markdown
 * utilities (./markdown-utils) into business operations: listing / creating /
 * archiving inspirations, appending patches, and daily-journal CRUD.
 *
 * External callers (API routes, the server data layer, client components)
 * import from here; the re-exports below preserve the pre-split public API so
 * no call site needs to change.
 */

import { getBeijingDateTimeString } from "./beijing-time";
import { parseBeijingTime } from "./time";
import pLimit from "p-limit";
import {
  getConfig,
  githubFetch,
  withConflictRetry,
  encodeBase64,
  decodeBase64,
  type GitHubContentItem,
  type FileListItem,
} from "./github-client";
import {
  parseFrontmatter,
  setFrontmatterField,
  parseMarkdown,
  extractTitle,
  stripHeading,
  parseInspirationPatches,
  parseTasks,
  parseDailyNotes,
  stripStalePlaceholder,
  appendInspirationPatchLine,
  type InspirationPatch,
  type DailyTask,
  type DailyNote,
} from "./markdown-utils";

// ── Re-export the pre-split public API (keeps external imports working) ──
export {
  GitHubApiError,
  GitHubConflictError,
  type GitHubContentItem,
  type FileListItem,
} from "./github-client";
export {
  parseMarkdown,
  extractTitle,
  stripHeading,
  parseInspirationPatches,
  parseTasks,
  createTaskLocator,
  locateTask,
  setTaskFocusDurationAtLine,
  computeParents,
  parseDailyNotes,
  insertSubtaskLine,
  insertIntoDailySection,
  insertIntoDailyNotesSection,
  stripStalePlaceholder,
  type ParsedMarkdown,
  type InspirationPatch,
  type DailyTask,
  type DailyTaskLocator,
  type DailyNote,
} from "./markdown-utils";

// ── Types ──────────────────────────────────────────────

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
  content: string; // body above ## 追加记录 (excluding the first # heading)
  patches?: InspirationPatch[]; // parsed from ## 追加记录 section
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

// ── Helpers ────────────────────────────────────────────

/** Normalise a frontmatter `date` value to YYYY-MM-DD. Accepts ISO strings
 *  (e.g. "2026-06-08T17:15:00") and plain dates ("2026-06-26"). Falls back to
 *  the raw string if it doesn't look like a date. */
function normalizeDateString(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : value;
}

// ── Inspirations ───────────────────────────────────────

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
  const encoded = encodeBase64(yamlBlock);

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

/** Fetch and decode a single file's raw text content from the repo */
export async function getFileContent(filePath: string): Promise<string> {
  const { owner, repo } = getConfig();

  // SECURITY: Prevent path traversal attacks. Reject paths containing ".." or
  // starting with "/" to ensure all reads stay within the repository root.
  if (filePath.includes("..") || filePath.startsWith("/")) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  console.log(`[getFileContent] Fetching ${filePath}`);
  const data = await githubFetch<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${filePath}`
  );
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }
  console.log(`[getFileContent] OK → ${filePath} (${data.content.length} chars b64)`);
  return decodeBase64(data.content);
}

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

        // SECURITY: Extract create date ONLY from parsed frontmatter, not from raw
        // string scan. A raw regex scan would let malicious content in the body
        // inject a fake "create: <timestamp>" line to manipulate sort order.
        // gray-matter's date coercion is prevented by JSON_SCHEMA in parseFrontmatter.
        // Fallback to filename timestamp if frontmatter.create is missing (legacy data).
        const createdAt = String(frontmatter.create ?? "") || f.name.replace(/\.md$/, "");

        // Parse content and patches, splitting at ## 追加记录
        const stripped = stripHeading(body);
        const { content, patches } = parseInspirationPatches(stripped, createdAt);

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
          patches: patches.length > 0 ? patches : undefined,
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

/** Update the status field in a file's YAML frontmatter */
export async function updateFileStatus(
  filePath: string,
  _sha: string,
  newStatus: string
): Promise<{ path: string; url: string }> {
  return withConflictRetry(async () => {
    const { owner, repo } = getConfig();

    // Fetch current content + fresh SHA (the passed sha may be stale).
    const data = await githubFetch<{
      sha: string;
      content: string;
      encoding: string;
    }>(`/repos/${owner}/${repo}/contents/${filePath}`);
    if (data.encoding !== "base64") {
      throw new Error(`Unexpected encoding: ${data.encoding}`);
    }
    const raw = decodeBase64(data.content);

    // Update status via structured frontmatter, not a whole-document regex,
    // so a body line containing "status:" is never touched. The date-safe
    // helper keeps `create` (and other date-like fields) as strings.
    const updated = setFrontmatterField(raw, "status", newStatus);
    const encoded = encodeBase64(updated);

    const result = await githubFetch<{ content: { path: string; html_url: string } }>(
      `/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: `Update status to ${newStatus}`,
          content: encoded,
          sha: data.sha,
        }),
        headers: { "Content-Type": "application/json" },
      }
    );

    return { path: result.content.path, url: result.content.html_url };
  });
}

/** Set an inspiration's status to completed by file path */
export async function archiveInspiration(filePath: string): Promise<void> {
  return withConflictRetry(async () => {
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
    const raw = decodeBase64(data.content);

    // Set status to completed via structured frontmatter — protects body text
    // containing "status:".
    const updated = setFrontmatterField(raw, "status", "completed");
    const encoded = encodeBase64(updated);

    await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Archive inspiration`,
        content: encoded,
        sha: data.sha,
      }),
      headers: { "Content-Type": "application/json" },
    });
  });
}

// ── Sync ideas state (Obsidian reconciliation) ──────────

/**
 * Batch-update inspiration status to completed.
 * Used when Obsidian marks a linked task as done and the web app
 * needs to catch up on the inspiration side.
 *
 * @returns Count of actually-synced items and any per-item errors.
 */
export async function syncIdeasState(
  ideaIds: string[]
): Promise<{ synced: number; errors: string[] }> {
  const { owner, repo } = getConfig();

  // Limit concurrency to 10 to avoid hitting GitHub API rate limits (5000 req/hr).
  // With 100+ ideas and ~2 API calls per idea (GET + PUT), unlimited concurrency
  // could exhaust the rate limit. Each id maps to a distinct file, so no cross-item
  // races within the batch.
  const limit = pLimit(10);

  const results = await Promise.allSettled(
    ideaIds.map((id) =>
      limit(async (): Promise<{ id: string; synced: boolean; error?: string }> => {
        const filePath = `Inspirations/${id}.md`;
        try {
          await withConflictRetry(async () => {
            const data = await githubFetch<{
              sha: string;
              content: string;
              encoding: string;
            }>(`/repos/${owner}/${repo}/contents/${filePath}`);

            if (data.encoding !== "base64") {
              throw new Error(`unexpected encoding ${data.encoding}`);
            }
            const raw = decodeBase64(data.content);

            // Idempotency check + write go through the date-safe frontmatter
            // helpers, so body text containing "status:" can't trigger a false
            // skip or be mutated.
            if (parseFrontmatter(raw).status === "completed") {
              return; // already completed (idempotent) — counts as synced
            }
            const updated = setFrontmatterField(raw, "status", "completed");
            const encoded = encodeBase64(updated);

            await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
              method: "PUT",
              body: JSON.stringify({
                message: `Auto-sync: mark inspiration as completed`,
                content: encoded,
                sha: data.sha,
              }),
              headers: { "Content-Type": "application/json" },
            });
          });

          console.log(`[syncIdeasState] Archived: ${id}`);
          return { id, synced: true };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          // 404 = file doesn't exist (maybe already deleted) — not an error
          if (msg.includes("404")) {
            console.log(`[syncIdeasState] ${id} not found (already gone)`);
            return { id, synced: false };
          }
          return { id, synced: false, error: msg };
        }
      })
    )
  );

  // Tally: synced counts successes (incl. idempotent no-ops); 404 skips are
  // neither synced nor errors; anything else goes to errors.
  let synced = 0;
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      const v = r.value;
      if (v.synced) synced++;
      else if (v.error) errors.push(`${v.id}: ${v.error}`);
      // else: 404 skip — neither synced nor an error
    } else {
      // Defensive — the inner async catches everything, so this only fires if
      // the closure itself rejected unexpectedly.
      const reason =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`unknown: ${reason}`);
    }
  }

  return { synced, errors };
}

// ── Patch append (追加记录) ─────────────────────────────

/**
 * Append a timestamped patch line to an inspiration file's ## 追加记录 section.
 * If the section doesn't exist, creates it at the end of the file.
 * Fetches the current SHA internally — the caller doesn't need to provide it.
 */
export async function appendInspirationPatch(
  filePath: string,
  patchContent: string
): Promise<{ sha: string; patch: InspirationPatch }> {
  const { owner, repo } = getConfig();

  // Fetch current content + sha (same pattern as archiveInspiration)
  const data = await githubFetch<{
    sha: string;
    content: string;
    encoding: string;
  }>(`/repos/${owner}/${repo}/contents/${filePath}`);

  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }
  const raw = decodeBase64(data.content);

  const timeStr = getBeijingDateTimeString().slice(0, 16); // "YYYY-MM-DD HH:mm"
  const patchLine = `- **${timeStr}** ${patchContent}`;
  const updated = appendInspirationPatchLine(raw, patchLine);
  const encoded = encodeBase64(updated);

  const result = await githubFetch<{ content: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Append inspiration patch`,
        content: encoded,
        sha: data.sha,
      }),
      headers: { "Content-Type": "application/json" },
    }
  );

  return {
    sha: result.content.sha,
    patch: { time: timeStr, content: patchContent },
  };
}

// ── Daily Journal ─────────────────────────────────────

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
    // Normalise CRLF/CR → LF up front. Every downstream consumer (parseTasks,
    // cascade, rollover, insertSubtaskLine, parseDailyNotes) splits on "\n" and
    // anchors regexes with "$", which would silently drop tasks/notes on CRLF
    // files (Obsidian on Windows writes CRLF). Doing it here also keeps
    // parseTasks' lineNumber aligned with the line indices cascade and
    // insertSubtaskLine use on the same content.
    const raw = decodeBase64(data.content).replace(/\r\n?/g, "\n");
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
      // Normalise to YYYY-MM-DD: frontmatter date may be ISO (2026-06-08T17:15:00)
      // or a plain date string. Take the first 10 chars when it looks like a date.
      date: normalizeDateString(String(frontmatter.date ?? date)),
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

  const encoded = encodeBase64(template);
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

const DIARY_TEMPLATE_PATH =
  process.env.DIARY_TEMPLATE_PATH || "Templates/Diary_Template.md";

/**
 * Load the daily-journal template (Templates/Diary_Template.md) with `date`
 * substituted into {{date}} / legacy {{DATE:YYYY-MM-DD}}. Returns the raw
 * template verbatim, INCLUDING the `%%TODO_PLACEHOLDER%%` rollover-injection
 * token - callers that aren't injecting rollover tasks (the web create paths)
 * must strip it via `stripStalePlaceholder`.
 *
 * Shared by rollover (injects tasks at the placeholder) and the web create
 * paths (POST /api/daily, modifyDailyJournal's create-if-missing) so every new
 * journal starts from one template source instead of diverging between the real
 * template and a hardcoded fallback. Falls back to a minimal template if the
 * file is missing.
 */
export async function loadDiaryTemplate(date: string): Promise<string> {
  try {
    const raw = await getFileContent(DIARY_TEMPLATE_PATH);
    return raw
      .replace(/\{\{DATE:YYYY-MM-DD\}\}/g, date)
      .replace(/\{\{date\}\}/g, date);
  } catch (err) {
    console.warn(
      `[loadDiaryTemplate] Template not found at ${DIARY_TEMPLATE_PATH}, using fallback:`,
      err instanceof Error ? err.message : err
    );
    return [
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
  }
}

/** Update a daily journal file with new content using the caller's exact SHA.
 *
 * This is a full-document replacement, so it must not swap in a newer SHA and
 * write caller-computed content against it. A 409 is intentionally surfaced to
 * the client, which can re-fetch the latest document and re-apply its mutation.
 */
export async function updateDailyJournal(
  filePath: string,
  sha: string,
  content: string
): Promise<{ sha: string }> {
  const { owner, repo } = getConfig();
  const encoded = encodeBase64(content);

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

/**
 * Ensure the daily journal for `date` exists, then apply `modify` to its
 * content and PUT the result. Retries on HTTP 409 (stale SHA — either a
 * concurrent write or GitHub read-replica lag right after a prior write) by
 * re-fetching fresh content + SHA and re-running `modify`.
 *
 * `modify` returns the new content, or `null` to abort (e.g. a duplicate-task
 * check). Returns `{ sha, content }` on success, or `null` if `modify`
 * aborted.
 *
 * Unlike calling getDailyJournal → updateDailyJournal directly, this wraps the
 * whole read-modify-write in withConflictRetry so a 409 doesn't surface to the
 * user just because the GET read a stale SHA.
 */
export async function modifyDailyJournal(
  date: string,
  modify: (content: string) => string | null
): Promise<{ path: string; sha: string; content: string } | null> {
  // Track retry attempts for exponential backoff
  let attempt = 0;

  return withConflictRetry(async () => {
    // Exponential backoff: wait longer on each retry to handle GitHub's eventual
    // consistency. The Contents API can return stale content immediately after a
    // write. Backoff: 0ms (first attempt), 500ms, 1000ms (on retries).
    if (attempt > 0) {
      const delay = Math.min(500 * attempt, 2000);
      await new Promise((r) => setTimeout(r, delay));
    }
    attempt++;

    let journal = await getDailyJournal(date);
    if (!journal.exists) {
      // Create from the shared diary template (placeholder stripped - there are
      // no rollover tasks to inject here) and use that template as the modify
      // base instead of discarding it. Skipping the re-GET avoids a stale
      // read-replica GET right after create (fresh-looking SHA paired with
      // stale content); we already know the content - the template we wrote.
      const template = stripStalePlaceholder(await loadDiaryTemplate(date));
      const created = await createDailyJournal(date, template);
      journal = {
        exists: true,
        path: created.path,
        sha: created.sha,
        content: template,
      };
    }
    const newContent = modify(journal.content || "");
    if (newContent === null) return null; // modifier aborted (e.g. duplicate)
    if (newContent === journal.content) {
      return {
        path: journal.path!,
        sha: journal.sha!,
        content: journal.content || "",
      };
    }
    const res = await updateDailyJournal(journal.path!, journal.sha!, newContent);
    return { path: journal.path!, sha: res.sha, content: newContent };
  });
}
