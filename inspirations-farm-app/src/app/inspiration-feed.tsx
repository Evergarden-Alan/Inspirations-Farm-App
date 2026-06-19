"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSurvivalLabel } from "@/lib/time";

interface Inspiration {
  name: string;
  path: string;
  sha: string;
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
      const res = await fetch("/api/github");
      const data = await res.json();
      if (data.ok) {
        setItems(
          data.items.filter((i: Inspiration) => i.status !== "completed")
        );
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch {
      setError("Network error");
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
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Mark complete ───────────────────────────────────
  async function handleComplete(item: Inspiration) {
    setActionLoading(item.sha);
    setError(null);
    try {
      const res = await fetch("/api/github", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(null);
    }
  }

  // ── Delete ──────────────────────────────────────────
  async function handleDelete(item: Inspiration) {
    setActionLoading(item.sha);
    setError(null);
    try {
      const res = await fetch("/api/github", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, sha: item.sha }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems((prev) => prev.filter((i) => i.sha !== item.sha));
      } else {
        setError(data.error ?? "Failed to delete");
      }
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(null);
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
          className="min-h-[100px] resize-none bg-white border-slate-200 focus-visible:ring-emerald-500 text-base"
          value={content}
          onChange={(e) => setContent(e.target.value)}
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
              disabled={actionLoading === item.sha}
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
  disabled,
}: {
  item: Inspiration;
  onComplete: (item: Inspiration) => void;
  onDelete: (item: Inspiration) => void;
  disabled: boolean;
}) {
  const survival = getSurvivalLabel(item.createdAt);

  return (
    <Card className="bg-white border-slate-200/60 shadow-sm group">
      <CardContent className="p-4 space-y-3">
        {/* Survival time */}
        <span className="text-xs text-slate-400 tracking-wide">{survival}</span>

        {/* Content */}
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {item.content}
        </p>

        {/* Action bar — bottom-right, responsive visibility */}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-50">
          {/* Complete */}
          <button
            onClick={() => onComplete(item)}
            disabled={disabled}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-slate-400 opacity-60 hover:text-emerald-600 hover:bg-emerald-50 hover:opacity-100 active:bg-emerald-100 transition-all disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
            title="完成"
          >
            <Check className="w-5 h-5" />
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(item)}
            disabled={disabled}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-slate-400 opacity-60 hover:text-red-500 hover:bg-red-50 hover:opacity-100 active:bg-red-100 transition-all disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
            title="删除"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
