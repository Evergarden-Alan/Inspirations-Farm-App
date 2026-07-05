"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Send, MessageSquarePlus, Loader2, ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSurvivalLabel, getSurvivalColor } from "@/lib/time";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";

// ── Shared prose class string ──────────────────────────────
const PROSE_CN =
  "prose prose-sm prose-slate max-w-none break-words " +
  "prose-p:my-0.5 prose-p:leading-relaxed prose-p:text-xs " +
  "prose-ul:my-0.5 prose-ol:my-0.5 " +
  "prose-li:my-1 prose-li:text-xs prose-li:leading-relaxed " +
  "prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline " +
  "prose-code:text-[11px] prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none " +
  "prose-pre:text-xs prose-pre:my-1 " +
  "prose-strong:text-slate-700 prose-strong:font-semibold " +
  "prose-headings:my-1 prose-headings:text-sm prose-headings:font-medium " +
  "prose-hr:my-1 " +
  "prose-blockquote:my-1 prose-blockquote:text-xs " +
  "prose-table:text-xs prose-th:text-xs prose-td:text-xs";

const PATCH_PROSE_CN =
  "text-xs text-slate-500 leading-relaxed prose prose-sm prose-slate max-w-none break-words " +
  "prose-p:my-0 prose-p:text-xs prose-p:leading-relaxed " +
  "prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline " +
  "prose-code:text-[11px] prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none " +
  "prose-strong:text-slate-600 prose-strong:font-semibold " +
  "prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0.5 prose-li:text-xs " +
  "prose-hr:my-1 " +
  "prose-blockquote:my-1 prose-blockquote:text-xs";

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
  patches?: { time: string; content: string }[];
}

interface InspirationFeedProps {
  initialItems?: Inspiration[];
}

