"use client";

import { useEffect, useState, useCallback } from "react";
import { Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";

interface DailyNote {
  time: string;
  text: string;
}

export function JottingsCard() {
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [loading, setLoading] = useState(true);
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
    fetchNotes();

    // Refresh when another component modifies the daily journal
    function handleDailyUpdate() {
      fetchNotes();
    }
    window.addEventListener("daily:updated", handleDailyUpdate);
    return () => window.removeEventListener("daily:updated", handleDailyUpdate);
  }, [fetchNotes]);

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
    <Card className="bg-white border-slate-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-700">
          📝 今日杂记
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Notes timeline */}
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-4">加载中...</p>
        ) : notes.length > 0 ? (
          <div className="space-y-1.5">
            {notes.map((n, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-slate-400 font-mono flex-shrink-0 mt-0.5 w-10">
                  {n.time}
                </span>
                <span className="text-slate-600 leading-relaxed">{n.text}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Add note input */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <Clock className="w-4 h-4 text-slate-300 flex-shrink-0" />
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
            className="h-9 text-sm border-slate-200 focus-visible:ring-emerald-500"
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleAddNote}
            disabled={acting || !noteText.trim()}
            className="h-8 w-8 flex-shrink-0 text-slate-400 hover:text-emerald-600"
          >
            <Check className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
