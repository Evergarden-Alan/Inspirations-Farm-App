import { formatSecondsToMdDuration, parseDurationToSeconds } from "./focus-duration";
import {
  locateTask,
  parseTasks,
  setTaskFocusDurationAtLine,
  type DailyTaskLocator,
} from "./markdown-utils";

export interface FocusDurationWrite {
  task: DailyTaskLocator;
  baseDurationSeconds: number;
  additionalSeconds: number;
}

export type FocusSessionApplyErrorCode =
  | "INVALID_DURATION"
  | "DUPLICATE_TASK"
  | "TASK_NOT_FOUND"
  | "DURATION_CONFLICT";

export class FocusSessionApplyError extends Error {
  public readonly code: FocusSessionApplyErrorCode;

  constructor(
    code: FocusSessionApplyErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FocusSessionApplyError";
    this.code = code;
  }
}

function assertDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FocusSessionApplyError("INVALID_DURATION", "Invalid focus duration");
  }
}

export function applyFocusSessionDurations(
  content: string,
  writes: FocusDurationWrite[]
): string {
  let updatedContent = content;
  const resolvedLines = new Set<number>();

  for (const write of writes) {
    assertDuration(write.baseDurationSeconds);
    assertDuration(write.additionalSeconds);

    const tasks = parseTasks(updatedContent);
    const task = locateTask(tasks, write.task);
    if (!task) {
      throw new FocusSessionApplyError("TASK_NOT_FOUND", "Focus target no longer exists");
    }
    if (resolvedLines.has(task.lineNumber)) {
      throw new FocusSessionApplyError("DUPLICATE_TASK", "Focus target is duplicated");
    }
    resolvedLines.add(task.lineNumber);

    const currentSeconds = task.focusDuration === null
      ? 0
      : parseDurationToSeconds(task.focusDuration);
    if (currentSeconds === null) {
      throw new FocusSessionApplyError("INVALID_DURATION", "Existing focus duration is invalid");
    }

    const recordedIncrement = parseDurationToSeconds(
      formatSecondsToMdDuration(write.additionalSeconds)
    )!;
    const targetSeconds = write.baseDurationSeconds + recordedIncrement;
    if (!Number.isSafeInteger(targetSeconds)) {
      throw new FocusSessionApplyError("INVALID_DURATION", "Focus duration is too large");
    }

    if (currentSeconds === targetSeconds) continue;
    if (currentSeconds !== write.baseDurationSeconds) {
      throw new FocusSessionApplyError(
        "DURATION_CONFLICT",
        "Focus duration changed while the timer was running"
      );
    }

    updatedContent = setTaskFocusDurationAtLine(
      updatedContent,
      task.lineNumber,
      formatSecondsToMdDuration(targetSeconds)
    );
  }

  return updatedContent;
}
