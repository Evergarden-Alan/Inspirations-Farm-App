"use client";

/**
 * Lightweight event-bus toast system.
 *
 * Usage anywhere in client code:
 *   import { toast } from "@/app/toast";
 *   toast.success("已种下灵感 🌱");
 *   toast.error("网络错误，请重试");
 *
 * Mount <ToastContainer /> once in home.tsx.
 */

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, X } from "lucide-react";

// ── Event bus ──────────────────────────────────────────────
type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let _id = 0;
function emit(type: ToastType, message: string) {
  window.dispatchEvent(
    new CustomEvent("toast:show", { detail: { id: ++_id, type, message } })
  );
}

export const toast = {
  success: (msg: string) => emit("success", msg),
  error: (msg: string) => emit("error", msg),
  info: (msg: string) => emit("info", msg),
};

// ── Container component ────────────────────────────────────
export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;

    function onShow(e: Event) {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev, item]);

      // Auto-dismiss after 3.5s
      const timerId = setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== item.id));
        timers.delete(timerId);
      }, 3500);
      timers.add(timerId);
    }

    window.addEventListener("toast:show", onShow);
    return () => {
      window.removeEventListener("toast:show", onShow);
      // Clean up all pending timers on unmount to prevent memory leak
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  function dismiss(id: number) {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-4 top-20 z-[60] flex items-end flex-col gap-2 sm:left-auto"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 rounded-xl shadow-lg text-sm max-w-[280px] min-w-[200px] border ${
              item.type === "success"
                ? "border-[var(--farm-line-strong)] bg-[var(--farm-green-soft)] text-[var(--farm-green-strong)]"
                : item.type === "error"
                  ? "border-[var(--farm-danger-line)] bg-[var(--farm-danger-bg)] text-[var(--farm-danger)]"
                  : "bg-[var(--farm-paper)] border-[var(--farm-line)] text-[var(--farm-ink)]"
            }`}
          >
            {/* Icon */}
            <span className="shrink-0 mt-0.5">
              {item.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--farm-green)]" />
              ) : item.type === "error" ? (
                <XCircle className="w-4 h-4 text-[var(--farm-danger)]" />
              ) : (
                <span className="w-4 h-4 inline-block" />
              )}
            </span>

            {/* Message */}
            <span className="flex-1 leading-snug">{item.message}</span>

            {/* Dismiss */}
            <button
              onClick={() => dismiss(item.id)}
              aria-label="关闭"
              className="shrink-0 mt-0.5 text-current opacity-40 hover:opacity-70 transition-opacity touch-manipulation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
