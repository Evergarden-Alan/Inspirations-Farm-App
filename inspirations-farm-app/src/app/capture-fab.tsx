"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sprout, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch, AuthError } from "@/lib/api";
import { toast } from "@/app/toast";
import { PriorityPicker, type Priority } from "@/components/priority-picker";

/**
 * Floating Action Button — mobile only (hidden on lg+).
 * Tapping opens a bottom drawer for quick inspiration capture.
 * On submit, dispatches `inspiration:updated` so InspirationFeed refreshes.
 */
export function CaptureFab() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<Priority>("p2");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Auto-dismiss error after 4s
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(id);
  }, [error]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSubmit() {
    const text = content.trim();
    if (!text || submitting) return;

    const tagList = tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (text.length > 10000) {
      setError("内容过长（最多 10,000 字符）");
      return;
    }
    if (tagList.length > 10 || tagList.some((tag) => tag.length > 50)) {
      setError("标签最多 10 个，且每个不超过 50 字符");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/github", {
        method: "POST",
        body: JSON.stringify({ content: text, priority, tags: tagList }),
      });
      const data = await res.json();
      if (data.ok) {
        setContent("");
        setPriority("p2");
        setTags("");
        setOpen(false);
        toast.success("已种下灵感 🌱");
        window.dispatchEvent(new CustomEvent("inspiration:updated"));
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <>
      {/* ── FAB button — mobile only, hidden when drawer open ─── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            onClick={() => setOpen(true)}
            aria-label="添加灵感"
            className="farm-primary-button fixed right-5 z-40 flex h-14 w-14 touch-manipulation items-center justify-center rounded-[1.15rem_1.15rem_0.45rem_1.15rem] lg:hidden"
            style={{ bottom: "calc(6.25rem + env(safe-area-inset-bottom))" }}
          >
            <Sprout className="h-5 w-5" strokeWidth={1.9} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Backdrop + Drawer ──────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="fab-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-[var(--farm-overlay)] backdrop-blur-[2px] lg:hidden"
              onClick={() => setOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              key="fab-drawer"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-[2rem] border-t border-[var(--farm-line)] bg-[var(--farm-paper)] shadow-2xl lg:hidden"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="quick-capture-title"
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-[var(--farm-line)]" />
              </div>

              <div className="px-4 pb-5 space-y-3">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="farm-kicker mb-0.5">QUICK CAPTURE</p>
                    <h3 id="quick-capture-title" className="farm-display text-xl font-semibold text-[var(--farm-ink)]">种下灵感</h3>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl text-[var(--farm-muted)] transition-colors hover:bg-[var(--farm-paper-deep)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Textarea */}
                <Textarea
                  autoFocus
                  placeholder="此刻有什么灵感..."
                  rows={3}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={submitting}
                  className="farm-input min-h-[96px] resize-none rounded-2xl text-base leading-relaxed"
                />

                <PriorityPicker
                  value={priority}
                  onChange={setPriority}
                  disabled={submitting}
                />

                {/* Tags */}
                <Input
                  placeholder="标签, 逗号分隔"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  disabled={submitting}
                  className="farm-input h-10 text-sm"
                />

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="farm-alert-error px-3 py-2 text-xs"
                      role="alert"
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Submit */}
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !content.trim()}
                  className="farm-primary-button h-12 w-full text-sm font-medium"
                >
                  {!submitting && <Sprout className="size-4" />}
                  {submitting ? "种下中..." : "种下灵感"}
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
