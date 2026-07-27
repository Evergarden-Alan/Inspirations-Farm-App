"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Send, MessageSquarePlus, Loader2, ChevronDown, ChevronUp, Undo2, MoreHorizontal, Sprout } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { getSurvivalLabel, getSurvivalColor } from "@/lib/time";
import { apiFetch, AuthError } from "@/lib/api";
import { toast } from "@/app/toast";
import { getBeijingDateString } from "@/lib/beijing-time";
import { MarkdownRenderer } from "@/components/markdown-renderer";

// ── Shared prose class string ──────────────────────────────
const PROSE_CN =
  "prose prose-sm prose-slate max-w-none break-words text-[#526057] " +
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
  "text-xs text-[#667168] leading-relaxed prose prose-sm prose-slate max-w-none break-words " +
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
  const [items, setItems] = useState<Inspiration[]>(() =>
    initialItems?.filter((item) => item.status !== "completed") ?? []
  );
  const [loading, setLoading] = useState(!initialItems);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
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
    const initialFetchTimer = !initialItems
      ? setTimeout(() => void fetchItems(), 0)
      : undefined;

    // Listen for inspiration updates from other components (e.g. task archive)
    function handleUpdate() {
      fetchItems();
    }
    window.addEventListener("inspiration:updated", handleUpdate);
    return () => {
      if (initialFetchTimer) clearTimeout(initialFetchTimer);
      window.removeEventListener("inspiration:updated", handleUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Create inspiration ──────────────────────────────
  async function handlePlant() {
    const text = content.trim();
    if (!text || submitting) return;

    // Input validation: enforce reasonable limits to prevent abuse
    if (text.length > 10000) {
      setError("内容过长（最多 10,000 字符）");
      return;
    }

    // Preprocess tags: split by comma, trim, filter empty
    const tags = newTags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    // Validate tag count and length
    if (tags.length > 10) {
      setError("标签过多（最多 10 个）");
      return;
    }
    if (tags.some((t) => t.length > 50)) {
      setError("标签过长（每个最多 50 字符）");
      return;
    }

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
        toast.success("灵感已完成 ✓");
      } else {
        toast.error(data.error ?? "Failed to update");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) toast.error("Network error");
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

  async function handleDelete(item: Inspiration) {
    // Optimistic remove immediately
    setItems((prev) => prev.filter((i) => i.sha !== item.sha));
    setError(null);

    // Clear any existing pending delete first and await its execution to avoid
    // race condition where first delete fails but second succeeds, leaving
    // inconsistent UI state
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      await execDelete(pendingDelete.item);
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

  // Clean up pending delete timer on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (pendingDelete) {
        clearTimeout(pendingDelete.timeoutId);
      }
    };
  }, [pendingDelete]);

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

  // ── Append patch ─────────────────────────────────────
  const [appendingId, setAppendingId] = useState<string | null>(null);
  const [appendText, setAppendText] = useState("");

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
      if (data.ok) {
        toast.success("已推送到今日日程 ✓");
        window.dispatchEvent(new CustomEvent("daily:updated"));
        router.refresh();
      } else {
        if (data.duplicate) {
          toast.info("此灵感已在今日日程中");
        } else {
          setError(data.error ?? "Failed to push");
        }
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setPushingId(null);
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
    // 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((i) => {
        // 标题匹配
        if (i.title.toLowerCase().includes(q)) return true;
        // 内容匹配
        if (i.content.toLowerCase().includes(q)) return true;
        // 标签匹配
        if (i.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
        // 追加记录匹配
        if (i.patches?.some((p) => p.content.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return result;
  }, [items, filterPriority, filterTag, searchQuery]);

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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="farm-section-icon">
            <Sprout className="size-5" strokeWidth={1.8} />
          </div>
          <div>
            <p className="farm-kicker mb-0.5">SEED BANK</p>
            <h2 className="farm-display text-2xl font-semibold text-[var(--farm-ink)]">灵感种子库</h2>
          </div>
        </div>
        {items.length > 0 && (
          <span className="rounded-full border border-[var(--farm-line)] bg-[var(--farm-paper)]/70 px-3 py-1 text-xs tabular-nums text-[var(--farm-muted)]">
            {filteredItems.length !== items.length
              ? `${filteredItems.length} / ${items.length}`
              : `${items.length} 条`}
          </span>
        )}
      </div>

      {/* Capture Zone — desktop only; mobile uses FAB */}
      <section className="farm-capture-zone hidden space-y-3 lg:block">
        <div className="flex items-center justify-between">
          <div>
            <p className="farm-display text-lg font-semibold text-[var(--farm-ink)]">种下一个新念头</p>
            <p className="text-xs text-[var(--farm-muted)]">不用完整，先让它有一个落脚处。</p>
          </div>
          <Sprout className="size-5 text-[var(--farm-green)]/70" strokeWidth={1.6} />
        </div>
        <Textarea
          ref={textareaRef}
          placeholder="此刻有什么灵感..."
          rows={3}
          className="farm-input min-h-[92px] resize-none rounded-2xl text-base leading-relaxed"
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />

        {/* Priority + Tags controls */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Priority selector */}
          <div className="flex items-center gap-1">
            <span className="mr-1 text-[10px] font-semibold tracking-[0.12em] text-[var(--farm-muted)]">优先级</span>
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
                      : "border-transparent text-[var(--farm-muted)] hover:bg-[var(--farm-paper-deep)]"
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
            className="farm-input h-9 text-xs sm:max-w-[190px]"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-wide text-[var(--farm-muted)]">CTRL + ENTER · 快捷种下</span>
          <Button
            onClick={handlePlant}
            disabled={submitting || !content.trim()}
            className="farm-primary-button min-h-[44px] gap-1.5 px-5"
          >
            {!submitting && <Sprout className="size-4" />}
            {submitting ? "种下中..." : "种下灵感"}
          </Button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Search Bar */}
      {items.length > 0 && (
        <div className="relative">
          <Input
            type="search"
            placeholder="搜索标题、内容、标签..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="farm-input h-11 pl-4 pr-10 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--farm-muted)] hover:text-[var(--farm-ink)] transition-colors"
              aria-label="清空搜索"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Filter Bar */}
      {items.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-[var(--farm-line)]/80 bg-[var(--farm-paper)]/45 p-2.5">
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
                      : "text-[var(--farm-muted)] hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)]"
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
                    ? "bg-[var(--farm-green)] text-white font-medium"
                    : "text-[var(--farm-muted)] hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)]"
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
                      ? "bg-[var(--farm-green)] text-white font-medium"
                      : "bg-[var(--farm-paper-deep)] text-[var(--farm-muted)] hover:text-[var(--farm-ink)]"
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
            className="flex items-center justify-between gap-3 rounded-xl bg-[var(--farm-ink)] px-3 py-2 text-sm text-white shadow-lg"
          >
            <span className="text-xs text-white/70">已删除「{pendingDelete.item.title}」</span>
            <button
              onClick={handleUndoDelete}
              className="flex shrink-0 items-center gap-1 text-xs font-medium text-[#b8d6bc] hover:text-white"
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
          <p className="py-12 text-center text-sm text-[var(--farm-muted)]">
            正在翻找灵感种子...
          </p>
        ) : filteredItems.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-12 text-center text-sm text-[var(--farm-muted)]"
          >
            {items.length === 0 ? "种子库还是空的，种下第一个念头吧。" : "没有匹配的灵感"}
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
  appending: boolean;
  appendText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [patchesExpanded, setPatchesExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const survival = getSurvivalLabel(item.createdAt);
  const survivalColor = getSurvivalColor(item.createdAt);

  // Priority → left border class
  const priorityBorder: Record<string, string> = {
    p0: "farm-seed-p0",
    p1: "farm-seed-p1",
    p2: "farm-seed-p2",
    p3: "farm-seed-p3",
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
      className={`farm-panel farm-seed-card group overflow-hidden transition-transform duration-200 hover:-translate-y-0.5 ${borderColor}`}
    >
      <CardContent className="space-y-3 px-5 pb-3 pt-5">
        {/* Title */}
        <div className="flex items-start justify-between gap-3">
          <p className="farm-display text-base font-semibold leading-snug text-[var(--farm-ink)]">
            {item.title}
          </p>
          <span className="rounded-full bg-[var(--farm-paper-deep)] px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-[var(--farm-muted)]">
            {item.priority?.toUpperCase() || "P2"}
          </span>
        </div>

        {/* Content preview with expand/collapse */}
        {item.content && (
          <div>
            <div className={`${PROSE_CN} ${expanded ? "" : "line-clamp-2"}`}>
              <MarkdownRenderer content={item.content} />
            </div>
            {/* Only show toggle if content is likely clipped */}
            {item.content.length > 80 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="-mx-1 mt-0.5 flex min-h-[32px] touch-manipulation items-center gap-0.5 px-1 text-[11px] text-[var(--farm-muted)] transition-colors hover:text-[var(--farm-ink)]"
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
                className="rounded-full bg-[var(--farm-green-soft)]/70 px-2 py-0.5 text-xs text-[var(--farm-green)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Patches timeline — collapsible */}
        {item.patches && item.patches.length > 0 && (
          <div>
            <div className="my-2 border-t border-[var(--farm-line)]/70" />
            <button
              onClick={() => setPatchesExpanded((v) => !v)}
              className="flex min-h-[28px] touch-manipulation items-center gap-1 text-[11px] text-[var(--farm-muted)] transition-colors hover:text-[var(--farm-ink)]"
            >
              {patchesExpanded
                ? <><ChevronUp className="w-3 h-3" />{item.patches.length}条更新</>
                : <><ChevronDown className="w-3 h-3" />{item.patches.length}条更新</>}
            </button>
            <AnimatePresence>
              {patchesExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: "easeInOut" }}
                  style={{ overflow: "hidden" }}
                  className="space-y-2 pt-1"
                >
                  {item.patches.map((patch, idx) => (
                    <div
                      key={idx}
                      className="space-y-0.5 border-l-2 border-[var(--farm-line)] pl-2.5"
                    >
                      <span className="font-mono text-[11px] text-[var(--farm-muted)]">
                        {patch.time}
                      </span>
                      <div className={PATCH_PROSE_CN}>
                        <MarkdownRenderer content={patch.content} />
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
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
                className="farm-input w-full resize-none rounded-xl border px-3 py-2 text-sm placeholder:text-[var(--farm-muted)] disabled:opacity-50"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => onAppendToggle(null)}
                  disabled={disabled}
                  className="min-h-[44px] min-w-[44px] touch-manipulation rounded-lg px-3 py-1.5 text-xs text-[var(--farm-muted)] transition-colors hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)]"
                >
                  取消
                </button>
                <button
                  onClick={() => onAppend(item)}
                  disabled={disabled || !appendText.trim()}
                  className="farm-primary-button min-h-[44px] min-w-[44px] touch-manipulation px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
                >
                  {disabled ? "追加中..." : "发送"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer: survival time + actions */}
        <div className="flex items-center justify-between border-t border-[var(--farm-line)]/70 pt-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${survivalColor}`}>{survival}</span>
          </div>

          <div className="flex items-center gap-1">
            {/* Push to daily */}
            <button
              onClick={() => onPush(item)}
              disabled={disabled || pushing}
              className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all md:opacity-0 md:group-hover:opacity-100 touch-manipulation ${
                pushing
                  ? "cursor-not-allowed bg-[var(--farm-paper-deep)] text-[var(--farm-muted)]"
                  : "text-[var(--farm-muted)] hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)] active:bg-[var(--farm-green-soft)]"
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
              className="flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg text-[var(--farm-muted)] transition-all hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)] active:bg-[var(--farm-green-soft)] disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100"
              title="追加记录"
            >
              <MessageSquarePlus className="w-4 h-4" />
            </button>

            {/* Complete */}
            <button
              onClick={() => onComplete(item)}
              disabled={disabled}
              className="flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg text-[var(--farm-muted)] transition-all hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)] active:bg-[var(--farm-green-soft)] disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100"
              title="完成"
            >
              <Check className="w-5 h-5" />
            </button>

            {/* Overflow menu — delete lives here */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                disabled={disabled}
                className="flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg text-[var(--farm-muted)] transition-all hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)] disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100"
                title="更多操作"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <>
                    {/* Click-outside backdrop */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92, y: -4 }}
                      transition={{ duration: 0.12 }}
                      role="menu"
                      className="absolute bottom-full right-0 z-20 mb-1 min-w-[110px] rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper)] py-1 shadow-lg"
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete(item);
                        }}
                        disabled={disabled}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors touch-manipulation"
                      >
                        <Trash2 className="w-4 h-4" />
                        删除
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
