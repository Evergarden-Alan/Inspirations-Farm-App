"use client";

import { useEffect, useState, useCallback } from "react";
import { Clock, Check, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";
import { MarkdownRenderer } from "@/components/markdown-renderer";

interface DailyNote {
  time: string;
  text: string;
}

interface JottingsCardProps {
  initialNotes?: {
    notes: DailyNote[];
    dailyExists: boolean;
  };
}

export function JottingsCard({ initialNotes }: JottingsCardProps = {}) {
  const [notes, setNotes] = useState<DailyNote[]>(() => initialNotes?.notes ?? []);
  const [loading, setLoading] = useState(!initialNotes);
  const [noteText, setNoteText] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = getBeijingDateString();

  // ── Fetch ───────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/daily?date=${date}`);
      const data = await res.json();
      if (data.ok) {
        setNotes(data.notes ?? []);
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const initialFetchTimer = !initialNotes
      ? setTimeout(() => void fetchNotes(), 0)
      : undefined;

    // Refresh when another component modifies the daily journal
    function handleDailyUpdate() {
      fetchNotes();
    }
    window.addEventListener("daily:updated", handleDailyUpdate);
    return () => {
      if (initialFetchTimer) clearTimeout(initialFetchTimer);
      window.removeEventListener("daily:updated", handleDailyUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Add note ────────────────────────────────────────
  async function handleAddNote() {
    const text = noteText.trim();
    if (!text || acting) return;

    setActing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/daily", {
        method: "POST",
        body: JSON.stringify({ action: "addNote", date, content: text }),
      });
      const data = await res.json();
      if (data.ok) {
        setNoteText("");
        // Optimistic update: use the server-returned timestamp
        setNotes((prev) => [...prev, { time: data.time, text }]);
      } else {
        setError(data.error ?? "Failed to add note");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Render ──────────────────────────────────────────
  return (
    <Card className="farm-panel">
      <CardHeader className="pb-4 pt-1">
        <div className="flex items-center gap-3">
          <div className="farm-section-icon">
            <NotebookPen className="size-5" strokeWidth={1.8} />
          </div>
          <div>
            <p className="farm-kicker mb-0.5">JOTTINGS</p>
            <CardTitle className="farm-display text-xl font-semibold text-[var(--farm-ink)]">
              今日杂记
            </CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}

        {/* Notes timeline */}
        {loading ? (
          <p className="py-4 text-center text-sm text-[var(--farm-muted)]">正在翻找今天的记录...</p>
        ) : notes.length === 0 ? (
          <p className="py-5 text-center text-xs text-[var(--farm-muted)]">风吹过了，留下一点文字吧。</p>
        ) : (
          <div className="relative pl-3">
            {/* Vertical timeline line */}
            <div className="absolute bottom-1 left-0 top-1 w-px bg-[var(--farm-line)]" />

            <div className="space-y-3">
              {notes.map((n, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm relative">
                  {/* Timeline dot */}
                  <div className="absolute -left-3.5 top-1.5 h-2 w-2 shrink-0 rounded-full border border-white bg-[var(--farm-green-soft)] ring-1 ring-[var(--farm-green)]/25" />

                  <span className="mt-0.5 w-10 shrink-0 font-mono text-[11px] leading-relaxed text-[var(--farm-muted)]">
                    {n.time}
                  </span>
                  <div className="min-w-0 max-w-none break-words text-[#4f5e55] prose prose-sm prose-slate leading-relaxed
                    prose-p:my-0 prose-p:text-sm prose-p:leading-relaxed
                    prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                    prose-code:text-xs prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                    prose-strong:text-slate-700 prose-strong:font-semibold
                    prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0.5 prose-li:text-sm
                  ">
                    <MarkdownRenderer content={n.text} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add note input */}
        <div className="flex items-center gap-2 border-t border-[var(--farm-line)]/70 pt-3">
          <Clock className="h-4 w-4 flex-shrink-0 text-[var(--farm-muted)]" />
          <Input
            placeholder="记一笔杂记..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddNote();
              }
            }}
            disabled={acting}
            className="farm-input h-9 text-sm"
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleAddNote}
            disabled={acting || !noteText.trim()}
            className="h-8 w-8 flex-shrink-0 text-[var(--farm-muted)] hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)]"
          >
            <Check className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
