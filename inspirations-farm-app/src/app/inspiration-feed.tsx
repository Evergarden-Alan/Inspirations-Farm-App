"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Trash2, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
  content: string;
}

export function InspirationFeed() {
  const [content, setContent] = useState("");
  const [items, setItems] = useState<Inspiration[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
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

    setSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch("/api/github", {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (data.ok) {
        setContent("");
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

      {/* Timeline */}
      <section className="space-y-3">
        {loading ? (
          <p className="text-center text-sm text-slate-400 py-12">
            正在加载灵感...
          </p>
        ) : items.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-12">
            还没有灵感，种下第一个吧 🌱
          </p>
        ) : (
          items.map((item) => (
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

  return (
    <Card className="bg-white border-slate-200/60 shadow-sm group">
      <CardContent className="px-4 pt-4 pb-2 space-y-2.5">
        {/* Title + badge */}
        <div className="flex items-start gap-2">
          <span className="text-xs text-slate-400 font-mono flex-shrink-0 mt-0.5">
            {item.id}
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
