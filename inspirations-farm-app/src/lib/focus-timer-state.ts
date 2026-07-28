import type { DailyTaskLocator } from "./markdown-utils";

export const FOCUS_TIMER_STORAGE_KEY = "farm_focus_timer";

export interface FocusTimerState {
  version: 1;
  date: string;
  path: string;
  task: DailyTaskLocator;
  startTime: number;
  pausedDuration: number;
  isPaused: boolean;
}

function isTaskLocator(value: unknown): value is DailyTaskLocator {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<DailyTaskLocator>;
  return (
    typeof task.lineNumber === "number" &&
    Number.isInteger(task.lineNumber) &&
    task.lineNumber >= 0 &&
    typeof task.text === "string" &&
    typeof task.indent === "string" &&
    (typeof task.parentText === "string" || task.parentText === null)
  );
}

function isFocusTimerState(value: unknown): value is FocusTimerState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<FocusTimerState>;
  return (
    state.version === 1 &&
    typeof state.date === "string" &&
    typeof state.path === "string" &&
    isTaskLocator(state.task) &&
    typeof state.startTime === "number" &&
    Number.isFinite(state.startTime) &&
    typeof state.pausedDuration === "number" &&
    Number.isFinite(state.pausedDuration) &&
    state.pausedDuration >= 0 &&
    typeof state.isPaused === "boolean"
  );
}

export function createFocusTimerState(
  target: Pick<FocusTimerState, "date" | "path" | "task">,
  now = Date.now()
): FocusTimerState {
  return {
    version: 1,
    ...target,
    startTime: now,
    pausedDuration: 0,
    isPaused: false,
  };
}

export function getFocusElapsedSeconds(
  state: FocusTimerState,
  now = Date.now()
): number {
  if (state.isPaused) return Math.floor(state.pausedDuration);
  return Math.max(0, Math.floor((now - state.startTime) / 1000));
}

export function readFocusTimerState(): FocusTimerState | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
  if (!stored) return null;

  try {
    const state: unknown = JSON.parse(stored);
    if (isFocusTimerState(state)) return state;
  } catch {
    // Invalid JSON is handled by clearing the stale record below.
  }

  localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
  return null;
}

export function saveFocusTimerState(state: FocusTimerState): void {
  localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(state));
}

export function clearFocusTimerState(): void {
  localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
}
