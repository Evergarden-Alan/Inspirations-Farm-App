"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, Pause, Play, X, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  clearFocusTimerState,
  getFocusElapsedSeconds,
  saveFocusTimerState,
  type FocusTimerState,
} from "@/lib/focus-timer-state";
import type { DailyTask } from "@/lib/github";

interface FocusTimerProps {
  task: DailyTask;
  initialState: FocusTimerState;
  onComplete: (duration: string) => Promise<boolean>;
  onFinished: () => void;
  onClose: () => void;
  onAbort: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDurationForMarkdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return "1m";
}

export function FocusTimer({
  task,
  initialState,
  onComplete,
  onFinished,
  onClose,
  onAbort,
}: FocusTimerProps) {
  const [timerState, setTimerState] = useState(initialState);
  const [elapsed, setElapsed] = useState(() => getFocusElapsedSeconds(initialState));
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [confirmingAbort, setConfirmingAbort] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    if (timerState.isPaused) return;

    const updateElapsed = () => {
      setElapsed(getFocusElapsedSeconds(timerState));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [timerState]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const handlePauseResume = useCallback(() => {
    if (isCompleting) return;

    const nextState: FocusTimerState = timerState.isPaused
      ? {
          ...timerState,
          startTime: Date.now() - timerState.pausedDuration * 1000,
          isPaused: false,
        }
      : {
          ...timerState,
          pausedDuration: elapsed,
          isPaused: true,
        };

    setTimerState(nextState);
    setElapsed(getFocusElapsedSeconds(nextState));
    saveFocusTimerState(nextState);
  }, [elapsed, isCompleting, timerState]);

  const handleComplete = useCallback(async () => {
    if (isCompleting) return;

    setIsCompleting(true);
    setSaveError(false);
    const saved = await onComplete(formatDurationForMarkdown(elapsed));

    if (saved) {
      clearFocusTimerState();
      onFinished();
      return;
    }

    setSaveError(true);
    setIsCompleting(false);
  }, [elapsed, isCompleting, onComplete, onFinished]);

  const handleAbort = useCallback(() => {
    clearFocusTimerState();
    onAbort();
  }, [onAbort]);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !isCompleting) {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={saveError ? errorId : undefined}
      onKeyDown={handleDialogKeyDown}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 6 }}
        transition={{ type: "spring", damping: 24, stiffness: 320 }}
        className="relative flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col items-center gap-6 overflow-y-auto rounded-3xl border border-white/5 bg-[var(--farm-paper)] p-6 shadow-2xl sm:gap-8 sm:p-12"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          disabled={isCompleting}
          className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-xl text-[var(--farm-muted)] transition-colors hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)] disabled:opacity-40"
          aria-label="收起计时器，继续后台计时"
          title="收起并继续计时"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="max-w-full px-8 text-center">
          <p className="mb-2 font-mono text-xs uppercase tracking-wider text-[var(--farm-muted)]">
            专注模式
          </p>
          <h2
            id={titleId}
            className="break-words text-xl font-semibold leading-snug text-[var(--farm-ink)] sm:text-2xl"
          >
            {task.displayText.replace(/^- \[[x ]\] /, "")}
          </h2>
          {task.priority && task.priority !== "p2" && (
            <span
              className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: `var(--farm-priority-${task.priority}-bg)`,
                color: `var(--farm-priority-${task.priority})`,
              }}
            >
              {task.priority.toUpperCase()}
            </span>
          )}
        </div>

        <div className="max-w-full text-center">
          <div
            className="font-mono text-[clamp(2.75rem,16vw,4.5rem)] font-bold leading-none tabular-nums text-[var(--farm-ink)]"
            role="timer"
            aria-label={`已专注 ${formatDuration(elapsed)}`}
          >
            {formatDuration(elapsed)}
          </div>
          {timerState.isPaused && (
            <p className="mt-3 text-sm text-[var(--farm-muted)]">已暂停</p>
          )}
        </div>

        {saveError && (
          <p id={errorId} className="farm-alert-error px-3 py-2 text-center text-sm" role="alert">
            保存失败，计时仍已保留，请检查网络后重试。
          </p>
        )}

        {confirmingAbort ? (
          <div className="w-full max-w-sm rounded-2xl border border-[var(--farm-danger-line)] bg-[var(--farm-danger-bg)] p-4 text-center">
            <p className="text-sm font-medium text-[var(--farm-danger)]">放弃本次专注计时？</p>
            <p className="mt-1 text-xs text-[var(--farm-muted)]">已记录的时长不会写入任务。</p>
            <div className="mt-3 flex justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-w-24"
                onClick={() => setConfirmingAbort(false)}
              >
                继续专注
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 min-w-24 border-[var(--farm-danger-line)] text-[var(--farm-danger)] hover:bg-[var(--farm-danger-bg)]"
                onClick={handleAbort}
              >
                确认中止
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              onClick={handlePauseResume}
              disabled={isCompleting}
              variant="outline"
              className="h-11 min-w-[120px] gap-2"
            >
              {timerState.isPaused ? (
                <>
                  <Play className="h-5 w-5" />
                  继续
                </>
              ) : (
                <>
                  <Pause className="h-5 w-5" />
                  暂停
                </>
              )}
            </Button>

            <Button
              type="button"
              onClick={() => void handleComplete()}
              disabled={isCompleting}
              className="farm-primary-button h-11 min-w-[140px] gap-2"
            >
              {isCompleting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {isCompleting ? "保存中..." : "完成任务"}
            </Button>

            <Button
              type="button"
              onClick={() => setConfirmingAbort(true)}
              disabled={isCompleting}
              variant="outline"
              className="h-11 min-w-[120px] gap-2 border-[var(--farm-danger-line)] text-[var(--farm-danger)] hover:bg-[var(--farm-danger-bg)]"
            >
              <XCircle className="h-5 w-5" />
              中止
            </Button>
          </div>
        )}

        {!confirmingAbort && (
          <p className="text-center text-xs text-[var(--farm-muted)]">
            收起后仍会继续计时，点击任务旁的计时按钮即可返回。
          </p>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}
