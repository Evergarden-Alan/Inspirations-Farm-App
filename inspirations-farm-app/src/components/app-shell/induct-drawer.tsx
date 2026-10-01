"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiFetch, AuthError } from "@/lib/api";
import { toast } from "@/components/app-shell/toast";
import { LEARNING_TOPICS } from "@/lib/insights-config";

/** Fired by jottings notes and inspiration cards — detail carries the prefill. */
export interface InductDetail {
  statement: string;
  origin?: { date: string; time: string } | null;
}

/**
 * 「转洞察」single-step drawer (plan 02 §2 归纳): a jottings note becomes an
 * INS hypothesis. statement prefilled, topics picked, origin anchor recorded
 * into the INS body. Mounted once next to CaptureFab.
 */
export function InductDrawer() {
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState("");
  const [origin, setOrigin] = useState<InductDetail["origin"]>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    function onInduct(event: Event) {
      const detail = (event as CustomEvent<InductDetail>).detail;
      setStatement(detail?.statement ?? "");
      setOrigin(detail?.origin ?? null);
      setTopics([]);
      setError(null);
      setOpen(true);
    }
    window.addEventListener("insight:induct", onInduct);
    return () => window.removeEventListener("insight:induct", onInduct);
  }, []);

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

  function toggleTopic(topic: string) {
    setTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  }

  async function handleSubmit() {
    const text = statement.trim();
    if (!text || submitting) return;
    if (text.includes("\n")) {
      setError("命题必须是单行因果句（如：早睡→下午不犯困）");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/insights", {
        method: "POST",
        body: JSON.stringify({ statement: text, topics, origin }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setOpen(false);
        toast.success(`已建洞察 ${data.id} 🌱`);
        router.refresh();
      } else {
        setError(data.error ?? "创建失败");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="induct-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[var(--farm-overlay)] backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <motion.div
            key="induct-drawer"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-[2rem] border-t border-[var(--farm-line)] bg-[var(--farm-paper)] shadow-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="induct-title"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-[var(--farm-line)]" />
            </div>

            <div className="px-4 pb-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="farm-kicker mb-0.5">INDUCT</p>
                  <h3 id="induct-title" className="farm-display text-xl font-semibold text-[var(--farm-ink)]">
                    转洞察
                  </h3>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl text-[var(--farm-muted)] transition-colors hover:bg-[var(--farm-paper-deep)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <Textarea
                autoFocus
                placeholder="单行因果命题，如：早睡→下午不犯困"
                rows={2}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                disabled={submitting}
                className="farm-input min-h-[64px] resize-none rounded-2xl text-base leading-relaxed"
              />

              <div className="flex flex-wrap gap-1.5">
                {LEARNING_TOPICS.map((topic) => (
                  <button
                    key={topic}
                    onClick={() => toggleTopic(topic)}
                    disabled={submitting}
                    className={`min-h-[32px] touch-manipulation rounded-full border px-3 text-xs transition-colors ${
                      topics.includes(topic)
                        ? "border-[var(--farm-green)] bg-[var(--farm-green-soft)] text-[var(--farm-green)]"
                        : "border-[var(--farm-line)] text-[var(--farm-muted)] hover:border-[var(--farm-green)]"
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>

              {origin && (
                <p className="text-[11px] text-[var(--farm-muted)]">
                  来源：{origin.date} {origin.time}（写入 INS 正文留痕）
                </p>
              )}

              {error && (
                <p className="farm-alert-error px-3 py-2 text-xs" role="alert">
                  {error}
                </p>
              )}

              <Button
                onClick={handleSubmit}
                disabled={submitting || !statement.trim()}
                className="farm-primary-button h-12 w-full text-sm font-medium"
              >
                {!submitting && <Lightbulb className="size-4" />}
                {submitting ? "创建中..." : "建为假设（INS）"}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
