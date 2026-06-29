"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Loader2, Circle, CheckCircle2, CornerDownRight, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
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
  const [state, setState] = useState<DailyState | null>(null);
  const [loading, setLoading] = useState(!initialDaily);
  const seeded = useRef(false);
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
    // Seed from server-provided data on first mount
    if (initialDaily && !seeded.current) {
      seeded.current = true;
      if (initialDaily.exists) {
        setState({
          exists: true,
          path: initialDaily.path,
          sha: initialDaily.sha,
          content: initialDaily.content,
          tasks: initialDaily.tasks ?? [],
        });
      } else {
        setState({ exists: false });
      }
      setLoading(false);
    } else if (!initialDaily) {
      fetchJournal();
    }

    function handleDailyUpdate() {
      fetchJournal();
    }
    window.addEventListener("daily:updated", handleDailyUpdate);
    return () => window.removeEventListener("daily:updated", handleDailyUpdate);
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
      <Card className="bg-white border-slate-200/60 shadow-sm">
        <CardContent className="p-6 text-center text-sm text-slate-400">加载日程中...</CardContent>
      </Card>
    );
  }

  if (!state?.exists) {
    return (
      <Card className="bg-white border-slate-200/60 shadow-sm">
        <CardContent className="p-6 space-y-4 text-center">
          <p className="text-sm text-slate-500">📅 {date} 还没有日程</p>
          <Button
            onClick={handleCreate}
            disabled={acting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
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
    <Card className="bg-white border-slate-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-700">📅 今日日程</CardTitle>
          <span className="text-xs text-slate-400">
            {totalCount > 0 ? `${doneCount}/${totalCount}` : ""}
          </span>
        </div>
        <p className="text-xs text-slate-400">{date}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
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
                      className="w-full flex items-center gap-3 py-3 px-3 min-h-[3.5rem] rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors text-left disabled:opacity-50 touch-manipulation"
                    >
                      {task.done ? (
                        <CheckCircle2 className={`${iconSize} text-emerald-500 flex-shrink-0`} />
                      ) : (
                        <Circle className={`${iconSize} text-slate-300 flex-shrink-0`} />
                      )}
                      <span
                        className={`text-base leading-relaxed transition-all duration-200 min-w-0 ${
                          task.done
                            ? "text-slate-300 line-through"
                            : isSub
                              ? "text-slate-600"
                              : "text-slate-700"
                        }`}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: "html" }]]}
                          components={{
                            p: ({ ...props}) => (
                              <span className="inline" {...props} />
                            ),
                            a: ({ ...props}) => (
                              <a
                                className="text-blue-500 hover:underline"
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
                          <span className="ml-1.5 text-[10px] text-slate-400 font-mono align-middle">
                            #{task.sourceIdeaId.slice(-6)}
                          </span>
                        )}
                        {isRollover && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-sm font-medium">
                            延期
                          </span>
                        )}
                      </span>

                      {/* Add sub-task button — mobile always visible, desktop hover */}
                      {task.indentLevel < 4 && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddSubFor(task.id);
                            setSubText("");
                          }}
                          className="ml-auto opacity-40 md:opacity-0 md:group-hover/task:opacity-100 active:opacity-100 transition-opacity p-2 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 touch-manipulation"
                          title="添加子任务"
                        >
                          <CornerDownRight className="w-4 h-4" />
                        </span>
                      )}
                    </button>

                    {/* Inline sub-task input */}
                    {addSubFor === task.id && (
                      <div
                        className="flex items-center gap-2 py-1 px-3"
                        style={{ marginLeft: `${1.5}rem` }}
                      >
                        <CornerDownRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
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
                          className="h-9 text-sm border-slate-200 focus-visible:ring-emerald-500"
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleAddSub(task)}
                          disabled={acting || !subText.trim()}
                          className="h-8 w-8 flex-shrink-0 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          title="确认"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">还没有任务，添加一个吧</p>
        )}

        {/* Add top-level task */}
        <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
          <Input
            placeholder="添加任务..."
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTask(); } }}
            disabled={acting}
            className="h-11 text-base border-slate-200 focus-visible:ring-emerald-500"
          />
          <Button
            onClick={handleAddTask}
            disabled={acting || !newTask.trim()}
            className="min-w-[44px] min-h-[44px] h-11 w-11 p-0 flex-shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {acting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
