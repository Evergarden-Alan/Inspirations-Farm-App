/**
 * Daily rollover: move uncompleted tasks from yesterday's journal to today's.
 *
 * Uses a tree-based approach: parses the # 当日日程 section into a parent-child
 * tree, then splits each subtree into yesterday (done portions) and tomorrow
 * (undone portions), preserving nesting relationships.
 */

import {
  getBeijingDateString,
  getTomorrowForBeijingDate,
  getYesterdayForBeijingDate,
} from "./beijing-time";
import {
  getDailyJournal,
  createDailyJournal,
  updateDailyJournal,
  loadDiaryTemplate,
  stripStalePlaceholder,
} from "./github";

export interface RolloverResult {
  ok: boolean;
  status: "no_source" | "all_done" | "ok" | "dry-run" | "error";
  moved?: number;
  error?: string;
  sourceDate: string;
  targetDate: string;
  sourcePreview?: string;
  targetPreview?: string;
  extractedTasks?: string[];
}

export interface RolloverOptions {
  targetDate?: string;
  dryRun?: boolean;
}

const ROLLOVER_LOG_PREFIX = "[rollover]" as const;

// ── Tree Types ────────────────────────────────────────────

interface TaskNode {
  indent: string;
  status: "x" | " " | ">";
  text: string;
  raw: string; // original full line
  children: TaskNode[];
}

// Matches lines like "  - [x] Buy groceries" or "    - [>] Old task".
// Bullet accepts -, *, or + (all valid Markdown task-list markers).
const TASK_LINE_RE = /^(\s*)[-+*]\s*\[([ xX>])\]\s+(.*)$/;
const SECTION_HEADING_RE = /^#+\s+当日日程\s*$/;

/** Normalize mixed tab/space indentation to a depth number (1 tab = 2 spaces). */
function indentDepth(indent: string): number {
  return indent.replace(/\t/g, "  ").length;
}

// ── Section Extraction ────────────────────────────────────

/** Extract lines belonging to the # 当日日程 section (between heading and next --- or # ). */
function extractSectionLines(content: string): {
  before: string[];
  sectionLines: string[];
  after: string[];
  headingIdx: number;
} {
  const lines = content.split("\n");

  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    return { before: lines, sectionLines: [], after: [], headingIdx: -1 };
  }

  // Find section end — next "---" or any heading ("# ...") after headingIdx
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || /^#+\s/.test(t)) {
      sectionEnd = i;
      break;
    }
  }

  const before = lines.slice(0, headingIdx + 1); // includes the heading
  const sectionLines = lines.slice(headingIdx + 1, sectionEnd);
  const after = lines.slice(sectionEnd);

  return { before, sectionLines, after, headingIdx };
}

// ── Tree Construction ─────────────────────────────────────

/**
 * Parse task lines into a tree. Uses a stack to handle arbitrary nesting.
 * Lines that are not task checkboxes (blank lines, non-list text) are skipped.
 */
function parseTaskTree(lines: string[]): TaskNode[] {
  const roots: TaskNode[] = [];
  const stack: TaskNode[] = [];

  for (const line of lines) {
    const match = line.match(TASK_LINE_RE);
    if (!match) continue;

    const indent = match[1];
    const rawStatus = match[2].toLowerCase();
    const status: TaskNode["status"] =
      rawStatus === "x" ? "x" : rawStatus === ">" ? ">" : " ";
    const text = match[3];
    const raw = line;

    const node: TaskNode = { indent, status, text, raw, children: [] };

    // Pop stack until we find a node with less indent → that's our parent
    const currentDepth = indentDepth(indent);
    while (stack.length > 0 && indentDepth(stack[stack.length - 1].indent) >= currentDepth) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    stack.push(node);
  }

  return roots;
}

// ── Tree Predicates ───────────────────────────────────────

/** A tree is fully done when this node and every descendant is [x]. */
function isFullyDone(node: TaskNode): boolean {
  if (node.status !== "x") return false;
  return node.children.every(isFullyDone);
}

// ── Split Logic ───────────────────────────────────────────

/**
 * Split a task tree into yesterdayLines (stay in source) and tomorrowLines
 * (migrate to target). Applies recursively so nested subtrees are handled.
 */
