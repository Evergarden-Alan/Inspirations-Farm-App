import assert from "node:assert/strict";
import test from "node:test";

import {
  addDurations,
  formatSecondsToMdDuration,
  parseDurationToSeconds,
} from "../src/lib/focus-duration.ts";
import {
  applyFocusSessionDurations,
  FocusSessionApplyError,
} from "../src/lib/focus-session.ts";
import {
  createFocusTimerState,
  finalizeFocusTimer,
  getFocusElapsedSeconds,
  getFocusSessionElapsedSeconds,
  parseFocusTimerState,
  pauseFocusTimer,
  resumeFocusTimer,
  switchFocusSession,
} from "../src/lib/focus-timer-state.ts";
import {
  createTaskLocator,
  parseTasks,
} from "../src/lib/markdown-utils.ts";

function locator(lineNumber, text, parentText = null) {
  return { lineNumber, text, indent: parentText === null ? "" : "  ", parentText };
}

test("focus durations parse legacy forms and format canonically", () => {
  assert.equal(parseDurationToSeconds("25m"), 1500);
  assert.equal(parseDurationToSeconds("90m"), 5400);
  assert.equal(parseDurationToSeconds("1h5m"), 3900);
  assert.equal(parseDurationToSeconds("1h90m"), 9000);
  assert.equal(parseDurationToSeconds(""), null);
  assert.equal(parseDurationToSeconds("-1m"), null);
  assert.equal(parseDurationToSeconds("nope"), null);

  assert.equal(formatSecondsToMdDuration(0), "1m");
  assert.equal(formatSecondsToMdDuration(59), "1m");
  assert.equal(formatSecondsToMdDuration(60), "1m");
  assert.equal(formatSecondsToMdDuration(3599), "59m");
  assert.equal(formatSecondsToMdDuration(3600), "1h");
  assert.equal(formatSecondsToMdDuration(3900), "1h05m");
  assert.throws(() => formatSecondsToMdDuration(-1), RangeError);
});

test("duration increments are rounded independently before being added", () => {
  assert.equal(addDurations("12m", 30), "13m");
  assert.equal(addDurations("1h", 300), "1h05m");
  assert.equal(addDurations(null, 90), "1m");
  assert.throws(() => addDurations("invalid", 60), RangeError);
});

test("timer state accumulates A to B to A without losing segments", () => {
  const root = locator(0, "父任务");
  const state = createFocusTimerState({
    date: "2026-07-30",
    path: "Journal/Daily/2026-07-30.md",
    task: root,
    targetMode: "subtasks",
    sessions: [
      { taskLocator: locator(1, "A", "父任务"), baseDurationSeconds: 0 },
      { taskLocator: locator(2, "B", "父任务"), baseDurationSeconds: 0 },
    ],
  }, 1_000, "test-session");

  const onB = switchFocusSession(state, 1, 62_000);
  const backOnA = switchFocusSession(onB, 0, 182_000);
  const completed = finalizeFocusTimer(backOnA, 212_000);

  assert.equal(completed.sessions[0].elapsedSeconds, 91);
  assert.equal(completed.sessions[1].elapsedSeconds, 120);
  assert.equal(getFocusSessionElapsedSeconds(completed, 0, 999_000), 91);
  assert.equal(getFocusElapsedSeconds(completed, 999_000), 211);
  assert.equal(completed.segmentElapsedSeconds, 0);
  assert.equal(completed.isPaused, true);
});

test("pause freezes one segment and resume does not double count it", () => {
  const task = locator(0, "任务");
  const initial = createFocusTimerState({
    date: "2026-07-30",
    path: "Journal/Daily/2026-07-30.md",
    task,
    sessions: [{ taskLocator: task, baseDurationSeconds: 0 }],
  }, 1_000, "pause-session");

  const paused = pauseFocusTimer(initial, 11_500);
  assert.equal(getFocusElapsedSeconds(paused, 50_000), 10);
  const resumed = resumeFocusTimer(paused, 20_000);
  const completed = finalizeFocusTimer(resumed, 25_900);

  assert.equal(completed.sessions[0].elapsedSeconds, 15);
  assert.equal(getFocusElapsedSeconds(completed), 15);
});

