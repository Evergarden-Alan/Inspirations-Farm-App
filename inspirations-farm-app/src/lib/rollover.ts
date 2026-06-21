/**
 * Daily rollover: move uncompleted tasks from today's journal to tomorrow's.
 * Uses Asia/Shanghai for all date calculations.
 *
 * Supports two optional modes via `executeRollover(options)`:
 *   - targetDate  — override "today" for historical remediation (YYYY-MM-DD)
 *   - dryRun      — build all content but skip GitHub writes; return previews
 */

import {
  getBeijingDateString,
  getTomorrowBeijingDate,
  getTomorrowForBeijingDate,
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
  status: "no_today" | "all_done" | "ok" | "dry-run" | "error";
  moved?: number;
  error?: string;
  /** The effective "today" date used for this run (YYYY-MM-DD, Beijing) */
  todayDate: string;
  /** The effective "tomorrow" date used for this run (YYYY-MM-DD, Beijing) */
  tomorrowDate: string;
  /** dryRun only — today's content with [>] migration markers */
  todayPreview?: string;
  /** dryRun only — tomorrow's content with appended tasks */
  tomorrowPreview?: string;
  /** dryRun only — text of each extracted undone task */
  extractedTasks?: string[];
}

export interface RolloverOptions {
  /** Override "today" as YYYY-MM-DD (Beijing time). Falls back to real now. */
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
    // ── Determine effective dates ────────────────────────
    const today = options?.targetDate || getBeijingDateString();
    const tomorrow = getTomorrowForBeijingDate(today);
    log(
      `Effective dates: today=${today} tomorrow=${tomorrow}` +
        (options?.targetDate
          ? ` (targetDate override)`
          : " (real Beijing time)")
    );

    // ── 1) Fetch today's journal ──────────────────────────
    log(`Step 1: Fetching today's journal (${today})...`);
    const todayJournal = await getDailyJournal(today);
    if (!todayJournal.exists) {
      log(`Today's journal does not exist → no_today, done.`);
      return {
        ok: true,
        status: "no_today",
        todayDate: today,
        tomorrowDate: tomorrow,
      };
    }
    log(
      `Today's journal found: path=${todayJournal.path} sha=${todayJournal.sha}`
    );

    // ── 2) Parse and filter undone tasks ──────────────────
    log(`Step 2: Parsing tasks...`);
    const tasks = parseTasks(todayJournal.content!);
    const undone = tasks.filter((t: DailyTask) => !t.done);
    log(
      `Found ${tasks.length} total tasks, ${undone.length} undone (${tasks.length - undone.length} done)`
    );

    if (undone.length === 0) {
      log(`No undone tasks → all_done, nothing to migrate.`);
      return {
        ok: true,
        status: "all_done",
        todayDate: today,
        tomorrowDate: tomorrow,
      };
    }

    // ── 3) Mark undone tasks as migrated in today's content ─
    log(
      `Step 3: Marking ${undone.length} undone tasks as migrated ([ ] → [>])...`
    );
    let updatedToday = todayJournal.content!;
    for (const task of undone) {
      const oldLine = `${task.indent}- [ ] ${task.text}`;
      const newLine = `${task.indent}- [>] ${task.text}`;
      if (updatedToday.includes(oldLine)) {
        updatedToday = updatedToday.replace(oldLine, newLine);
      } else {
        logErr(
          `WARNING: Could not find task line in content: "${oldLine.slice(0, 80)}..."`
        );
      }
    }

    // ── 4) Build task lines for tomorrow ──────────────────
    const taskLines = undone.map(
      (t: DailyTask) => `${t.indent}- [ ] ${t.text}`
    );
    log(`Step 4: Built ${taskLines.length} task lines for tomorrow`);

    // ── 5) Commit today's changes (or dry-run log) ────────
    let todaySha = todayJournal.sha!;
    if (dryRun) {
      log("━━━ DRY RUN: would update today ━━━");
      console.log(
        `\n[DRY RUN] 准备覆盖的今日日记 (${today}):\n${"-".repeat(60)}\n${updatedToday}\n${"-".repeat(60)}\n`
      );
    } else {
      log(`Step 5: Committing today's changes (marking tasks as migrated)...`);
      const todayResult = await updateDailyJournal(
        todayJournal.path!,
        todaySha,
        updatedToday
      );
      todaySha = todayResult.sha;
      log(`Today updated: new sha=${todaySha}`);
    }

