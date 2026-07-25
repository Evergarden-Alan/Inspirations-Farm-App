"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2, Circle, CheckCircle2, CornerDownRight, Check, CalendarCheck2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";
import { insertSubtaskLine, insertIntoDailySection, parseTasks } from "@/lib/github";
import { cascadeToggleAtLine } from "@/lib/cascade";
import type { DailyTask } from "@/lib/github";

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
  const [error, setError] = useState<string | null>(null);
  const [addSubFor, setAddSubFor] = useState<number | null>(null);
  const [subText, setSubText] = useState("");
  const date = getBeijingDateString();

  // ── Fetch ───────────────────────────────────────────
  const fetchJournal = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/daily?date=${date}`);
      const data = await res.json();
      if (data.ok) {
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

    function handleDailyUpdate() {
      fetchJournal();
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

    const oldTasks = state.tasks;
    const toggledTask = oldTasks[index];

    // Operate directly on raw content using line numbers
    const updatedContent = cascadeToggleAtLine(state.content, toggledTask.lineNumber);
    if (updatedContent === state.content) {
      setError("Failed to update task in file");
      return;
    }

    // Re-parse tasks from the updated content for UI state
    const newTasks = parseTasks(updatedContent);

    setActing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/daily", {
        method: "PUT",
        body: JSON.stringify({
          path: state.path,
          sha: state.sha,
          content: updatedContent,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setState({ ...state, content: updatedContent, sha: data.sha, tasks: newTasks });

        // Archive linked inspirations that became completed
        for (let i = 0; i < newTasks.length; i++) {
          const oldDone = oldTasks[i].done;
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
      } else {
        setError(data.error ?? "Failed to update");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Add top-level task ──────────────────────────────
  async function handleAddTask() {
    const text = newTask.trim();
    if (!text || !state?.content || !state.sha || !state.path) return;

    const updatedContent = insertIntoDailySection(
      state.content,
      `- [ ] ${text}`
    );

    setActing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/daily", {
        method: "PUT",
        body: JSON.stringify({ path: state.path, sha: state.sha, content: updatedContent }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewTask("");
        // Optimistic update: apply locally-computed content + re-parsed tasks
        const newTasks = parseTasks(updatedContent);
        setState({
          ...state,
          content: updatedContent,
          sha: data.sha,
          tasks: newTasks,
        });
      } else {
        setError(data.error ?? "Failed to add task");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Add sub-task ────────────────────────────────────
  async function handleAddSub(parentTask: DailyTask) {
    const text = subText.trim();
    if (!text || !state?.content || !state.sha || !state.path) return;

    const updatedContent = insertSubtaskLine(state.content, parentTask, text);

    setActing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/daily", {
        method: "PUT",
        body: JSON.stringify({ path: state.path, sha: state.sha, content: updatedContent }),
      });
      const data = await res.json();
      if (data.ok) {
        setAddSubFor(null);
        setSubText("");
        // Optimistic update: apply locally-computed content + re-parsed tasks
        const newTasks = parseTasks(updatedContent);
        setState({
          ...state,
          content: updatedContent,
          sha: data.sha,
          tasks: newTasks,
        });
      } else {
        setError(data.error ?? "Failed to add subtask");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
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
          <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}

        {/* Task list */}
        {state.tasks && state.tasks.length > 0 ? (
          <ul className="space-y-0.5 -mx-2">
            {state.tasks.map((task, i) => {
              const isSub = task.indentLevel > 0;
              const iconSize = isSub ? "w-5 h-5" : "w-6 h-6";
              const isRollover = task.displayText.includes("🔄");
              const cleanText = task.displayText.replace(/🔄/g, "").trim();

              return (
                <li key={task.id}>
                  <div
                    className="group/task relative"
                    style={{ marginLeft: `${task.indentLevel * 1.5}rem` }}
                  >
                    {/* Main row */}
                    <button
                      onClick={() => handleToggle(i)}
                      disabled={acting}
                      aria-label={task.done ? `标记「${task.displayText}」为未完成` : `标记「${task.displayText}」为已完成`}
                      className="flex min-h-[3.5rem] w-full touch-manipulation items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--farm-green-soft)]/55 active:bg-[var(--farm-green-soft)] disabled:opacity-50"
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
                      <span
                        className={`text-base leading-relaxed transition-all duration-200 min-w-0 ${
                          task.done
                            ? "text-[#a1a49b] line-through"
                            : isSub
                              ? "text-[#59665e]"
                              : "text-[var(--farm-ink)]"
                        }`}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[
                            [rehypeKatex, { strict: false, throwOnError: false, output: "html" }],
                            rehypeSanitize
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
                        {task.sourceIdeaId && (
                          <span className="ml-1.5 align-middle font-mono text-[10px] text-[var(--farm-muted)]">
                            #{task.sourceIdeaId.slice(-6)}
                          </span>
                        )}
                        {isRollover && (
                          <span className="ml-1.5 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                            延期
                          </span>
                        )}
                      </span>

                      {/* Add sub-task button — mobile always visible, desktop hover */}
                      {task.indentLevel < 4 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddSubFor(task.id);
                            setSubText("");
                          }}
                          aria-label={`为「${task.displayText}」添加子任务`}
                          className="ml-auto touch-manipulation rounded-lg p-2 text-[var(--farm-muted)] opacity-50 transition-all hover:bg-white/70 hover:text-[var(--farm-green)] active:opacity-100 md:opacity-0 md:group-hover/task:opacity-100"
                          title="添加子任务"
                        >
                          <CornerDownRight className="w-4 h-4" />
                        </button>
                      )}
                    </button>

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
        <div className="flex items-center gap-3 border-t border-[var(--farm-line)]/70 pt-4">
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
      </CardContent>
    </Card>
  );
}