test("switching while paused settles the old target and keeps the new one paused", () => {
  const root = locator(0, "父任务");
  const initial = createFocusTimerState({
    date: "2026-07-30",
    path: "Journal/Daily/2026-07-30.md",
    task: root,
    targetMode: "subtasks",
    sessions: [
      { taskLocator: locator(1, "A", "父任务"), baseDurationSeconds: 0 },
      { taskLocator: locator(2, "B", "父任务"), baseDurationSeconds: 0 },
    ],
  }, 1_000, "paused-switch");

  const paused = pauseFocusTimer(initial, 11_000);
  const switched = switchFocusSession(paused, 1, 20_000);
  assert.equal(switched.sessions[0].elapsedSeconds, 10);
  assert.equal(switched.segmentElapsedSeconds, 0);
  assert.equal(switched.isPaused, true);

  const completed = finalizeFocusTimer(resumeFocusTimer(switched, 30_000), 35_000);
  assert.deepEqual(completed.sessions.map((session) => session.elapsedSeconds), [10, 5]);
});

test("legacy v1 timer state migrates and malformed v2 state is rejected", () => {
  const task = locator(4, "旧任务");
  const migrated = parseFocusTimerState({
    version: 1,
    date: "2026-07-30",
    path: "Journal/Daily/2026-07-30.md",
    task,
    startTime: 1_000,
    pausedDuration: 42,
    isPaused: true,
  });

  assert.equal(migrated?.version, 2);
  assert.equal(migrated?.sessions[0].baseDurationSeconds, null);
  assert.equal(getFocusElapsedSeconds(migrated, 99_000), 42);
  assert.equal(parseFocusTimerState({ ...migrated, activeSessionIndex: 9 }), null);
});

test("all focus targets are applied atomically and the same payload is idempotent", () => {
  const content = [
    "- [ ] 父任务",
    "  - [ ] A ⏱️12m",
    "  - [ ] B",
  ].join("\n");
  const tasks = parseTasks(content);
  const writes = [
    {
      task: createTaskLocator(tasks[1], tasks),
      baseDurationSeconds: 12 * 60,
      additionalSeconds: 90,
    },
    {
      task: createTaskLocator(tasks[2], tasks),
      baseDurationSeconds: 0,
      additionalSeconds: 125,
    },
  ];

  const updated = applyFocusSessionDurations(content, writes);
  assert.deepEqual(
    parseTasks(updated).map((task) => task.focusDuration),
    [null, "13m", "2m"]
  );
  assert.equal(applyFocusSessionDurations(updated, writes), updated);
});

test("focus session apply rejects stale baselines, missing tasks, and duplicates", () => {
  const content = "- [ ] 任务 ⏱️5m";
  const [task] = parseTasks(content);
  const taskLocator = createTaskLocator(task, [task]);

  assert.throws(
    () => applyFocusSessionDurations(content, [{
      task: taskLocator,
      baseDurationSeconds: 0,
      additionalSeconds: 60,
    }]),
    (error) => error instanceof FocusSessionApplyError && error.code === "DURATION_CONFLICT"
  );
  assert.throws(
    () => applyFocusSessionDurations(content, [{
      task: { ...taskLocator, text: "不存在" },
      baseDurationSeconds: 0,
      additionalSeconds: 60,
    }]),
    (error) => error instanceof FocusSessionApplyError && error.code === "TASK_NOT_FOUND"
  );
  assert.throws(
    () => applyFocusSessionDurations(content, [
      { task: taskLocator, baseDurationSeconds: 300, additionalSeconds: 60 },
      { task: taskLocator, baseDurationSeconds: 300, additionalSeconds: 60 },
    ]),
    (error) => error instanceof FocusSessionApplyError && error.code === "DUPLICATE_TASK"
  );
});
