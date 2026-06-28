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
  getFileContent,
  createDailyJournal,
  updateDailyJournal,
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
const TEMPLATE_PATH =
  process.env.DIARY_TEMPLATE_PATH || "Templates/Diary_Template.md";

// ── Tree Types ────────────────────────────────────────────

interface TaskNode {
  indent: string;
  status: "x" | " " | ">";
  text: string;
  raw: string; // original full line
  children: TaskNode[];
}

// Matches lines like "  - [x] Buy groceries" or "    - [>] Old task"
const TASK_LINE_RE = /^(\s*)-\s*\[([ xX>])\]\s+(.*)$/;
const SECTION_HEADING_RE = /^#\s+当日日程\s*$/;

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

  // Find section end — next "---" or "# " after headingIdx
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || /^#\s/.test(t)) {
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

  // Normalise mixed tab+space indentation: each tab → 2 spaces
  const depth = (indent: string) => indent.replace(/\t/g, "  ").length;

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
    const currentDepth = depth(indent);
    while (stack.length > 0 && depth(stack[stack.length - 1].indent) >= currentDepth) {
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
    // Entire subtree is done — keep everything in yesterday as-is
    return { y: flattenTree(node), t: [], count: 0 };
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
      // Done child → keep entirely in yesterday
      y.push(...flattenTree(child));
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
  return `${node.indent}- [${status}] ${text}`;
}

/** Flatten a tree into lines in pre-order (parent, then children). */
function flattenTree(node: TaskNode): string[] {
  const lines = [node.raw];
  for (const child of node.children) {
    lines.push(...flattenTree(child));
  }
  return lines;
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

/**
 * Insert task lines into the # 当日日程 section of the target content.
 * Appends lines at the end of the section (before trailing blanks / next section).
 */
function insertIntoSection(content: string, lines: string[]): string {
  const allLines = content.split("\n");

  // Find section heading
  let sectionStart = -1;
  for (let i = 0; i < allLines.length; i++) {
    if (SECTION_HEADING_RE.test(allLines[i])) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    // No section heading — append to end
    return content.trimEnd() + "\n" + lines.join("\n") + "\n";
  }

  // Find section end — next "---" or "# " after sectionStart
  let sectionEnd = allLines.length;
  for (let i = sectionStart + 1; i < allLines.length; i++) {
    const t = allLines[i].trim();
    if (t === "---" || /^#\s/.test(t)) {
      sectionEnd = i;
      break;
    }
  }

  // Back up past trailing blank lines
  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && allLines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  allLines.splice(insertAt, 0, ...lines);
  return allLines.join("\n");
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
    const { yesterdayLines, tomorrowLines, undoneCount } = splitTree(roots);
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

    // ── 5) Commit source changes ─────────────────────────
    let sourceSha = sourceJournal.sha!;
    if (dryRun) {
      log("━━━ DRY RUN: would update source ━━━");
      console.log(
        `\n[DRY RUN] 源日记 (${source}) 更新后:\n${"-".repeat(60)}\n${updatedSource}\n${"-".repeat(60)}\n`
      );
    } else {
      log(`Step 5: Committing source changes...`);
      const sourceResult = await updateDailyJournal(
        sourceJournal.path!,
        sourceSha,
        updatedSource
      );
      sourceSha = sourceResult.sha;
      log(`Source updated: new sha=${sourceSha}`);
    }

    // ── 6) Get or create target journal ──────────────────
    log(`Step 6: Preparing target journal (${target})...`);
    const targetJournal = await getDailyJournal(target);

    let targetContent: string;
    let targetPath: string;

    if (!targetJournal.exists) {
      log(`Target journal (${target}) does not exist — creating from template...`);

      let template: string;
      try {
        template = await getFileContent(TEMPLATE_PATH);
        // Support both Obsidian-style {{date}} and legacy {{DATE:YYYY-MM-DD}}
        template = template
          .replace(/\{\{DATE:YYYY-MM-DD\}\}/g, target)
          .replace(/\{\{date\}\}/g, target);
        log(
          `Loaded template from ${TEMPLATE_PATH} (${template.length} chars)` +
            (dryRun ? " [DRY RUN]" : "")
        );
      } catch (templateErr) {
        console.warn(
          ROLLOVER_LOG_PREFIX,
          `Template not found at ${TEMPLATE_PATH}, using fallback:`,
          templateErr instanceof Error ? templateErr.message : templateErr
        );
        template = [
          "---",
          "tags:",
          "  - diary",
          `date: ${target}`,
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

      // Inject tomorrowLines into the template
      const TODO_PLACEHOLDER = "%%TODO_PLACEHOLDER%%";
      if (template.includes(TODO_PLACEHOLDER)) {
        targetContent = template.replace(
          TODO_PLACEHOLDER,
          tomorrowLines.join("\n")
        );
        log(
          `Injected ${tomorrowLines.length} task lines at %%TODO_PLACEHOLDER%%` +
            (dryRun ? " [DRY RUN]" : "")
        );
      } else {
        // Fallback: insert into # 当日日程 section
        targetContent = insertIntoSection(template, tomorrowLines);
        log(
          `%%TODO_PLACEHOLDER%% not found — inserted after ## 当日日程` +
            (dryRun ? " [DRY RUN]" : "")
        );
      }

      if (dryRun) {
        log("━━━ DRY RUN: would create target ━━━");
        console.log(
          `\n[DRY RUN] 目标日记 (${target}) 内容:\n${"-".repeat(60)}\n${targetContent}\n${"-".repeat(60)}\n`
        );
      } else {
        const created = await createDailyJournal(target, targetContent);
        targetPath = created.path;
        log(`Target journal created: path=${targetPath}`);
      }

      // Extract task texts for dryRun preview
      const extractedTasks = collectTaskTexts(roots);
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
    }

    // Target exists — append tomorrowLines to its # 当日日程 section
    log(`Target journal exists: path=${targetJournal.path} sha=${targetJournal.sha}`);
    targetContent = insertIntoSection(targetJournal.content!, tomorrowLines);
    targetPath = targetJournal.path!;
    const targetSha = targetJournal.sha!;

    // ── 7) Commit target changes ─────────────────────────
    if (dryRun) {
      log("━━━ DRY RUN: would update target ━━━");
      console.log(
        `\n[DRY RUN] 目标日记 (${target}) 更新后:\n${"-".repeat(60)}\n${targetContent}\n${"-".repeat(60)}\n`
      );
    } else {
      log(`Step 7: Committing target journal update...`);
      const targetResult = await updateDailyJournal(
        targetPath,
        targetSha,
        targetContent
      );
      log(`Target updated: new sha=${targetResult.sha}`);
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
