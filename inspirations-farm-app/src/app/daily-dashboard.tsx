"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Loader2, Circle, CheckCircle2, CornerDownRight, Check, CalendarCheck2, Trash2, Timer, MoreHorizontal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PriorityPicker, type Priority } from "@/components/priority-picker";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";
import {
  createTaskLocator,
  insertSubtaskLine,
  insertIntoDailySection,
  locateTask,
  parseTasks,
} from "@/lib/github";
import { cascadeToggleAtLine } from "@/lib/cascade";
import type { DailyTask } from "@/lib/github";
import {
  clearFocusTimerState,
  createFocusTimerState,
  readFocusTimerState,
  saveFocusTimerState,
  type FocusTimerState,
} from "@/lib/focus-timer-state";
import {
  formatSecondsToMdDuration,
  parseDurationToSeconds,
} from "@/lib/focus-duration";
import { FocusTimer } from "./focus-timer";
import { toast } from "./toast";

interface DailyState {
  exists: boolean;
  path?: string;
  sha?: string;
  content?: string;
  tasks?: DailyTask[];
}

interface DailyDashboardProps {
  initialDaily?: {
    exists: boolean;
    path?: string;
    sha?: string;
    content?: string;
    tasks?: DailyTask[];
  };
}

interface DailyUpdatedDetail {
  date: string;
  path: string;
  sha: string;
  content: string;
}

interface FocusSession {
  task: DailyTask;
  timer: FocusTimerState;
  targetLabels: string[];
}

function getFocusTargetLabels(timer: FocusTimerState, tasks: DailyTask[]): string[] {
  return timer.sessions.map((session) =>
    locateTask(tasks, session.taskLocator)?.displayText ?? session.taskLocator.text
  );
}

function fillMissingFocusBaselines(
  timer: FocusTimerState,
  tasks: DailyTask[]
): FocusTimerState {
  let changed = false;
  const sessions = timer.sessions.map((session) => {
    if (session.baseDurationSeconds !== null) return session;
    const task = locateTask(tasks, session.taskLocator);
    if (!task) return session;
    changed = true;
    return {
      ...session,
      baseDurationSeconds: parseDurationToSeconds(task.focusDuration) ?? 0,
    };
  });
  return changed ? { ...timer, sessions } : timer;
}

function getTaskSubtreeSize(tasks: DailyTask[], index: number): number {
  const parentLevel = tasks[index].indentLevel;
  let size = 1;

  for (let i = index + 1; i < tasks.length; i++) {
    if (tasks[i].indentLevel <= parentLevel) break;
    size++;
  }

  return size;
}