function splitTree(roots: TaskNode[]): {
  yesterdayLines: string[];
  tomorrowLines: string[];
  undoneCount: number;
} {
  const yesterdayLines: string[] = [];
  const tomorrowLines: string[] = [];
  let undoneCount = 0;

  for (const root of roots) {
    const { y, t, count } = splitNode(root);
    yesterdayLines.push(...y);
    tomorrowLines.push(...t);
    undoneCount += count;
  }

  return { yesterdayLines, tomorrowLines, undoneCount };
}

function splitNode(node: TaskNode): {
  y: string[];
  t: string[];
  count: number;
} {
  if (isFullyDone(node)) {
    // Entire subtree is done — keep everything in yesterday, but strip any stale
    // 🔄 markers: a fully-done task should never carry the "延期" badge.
    return { y: flattenTree(node).map(stripRolloverMarker), t: [], count: 0 };
  }

  // Partially complete — must split
  const y: string[] = [];
  const t: string[] = [];
  let undoneCount = 0;

  // Yesterday: parent as [>], keep [x] children (with their done subtrees)
  y.push(rebuildLine(node, ">"));

  // Tomorrow: parent as [ ], keep [ ] children (with their undone subtrees)
  t.push(rebuildLine(node, " "));

  // The node itself counts as undone (it's migrating to tomorrow)
  undoneCount++;

  for (const child of node.children) {
    if (isFullyDone(child)) {
      // Done child → keep entirely in yesterday, strip stale 🔄
      y.push(...flattenTree(child).map(stripRolloverMarker));
    } else if (child.status === "x") {
      // Child itself is [x] but has undone descendants → split recursively
      // (this handles the case where a checked parent has unchecked grandchildren)
      const sub = splitNode(child);
      y.push(...sub.y);
      t.push(...sub.t);
      undoneCount += sub.count;
    } else {
      // Child is [ ] or [>] → split its subtree
      const sub = splitNode(child);
      y.push(...sub.y);
      t.push(...sub.t);
      undoneCount += sub.count;
    }
  }

  return { y, t, count: undoneCount };
}

