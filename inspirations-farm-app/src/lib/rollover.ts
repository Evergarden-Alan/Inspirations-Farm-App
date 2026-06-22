/**
 * Daily rollover: move uncompleted tasks from yesterday's journal to today's.
 * Uses Asia/Shanghai for all date calculations.
 *
 * Auto-cron mode (no targetDate):
 *   source = yesterday, target = today (real Beijing time)
 *
 * Time-machine mode (targetDate=YYYY-MM-DD):
 *   source = targetDate, target = source + 1 day
 *
 * Optional flags via `executeRollover(options)`:
 *   - targetDate  — explicitly set the source date for historical remediation
 *   - dryRun      — build all content but skip GitHub writes; return previews
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
  insertIntoDailySection,
  parseTasks,
} from "./github";
import type { DailyTask } from "./github";

export interface RolloverResult {
  ok: boolean;
  status: "no_source" | "all_done" | "ok" | "dry-run" | "error";
  moved?: number;
  error?: string;
  /** The source date — the day whose undone tasks we're rolling forward (YYYY-MM-DD, Beijing) */
  sourceDate: string;
  /** The target date — the day receiving the rolled-over tasks (YYYY-MM-DD, Beijing) */
  targetDate: string;
  /** dryRun only — source file content with [>] migration markers */
  sourcePreview?: string;
  /** dryRun only — target file content with appended tasks */
  targetPreview?: string;
  /** dryRun only — text of each extracted undone task */
  extractedTasks?: string[];
}

export interface RolloverOptions {
  /**
   * Time-machine mode: explicitly pick the source date (the day whose
   * undone tasks to roll forward). The target will be source + 1 day.
   * Format: YYYY-MM-DD (Beijing time).
   * Falls back to auto mode (source = yesterday, target = today) when omitted.
   */
  targetDate?: string;
  /** If true, skip all GitHub writes and return content previews. */
  dryRun?: boolean;
}