export function DailyDashboard({ initialDaily }: DailyDashboardProps = {}) {
  const [state, setState] = useState<DailyState | null>(() => {
    if (!initialDaily) return null;
    return initialDaily.exists
      ? {
          exists: true,
          path: initialDaily.path,
          sha: initialDaily.sha,
          content: initialDaily.content,
          tasks: initialDaily.tasks ?? [],
        }
      : { exists: false };
  });
  const [loading, setLoading] = useState(!initialDaily);
  const [acting, setActing] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [taskPriority, setTaskPriority] = useState<Priority>("p2");
  const [error, setError] = useState<string | null>(null);
  const [addSubFor, setAddSubFor] = useState<number | null>(null);
  const [subText, setSubText] = useState("");
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<number | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);
  const [taskMenuFor, setTaskMenuFor] = useState<number | null>(null);
  const [focusSession, setFocusSession] = useState<FocusSession | null>(null);
  const [focusTimerOpen, setFocusTimerOpen] = useState(false);
  const recoveryCheckedRef = useRef(false);
  const date = getBeijingDateString();

  // ── Check for active timer on mount ─────────────────
  useEffect(() => {
    if (recoveryCheckedRef.current || !state?.tasks || !state.path) return;
    recoveryCheckedRef.current = true;

    const stored = readFocusTimerState();
    if (!stored) return;

    if (stored.date !== date || stored.path !== state.path) {
      clearFocusTimerState();
      return;
    }

    const activeTask = locateTask(state.tasks, stored.task);
    if (!activeTask) {
      clearFocusTimerState();
      return;
    }

    const restored = fillMissingFocusBaselines(stored, state.tasks);
    if (restored !== stored) saveFocusTimerState(restored);

    const recoveryTimer = setTimeout(() => {
      setFocusSession({
        task: activeTask,
        timer: restored,
        targetLabels: getFocusTargetLabels(restored, state.tasks!),
      });
      setFocusTimerOpen(true);
    }, 0);
    return () => clearTimeout(recoveryTimer);
  }, [date, state?.path, state?.tasks]);

  // ── Conflict Retry Helpers ──────────────────────────

  /** Check if error is a 409 conflict */
  function isConflictError(err: unknown): boolean {
    if (err && typeof err === "object" && "status" in err) {
      return (err as { status: number }).status === 409;
    }
    return false;
  }

  /** Refetch latest daily content for retry */
  async function refetchDaily(): Promise<{ content: string; sha: string; tasks: DailyTask[] }> {
    const res = await apiFetch(`/api/daily?date=${date}`);
    const data = await res.json();

    if (!data.ok || !data.exists) {
      throw new Error("Failed to fetch latest daily");
    }

    return {
      content: data.content,
      sha: data.sha,
      tasks: data.tasks ?? [],
    };
  }

  /** Retry wrapper for client-side operations that may conflict */
  async function withClientRetry<T>(
    operation: (freshState: { content: string; sha: string; tasks: DailyTask[] }) => Promise<T>,
    maxRetries = 2
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // First attempt uses current state, retries refetch
        const freshState =
          attempt === 0
            ? { content: state!.content!, sha: state!.sha!, tasks: state!.tasks! }
            : await refetchDaily();

        return await operation(freshState);
      } catch (err) {
        lastError = err;

        // Retry on 409 if attempts remain
        if (isConflictError(err) && attempt < maxRetries - 1) {
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  // ── Fetch ───────────────────────────────────────────
  const fetchJournal = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/daily?date=${date}`);
      const data = await res.json();
      if (data.ok) {
        setDeleteConfirmFor(null);
        setState({
          exists: data.exists,
          path: data.path,
          sha: data.sha,
          content: data.content,
          tasks: data.tasks ?? [],
        });
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const initialFetchTimer = !initialDaily
      ? setTimeout(() => void fetchJournal(), 0)
      : undefined;

    function handleDailyUpdate(event: Event) {
      const detail = (event as CustomEvent<DailyUpdatedDetail>).detail;
      if (
        detail?.date === date &&
        typeof detail.path === "string" &&
        typeof detail.sha === "string" &&
        typeof detail.content === "string"
      ) {
        setDeleteConfirmFor(null);
        setState({
          exists: true,
          path: detail.path,
          sha: detail.sha,
          content: detail.content,
          tasks: parseTasks(detail.content),
        });
        return;
      }
      void fetchJournal();
    }
    window.addEventListener("daily:updated", handleDailyUpdate);
    return () => {
      if (initialFetchTimer) clearTimeout(initialFetchTimer);
      window.removeEventListener("daily:updated", handleDailyUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Create journal ──────────────────────────────────
  async function handleCreate() {
    setActing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/daily", {
        method: "POST",
        body: JSON.stringify({ date }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchJournal();
      } else {
        setError(data.error ?? "Failed to create");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Toggle with parent-child cascade ────────────────
  async function handleToggle(index: number) {
    if (!state?.content || !state.sha || !state.path || !state.tasks) return;

    const originalTask = state.tasks[index];
    const oldTasks = state.tasks;
    const runningTask = focusSession
      ? locateTask(state.tasks, focusSession.timer.task)
      : undefined;
    if (runningTask?.id === originalTask.id) {
      setFocusTimerOpen(true);
      toast.info("该任务正在计时，请在专注模式中完成或中止");
      return;
    }

    setActing(true);
    setError(null);

    try {
      await withClientRetry(async (freshState) => {
        // Re-locate the task (line number may have changed)
        const freshTasks = freshState.tasks;
        const taskToToggle =
          freshTasks.find((t) => t.text === originalTask.text && t.indent === originalTask.indent) ||
          freshTasks[index]; // fallback to same index

        // Perform toggle
        const updatedContent = cascadeToggleAtLine(freshState.content, taskToToggle.lineNumber);
        if (updatedContent === freshState.content) {
          throw new Error("Failed to update task in file");
        }

        const newTasks = parseTasks(updatedContent);

        // PUT request
        const res = await apiFetch("/api/daily", {
          method: "PUT",
          body: JSON.stringify({
            path: state.path,
            sha: freshState.sha,
            content: updatedContent,
          }),
        });

        const data = await res.json();

        if (!data.ok) {
          const err = new Error(data.error ?? "Failed to update") as Error & { status?: number };
          err.status = res.status;
          throw err;
        }

        // Success - update state
        setState({ ...state, content: updatedContent, sha: data.sha, tasks: newTasks });

        // Archive linked inspirations that became completed
        for (let i = 0; i < newTasks.length; i++) {
          const oldDone = oldTasks[i]?.done;
          const newDone = newTasks[i].done;
          if (!oldDone && newDone && newTasks[i].sourceIdeaId) {
            apiFetch("/api/github", {
              method: "PUT",
              body: JSON.stringify({
                ideaId: newTasks[i].sourceIdeaId,
                status: "completed",
              }),
            })
              .then(() => {
                window.dispatchEvent(new CustomEvent("inspiration:updated"));
              })
              .catch(() => {});
          }
        }
      }, 2);
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setError(isConflictError(err) ? "操作冲突，请刷新重试" : "Network error");
      }
    } finally {
      setActing(false);
    }
  }

  // ── Add top-level task ──────────────────────────────
  async function handleAddTask() {
    const text = newTask.trim();
    if (!text || !state?.content || !state.sha || !state.path) return;

    setActing(true);
    setError(null);

    try {
      await withClientRetry(async (freshState) => {
        // Check if task already exists (avoid duplicates on retry)
        const freshTasks = freshState.tasks;
        const alreadyExists = freshTasks.some((t) => t.text === text || t.text === `${text} #${taskPriority}`);
        if (alreadyExists) {
          // Task already added, treat as success
          setNewTask("");
          setTaskPriority("p2");
          return;
        }

        // Construct task line with priority
        const prioritySuffix = taskPriority !== "p2" ? ` #${taskPriority}` : "";
        const taskLine = `- [ ] ${text}${prioritySuffix}`;
        const updatedContent = insertIntoDailySection(freshState.content, taskLine);

        const res = await apiFetch("/api/daily", {
          method: "PUT",
          body: JSON.stringify({ path: state.path, sha: freshState.sha, content: updatedContent }),
        });

        const data = await res.json();

        if (!data.ok) {
          const err = new Error(data.error ?? "Failed to add task") as Error & { status?: number };
          err.status = res.status;
          throw err;
        }

        setNewTask("");
        setTaskPriority("p2"); // Reset to default
        const newTasks = parseTasks(updatedContent);
        setState({
          ...state,
          content: updatedContent,
          sha: data.sha,
          tasks: newTasks,
        });
      }, 2);
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setError(isConflictError(err) ? "操作冲突，请刷新重试" : "Network error");
      }
    } finally {
      setActing(false);
    }
  }

  // ── Add sub-task ────────────────────────────────────
  async function handleAddSub(parentTask: DailyTask) {
    const text = subText.trim();
    if (!text || !state?.content || !state.sha || !state.path) return;

    setActing(true);
    setError(null);

    try {
      await withClientRetry(async (freshState) => {
        // Re-locate the parent task (line number may have changed)
        const freshTasks = freshState.tasks;
        const freshParent =
          freshTasks.find((t) => t.text === parentTask.text && t.indent === parentTask.indent) ||
          parentTask; // fallback

        const updatedContent = insertSubtaskLine(freshState.content, freshParent, text);

        const res = await apiFetch("/api/daily", {
          method: "PUT",
          body: JSON.stringify({ path: state.path, sha: freshState.sha, content: updatedContent }),
        });

        const data = await res.json();

        if (!data.ok) {
          const err = new Error(data.error ?? "Failed to add subtask") as Error & { status?: number };
          err.status = res.status;
          throw err;
        }

        setAddSubFor(null);
        setSubText("");
        const newTasks = parseTasks(updatedContent);
        setState({
          ...state,
          content: updatedContent,
          sha: data.sha,
          tasks: newTasks,
        });
      }, 2);
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setError(isConflictError(err) ? "操作冲突，请刷新重试" : "Network error");
      }
    } finally {
      setActing(false);
    }
  }

  // ── Delete task subtree ─────────────────────────────
  async function handleDeleteTask(task: DailyTask) {
    if (!state?.tasks) return;

    const taskIndex = state.tasks.findIndex((candidate) => candidate.id === task.id);
    const protectedLocators = focusSession
      ? [
          focusSession.timer.task,
          ...focusSession.timer.sessions.map((session) => session.taskLocator),
        ]
      : [];
    const protectedTaskIndices = protectedLocators
      .map((locator) => locateTask(state.tasks!, locator))
      .filter((candidate): candidate is DailyTask => Boolean(candidate))
      .map((candidate) =>
        state.tasks!.findIndex((taskCandidate) => taskCandidate.id === candidate.id)
      );
    const subtreeEnd = taskIndex >= 0
      ? taskIndex + getTaskSubtreeSize(state.tasks, taskIndex)
      : taskIndex;

    if (
      taskIndex >= 0 &&
      protectedTaskIndices.some(
        (protectedIndex) => protectedIndex >= taskIndex && protectedIndex < subtreeEnd
      )
    ) {
      setDeleteConfirmFor(null);
      setTaskMenuFor(null);
      setFocusTimerOpen(true);
      toast.info("正在计时的任务不能删除，请先结束并保存或中止计时");
      return;
    }

    const parent =
      task.parentId === null
        ? null
        : state.tasks.find((candidate) => candidate.id === task.parentId);

    setActing(true);
    setDeletingTaskId(task.id);
    setError(null);

    try {
      const res = await apiFetch("/api/daily", {
        method: "DELETE",
        retryOnNetworkError: false,
        body: JSON.stringify({
          date,
          task: {
            lineNumber: task.lineNumber,
            text: task.text,
            indent: task.indent,
            parentText: parent?.text ?? null,
          },
        }),
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error ?? "删除任务失败");
        return;
      }

      setDeleteConfirmFor(null);
      setAddSubFor(null);
      setSubText("");

      if (typeof data.content === "string") {
        setState({
          ...state,
          content: data.content,
          sha: data.sha,
          tasks: parseTasks(data.content),
        });
      } else {
        await fetchJournal();
      }

      // Keep other consumers of the daily journal synchronized.
      window.dispatchEvent(new CustomEvent("daily:updated"));
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setError("请求响应中断，正在同步最新任务状态");
        await fetchJournal();
      }
    } finally {
      setDeletingTaskId(null);
      setActing(false);
    }
  }

  function handleSubKeyDown(e: React.KeyboardEvent, parent: DailyTask) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSub(parent);
    }
    if (e.key === "Escape") {
      setAddSubFor(null);
      setSubText("");
    }
  }

  // ── Focus session ────────────────────────────────────
  function handleOpenFocusTimer(task: DailyTask) {
    if (!state?.path || !state.tasks) return;
    setError(null);

    let stored = readFocusTimerState();
    if (stored && (stored.date !== date || stored.path !== state.path)) {
      clearFocusTimerState();
      stored = null;
    }

    if (stored) {
      const activeTask = locateTask(state.tasks, stored.task);
      if (activeTask) {
        if (activeTask.id !== task.id) {
          toast.info(`「${activeTask.displayText}」正在计时，请先结束或中止`);
          return;
        }

        const restored = fillMissingFocusBaselines(stored, state.tasks);
        if (restored !== stored) saveFocusTimerState(restored);
        setFocusSession({
          task: activeTask,
          timer: restored,
          targetLabels: getFocusTargetLabels(restored, state.tasks),
        });
        setFocusTimerOpen(true);
        return;
      }
      clearFocusTimerState();
    }

    const directSubtasks = state.tasks.filter(
      (candidate) => candidate.parentId === task.id && !candidate.done
    );
    const targets = directSubtasks.length > 0 ? directSubtasks : [task];
    const timer = createFocusTimerState({
      date,
      path: state.path,
      task: createTaskLocator(task, state.tasks),
      targetMode: directSubtasks.length > 0 ? "subtasks" : "task",
      sessions: targets.map((target) => ({
        taskLocator: createTaskLocator(target, state.tasks!),
        baseDurationSeconds: parseDurationToSeconds(target.focusDuration) ?? 0,
      })),
    });
    saveFocusTimerState(timer);
    setFocusSession({
      task,
      timer,
      targetLabels: targets.map((target) => target.displayText),
    });
    setFocusTimerOpen(true);
  }

  async function handleSaveFocusSession(timer: FocusTimerState): Promise<boolean> {
    if (!state?.content || !state.sha || !state.path || !state.tasks) return false;

    const sessionsWithTime = timer.sessions.filter((session) => session.elapsedSeconds > 0);
    const sessions = sessionsWithTime.length > 0
      ? sessionsWithTime
      : [timer.sessions[timer.activeSessionIndex]];
    if (sessions.some((session) => session.baseDurationSeconds === null)) {
      setError("计时目标已发生变化，无法确认原有时长");
      return false;
    }

    setActing(true);
    setError(null);

    try {
      const res = await apiFetch("/api/daily", {
        method: "PATCH",
        body: JSON.stringify({
          action: "saveFocusSession",
          date: timer.date,
          sessionId: timer.sessionId,
          sessions: sessions.map((session) => ({
            task: session.taskLocator,
            baseDurationSeconds: session.baseDurationSeconds,
            additionalSeconds: session.elapsedSeconds,
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        const err = new Error(data.error ?? "Failed to save focus session") as Error & {
          status?: number;
        };
        err.status = res.status;
        throw err;
      }

      const updatedTasks = parseTasks(data.content);
      setState({
        ...state,
        path: data.path,
        content: data.content,
        sha: data.sha,
        tasks: updatedTasks,
      });
      window.dispatchEvent(new CustomEvent<DailyUpdatedDetail>("daily:updated", {
        detail: {
          date: timer.date,
          path: data.path,
          sha: data.sha,
          content: data.content,
        },
      }));
      toast.success(`专注时长已保存 · ${formatSecondsToMdDuration(
        sessions.reduce((total, session) => total + session.elapsedSeconds, 0)
      )}`);
      return true;
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setError(
          isConflictError(err)
            ? "任务或已有时长已发生变化，请确认后重试"
            : "计时结果保存失败，请重试"
        );
      }
      return false;
    } finally {
      setActing(false);
    }
  }

  // ── Render ──────────────────────────────────────────
  if (loading) {
    return (
      <Card className="farm-panel">
        <CardContent className="p-8 text-center text-sm text-[var(--farm-muted)]">正在翻开今天的日程...</CardContent>
      </Card>
    );
  }

  if (!state?.exists) {
    return (
      <Card className="farm-panel">
        <CardContent className="space-y-5 p-8 text-center">
          <div className="farm-section-icon mx-auto">
            <CalendarCheck2 className="size-5" strokeWidth={1.8} />
          </div>
          <div>
            <p className="farm-display text-xl text-[var(--farm-ink)]">今天还是一张白纸</p>
            <p className="mt-1 text-xs text-[var(--farm-muted)]">{date} · 写下今天想完成的事</p>
          </div>
          <Button
            onClick={handleCreate}
            disabled={acting}
            className="farm-primary-button h-10 px-5"
          >
            {acting ? "创建中..." : "创建今日日程"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const doneCount = state.tasks?.filter((t) => t.done).length ?? 0;
  const totalCount = state.tasks?.length ?? 0;
  const activeFocusTask = focusSession && state.tasks
    ? locateTask(state.tasks, focusSession.timer.task)
    : undefined;

  return (
    <Card className="farm-panel">
      <CardHeader className="pb-4 pt-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="farm-section-icon">
              <CalendarCheck2 className="size-5" strokeWidth={1.8} />
            </div>
            <div>
              <p className="farm-kicker mb-0.5">DAY PLAN</p>
              <CardTitle className="farm-display text-xl font-semibold text-[var(--farm-ink)]">今日耕作</CardTitle>
            </div>
          </div>
          {totalCount > 0 && (
            <div className="rounded-full bg-[var(--farm-green-soft)] px-3 py-1 text-xs font-semibold tabular-nums text-[var(--farm-green)]">
              {doneCount} / {totalCount}
            </div>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-[var(--farm-muted)]">{date}</p>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--farm-paper-deep)]">
            <motion.div
              className="h-full rounded-full bg-[var(--farm-green)]"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <p className="farm-alert-error px-3 py-2 text-xs" role="alert">{error}</p>
        )}

        {/* Task list */}
        {state.tasks && state.tasks.length > 0 ? (
          <ul className="space-y-0.5 -mx-2">
            {state.tasks.map((task, i) => {
              const isSub = task.indentLevel > 0;
              const iconSize = isSub ? "w-5 h-5" : "w-6 h-6";
              const isRollover = task.displayText.includes("🔄");
              const cleanText = task.displayText.replace(/🔄/g, "").trim();
              const childCount = getTaskSubtreeSize(state.tasks!, i) - 1;
              const isFocusActive = activeFocusTask?.id === task.id;

              return (
                <li key={task.id}>
                  <div
                    className="group/task relative"
                    style={{ marginLeft: `${task.indentLevel * 1.5}rem` }}
                  >
                    {/* Toggle and subtask actions are siblings to keep the HTML valid. */}
                    <div className="flex min-h-[3.5rem] w-full items-center rounded-xl transition-colors hover:bg-[var(--farm-green-soft)]/60">
                      <button
                        onClick={() => handleToggle(i)}
                        disabled={acting}
                        aria-label={task.done ? `标记「${task.displayText}」为未完成` : `标记「${task.displayText}」为已完成`}
                        className="flex min-h-[3.5rem] min-w-0 flex-1 touch-manipulation items-center gap-3 px-3 py-3 text-left disabled:opacity-50"
                      >
                      <motion.div
                        key={task.done ? "done" : "undone"}
                        initial={{ scale: 0.7, opacity: 0.6 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 15, duration: 0.25 }}
                        className="flex-shrink-0"
                      >
                        {task.done ? (
                          <CheckCircle2 className={`${iconSize} text-[var(--farm-green)]`} />
                        ) : (
                          <Circle className={`${iconSize} text-[var(--farm-line)]`} />
                        )}
                      </motion.div>
                      <span className="min-w-0 flex-1 text-base leading-relaxed">
                        <span
                          className={`transition-all duration-200 ${
                            task.done
                              ? "text-[var(--farm-faint)] line-through"
                              : isSub
                                ? "text-[var(--farm-text)]"
                                : "text-[var(--farm-ink)]"
                          }`}
                        >
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[
                              rehypeSanitize,
                              [rehypeKatex, { strict: false, throwOnError: false, output: "html" }],
                            ]}
                            components={{
                              p: ({ ...props}) => (
                                <span className="inline" {...props} />
                              ),
                              a: ({ ...props}) => (
                                <a
                                  className="text-[var(--farm-green)] underline-offset-2 hover:underline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  {...props}
                                />
                              ),
                            }}
                          >
                            {cleanText.replace(/^- \[[x ]\] /, "")}
                          </ReactMarkdown>
                        </span>
                        {task.sourceIdeaId && (
                          <span className="ml-1.5 align-middle font-mono text-[10px] text-[var(--farm-muted)]">
                            #{task.sourceIdeaId.slice(-6)}
                          </span>
                        )}
                        {isRollover && (
                          <span className="farm-rollover-badge ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                            延期
                          </span>
                        )}
                        {/* Priority badge */}
                        {task.priority && task.priority !== "p2" && (
                          <span
                            className="farm-priority-badge ml-1.5 align-middle"
                            data-priority={task.priority}
                          >
                            {task.priority.toUpperCase()}
                          </span>
                        )}
                        {/* Focus duration badge */}
                        {task.focusDuration && (
                          <span className="ml-1.5 align-middle rounded-full bg-[var(--farm-green-soft)] px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--farm-green)]">
                            ⏱️{task.focusDuration}
                          </span>
                        )}
                      </span>

                      </button>

                      {/* Desktop actions stay compact until the row is hovered. */}
                      {task.indentLevel < 4 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddSubFor(task.id);
                            setSubText("");
                            setDeleteConfirmFor(null);
                            setTaskMenuFor(null);
                          }}
                          aria-label={`为「${task.displayText}」添加子任务`}
                          className="mr-1 ml-auto hidden min-h-10 min-w-10 touch-manipulation rounded-lg p-2 text-[var(--farm-muted)] opacity-0 transition-all hover:bg-[var(--farm-paper-raised)] hover:text-[var(--farm-green)] group-hover/task:opacity-100 focus-visible:opacity-100 lg:block"
                          title="添加子任务"
                        >
                          <CornerDownRight className="w-4 h-4" />
                        </button>
                      )}

                      {/* Timer remains directly reachable on touch layouts. */}
                      {!task.done && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenFocusTimer(task);
                          }}
                          aria-label={isFocusActive ? `继续「${task.displayText}」的计时` : `为「${task.displayText}」开始计时`}
                          className={`mr-1 ml-auto min-h-11 min-w-11 touch-manipulation rounded-lg p-2 transition-all hover:bg-[var(--farm-paper-raised)] hover:text-[var(--farm-green)] lg:ml-0 lg:min-h-10 lg:min-w-10 lg:opacity-0 lg:group-hover/task:opacity-100 lg:focus-visible:opacity-100 ${
                            isFocusActive
                              ? "bg-[var(--farm-green-soft)] text-[var(--farm-green)] opacity-100"
                              : "text-[var(--farm-muted)] opacity-65"
                          }`}
                          title={isFocusActive ? "继续计时" : "开始计时"}
                        >
                          <Timer className={`h-4 w-4 ${isFocusActive ? "animate-pulse" : ""}`} />
                        </button>
                      )}

                      {/* Delete action — desktop only; mobile uses the overflow menu. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmFor((current) => current === task.id ? null : task.id);
                          setAddSubFor(null);
                          setSubText("");
                          setTaskMenuFor(null);
                        }}
                        disabled={acting}
                        aria-label={`删除「${task.displayText}」`}
                        aria-expanded={deleteConfirmFor === task.id}
                        aria-controls={`delete-task-${task.id}`}
                        className="mr-1 hidden min-h-10 min-w-10 touch-manipulation rounded-lg p-2 text-[var(--farm-muted)] opacity-0 transition-all hover:bg-[var(--farm-danger-bg)] hover:text-[var(--farm-danger)] disabled:opacity-30 group-hover/task:opacity-100 focus-visible:opacity-100 lg:block"
                        title="删除任务"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setTaskMenuFor((current) => current === task.id ? null : task.id);
                        }}
                        aria-label={`「${task.displayText}」的更多操作`}
                        aria-expanded={taskMenuFor === task.id}
                        aria-controls={`task-menu-${task.id}`}
                        className="mr-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--farm-muted)] transition-colors hover:bg-[var(--farm-paper-raised)] hover:text-[var(--farm-ink)] lg:hidden"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>

                    <AnimatePresence>
                      {taskMenuFor === task.id && (
                        <motion.div
                          id={`task-menu-${task.id}`}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden lg:hidden"
                        >
                          <div className="mx-2 mb-2 flex items-center justify-end gap-2 rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper-deep)]/65 p-2">
                            {task.indentLevel < 4 && (
                              <button
                                type="button"
                                className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[var(--farm-text)] hover:bg-[var(--farm-paper-raised)]"
                                onClick={() => {
                                  setAddSubFor(task.id);
                                  setSubText("");
                                  setDeleteConfirmFor(null);
                                  setTaskMenuFor(null);
                                }}
                              >
                                <CornerDownRight className="h-4 w-4" />
                                添加子任务
                              </button>
                            )}
                            <button
                              type="button"
                              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[var(--farm-danger)] hover:bg-[var(--farm-danger-bg)]"
                              onClick={() => {
                                setDeleteConfirmFor(task.id);
                                setAddSubFor(null);
                                setSubText("");
                                setTaskMenuFor(null);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              删除任务
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Destructive actions require a second, explicit click. */}
                    <AnimatePresence>
                      {deleteConfirmFor === task.id && (
                        <motion.div
                          id={`delete-task-${task.id}`}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--farm-danger-line)] bg-[var(--farm-danger-bg)] px-3 py-2.5">
                            <p className="min-w-0 flex-1 text-sm text-[var(--farm-danger)]">
                              {childCount > 0
                                ? `将同时删除 ${childCount} 个子任务`
                                : "确定删除这个任务？"}
                            </p>
                            <div className="ml-auto flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmFor(null)}
                                disabled={deletingTaskId === task.id}
                                className="min-h-9 rounded-lg px-3 text-xs font-medium text-[var(--farm-text)] transition-colors hover:bg-[var(--farm-paper-raised)] disabled:opacity-50"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteTask(task)}
                                disabled={deletingTaskId === task.id}
                                className="flex min-h-9 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg bg-[var(--farm-danger)] px-3 text-xs font-semibold text-[var(--farm-paper-raised)] transition-opacity hover:opacity-90 disabled:opacity-60"
                              >
                                {deletingTaskId === task.id ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    删除中...
                                  </>
                                ) : "删除"}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Inline sub-task input — animated */}
                    <AnimatePresence>
                      {addSubFor === task.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18, ease: "easeInOut" }}
                          style={{ overflow: "hidden" }}
                        >
                          <div
                            className="flex items-center gap-2 py-1 px-3"
                            style={{ marginLeft: `${1.5}rem` }}
                          >
                            <CornerDownRight className="h-4 w-4 flex-shrink-0 text-[var(--farm-line)]" />
                            <Input
                              placeholder="子任务..."
                              value={subText}
                              onChange={(e) => setSubText(e.target.value)}
                              onKeyDown={(e) => handleSubKeyDown(e, task)}
                              onBlur={() => {
                                if (!subText.trim()) {
                                  setAddSubFor(null);
                                  setSubText("");
                                }
                              }}
                              disabled={acting}
                              className="farm-input h-9 text-sm"
                              autoFocus
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleAddSub(task)}
                              disabled={acting || !subText.trim()}
                              className="h-8 w-8 flex-shrink-0 text-[var(--farm-muted)] hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)]"
                              title="确认"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-[var(--farm-muted)]">土地已经备好，写下第一件事吧。</p>
        )}

        {/* Add top-level task */}
        <div className="space-y-3 border-t border-[var(--farm-line)]/70 pt-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="添加任务..."
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTask(); } }}
              disabled={acting}
              className="farm-input h-11 text-base"
            />
            <Button
              onClick={handleAddTask}
              disabled={acting || !newTask.trim()}
              aria-label="添加新任务"
              className="farm-primary-button h-11 min-h-[44px] w-11 min-w-[44px] flex-shrink-0 p-0"
            >
              {acting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            </Button>
          </div>

          <PriorityPicker
            value={taskPriority}
            onChange={setTaskPriority}
            disabled={acting}
          />
        </div>
      </CardContent>

      {/* Focus Timer Modal */}
      <AnimatePresence>
        {focusTimerOpen && focusSession && (
          <FocusTimer
            key={focusSession.timer.sessionId}
            task={focusSession.task}
            targetLabels={focusSession.targetLabels}
            initialState={focusSession.timer}
            onComplete={handleSaveFocusSession}
            onFinished={() => {
              setFocusTimerOpen(false);
              setFocusSession(null);
            }}
            onClose={() => setFocusTimerOpen(false)}
            onAbort={() => {
              setError(null);
              setFocusTimerOpen(false);
              setFocusSession(null);
            }}
          />
        )}
      </AnimatePresence>
    </Card>
  );
}