/** Rebuild a task line with a different checkbox status. */
function rebuildLine(node: TaskNode, status: "x" | " " | ">"): string {
  let text = node.text;
  // Tag rolled-over tasks so the frontend can highlight them.
  // Only tag undone tasks bound for tomorrow; avoid double-stacking.
  if (status === " " && !text.includes("🔄")) {
    text = text + " 🔄";
  }
  // Preserve the original bullet (-, *, or +) from the source line.
  const bullet = node.raw.match(/^\s*([-+*])\s*\[/)?.[1] ?? "-";
  return `${node.indent}${bullet} [${status}] ${text}`;
}

/** Flatten a tree into lines in pre-order (parent, then children). */
function flattenTree(node: TaskNode): string[] {
  const lines = [node.raw];
  for (const child of node.children) {
    lines.push(...flattenTree(child));
  }
  return lines;
}

/** Re-emit task lines with indentation normalized to one tab per tree-depth
 *  (top-level = 0 tabs). Unifies rollover output with the web app's tab
 *  convention regardless of the source file's tab/space mix, so rolled-over
 *  tasks and web-created tasks share one indent style. Also collapses any
 *  non-zero "top-level" indent to 0, preventing a migrated task from nesting
 *  under an unrelated sibling. Bullet, checkbox state, text, and the 🔄
 *  rollover marker are preserved; only leading whitespace is rewritten.
 *
 *  `lines` is expected to contain only task checkbox lines (as produced by
 *  splitTree); parseTaskTree drops any non-task lines. */
function normalizeTaskLines(lines: string[]): string[] {
  const roots = parseTaskTree(lines);
  const out: string[] = [];
  const walk = (nodes: TaskNode[], depth: number) => {
    for (const n of nodes) {
      // Keep everything from the bullet onward; replace leading whitespace
      // with `depth` tabs.
      const rest = n.raw.replace(/^\s*([-+*]\s*\[[ xX>]\].*)$/, "$1");
      out.push(`${"\t".repeat(depth)}${rest}`);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

// ── Content Reconstruction ────────────────────────────────

/**
 * Replace the # 当日日程 section content with the given lines.
 * Preserves the heading line and the rest of the file.
 */
function replaceSectionContent(
  content: string,
  newSectionLines: string[]
): string {
  const { before, after } = extractSectionLines(content);
  // Ensure exactly one blank line between heading and content, and before the next section
  const trimmed = newSectionLines.join("\n").trimEnd();
  const body = trimmed ? `\n${trimmed}\n` : "\n";
  return before.join("\n") + body + after.join("\n");
}


// ── Section Merge (target-exists path) ───────────────────

/**
 * Subject-name aliases for rollover merge matching. The diary template lists
 * daily subjects in Chinese (数学, 计网, ...) while rolled-over tasks often
 * carry the user's English shorthand (Math, CN, ...). Mapping both to one
 * canonical key lets a migrated "Math 🔄" merge under a template "数学" instead
 * of duplicating. Lookup is case-insensitive on the full task text (after
 * stripping 🔄); only exact subject-name hits canonicalize, so subtask text
 * like "4.3 第二换元积分法" is left untouched. Extend as new subjects appear.
 */
const SUBJECT_ALIASES: Record<string, string> = {
  math: "math", 数学: "math",
  cn: "cn", 计网: "cn", 计算机网络: "cn", 网络: "cn",
  co: "co", 计组: "co", 计算机组成: "co", 计算机组成原理: "co",
  os: "os", 操作系统: "os",
  english: "english", 英语: "english",
};

/**
 * Normalize task text for merge matching: strip the 🔄 rollover marker, trim,
 * and canonicalize known subject aliases (数学<->Math, 计网<->CN, ...) so the
 * same subject authored in either language matches as one block. */
function normalizeTaskText(text: string): string {
  const stripped = text.replace(/🔄/g, "").trim();
  return SUBJECT_ALIASES[stripped.toLowerCase()] ?? stripped;
}

/** Strip any 🔄 rollover marker (and surrounding whitespace) from a task line.
 *  Used on fully-done lines that still carry a stale 🔄 from a prior rollover — a
 *  completed task should never display the "延期" badge. */
function stripRolloverMarker(line: string): string {
  return line.replace(/\s*🔄\s*/g, " ").replace(/\s+$/, "");
}

/** Find the start index of the top-level task block whose last task line is
 *  `blockEnd`. Walks backward until a task line at `topDepth` is found. */
function findBlockStart(
  allLines: string[],
  blockEnd: number,
  topDepth: number
): number {
  for (let i = blockEnd; i >= 0; i--) {
    const m = allLines[i].match(TASK_LINE_RE);
    if (m && indentDepth(m[1]) === topDepth) return i;
  }
  return blockEnd;
}

/**
 * Merge incoming task lines into the target's # 当日日程 section.
 *
 * When the target already has a top-level task whose normalized text matches an
 * incoming top-level task, the incoming task's descendants are appended under
 * the existing top-level task instead of creating a duplicate root (e.g. a
 * rolled-over "数学 🔄" merges under an existing "数学"). Incoming top-level
 * tasks with no match — or leaf roots that would self-nest under a same-named
 * top-level task — are appended at the end of the section as new roots.
 *
 * Indentation of incoming lines is preserved as-is (consistent with the prior
 * append-only behavior); source and target are expected to share an indent
 * convention.
 */
function mergeIntoSection(content: string, incoming: string[]): string {
  const allLines = content.split("\n");
  // Locate # 当日日程 section heading
  let sectionStart = -1;
  for (let i = 0; i < allLines.length; i++) {
    if (SECTION_HEADING_RE.test(allLines[i])) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) {
    // No section heading — append to end (mergeIntoSection fallback for a section-less journal)
    return content.trimEnd() + "\n" + incoming.join("\n") + "\n";
  }

  // Find section end — next "---" or any heading ("# ...") after sectionStart
  let sectionEnd = allLines.length;
  for (let i = sectionStart + 1; i < allLines.length; i++) {
    const t = allLines[i].trim();
    if (t === "---" || /^#+\s/.test(t)) {
      sectionEnd = i;
      break;
    }
  }

  // Top-level indent = minimal indent among task lines in the section
  let topDepth = Infinity;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const m = allLines[i].match(TASK_LINE_RE);
    if (!m) continue;
    const d = indentDepth(m[1]);
    if (d < topDepth) topDepth = d;
  }

  // Map: normalized header text → last task line index of that top-level block.
  // Prefer the non-🔄 original block over a pre-existing 🔄 rollover block:
  // both normalize to the same key, so only set the 🔄 block when no original
  // exists yet. This keeps merges landing under the genuine original task
  // even after a prior (already-rolled-over) version of the same task is present.
  const blockEndByHeader = new Map<string, number>();
  const blockHasMarker = new Map<string, boolean>();
  if (topDepth !== Infinity) {
    for (let i = sectionStart + 1; i < sectionEnd; i++) {
      const m = allLines[i].match(TASK_LINE_RE);
      if (!m || indentDepth(m[1]) !== topDepth) continue; // not a top-level task
      // Walk forward to find the last task line belonging to this block
      let blockEnd = i;
      for (let j = i + 1; j < sectionEnd; j++) {
        const mj = allLines[j].match(TASK_LINE_RE);
        if (!mj) continue; // skip non-task lines (placeholders, blanks)
        if (indentDepth(mj[1]) <= topDepth) break; // next top-level task
        blockEnd = j;
      }
      const key = normalizeTaskText(m[3]);
      const isMarker = m[3].includes("🔄");
      const prevMarker = blockHasMarker.get(key) ?? false;
      // Set if: no entry yet, OR current block is non-🔄 but stored one is a 🔄 block.
      if (!blockEndByHeader.has(key) || (!isMarker && prevMarker)) {
        blockEndByHeader.set(key, blockEnd);
        blockHasMarker.set(key, isMarker);
      }
    }
  }

  // Parse incoming into top-level groups (roots)
  const roots = parseTaskTree(incoming);

  // Build insert operations + tail-append list
  const ops: { at: number; lines: string[] }[] = [];
  const append: string[] = [];

  for (const root of roots) {
    const key = normalizeTaskText(root.text);
    let descendants: string[] = [];
    for (const child of root.children) {
      descendants.push(...flattenTree(child));
    }

    if (blockEndByHeader.has(key) && descendants.length > 0) {
      // Merge descendants under the existing same-named top-level task.
      // Dedup against subtasks already present in that block (normalized, 🔄
      // stripped) so re-running rollover on a still-`[>]` source doesn't
      // duplicate previously-migrated lines.
      const blockEnd = blockEndByHeader.get(key)!;
      const blockStart = findBlockStart(allLines, blockEnd, topDepth);
      const existing = new Set<string>();
      for (let i = blockStart; i <= blockEnd; i++) {
        const m = allLines[i].match(TASK_LINE_RE);
        if (m) existing.add(normalizeTaskText(m[3]));
      }
      descendants = descendants.filter((line) => {
        const m = line.match(TASK_LINE_RE);
        return !m || !existing.has(normalizeTaskText(m[3]));
      });

      if (descendants.length > 0) {
        ops.push({ at: blockEnd + 1, lines: descendants });
      }
    } else if (blockEndByHeader.has(key)) {
      // Leaf root (no descendants) whose header already exists in the target.
      // Skip it: the existing header already represents this subject. Merging a
      // leaf would wrongly nest it as a child, and appending would duplicate
      // the header - so a rolled-over bare subject like "408" is absorbed into
      // the target's existing "408" rather than echoed as a "408 🔄" dupe.
    } else {
      // No match - append whole tree as a new root
      append.push(...flattenTree(root));
    }
  }

  // Tail-append point: end of section, backing up over blank lines
  let appendAt = sectionEnd;
  while (appendAt > sectionStart + 1 && allLines[appendAt - 1].trim() === "") {
    appendAt--;
  }
  if (append.length > 0) {
    ops.push({ at: appendAt, lines: append });
  }

  // Apply ops in descending order of `at` to keep earlier indices stable
  ops.sort((a, b) => b.at - a.at);
  for (const op of ops) {
    allLines.splice(op.at, 0, ...op.lines);
  }

  return allLines.join("\n");
}

// ── Target Write (create-or-merge, race-safe) ────────────

/** Did `createDailyJournal` fail because the file already exists? The Contents
 *  API returns 422 ("sha wasn't supplied") for a PUT on an existing path - this
 *  is how we detect a create race (another writer created the target between our
 *  GET and PUT). */
function isCreateRaceError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("GitHub API error 422");
}

/**
 * Ensure the target journal exists with `tomorrowLines` merged in, and write it.
 * Returns the final target content (for dry-run preview / logging).
 *
 * Written BEFORE the source in executeRollover, so a failure here loses no
 * data: yesterday stays untouched (tasks still [ ]) and the run can be retried.
 * (The previous order committed the source first, so a target-write failure
 * stranded the migrated tasks - gone from yesterday, never in today.)
 *
 * Race handling: if the target is created by a concurrent writer between our
 * GET (404) and PUT, `createDailyJournal` fails with HTTP 422. Rather than
 * erroring out - which once the source is committed would lose the migrated
 * tasks - we re-fetch and merge. `mergeIntoSection` dedups by normalized task
 * text, so merging onto a (possibly partial) existing target is safe.
 *
 * `dryRun` computes and returns the content with no GitHub writes.
 */
async function writeTargetJournal(
  target: string,
  tomorrowLines: string[],
  dryRun: boolean
): Promise<string> {
  const journal = await getDailyJournal(target);

  if (!journal.exists) {
    console.log(
      ROLLOVER_LOG_PREFIX,
      `Target (${target}) absent - creating from template${dryRun ? " [DRY RUN]" : ""}`
    );
    // Shared template loader (also used by the web create paths), so a
    // rollover-created journal and a web-created journal share one template.
    const template = await loadDiaryTemplate(target);

    // Merge migrated tasks into the template's # 当日日程 via the SAME
    // mergeIntoSection path used when the target already exists. This dedups a
    // rolled-over task against the template's default starter tasks - e.g. a
    // migrated "408 🔄" nests its subtasks under the template's "408" instead
    // of duplicating it, and "Math 🔄" merges under "数学" via the subject
    // aliases. (The old code did template.replace(%%TODO_PLACEHOLDER%%, ...),
    // which left the defaults in place and duplicated same-named subjects.) The
    // %%TODO_PLACEHOLDER%% token is stale here and stripped first.
    let content = stripStalePlaceholder(template);
    content = mergeIntoSection(content, tomorrowLines);
    console.log(
      ROLLOVER_LOG_PREFIX,
      `Merged ${tomorrowLines.length} migrated lines into fresh template${dryRun ? " [DRY RUN]" : ""}`
    );

    if (dryRun) return content;

    try {
      await createDailyJournal(target, content);
      return content;
    } catch (err: unknown) {
      // Create race: target appeared between our GET and PUT (HTTP 422). Fall
      // back to fetching + merging instead of failing.
      if (!isCreateRaceError(err)) throw err;
      console.warn(
        ROLLOVER_LOG_PREFIX,
        `Create raced (422) - re-fetching & merging into existing ${target}`
      );
      const refetched = await getDailyJournal(target);
      if (!refetched.exists) throw err; // vanished again - surface original error
      const merged = stripStalePlaceholder(
        mergeIntoSection(refetched.content!, tomorrowLines)
      );
      await updateDailyJournal(refetched.path!, refetched.sha!, merged);
      return merged;
    }
  }

  // Target exists - merge tomorrowLines into its # 当日日程 section.
  console.log(
    ROLLOVER_LOG_PREFIX,
    `Target (${target}) exists (sha=${journal.sha}) - merging${dryRun ? " [DRY RUN]" : ""}`
  );
  const content = stripStalePlaceholder(
    mergeIntoSection(journal.content!, tomorrowLines)
  );
  if (dryRun) return content;
  await updateDailyJournal(journal.path!, journal.sha!, content);
  return content;
}

// ── Main Rollover ─────────────────────────────────────────

export async function executeRollover(
  options?: RolloverOptions
): Promise<RolloverResult> {
  const log = (...args: unknown[]) => console.log(ROLLOVER_LOG_PREFIX, ...args);
  const logErr = (...args: unknown[]) =>
    console.error(ROLLOVER_LOG_PREFIX, ...args);

  const dryRun = options?.dryRun === true;
  if (dryRun) {
    log("━━━ DRY RUN MODE — no GitHub writes ━━━");
  }

  try {
    // ── Determine source and target dates ─────────────────
    const realToday = getBeijingDateString();
    const source = options?.targetDate || getYesterdayForBeijingDate(realToday);
    const target = getTomorrowForBeijingDate(source);
    log(
      `[INFO] 源文件日期: ${source}, 目标文件日期: ${target}` +
        (options?.targetDate
          ? ` (time-machine mode)`
          : ` (auto-cron mode, real today=${realToday})`)
    );

    // ── 1) Fetch source journal ──────────────────────────
    log(`Step 1: Fetching source journal (${source})...`);
    const sourceJournal = await getDailyJournal(source);
    if (!sourceJournal.exists) {
      log(`Source journal (${source}) does not exist → no_source.`);
      return { ok: true, status: "no_source", sourceDate: source, targetDate: target };
    }
    log(`Source journal found: path=${sourceJournal.path} sha=${sourceJournal.sha}`);

    // ── 2) Extract # 当日日程 section & build tree ────────
    log(`Step 2: Extracting section & building task tree...`);
    const { sectionLines } = extractSectionLines(sourceJournal.content!);
    const roots = parseTaskTree(sectionLines);

    if (roots.length === 0) {
      log(`No tasks found in # 当日日程 section → all_done.`);
      return { ok: true, status: "all_done", sourceDate: source, targetDate: target };
    }

    // ── 3) Split tree into yesterday / tomorrow ──────────
    log(`Step 3: Splitting task tree...`);
    const split = splitTree(roots);
    // Normalize only the lines migrating to tomorrow (the journal the user
    // actively works in) to the tab convention. The source (yesterday) keeps
    // its original indentation so historical journals aren't rewritten by
    // rollover; mixed indent there is left for the user to clean up in
    // Obsidian, or normalizes next time that task rolls over.
    const yesterdayLines = split.yesterdayLines;
    const tomorrowLines = normalizeTaskLines(split.tomorrowLines);
    const undoneCount = split.undoneCount;
    log(
      `Split complete: ${yesterdayLines.length} lines stay in source, ` +
        `${tomorrowLines.length} lines migrate to target (${undoneCount} undone trees)`
    );

    if (undoneCount === 0) {
      log(`All tasks fully done → all_done.`);
      return { ok: true, status: "all_done", sourceDate: source, targetDate: target };
    }

    // ── 4) Rebuild source content with yesterdayLines ────
    log(`Step 4: Rebuilding source content with migration markers...`);
    const updatedSource = replaceSectionContent(sourceJournal.content!, yesterdayLines);

    // ── 5) Write the TARGET first ─────────────────────────
    // Target-before-source is load-bearing: if the target write fails, yesterday
    // is still untouched and the rolled-over tasks are NOT lost (still [ ] in
    // yesterday). The source is only mutated (-> [>]) once the target safely
    // holds the migrated tasks, so a failed run can simply be retried. (The
    // previous order committed the source first, stranding tasks on failure.)
    log(`Step 5: Preparing & writing target journal (${target})...`);
    const targetContent = await writeTargetJournal(target, tomorrowLines, dryRun);

    if (dryRun) {
      log("━━━ DRY RUN: would write target, then commit source ━━━");
      console.log(
        `\n[DRY RUN] 目标日记 (${target}) 内容:\n${"-".repeat(60)}\n${targetContent}\n${"-".repeat(60)}\n`
      );
      console.log(
        `\n[DRY RUN] 源日记 (${source}) 更新后:\n${"-".repeat(60)}\n${updatedSource}\n${"-".repeat(60)}\n`
      );
    } else {
      // ── 6) Commit source changes (target already succeeded) ──
      log(`Step 6: Committing source changes...`);
      const sourceResult = await updateDailyJournal(
        sourceJournal.path!,
        sourceJournal.sha!,
        updatedSource
      );
      log(`Source updated: new sha=${sourceResult.sha}`);
    }

    const extractedTasks = collectTaskTexts(roots);
    log(
      `Rollover complete: ${undoneCount} undone trees moved from ${source} to ${target}` +
        (dryRun ? " (DRY RUN)" : "")
    );

    return {
      ok: true,
      status: dryRun ? "dry-run" : "ok",
      moved: undoneCount,
      sourceDate: source,
      targetDate: target,
      ...(dryRun && {
        sourcePreview: updatedSource,
        targetPreview: targetContent,
        extractedTasks,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(ROLLOVER_LOG_PREFIX, "FATAL ERROR:", message);
    if (err instanceof Error && err.stack) {
      console.error(ROLLOVER_LOG_PREFIX, err.stack);
    }
    const realToday = getBeijingDateString();
    const source = options?.targetDate || getYesterdayForBeijingDate(realToday);
    return {
      ok: false,
      status: "error",
      error: message,
      sourceDate: source,
      targetDate: getTomorrowForBeijingDate(source),
    };
  }
}

/** Collect display texts of all undone tasks in the tree (for dryRun preview). */
function collectTaskTexts(roots: TaskNode[]): string[] {
  const texts: string[] = [];
  function walk(node: TaskNode) {
    if (!isFullyDone(node)) {
      texts.push(node.text);
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  for (const root of roots) {
    walk(root);
  }
  return texts;
}