const ROLLOVER_LOG_PREFIX = "[rollover]" as const;

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
    //   Auto-cron mode (no targetDate):  source = yesterday,  target = today
    //   Time-machine mode (targetDate):  source = targetDate, target = source + 1
    const realToday = getBeijingDateString();
    const source = options?.targetDate || getYesterdayForBeijingDate(realToday);
    const target = getTomorrowForBeijingDate(source);
    log(
      `[INFO] 正在读取的源文件日期: ${source}, 正在写入的目标文件日期: ${target}` +
        (options?.targetDate
          ? ` (time-machine mode, targetDate override)`
          : ` (auto-cron mode, real Beijing today=${realToday})`)
    );

    // ── 1) Fetch source journal ──────────────────────────
    log(`Step 1: Fetching source journal (${source})...`);
    const sourceJournal = await getDailyJournal(source);
    if (!sourceJournal.exists) {
      log(`Source journal (${source}) does not exist → no_source, done.`);
      return {
        ok: true,
        status: "no_source",
        sourceDate: source,
        targetDate: target,
      };
    }
    log(
      `Source journal found: path=${sourceJournal.path} sha=${sourceJournal.sha}`
    );

    // ── 2) Parse and filter undone tasks ──────────────────
    log(`Step 2: Parsing tasks...`);
    const tasks = parseTasks(sourceJournal.content!);
    const undone = tasks.filter((t: DailyTask) => !t.done);
    log(
      `Found ${tasks.length} total tasks, ${undone.length} undone (${tasks.length - undone.length} done)`
    );

    if (undone.length === 0) {
      log(`No undone tasks → all_done, nothing to migrate.`);
      return {
        ok: true,
        status: "all_done",
        sourceDate: source,
        targetDate: target,
      };
    }

    // ── 3) Mark undone tasks as migrated in source content ─
    log(
      `Step 3: Marking ${undone.length} undone tasks as migrated ([ ] → [>])...`
    );
    let updatedSource = sourceJournal.content!;
    for (const task of undone) {
      const oldLine = `${task.indent}- [ ] ${task.text}`;
      const newLine = `${task.indent}- [>] ${task.text}`;
      if (updatedSource.includes(oldLine)) {
        updatedSource = updatedSource.replace(oldLine, newLine);
      } else {
        logErr(
          `WARNING: Could not find task line in content: "${oldLine.slice(0, 80)}..."`
        );
      }
    }

    // ── 4) Build task lines for target ────────────────────
    const taskLines = undone.map(
      (t: DailyTask) => `${t.indent}- [ ] ${t.text}`
    );
    log(`Step 4: Built ${taskLines.length} task lines for target (${target})`);

    // ── 5) Commit source changes (or dry-run log) ─────────
    let sourceSha = sourceJournal.sha!;
    if (dryRun) {
      log("━━━ DRY RUN: would update source ━━━");
      console.log(
        `\n[DRY RUN] 准备覆盖的源日记 (${source}):\n${"-".repeat(60)}\n${updatedSource}\n${"-".repeat(60)}\n`
      );
    } else {
      log(`Step 5: Committing source changes (marking tasks as migrated)...`);
      const sourceResult = await updateDailyJournal(
        sourceJournal.path!,
        sourceSha,
        updatedSource
      );
      sourceSha = sourceResult.sha;
      log(`Source updated: new sha=${sourceSha}`);
    }

    // ── 6) Get or create target journal ───────────────────
    log(`Step 6: Preparing target journal (${target})...`);
    const targetJournal = await getDailyJournal(target);

    let targetContent: string;
    let targetPath: string;

    if (!targetJournal.exists) {
      log(`Target journal (${target}) does not exist — creating from template...`);

      // Try to read the template file
      let template: string;
      try {
        template = await getFileContent("Templates/Diary_Template.md");
        template = template.replace(/\{\{DATE:YYYY-MM-DD\}\}/g, target);
        log(
          `Loaded template from Templates/Diary_Template.md (${template.length} chars)`
        );
      } catch (templateErr) {
        logErr(
          `Template not found or unreadable, using fallback:`,
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

      // Insert undone tasks into the template
      targetContent = template;
      for (const line of taskLines) {
        targetContent = insertIntoDailySection(targetContent, line);
      }

      if (dryRun) {
        log("━━━ DRY RUN: would create target ━━━");
        console.log(
          `\n[DRY RUN] 准备创建的目标日记 (${target}):\n${"-".repeat(60)}\n${targetContent}\n${"-".repeat(60)}\n`
        );
      } else {
        // Single PUT with fully-prepared content (no double-commit)
        const created = await createDailyJournal(target, targetContent);
        targetPath = created.path;
        log(
          `Target journal created with ${undone.length} tasks: path=${targetPath}`
        );
      }

      const extractedTasks = undone.map((t: DailyTask) => t.text);
      return {
        ok: true,
        status: dryRun ? "dry-run" : "ok",
        moved: undone.length,
        sourceDate: source,
        targetDate: target,
        ...(dryRun && {
          sourcePreview: updatedSource,
          targetPreview: targetContent,
          extractedTasks,
        }),
      };
    }

    // Target exists — append tasks to it
    log(
      `Target journal already exists: path=${targetJournal.path} sha=${targetJournal.sha}`
    );
    targetContent = targetJournal.content!;
    targetPath = targetJournal.path!;
    const targetSha = targetJournal.sha!;

    // ── 7) Append undone tasks into target's # 当日日程 section
    log(
      `Step 7: Inserting ${taskLines.length} tasks into target journal (${target})...`
    );
    for (const line of taskLines) {
      targetContent = insertIntoDailySection(targetContent, line);
    }

    // ── 8) Commit target changes (or dry-run log) ─────────
    if (dryRun) {
      log("━━━ DRY RUN: would update target ━━━");
      console.log(
        `\n[DRY RUN] 准备更新的目标日记 (${target}):\n${"-".repeat(60)}\n${targetContent}\n${"-".repeat(60)}\n`
      );
    } else {
      log(`Step 8: Committing target journal update...`);
      const targetResult = await updateDailyJournal(
        targetPath,
        targetSha,
        targetContent
      );
      log(`Target updated: new sha=${targetResult.sha}`);
    }

    const extractedTasks = undone.map((t: DailyTask) => t.text);
    log(
      `Rollover complete: moved=${undone.length} tasks from ${source} to ${target}` +
        (dryRun ? " (DRY RUN)" : "")
    );

    return {
      ok: true,
      status: dryRun ? "dry-run" : "ok",
      moved: undone.length,
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
