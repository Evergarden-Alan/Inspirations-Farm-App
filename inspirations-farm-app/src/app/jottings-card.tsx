"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Clock, Check, ImagePlus, Loader2, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, AuthError } from "@/lib/api";
import { getBeijingDateString } from "@/lib/beijing-time";
import { parseDailyNotes, type DailyNote } from "@/lib/markdown-utils";
import { compressImage } from "@/lib/image-compress";
import { MarkdownRenderer } from "@/components/markdown-renderer";

interface JottingsCardProps {
  initialNotes?: {
    notes: DailyNote[];
    dailyExists: boolean;
  };
}

interface DailyUpdatedDetail {
  date: string;
  path: string;
  sha: string;
  content: string;
}

/** The note an upload should attach to: first-line text + occurrence index
 *  among notes sharing the same time+text (disambiguates duplicates). */
function noteAnchor(notes: DailyNote[], index: number) {
  const note = notes[index];
  const text = note.text.split("\n")[0];
  const occurrence = notes
    .slice(0, index + 1)
    .filter(
      (n) => n.time === note.time && n.text.split("\n")[0] === text
    ).length - 1;
  return { time: note.time, text, occurrence };
}

export function JottingsCard({ initialNotes }: JottingsCardProps = {}) {
  const [notes, setNotes] = useState<DailyNote[]>(() => initialNotes?.notes ?? []);
  const [loading, setLoading] = useState(!initialNotes);
  const [noteText, setNoteText] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const date = getBeijingDateString();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAnchorRef = useRef<{ time: string; text: string; occurrence: number } | null>(null);

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
    function handleDailyUpdate(event: Event) {
      const detail = (event as CustomEvent<DailyUpdatedDetail>).detail;
      if (detail?.date === date && typeof detail.content === "string") {
        setNotes(parseDailyNotes(detail.content));
        return;
      }
      void fetchNotes();
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
        setNotes(parseDailyNotes(data.content));
        window.dispatchEvent(
          new CustomEvent<DailyUpdatedDetail>("daily:updated", {
            detail: {
              date,
              path: data.path,
              sha: data.sha,
              content: data.content,
            },
          })
        );
      } else {
        setError(data.error ?? "Failed to add note");
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setError("Network error");
    } finally {
      setActing(false);
    }
  }

  // ── Attach image to a note ─────────────────────────
  const handleAttach = useCallback(
    async (anchor: { time: string; text: string; occurrence: number }, file: File) => {
      const key = `${anchor.time}|${anchor.text}|${anchor.occurrence}`;
      setUploadingKey(key);
      setError(null);
      try {
        // 1) Smart client-side compression (≤1MB / GIF pass through).
        const uploadFile = await compressImage(file);

        // 2) Upload to Assets/Sources (multipart, no network retry — a retry
        //    could double-upload and leave orphan duplicates).
        const form = new FormData();
        form.append("file", uploadFile);
        const uploadRes = await apiFetch("/api/attachment", {
          method: "POST",
          body: form,
          retryOnNetworkError: false,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.ok) {
          throw new Error(uploadData.error ?? "图片上传失败");
        }

        // 3) Splice the embed line after the note (server anchors against
        //    fresh content; 404 = the note changed under us).
        const attachRes = await apiFetch("/api/daily", {
          method: "POST",
          body: JSON.stringify({
            action: "attachImage",
            date,
            time: anchor.time,
            text: anchor.text,
            occurrence: anchor.occurrence,
            filename: uploadData.filename,
          }),
        });
        const attachData = await attachRes.json();
        if (!attachRes.ok || !attachData.ok) {
          // The upload itself succeeded — the file stays in Assets/Sources
          // as a harmless orphan; only the note embed failed.
          throw new Error(attachData.error ?? "附加到杂记失败");
        }

        setNotes(parseDailyNotes(attachData.content));
        window.dispatchEvent(
          new CustomEvent<DailyUpdatedDetail>("daily:updated", {
            detail: {
              date,
              path: attachData.path,
              sha: attachData.sha,
              content: attachData.content,
            },
          })
        );
      } catch (err) {
        if (!(err instanceof AuthError)) {
          setError(err instanceof Error ? err.message : "图片上传失败");
        }
      } finally {
        setUploadingKey(null);
      }
    },
    [date]
  );

  function handlePickFile(index: number) {
    if (uploadingKey) return;
    pendingAnchorRef.current = noteAnchor(notes, index);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const anchor = pendingAnchorRef.current;
    e.target.value = ""; // allow re-picking the same file
    if (file && anchor) void handleAttach(anchor, file);
    pendingAnchorRef.current = null;
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
          <p className="farm-alert-error px-3 py-2 text-xs" role="alert">{error}</p>
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
              {notes.map((n, i) => {
                const anchor = noteAnchor(notes, i);
                const key = `${anchor.time}|${anchor.text}|${anchor.occurrence}`;
                const uploading = uploadingKey === key;
                return (
                  <div key={i} className="group relative flex items-start gap-2.5 text-sm">
                    {/* Timeline dot */}
                    <div className="absolute -left-3.5 top-1.5 h-2 w-2 shrink-0 rounded-full border border-[var(--farm-paper)] bg-[var(--farm-green)] ring-1 ring-[var(--farm-green)]/25" />

                    <span className="mt-0.5 w-10 shrink-0 font-mono text-[11px] leading-relaxed text-[var(--farm-muted)]">
                      {n.time}
                    </span>
                    <div className="farm-prose min-w-0 max-w-none break-words prose prose-sm leading-relaxed
                      prose-p:my-0 prose-p:text-sm prose-p:leading-relaxed
                      prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                      prose-strong:font-semibold
                      prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0.5 prose-li:text-sm
                    ">
                      <MarkdownRenderer content={n.text} />
                    </div>
                    <button
                      type="button"
                      title={uploading ? "正在上传..." : "附加图片"}
                      aria-label={uploading ? "正在上传图片" : "给这条杂记附加图片"}
                      onClick={() => handlePickFile(i)}
                      disabled={!!uploadingKey}
                      className="ml-auto mt-0.5 h-7 w-7 shrink-0 touch-manipulation rounded-md text-[var(--farm-muted)] opacity-60 transition-opacity hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)] hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {uploading ? (
                        <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="mx-auto h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Hidden image picker — the per-note attach button sets the pending
            anchor, then opens this once-shared input. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic"
          className="hidden"
          onChange={handleFileChange}
        />

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
