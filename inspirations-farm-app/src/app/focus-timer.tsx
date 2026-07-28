"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Pause, Play, CheckCircle2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import type { DailyTask } from "@/lib/github";

interface FocusTimerProps {
  task: DailyTask;
  onComplete: (duration: string) => void;
  onAbort: () => void;
}

interface TimerState {
  taskId: number;
  startTime: number;
  pausedDuration: number;
  isPaused: boolean;
}

const STORAGE_KEY = "farm_focus_timer";

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
  return "1m"; // Minimum 1 minute
}

export function FocusTimer({ task, onComplete, onAbort }: FocusTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [timerState, setTimerState] = useState<TimerState | null>(null);

  // Initialize or restore timer state
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const state: TimerState = JSON.parse(stored);
        if (state.taskId === task.id) {
          // Restore from localStorage
          const now = Date.now();
          const elapsed = state.isPaused
            ? state.pausedDuration
            : Math.floor((now - state.startTime) / 1000);
          setElapsed(elapsed);
          setIsPaused(state.isPaused);
          setTimerState(state);
          return;
        }
      } catch (e) {
        // Invalid stored state
      }
    }

    // New timer
    const newState: TimerState = {
      taskId: task.id,
      startTime: Date.now(),
      pausedDuration: 0,
      isPaused: false,
    };
    setTimerState(newState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  }, [task.id]);

  // Tick timer
  useEffect(() => {
    if (!timerState || isPaused) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const newElapsed = Math.floor((now - timerState.startTime) / 1000);
      setElapsed(newElapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [timerState, isPaused]);

  const handlePauseResume = useCallback(() => {
    if (!timerState) return;

    if (isPaused) {
      // Resume
      const newState: TimerState = {
        ...timerState,
        startTime: Date.now() - timerState.pausedDuration * 1000,
        isPaused: false,
      };
      setTimerState(newState);
      setIsPaused(false);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    } else {
      // Pause
      const newState: TimerState = {
        ...timerState,
        pausedDuration: elapsed,
        isPaused: true,
      };
      setTimerState(newState);
      setIsPaused(true);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    }
  }, [timerState, isPaused, elapsed]);

  const handleComplete = useCallback(() => {
    const duration = formatDurationForMarkdown(elapsed);
    localStorage.removeItem(STORAGE_KEY);
    onComplete(duration);
  }, [elapsed, onComplete]);

  const handleAbort = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    onAbort();
  }, [onAbort]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            // Click outside - do nothing (require explicit abort)
          }
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="relative mx-4 flex w-full max-w-2xl flex-col items-center gap-8 rounded-3xl bg-[var(--farm-paper)] p-12 shadow-2xl"
        >
          {/* Close button */}
          <button
            onClick={handleAbort}
            className="absolute right-4 top-4 rounded-lg p-2 text-[var(--farm-muted)] transition-colors hover:bg-[var(--farm-paper-deep)] hover:text-[var(--farm-ink)]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Task info */}
          <div className="text-center">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-[var(--farm-muted)]">
              专注模式
            </p>
            <h2 className="text-2xl font-semibold text-[var(--farm-ink)]">
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

          {/* Timer display */}
          <div className="text-center">
            <div className="font-mono text-7xl font-bold tabular-nums text-[var(--farm-ink)]">
              {formatDuration(elapsed)}
            </div>
            {isPaused && (
              <p className="mt-3 text-sm text-[var(--farm-muted)]">已暂停</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={handlePauseResume}
              variant="outline"
              size="lg"
              className="min-w-[120px] gap-2"
            >
              {isPaused ? (
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
              onClick={handleComplete}
              size="lg"
              className="farm-primary-button min-w-[140px] gap-2"
            >
              <CheckCircle2 className="h-5 w-5" />
              完成任务
            </Button>

            <Button
              onClick={handleAbort}
              variant="outline"
              size="lg"
              className="min-w-[120px] gap-2 border-[var(--farm-danger-line)] text-[var(--farm-danger)] hover:bg-[var(--farm-danger-bg)]"
            >
              <XCircle className="h-5 w-5" />
              中止
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
