"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2, Circle, CheckCircle2, CornerDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";
import { insertSubtaskLine, insertIntoDailySection } from "@/lib/github";
import { cascadeToggle, applyTaskChanges } from "@/lib/cascade";
import type { DailyTask } from "@/lib/github";

interface DailyState {
  exists: boolean;
  path?: string;
  sha?: string;
  content?: string;
  tasks?: DailyTask[];
}

export function DailyDashboard() {
  const [state, setState] = useState<DailyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addSubFor, setAddSubFor] = useState<number | null>(null); // task id
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
    fetchJournal();
  }, [fetchJournal]);

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
    const newTasks = cascadeToggle(oldTasks, index);

    // Build updated markdown from the diff
    const updatedContent = applyTaskChanges(state.content, oldTasks, newTasks);
    if (updatedContent === state.content && oldTasks[index].done === newTasks[index].done) {
      setError("Failed to update task in file");
      return;
    }

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
        await fetchJournal();
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
        await fetchJournal();
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
                        className={`text-base leading-relaxed transition-all duration-200 ${
                          task.done
                            ? "text-slate-300 line-through"
                            : isSub
                              ? "text-slate-600"
                              : "text-slate-700"
                        }`}
                      >
                        {task.text}
                      </span>

                      {/* Add sub-task button — visible on hover */}
                      {task.indentLevel < 4 && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddSubFor(task.id);
                            setSubText("");
                          }}
                          className="ml-auto opacity-0 group-hover/task:opacity-100 transition-opacity p-1.5 rounded-md text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 touch-manipulation"
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
                          disabled={acting}
                          className="h-9 text-sm border-slate-200 focus-visible:ring-emerald-500"
                          autoFocus
                        />
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
