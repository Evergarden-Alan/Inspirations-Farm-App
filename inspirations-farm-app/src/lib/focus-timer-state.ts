import type { DailyTaskLocator } from "./markdown-utils";

export const FOCUS_TIMER_STORAGE_KEY = "farm_focus_timer";

export interface FocusTargetSession {
  taskLocator: DailyTaskLocator;
  elapsedSeconds: number;
  baseDurationSeconds: number | null;
}

export interface FocusTimerState {
  version: 2;
  sessionId: string;
  date: string;
  path: string;
  task: DailyTaskLocator;
  targetMode: "task" | "subtasks";
  sessions: FocusTargetSession[];
  activeSessionIndex: number;
  segmentStartedAt: number;
  segmentElapsedSeconds: number;
  isPaused: boolean;
}

interface LegacyFocusTimerState {
  version: 1;
  date: string;
  path: string;
  task: DailyTaskLocator;
  startTime: number;
  pausedDuration: number;
  isPaused: boolean;
}

type FocusTimerTargetInput = Pick<FocusTimerState, "date" | "path" | "task"> & {
  targetMode?: FocusTimerState["targetMode"];
  sessions?: Array<Pick<FocusTargetSession, "taskLocator" | "baseDurationSeconds">>;
};

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

function isFocusTargetSession(value: unknown): value is FocusTargetSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<FocusTargetSession>;
  return (
    isTaskLocator(session.taskLocator) &&
    isNonNegativeFinite(session.elapsedSeconds) &&
    Number.isInteger(session.elapsedSeconds) &&
    (session.baseDurationSeconds === null ||
      (isNonNegativeFinite(session.baseDurationSeconds) &&
        Number.isInteger(session.baseDurationSeconds)))
  );
}

function isFocusTimerStateV2(value: unknown): value is FocusTimerState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<FocusTimerState>;
  if (
    state.version !== 2 ||
    typeof state.sessionId !== "string" ||
    state.sessionId.length === 0 ||
    state.sessionId.length > 200 ||
    typeof state.date !== "string" ||
    typeof state.path !== "string" ||
    !isTaskLocator(state.task) ||
    (state.targetMode !== "task" && state.targetMode !== "subtasks") ||
    !Array.isArray(state.sessions) ||
    state.sessions.length === 0 ||
    state.sessions.length > 100 ||
    !state.sessions.every(isFocusTargetSession) ||
    typeof state.activeSessionIndex !== "number" ||
    !Number.isInteger(state.activeSessionIndex) ||
    state.activeSessionIndex < 0 ||
    state.activeSessionIndex >= state.sessions.length ||
    !isNonNegativeFinite(state.segmentStartedAt) ||
    !isNonNegativeFinite(state.segmentElapsedSeconds) ||
    !Number.isInteger(state.segmentElapsedSeconds) ||
    typeof state.isPaused !== "boolean"
  ) {
    return false;
  }

  return true;
}

function isLegacyFocusTimerState(value: unknown): value is LegacyFocusTimerState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<LegacyFocusTimerState>;
  return (
    state.version === 1 &&
    typeof state.date === "string" &&
    typeof state.path === "string" &&
    isTaskLocator(state.task) &&
    isNonNegativeFinite(state.startTime) &&
    isNonNegativeFinite(state.pausedDuration) &&
    typeof state.isPaused === "boolean"
  );
}

function createSessionId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `focus-${now}-${Math.random().toString(36).slice(2)}`;
}

export function createFocusTimerState(
  target: FocusTimerTargetInput,
  now = Date.now(),
  sessionId = createSessionId(now)
): FocusTimerState {
  const sessions = target.sessions?.length
    ? target.sessions.map((session) => ({ ...session, elapsedSeconds: 0 }))
    : [{ taskLocator: target.task, elapsedSeconds: 0, baseDurationSeconds: null }];

  return {
    version: 2,
    sessionId,
    date: target.date,
    path: target.path,
    task: target.task,
    targetMode: target.targetMode ?? "task",
    sessions,
    activeSessionIndex: 0,
    segmentStartedAt: now,
    segmentElapsedSeconds: 0,
    isPaused: false,
  };
}

