"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Trash2, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { getSurvivalLabel } from "@/lib/time";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";

interface Inspiration {
  name: string;
  path: string;
  sha: string;
  id: string;
  title: string;
  createdAt: string;
  status: string;
  priority: string;
  tags: string[];
  content: string;
}

export function InspirationFeed() {
  const [content, setContent] = useState("");
  const [items, setItems] = useState<Inspiration[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [newPriority, setNewPriority] = useState("p2");
  const [newTags, setNewTags] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch list ──────────────────────────────────────
  const fetchItems = useCallback(async () => {
    try {
      const res = await apiFetch("/api/github");
      const data = await res.json();
      if (data.ok) {
        setItems(
          data.items.filter((i: Inspiration) => i.status !== "completed")
        );
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // ── Create inspiration ──────────────────────────────
  async function handlePlant() {
    const text = content.trim();
    if (!text || submitting) return;

    // Preprocess tags: split by comma, trim, filter empty
    const tags = newTags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    setSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch("/api/github", {
        method: "POST",
        body: JSON.stringify({ content: text, priority: newPriority, tags }),
      });
      const data = await res.json();
      if (data.ok) {
        setContent("");
        setNewPriority("p2");
        setNewTags("");
        textareaRef.current?.focus();
        await fetchItems();
      } else {
        setError(data.error ?? "Failed to create");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Mark complete ───────────────────────────────────
  async function handleComplete(item: Inspiration) {
    setActionLoading(item.sha);
    setError(null);
    try {
      const res = await apiFetch("/api/github", {
        method: "PUT",
        body: JSON.stringify({
          path: item.path,
          sha: item.sha,
          status: "completed",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems((prev) => prev.filter((i) => i.sha !== item.sha));
      } else {
        setError(data.error ?? "Failed to update");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActionLoading(null);
    }
  }

  // ── Delete ──────────────────────────────────────────
  async function handleDelete(item: Inspiration) {
    setActionLoading(item.sha);
    setError(null);
    try {
      const res = await apiFetch("/api/github", {
        method: "DELETE",
        body: JSON.stringify({ path: item.path, sha: item.sha }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems((prev) => prev.filter((i) => i.sha !== item.sha));
      } else {
        setError(data.error ?? "Failed to delete");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActionLoading(null);
    }
  }

  // ── Auto-resize textarea ────────────────────────────
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    autoResize(e.target);
  }

  // ── Push to daily ────────────────────────────────────
  const [pushingId, setPushingId] = useState<string | null>(null);

  async function handlePushToDaily(item: Inspiration) {
    setPushingId(item.id);
    setError(null);
    try {
      const res = await apiFetch("/api/daily", {
        method: "POST",
        body: JSON.stringify({
          ideaId: item.id,
          ideaTitle: item.title,
          date: getBeijingDateString(),
        }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Failed to push");
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setPushingId(null);
    }
  }

  // ── Filtering ───────────────────────────────────────
  const allTags = useMemo(
    () => [...new Set(items.flatMap((i) => i.tags || []))].sort(),
    [items]
  );

  const filteredItems = useMemo(() => {
    let result = items;
    if (filterPriority !== "all") {
      result = result.filter((i) => i.priority === filterPriority);
    }
    if (filterTag !== "all") {
      result = result.filter((i) => i.tags?.includes(filterTag));
    }
    return result;
  }, [items, filterPriority, filterTag]);

  // ── Ctrl+Enter ──────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlePlant();
    }
  }

  // ── Render ──────────────────────────────────────────
  return (
    <div className="space-y-5 pb-12">
      {/* Capture Zone */}
      <section className="space-y-3">
        <Textarea
          ref={textareaRef}
          placeholder="此刻有什么灵感..."
          rows={3}
          className="min-h-[64px] resize-none bg-white border-slate-200 focus-visible:ring-emerald-500 text-base"
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />

        {/* Priority + Tags controls */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Priority selector */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-1">优先级</span>
            {["p0", "p1", "p2", "p3"].map((p) => {
              const active = newPriority === p;
              const color =
                p === "p0"
                  ? "bg-red-50 text-red-600 border-red-300"
                  : p === "p1"
                    ? "bg-amber-50 text-amber-600 border-amber-300"
                    : p === "p2"
                      ? "bg-blue-50 text-blue-600 border-blue-300"
                      : "bg-slate-50 text-slate-500 border-slate-300";
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewPriority(p)}
                  disabled={submitting}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    active
                      ? `${color} font-medium`
                      : "border-transparent text-slate-400 hover:bg-slate-100"
                  }`}
                >
                  {p.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* Tags input */}
          <Input
            placeholder="标签, 逗号分隔"
            value={newTags}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTags(e.target.value)}
            disabled={submitting}
            className="h-8 text-xs border-slate-200 focus-visible:ring-emerald-500 sm:max-w-[180px]"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Ctrl + Enter 快捷发送</span>
          <Button
            onClick={handlePlant}
            disabled={submitting || !content.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 px-5 min-h-[44px]"
          >
            {submitting ? "种下中..." : "种下灵感 🌱"}
          </Button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Filter Bar */}
      {items.length > 0 && (
        <section className="space-y-2">
          {/* Priority filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {["all", "p0", "p1", "p2", "p3"].map((p) => {
              const active = filterPriority === p;
              const label = p === "all" ? "全部" : p.toUpperCase();
              const color =
                p === "p0"
                  ? "text-red-600 bg-red-50"
                  : p === "p1"
                    ? "text-amber-600 bg-amber-50"
                    : p === "p2"
                      ? "text-blue-600 bg-blue-50"
                      : p === "p3"
                        ? "text-slate-500 bg-slate-100"
                        : "";
              return (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    active
                      ? `${color} font-medium`
                      : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterTag("all")}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  filterTag === "all"
                    ? "bg-slate-200 text-slate-700 font-medium"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                }`}
              >
                全部
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setFilterTag(tag)}
                  className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                    filterTag === tag
                      ? "bg-slate-200 text-slate-700 font-medium"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Timeline */}
      <section className="space-y-3">
        {loading ? (
          <p className="text-center text-sm text-slate-400 py-12">
            正在加载灵感...
          </p>
        ) : filteredItems.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-12">
            {items.length === 0 ? "还没有灵感，种下第一个吧 🌱" : "没有匹配的灵感"}
          </p>
        ) : (
          filteredItems.map((item) => (
            <InspirationCard
              key={item.sha}
              item={item}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onPush={handlePushToDaily}
              disabled={actionLoading === item.sha}
              pushing={pushingId === item.id}
            />
          ))
        )}
      </section>
    </div>
  );
}

// ── Single Card ────────────────────────────────────────
function InspirationCard({
  item,
  onComplete,
  onDelete,
  onPush,
  disabled,
  pushing,
}: {
  item: Inspiration;
  onComplete: (item: Inspiration) => void;
  onDelete: (item: Inspiration) => void;
  onPush: (item: Inspiration) => void;
  disabled: boolean;
  pushing: boolean;
}) {
  const survival = getSurvivalLabel(item.createdAt);

  // Priority → left border class
  const priorityBorder: Record<string, string> = {
    p0: "border-l-red-500",
    p1: "border-l-amber-500",
    p2: "border-l-blue-400",
    p3: "border-l-slate-300",
  };
  const borderColor = priorityBorder[item.priority] || priorityBorder.p2;

  return (
    <Card
      className={`bg-white border-slate-200/60 shadow-sm group overflow-hidden border-l-4 ${borderColor}`}
    >
      <CardContent className="px-4 pt-4 pb-2 space-y-2.5">
        {/* Title + badge */}
        <div className="flex items-start gap-2">
          <span className="text-xs text-slate-400 font-mono flex-shrink-0 mt-0.5">
            {item.id.slice(0, 10)}
          </span>
          <p className="text-sm font-medium text-slate-800 leading-snug">
            {item.title}
          </p>
        </div>

        {/* Content preview */}
        {item.content && (
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
            {item.content}
          </p>
        )}

        {/* Tags */}
        {item.tags && item.tags.filter(Boolean).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.filter(Boolean).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer: survival time + actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <span className="text-xs text-slate-400">{survival}</span>

          <div className="flex items-center gap-1">
            {/* Push to daily */}
            <button
              onClick={() => onPush(item)}
              disabled={disabled || pushing}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-all disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
              title="推送到今日"
            >
              <Send className={`w-4 h-4 ${pushing ? "animate-pulse" : ""}`} />
            </button>

            {/* Complete */}
            <button
              onClick={() => onComplete(item)}
              disabled={disabled}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-all disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
              title="完成"
            >
              <Check className="w-5 h-5" />
            </button>

            {/* Delete */}
            <button
              onClick={() => onDelete(item)}
              disabled={disabled}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-all disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
              title="删除"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