    // ── 6) Get or create tomorrow's journal ───────────────
    log(`Step 6: Preparing tomorrow's journal (${tomorrow})...`);
    const tomorrowJournal = await getDailyJournal(tomorrow);

    let tomorrowContent: string;
    let tomorrowPath: string;

    if (!tomorrowJournal.exists) {
      log(`Tomorrow's journal does not exist — creating from template...`);

      // Try to read the template file
      let template: string;
      try {
        template = await getFileContent("Templates/Diary_Template.md");
        template = template.replace(/\{\{DATE:YYYY-MM-DD\}\}/g, tomorrow);
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
          `date: ${tomorrow}`,
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
      tomorrowContent = template;
      for (const line of taskLines) {
        tomorrowContent = insertIntoDailySection(tomorrowContent, line);
      }

      if (dryRun) {
        log("━━━ DRY RUN: would create tomorrow ━━━");
        console.log(
          `\n[DRY RUN] 准备创建的明日日记 (${tomorrow}):\n${"-".repeat(60)}\n${tomorrowContent}\n${"-".repeat(60)}\n`
        );
      } else {
        // Single PUT with fully-prepared content (no double-commit)
        const created = await createDailyJournal(tomorrow, tomorrowContent);
        tomorrowPath = created.path;
        log(
          `Tomorrow's journal created with ${undone.length} tasks: path=${tomorrowPath}`
        );
      }

      const extractedTasks = undone.map((t: DailyTask) => t.text);
      return {
        ok: true,
        status: dryRun ? "dry-run" : "ok",
        moved: undone.length,
        todayDate: today,
        tomorrowDate: tomorrow,
        ...(dryRun && {
          todayPreview: updatedToday,
          tomorrowPreview: tomorrowContent,
          extractedTasks,
        }),
      };
    }

    // Tomorrow exists — append tasks to it
    log(
      `Tomorrow's journal already exists: path=${tomorrowJournal.path} sha=${tomorrowJournal.sha}`
    );
    tomorrowContent = tomorrowJournal.content!;
    tomorrowPath = tomorrowJournal.path!;
    const tomorrowSha = tomorrowJournal.sha!;

    // ── 7) Append undone tasks into tomorrow's # 当日日程 section
    log(
      `Step 7: Inserting ${taskLines.length} tasks into tomorrow's journal...`
    );
    for (const line of taskLines) {
      tomorrowContent = insertIntoDailySection(tomorrowContent, line);
    }

    // ── 8) Commit tomorrow's changes (or dry-run log) ─────
    if (dryRun) {
      log("━━━ DRY RUN: would update tomorrow ━━━");
      console.log(
        `\n[DRY RUN] 准备更新的明日日记 (${tomorrow}):\n${"-".repeat(60)}\n${tomorrowContent}\n${"-".repeat(60)}\n`
      );
    } else {
      log(`Step 8: Committing tomorrow's updated journal...`);
      const tmrwResult = await updateDailyJournal(
        tomorrowPath,
        tomorrowSha,
        tomorrowContent
      );
      log(`Tomorrow updated: new sha=${tmrwResult.sha}`);
    }

    const extractedTasks = undone.map((t: DailyTask) => t.text);
    log(
      `Rollover complete: moved=${undone.length} tasks to ${tomorrow}` +
        (dryRun ? " (DRY RUN)" : "")
    );

    return {
      ok: true,
      status: dryRun ? "dry-run" : "ok",
      moved: undone.length,
      todayDate: today,
      tomorrowDate: tomorrow,
      ...(dryRun && {
        todayPreview: updatedToday,
        tomorrowPreview: tomorrowContent,
        extractedTasks,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(ROLLOVER_LOG_PREFIX, "FATAL ERROR:", message);
    if (err instanceof Error && err.stack) {
      console.error(ROLLOVER_LOG_PREFIX, err.stack);
    }
    return {
      ok: false,
      status: "error",
      error: message,
      todayDate: options?.targetDate || getBeijingDateString(),
      tomorrowDate: getTomorrowBeijingDate(),
    };
  }
}