export function parseFocusTimerState(value: unknown): FocusTimerState | null {
  if (isFocusTimerStateV2(value)) return value;
  if (!isLegacyFocusTimerState(value)) return null;

  return {
    version: 2,
    sessionId: `legacy-${value.startTime}-${value.task.lineNumber}`,
    date: value.date,
    path: value.path,
    task: value.task,
    targetMode: "task",
    sessions: [
      {
        taskLocator: value.task,
        elapsedSeconds: 0,
        baseDurationSeconds: null,
      },
    ],
    activeSessionIndex: 0,
    segmentStartedAt: value.startTime,
    segmentElapsedSeconds: value.isPaused ? Math.floor(value.pausedDuration) : 0,
    isPaused: value.isPaused,
  };
}

export function getActiveSegmentElapsedSeconds(
  state: FocusTimerState,
  now = Date.now()
): number {
  if (state.isPaused) return state.segmentElapsedSeconds;
  const runningSeconds = Math.max(0, Math.floor((now - state.segmentStartedAt) / 1000));
  return state.segmentElapsedSeconds + runningSeconds;
}

export function getFocusSessionElapsedSeconds(
  state: FocusTimerState,
  sessionIndex: number,
  now = Date.now()
): number {
  const session = state.sessions[sessionIndex];
  if (!session) return 0;
  return session.elapsedSeconds +
    (sessionIndex === state.activeSessionIndex
      ? getActiveSegmentElapsedSeconds(state, now)
      : 0);
}

export function getFocusElapsedSeconds(
  state: FocusTimerState,
  now = Date.now()
): number {
  return state.sessions.reduce((total, session) => total + session.elapsedSeconds, 0) +
    getActiveSegmentElapsedSeconds(state, now);
}

function settleActiveSegment(state: FocusTimerState, now: number): FocusTimerState {
  const activeElapsed = getActiveSegmentElapsedSeconds(state, now);
  const sessions = state.sessions.map((session, index) =>
    index === state.activeSessionIndex
      ? { ...session, elapsedSeconds: session.elapsedSeconds + activeElapsed }
      : session
  );

  return {
    ...state,
    sessions,
    segmentStartedAt: now,
    segmentElapsedSeconds: 0,
  };
}

export function switchFocusSession(
  state: FocusTimerState,
  nextIndex: number,
  now = Date.now()
): FocusTimerState {
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= state.sessions.length) {
    return state;
  }
  if (nextIndex === state.activeSessionIndex) return state;

  return {
    ...settleActiveSegment(state, now),
    activeSessionIndex: nextIndex,
  };
}

export function pauseFocusTimer(
  state: FocusTimerState,
  now = Date.now()
): FocusTimerState {
  if (state.isPaused) return state;
  return {
    ...state,
    segmentStartedAt: now,
    segmentElapsedSeconds: getActiveSegmentElapsedSeconds(state, now),
    isPaused: true,
  };
}

export function resumeFocusTimer(
  state: FocusTimerState,
  now = Date.now()
): FocusTimerState {
  if (!state.isPaused) return state;
  return {
    ...state,
    segmentStartedAt: now,
    isPaused: false,
  };
}

export function finalizeFocusTimer(
  state: FocusTimerState,
  now = Date.now()
): FocusTimerState {
  return {
    ...settleActiveSegment(state, now),
    isPaused: true,
  };
}

export function readFocusTimerState(): FocusTimerState | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
  if (!stored) return null;

  try {
    const raw: unknown = JSON.parse(stored);
    const state = parseFocusTimerState(raw);
    if (state) {
      if ((raw as { version?: unknown }).version !== 2) saveFocusTimerState(state);
      return state;
    }
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