export function InspirationFeed({ initialItems }: InspirationFeedProps = {}) {
  const [content, setContent] = useState("");
  const [items, setItems] = useState<Inspiration[]>([]);
  const [loading, setLoading] = useState(!initialItems);
  const seeded = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [newPriority, setNewPriority] = useState("p2");
  const [newTags, setNewTags] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

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
    // Seed from server-provided data on first mount
    if (initialItems && !seeded.current) {
      seeded.current = true;
      setItems(initialItems.filter((i: Inspiration) => i.status !== "completed"));
      setLoading(false);
    } else if (!initialItems) {
      fetchItems();
    }

    // Listen for inspiration updates from other components (e.g. task archive)
    function handleUpdate() {
      fetchItems();
    }
    window.addEventListener("inspiration:updated", handleUpdate);
    return () => window.removeEventListener("inspiration:updated", handleUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        router.refresh();
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

  // ── Delete with undo ────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<{
    item: Inspiration;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  async function execDelete(item: Inspiration) {
    try {
      const res = await apiFetch("/api/github", {
        method: "DELETE",
        body: JSON.stringify({ path: item.path, sha: item.sha }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Failed to delete");
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
      // Re-add on failure
      setItems((prev) => [item, ...prev]);
    }
  }

  function handleDelete(item: Inspiration) {
    // Optimistic remove immediately
    setItems((prev) => prev.filter((i) => i.sha !== item.sha));
    setError(null);

    // Clear any existing pending delete first
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      execDelete(pendingDelete.item);
    }

    const timeoutId = setTimeout(() => {
      setPendingDelete(null);
      execDelete(item);
    }, 3500);

    setPendingDelete({ item, timeoutId });
  }

  function handleUndoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timeoutId);
    // Re-insert at original position is hard; prepend is acceptable
    setItems((prev) => [pendingDelete.item, ...prev]);
    setPendingDelete(null);
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
  const [pushFeedback, setPushFeedback] = useState<{
    id: string;
    type: "success" | "duplicate";
  } | null>(null);

  // ── Append patch ─────────────────────────────────────
  const [appendingId, setAppendingId] = useState<string | null>(null);
  const [appendText, setAppendText] = useState("");

  async function handlePushToDaily(item: Inspiration) {
    setPushingId(item.id);
    setError(null);
    setPushFeedback(null);
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
      if (data.ok) {
        setPushFeedback({ id: item.id, type: "success" });
        window.dispatchEvent(new CustomEvent("daily:updated"));
        router.refresh();
      } else {
        if (data.duplicate) {
          setPushFeedback({ id: item.id, type: "duplicate" });
        } else {
          setError(data.error ?? "Failed to push");
        }
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setPushingId(null);
      setTimeout(() => setPushFeedback(null), 2500);
    }
  }

  // ── Append patch ─────────────────────────────────────
  async function handleAppend(item: Inspiration) {
    const text = appendText.trim();
    if (!text) return;

    setActionLoading(item.sha);
    setError(null);

    try {
      const res = await apiFetch("/api/github", {
        method: "PATCH",
        body: JSON.stringify({
          path: item.path,
          content: text,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAppendText("");
        setAppendingId(null);

        // Optimistic update: apply the server-returned patch immediately
        // (avoids GitHub eventual-consistency lag from a re-fetch)
        if (data.patch) {
          setItems((prev) =>
            prev.map((i) =>
              i.path === item.path
                ? {
                    ...i,
                    patches: [...(i.patches || []), data.patch],
                    sha: data.sha,
                  }
                : i
            )
          );
        }
        router.refresh();
      } else {
        setError(data.error ?? "Failed to append patch");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActionLoading(null);
    }
  }

  function handleAppendToggle(item: Inspiration | null) {
    setAppendingId(item?.id ?? null);
    setAppendText("");
  }

  // ── Filtering ───────────────────────────────────────
  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((i) => {
      counts[i.priority] = (counts[i.priority] || 0) + 1;
    });
    return counts;
  }, [items]);

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

  // ── Error auto-dismiss (4s) ──────────────────────────
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(id);
  }, [error]);

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
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-700">🌱 灵感池</h2>
        {items.length > 0 && (
          <span className="text-xs text-slate-400 tabular-nums">
            {filteredItems.length !== items.length
              ? `${filteredItems.length} / ${items.length}`
              : `${items.length} 条`}
          </span>
        )}
      </div>

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
                  aria-pressed={active}
                  aria-label={`优先级 ${p.toUpperCase()}`}
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
        <section className="space-y-1.5">
          {/* Priority filter — scrollable on mobile */}
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5 -mx-1 px-1 flex-nowrap sm:flex-wrap">
            {["all", "p0", "p1", "p2", "p3"].map((p) => {
              const active = filterPriority === p;
              const label = p === "all" ? "全部" : p.toUpperCase();
              const count = p === "all" ? items.length : (priorityCounts[p] ?? 0);
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
              // Hide pills with zero items (except "all")
              if (p !== "all" && count === 0) return null;
              return (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p)}
                  aria-pressed={active}
                  aria-label={p === "all" ? "全部优先级" : `优先级 ${p.toUpperCase()}`}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-full transition-colors min-h-[32px] touch-manipulation ${
                    active
                      ? `${color} font-medium`
                      : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                  <span className={`text-[10px] tabular-nums ${active ? "opacity-70" : "opacity-50"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tag filter — scrollable on mobile */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5 -mx-1 px-1 flex-nowrap sm:flex-wrap">
              <button
                onClick={() => setFilterTag("all")}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors min-h-[32px] touch-manipulation shrink-0 ${
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
                  className={`px-2 py-0.5 text-xs rounded-full transition-colors min-h-[32px] touch-manipulation shrink-0 ${
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

      {/* Undo delete toast */}
      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-800 text-white text-sm rounded-lg"
          >
            <span className="text-slate-300 text-xs">已删除「{pendingDelete.item.title}」</span>
            <button
              onClick={handleUndoDelete}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium shrink-0"
            >
              <Undo2 className="w-3.5 h-3.5" />
              撤销
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline */}
      <section className="space-y-3">
        {loading ? (
          <p className="text-center text-sm text-slate-400 py-12">
            正在加载灵感...
          </p>
        ) : filteredItems.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-sm text-slate-400 py-12"
          >
            {items.length === 0 ? "还没有灵感，种下第一个吧 🌱" : "没有匹配的灵感"}
          </motion.p>
        ) : (
          <AnimatePresence initial={false}>
            {filteredItems.map((item) => (
              <motion.div
                key={item.sha}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -16, scale: 0.97 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <InspirationCard
                  item={item}
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                  onPush={handlePushToDaily}
                  onAppend={handleAppend}
                  onAppendToggle={handleAppendToggle}
                  onAppendTextChange={setAppendText}
                  disabled={actionLoading === item.sha}
                  pushing={pushingId === item.id}
                  pushFeedback={
                    pushFeedback?.id === item.id ? pushFeedback.type : null
                  }
                  appending={appendingId === item.id}
                  appendText={appendText}
                />
              </motion.div>
            ))}
          </AnimatePresence>
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
  onAppend,
  onAppendToggle,
  onAppendTextChange,
  disabled,
  pushing,
  pushFeedback,
  appending,
  appendText,
}: {
  item: Inspiration;
  onComplete: (item: Inspiration) => void;
  onDelete: (item: Inspiration) => void;
  onPush: (item: Inspiration) => void;
  onAppend: (item: Inspiration) => void;
  onAppendToggle: (item: Inspiration | null) => void;
  onAppendTextChange: (text: string) => void;
  disabled: boolean;
  pushing: boolean;
  pushFeedback: "success" | "duplicate" | null;
  appending: boolean;
  appendText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const survival = getSurvivalLabel(item.createdAt);
  const survivalColor = getSurvivalColor(item.createdAt);

  // Priority → left border class
  const priorityBorder: Record<string, string> = {
    p0: "border-l-red-500",
    p1: "border-l-amber-500",
    p2: "border-l-blue-400",
    p3: "border-l-slate-300",
  };
  const borderColor = priorityBorder[item.priority] || priorityBorder.p2;

  function handleAppendKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onAppend(item);
    }
  }

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

        {/* Content preview with expand/collapse */}
        {item.content && (
          <div>
            <div className={`${PROSE_CN} ${expanded ? "" : "line-clamp-2"}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: "html" }]]}
              >
                {item.content}
              </ReactMarkdown>
            </div>
            {/* Only show toggle if content is likely clipped */}
            {item.content.length > 80 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors min-h-[32px] px-1 -mx-1 touch-manipulation"
              >
                {expanded ? (
                  <><ChevronUp className="w-3 h-3" />收起</>
                ) : (
                  <><ChevronDown className="w-3 h-3" />展开</>
                )}
              </button>
            )}
          </div>
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

        {/* Patches timeline */}
        {item.patches && item.patches.length > 0 && (
          <div className="space-y-2">
            <div className="border-t border-slate-100 my-2" />
            {item.patches.map((patch, idx) => (
              <div
                key={idx}
                className="pl-2.5 border-l-2 border-slate-200 space-y-0.5"
              >
                <span className="text-[11px] text-slate-400 font-mono">
                  {patch.time}
                </span>
                <div className={PATCH_PROSE_CN}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: "html" }]]}
                  >
                    {patch.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Append patch textarea — animated expand */}
        <AnimatePresence>
          {appending && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
              className="space-y-2 pt-0.5"
            >
              <textarea
                autoFocus
                placeholder="补充一下这个想法..."
                value={appendText}
                onChange={(e) => onAppendTextChange(e.target.value)}
                onKeyDown={handleAppendKeyDown}
                disabled={disabled}
                rows={2}
                className="w-full text-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 placeholder:text-slate-400 disabled:opacity-50"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => onAppendToggle(null)}
                  disabled={disabled}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors min-w-[44px] min-h-[44px] touch-manipulation"
                >
                  取消
                </button>
                <button
                  onClick={() => onAppend(item)}
                  disabled={disabled || !appendText.trim()}
                  className="px-3 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] touch-manipulation"
                >
                  {disabled ? "追加中..." : "发送"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer: survival time + actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${survivalColor}`}>{survival}</span>
            <AnimatePresence>
              {pushFeedback && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.85, x: -4 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  className={`text-xs font-medium ${
                    pushFeedback === "success"
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {pushFeedback === "success" ? "✓ 已发送" : "⚠ 已在日程中"}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-1">
            {/* Push to daily */}
            <button
              onClick={() => onPush(item)}
              disabled={disabled || pushing}
              className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all md:opacity-0 md:group-hover:opacity-100 touch-manipulation ${
                pushing
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100"
              }`}
              title="推送到今日"
            >
              {pushing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>

            {/* Append patch */}
            <button
              onClick={() =>
                appending ? onAppendToggle(null) : onAppendToggle(item)
              }
              disabled={disabled}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-all disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
              title="追加记录"
            >
              <MessageSquarePlus className="w-4 h-4" />
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
