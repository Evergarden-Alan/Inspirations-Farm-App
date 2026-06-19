/**
 * Daily rollover: move uncompleted tasks from today's journal to tomorrow's.
 * Uses Asia/Shanghai for all date calculations.
 */

import { getBeijingDateString, getTomorrowBeijingDate } from "./beijing-time";
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
  status: "no_today" | "all_done" | "ok" | "error";
  moved?: number;
  error?: string;
}

export async function executeRollover(): Promise<RolloverResult> {
  try {
    const today = getBeijingDateString();
    const tomorrow = getTomorrowBeijingDate();

    // 1) Fetch today's journal
    const todayJournal = await getDailyJournal(today);
    if (!todayJournal.exists) {
      return { ok: true, status: "no_today" };
    }

    // 2) Parse and filter undone tasks
    const tasks = parseTasks(todayJournal.content!);
    const undone = tasks.filter((t: DailyTask) => !t.done);
    if (undone.length === 0) {
      return { ok: true, status: "all_done" };
    }

    // 3) Mark undone tasks as migrated (- [ ] → - [>]) in today's content
    let updatedToday = todayJournal.content!;
    for (const task of undone) {
      const oldLine = `${task.indent}- [ ] ${task.text}`;
      const newLine = `${task.indent}- [>] ${task.text}`;
      updatedToday = updatedToday.replace(oldLine, newLine);
    }

    // 4) Rebuild task lines for insertion into tomorrow
    const taskLines = undone.map(
      (t: DailyTask) => `${t.indent}- [ ] ${t.text}`
    );

    // 5) Commit today's changes
    const todayResult = await updateDailyJournal(
      todayJournal.path!,
      todayJournal.sha!,
      updatedToday
    );

    // 6) Get or create tomorrow's journal
    const tomorrowJournal = await getDailyJournal(tomorrow);
    let tomorrowContent: string;
    let tomorrowSha: string;
    let tomorrowPath: string;

    if (!tomorrowJournal.exists) {
      // Try to read the template
      let template: string;
      try {
        template = await getFileContent("Templates/Diary_Template.md");
        template = template.replace(/\{\{DATE:YYYY-MM-DD\}\}/g, tomorrow);
      } catch {
        // Fallback: default journal structure
        template = [
          "---",
          "tags:",
          "  - dairy",
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
        ].join("\n");
      }
      tomorrowContent = template;
      const created = await createDailyJournal(tomorrow);
      tomorrowPath = created.path;
      tomorrowSha = created.sha;
    } else {
      tomorrowContent = tomorrowJournal.content!;
      tomorrowPath = tomorrowJournal.path!;
      tomorrowSha = tomorrowJournal.sha!;
    }

    // 7) Append undone tasks into tomorrow's # 当日日程 section
    for (const line of taskLines) {
      tomorrowContent = insertIntoDailySection(tomorrowContent, line);
    }

    // 8) Commit tomorrow's changes
    const tmrwResult = await updateDailyJournal(
      tomorrowPath,
      tomorrowSha,
      tomorrowContent
    );

    return { ok: true, status: "ok", moved: undone.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, status: "error", error: message };
  }
}
