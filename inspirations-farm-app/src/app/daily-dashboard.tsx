"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2, Circle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface DailyState {
  exists: boolean;
  path?: string;
  sha?: string;
  content?: string;
  tasks?: { text: string; done: boolean }[];
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DailyDashboard() {
  const [state, setState] = useState<DailyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const date = today();

  // ── Fetch ───────────────────────────────────────────
  const fetchJournal = useCallback(async () => {
    try {
      const res = await fetch(`/api/daily?date=${date}`);
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
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchJournal();
  }, [fetchJournal]);

  // ── Create ──────────────────────────────────────────
  async function handleCreate() {
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchJournal();
      } else {
        setError(data.error ?? "Failed to create");
      }
    } catch {
      setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Toggle task ─────────────────────────────────────
  async function handleToggle(index: number) {
    if (!state?.content || !state.sha || !state.path || !state.tasks) return;

    const tasks = state.tasks;
    const task = tasks[index];
    const oldLine = task.done ? `- [x] ${task.text}` : `- [ ] ${task.text}`;
    const newLine = task.done ? `- [ ] ${task.text}` : `- [x] ${task.text}`;

    const updatedContent = state.content.replace(oldLine, newLine);
    if (updatedContent === state.content) {
      setError("Failed to locate task line in file");
      return;
    }

    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/daily", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: state.path,
          sha: state.sha,
          content: updatedContent,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const newTasks = [...tasks];
        newTasks[index] = { ...task, done: !task.done };
        setState({
          ...state,
          content: updatedContent,
          sha: data.sha,
          tasks: newTasks,
        });
      } else {
        setError(data.error ?? "Failed to update");
      }
    } catch {
      setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Add task ────────────────────────────────────────
  async function handleAddTask() {
    const text = newTask.trim();
    if (!text || !state?.content || !state.sha || !state.path) return;

    const updatedContent = state.content + `\n- [ ] ${text}`;

    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/daily", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: state.path,
          sha: state.sha,
          content: updatedContent,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewTask("");
        setState({
          ...state,
          content: updatedContent,
          sha: data.sha,
          tasks: [...(state.tasks ?? []), { text, done: false }],
        });
      } else {
        setError(data.error ?? "Failed to add task");
      }
    } catch {
      setError("Network error");
    } finally {
      setActing(false);
    }
  }

  function handleAddKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTask();
    }
  }

  // ── Render ──────────────────────────────────────────
  if (loading) {
    return (
      <Card className="bg-white border-slate-200/60 shadow-sm">
        <CardContent className="p-6 text-center text-sm text-slate-400">
          加载日程中...
        </CardContent>
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
          <CardTitle className="text-base font-semibold text-slate-700">
            📅 今日日程
          </CardTitle>
          <span className="text-xs text-slate-400">
            {totalCount > 0 ? `${doneCount}/${totalCount}` : ""}
          </span>
        </div>
        <p className="text-xs text-slate-400">{date}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Task list — full-row touch targets */}
        {state.tasks && state.tasks.length > 0 ? (
          <ul className="space-y-0.5 -mx-2">
            {state.tasks.map((task, i) => (
              <li key={i}>
                <button
                  onClick={() => handleToggle(i)}
                  disabled={acting}
                  className="w-full flex items-center gap-3 py-3 px-3 min-h-[3.5rem] rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors text-left disabled:opacity-50 touch-manipulation"
                >
                  {task.done ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Circle className="w-6 h-6 text-slate-300 flex-shrink-0" />
                  )}
                  <span
                    className={`text-base leading-relaxed transition-all duration-200 ${
                      task.done
                        ? "text-slate-400 line-through"
                        : "text-slate-700"
                    }`}
                  >
                    {task.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">
            还没有任务，添加一个吧
          </p>
        )}

        {/* Add task — input + full-size button */}
        <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
          <Input
            placeholder="添加任务..."
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={handleAddKeyDown}
            disabled={acting}
            className="h-11 text-base border-slate-200 focus-visible:ring-emerald-500"
          />
          <Button
            onClick={handleAddTask}
            disabled={acting || !newTask.trim()}
            className="min-w-[44px] min-h-[44px] h-11 w-11 p-0 flex-shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {acting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Plus className="w-5 h-5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
