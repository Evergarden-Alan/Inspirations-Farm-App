"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CircleHelp,
  Eye,
  FlaskConical,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, AuthError } from "@/lib/api";
import { formatBeijingDate, getBeijingDateString, getBeijingDateTimeString } from "@/lib/beijing-time";
import { toast } from "@/app/toast";
import { createEventId } from "@/lib/insights";
import {
  outboxAdd,
  outboxMarkSynced,
  outboxPendingCount,
  outboxReplay,
} from "@/lib/insights-outbox";
import type { BenchBoard, BenchCard } from "@/lib/insights-board";

// ── Degraded snapshot (read-side fallback) ──────────────

const LAST_GOOD_KEY = "insights_bench_last_good";
const WELCOME_DISMISS_KEY = "insights_welcome_dismissed_date";

function saveLastGood(board: BenchBoard) {
  try {
    localStorage.setItem(
      LAST_GOOD_KEY,
      JSON.stringify({ board, savedAt: getBeijingDateTimeString() })
    );
  } catch {
    /* quota — snapshot is best-effort */
  }
}

function loadLastGood(): { board: BenchBoard; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(LAST_GOOD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────

function daysSince(date: string | null, today: string): number {
  if (!date) return 0;
  const ms = Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${date}T00:00:00+08:00`);
  return Number.isNaN(ms) ? 0 : Math.max(0, ms / 86_400_000);
}

/** Score breakdown line, e.g. `1+2 次验证 × 半衰 10 天 · 3 天前`. */
function scoreDetail(card: BenchCard): string {
  const base = `1+${card.vc} × 0.5^(${card.scoreDetail.daysSince}天/${card.scoreDetail.halfLife}天)`;
  return card.scoreDetail.learning ? `${base} · 学习中` : base;
}

const VERDICT_UI = {
  confirm: { emoji: "✅", label: "符合" },
  refute: { emoji: "❌", label: "不符" },
  unobserved: { emoji: "👀", label: "未观察" },
} as const;

type Verdict = keyof typeof VERDICT_UI;

interface Props {
  initialBoard: BenchBoard | null;
}

/**
 * 验证台 — the fourth panel. Reads a server-rendered board (or the last-good
 * localStorage snapshot when GitHub is unreachable) and drives the verify /
 * crown / reconcile flows through the outbox-backed API.
 */
export function VerifyBench({ initialBoard }: Props) {
  const [board, setBoard] = useState<BenchBoard | null>(initialBoard);
  const [staleSince, setStaleSince] = useState<string | null>(
    initialBoard ? null : loadLastGood()?.savedAt ?? null
  );
  const [pending, setPending] = useState(0);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [evidenceOpenFor, setEvidenceOpenFor] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<{
    drift: { insightId: string; field: string; fileValue: unknown; replayValue: unknown }[];
    conflictMarkers: { date: string; line: number }[];
    damagedLines: number;
    duplicateEvents: number;
    events: number;
    scope: string;
  } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const today = getBeijingDateString();
  const boardRef = useRef<BenchBoard | null>(initialBoard);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // Persist every good board as the degraded-read snapshot.
  useEffect(() => {
    if (initialBoard) saveLastGood(initialBoard);
  }, [initialBoard]);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch("/api/insights");
      const data = await res.json();
      if (data.ok && data.board) {
        setBoard(data.board);
        setStaleSince(null);
        saveLastGood(data.board);
      }
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setStaleSince((prev) => prev ?? getBeijingDateTimeString());
      }
    }
  }, []);

  // Pending outbox count + replay on open / when back online.
  const refreshPending = useCallback(() => setPending(outboxPendingCount()), []);
  useEffect(() => {
    void Promise.resolve().then(refreshPending);
    if (outboxPendingCount() > 0 && navigator.onLine) {
      void outboxReplay(async (entry) => {
        const res = await apiFetch(
          entry.kind === "verify" ? "/api/insights/verify" : "/api/insights/crown",
          { method: "POST", body: JSON.stringify(entry.payload) }
        );
        if (!res.ok) throw new Error(`replay failed: ${res.status}`);
      }).then((left) => {
        setPending(left);
        if (left === 0) void refetch();
      });
    }
    function onOnline() {
      void outboxReplay(async (entry) => {
        const res = await apiFetch(
          entry.kind === "verify" ? "/api/insights/verify" : "/api/insights/crown",
          { method: "POST", body: JSON.stringify(entry.payload) }
        );
        if (!res.ok) throw new Error(`replay failed: ${res.status}`);
      }).then(setPending);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("insights:outbox", refreshPending);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("insights:outbox", refreshPending);
    };
  }, [refreshPending, refetch]);

  // Welcome-back (derived, no effect-setState): >14 days since the newest
  // verification across active cards. Never-verified sprouts count their
  // created date — a bench full of fresh sprouts is not an interruption.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const welcome = useMemo(() => {
    if (!board || welcomeDismissed) return false;
    try {
      if (localStorage.getItem(WELCOME_DISMISS_KEY) === today) return false;
    } catch {
      /* private mode — show anyway */
    }
    const active = [...board.todayTop, ...board.sprouts];
    if (active.length === 0) return false;
    return !active.some((c) => daysSince(c.lastVerified ?? c.created, today) <= 14);
  }, [board, today, welcomeDismissed]);

  // ── Verify flow ─────────────────────────────────────

  const applyOptimistic = useCallback(
    (cardId: string, verdict: Verdict) => {
      const current = boardRef.current;
      if (!current) return;
      const bump = (c: BenchCard): BenchCard => {
        if (c.id !== cardId) return c;
        const vc = verdict === "confirm" ? c.vc + 1 : c.vc;
        const fc = verdict === "refute" ? c.fc + 1 : c.fc;
        const status =
          verdict === "refute" && (c.status === "knowledge" || c.status === "verified")
            ? "hypothesis"
            : c.status;
        return {
          ...c,
          vc,
          fc,
          status,
          lastVerified: today,
        };
      };
      const next: BenchBoard = {
        ...current,
        knowledge: current.knowledge.map(bump),
        todayTop: current.todayTop.map(bump).sort((a, b) => b.score - a.score),
        sprouts: current.sprouts.map(bump),
      };
      setBoard(next);
      boardRef.current = next;
    },
    [today]
  );

  async function submitVerify(card: BenchCard, verdict: Verdict, source: { date: string; anchor: string } | null) {
    if (busyCard) return;
    const clientEventId = createEventId();
    const payload = {
      insightId: card.id,
      verdict,
      source,
      clientEventId,
    };
    // Optimistic flip first; the event id is already the idempotency key.
    applyOptimistic(card.id, verdict);
    setBusyCard(card.id);
    outboxAdd(clientEventId, "verify", payload);
    try {
      const res = await apiFetch("/api/insights/verify", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        outboxMarkSynced(clientEventId);
        if (data.already) {
          toast.success("此前一次验证已在服务器生效（幂等吸收）");
        } else {
          if (data.traceWritten && data.countsSynced) toast.success("3 项全部写入 GitHub ✓");
          else toast.success("已记录，部分写入稍后自动补齐");
        }
        await refetch();
      } else {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      if (!(err instanceof AuthError)) {
        await refetch(); // authoritative revert — simplest correct rollback
        setPending(outboxPendingCount());
        setBanner(`验证暂未送达（已存入发件箱，网络恢复后自动重试）：${err instanceof Error ? err.message : "未知错误"}`);
      }
    } finally {
      setBusyCard(null);
      setEvidenceOpenFor(null);
    }
  }

  // ── Crown flow ──────────────────────────────────────

  async function submitCrown(card: BenchCard) {
    if (busyCard) return;
    if (!window.confirm(`确认把「${card.statement}」加冕为真知？此操作以事件流记录，reconcile 不会回退。`)) {
      return;
    }
    const clientEventId = createEventId();
    const payload = { insightId: card.id, clientEventId };
    setBusyCard(card.id);
    outboxAdd(clientEventId, "crown", payload);
    try {
      const res = await apiFetch("/api/insights/crown", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        outboxMarkSynced(clientEventId);
        toast.success(data.already_crowned ? "已是真知（幂等吸收）" : "已加冕为真知 👑");
        await refetch();
      } else {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      if (!(err instanceof AuthError)) {
        setPending(outboxPendingCount());
        setBanner(`加冕暂未送达（已存入发件箱）：${err instanceof Error ? err.message : "未知错误"}`);
      }
    } finally {
      setBusyCard(null);
    }
  }

  // ── Reconcile flow ──────────────────────────────────

  async function runReconcile(fix: boolean) {
    if (reconciling) return;
    setReconciling(true);
    try {
      if (fix) {
        const res = await apiFetch("/api/insights/invariant", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          setReconcileReport(null);
          toast.success(`对账完成：${data.detail}`);
          await refetch();
        } else {
          setBanner(`对账修复失败：${data.error ?? res.status}`);
        }
      } else {
        const res = await apiFetch("/api/insights/invariant?dryRun=1");
        const data = await res.json();
        if (data.ok) setReconcileReport(data.report);
        else setBanner(`对账检测失败：${data.error ?? res.status}`);
      }
    } catch (err) {
      if (!(err instanceof AuthError)) setBanner(`对账请求失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setReconciling(false);
    }
  }

  // Evidence candidates for the open picker (today + yesterday's 📌 lines).
  const evidenceCandidates = useMemo(() => {
    if (!board) return [];
    return board.behaviorFlow.filter((e) => e.kind === "behavior");
  }, [board]);

  const hasTodayBehavior = board?.behaviorFlow.some(
    (e) => e.kind === "behavior" && e.date === today
  );

  function renderCard(card: BenchCard, opts: { crownable?: boolean; compact?: boolean } = {}) {
    const crownable =
      opts.crownable && card.status === "hypothesis" && card.vc >= 5 && card.fc === 0;
    const busy = busyCard === card.id;
    const evidenceOpen = evidenceOpenFor === card.id;
    const candidates = evidenceCandidates.filter((e) => e.date === today || e.date === addDays(today, -1));
    return (
      <div
        key={card.id}
        className="rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper-deep)]/40 p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 break-words text-sm font-medium leading-relaxed text-[var(--farm-ink)]">
            {card.statement}
          </p>
          {crownable && (
            <button
              onClick={() => void submitCrown(card)}
              disabled={busy}
              title="可加冕：连续 5 次验证通过、0 次证伪 — 点击加冕为真知"
              className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--farm-green-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--farm-green)] transition-transform active:scale-95"
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              可加冕
            </button>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--farm-muted)]">
          <span title={scoreDetail(card)}>⭐ {card.score.toFixed(2)}</span>
          <span>✅ {card.vc}</span>
          <span>❌ {card.fc}</span>
          {card.topics.map((t) => (
            <span key={t} className="rounded-full bg-[var(--farm-paper)] px-1.5 py-0.5">{t}</span>
          ))}
        </div>

        {/* Evidence lookback (four-step v1 landing) */}
        {card.evidence.length > 0 && (
          <div className="mt-2 space-y-1">
            {card.evidence.map((e) => (
              <p key={e.raw} className="text-[11px] leading-relaxed text-[var(--farm-muted)]">
                <Eye className="mr-1 inline h-3 w-3" />
                {e.date} {e.anchor}
                {e.ambiguous && (
                  <span className="ml-1 text-[var(--farm-warning)]">
                    同分钟 {e.candidates.length} 条，人工确认：{e.candidates.map((c) => c.text).join(" / ")}
                  </span>
                )}
                {!e.ambiguous && !e.missing && e.candidates[0] && (
                  <span className="ml-1">· {e.candidates[0].text}</span>
                )}
                {e.missing && <span className="ml-1">·（对应行为行已不存在）</span>}
              </p>
            ))}
          </div>
        )}

        {!opts.compact && card.status !== "falsified" && card.status !== "knowledge" && (
          <div className="mt-2.5 flex items-center gap-1.5">
            {(["confirm", "refute", "unobserved"] as Verdict[]).map((v) => (
              <button
                key={v}
                onClick={() => {
                  if (v === "confirm") {
                    // Evidence picker — the soft gate hint renders inside.
                    setEvidenceOpenFor(evidenceOpen ? null : card.id);
                  } else {
                    void submitVerify(card, v, null);
                  }
                }}
                disabled={busy}
                className={`min-h-[34px] flex-1 touch-manipulation rounded-lg border border-[var(--farm-line)] bg-[var(--farm-paper)] text-xs font-medium text-[var(--farm-muted)] transition-colors hover:border-[var(--farm-green)] hover:text-[var(--farm-green)] disabled:opacity-40`}
                title={VERDICT_UI[v].label}
              >
                {VERDICT_UI[v].emoji} {VERDICT_UI[v].label}
              </button>
            ))}
          </div>
        )}

        {/* Evidence picker + soft gate hint */}
        {evidenceOpen && (
          <div className="mt-2 rounded-lg border border-[var(--farm-line)] bg-[var(--farm-paper)] p-2">
            {!hasTodayBehavior && (
              <p className="mb-1.5 flex items-center gap-1 text-[11px] text-[var(--farm-warning)]">
                <CircleHelp className="h-3 w-3" />
                今日无对应行为记录，凭印象验证？也可「改记 👀」。
              </p>
            )}
            <button
              onClick={() => void submitVerify(card, "confirm", null)}
              disabled={busy}
              className="min-h-[32px] w-full rounded-md px-2 py-1 text-left text-xs text-[var(--farm-muted)] hover:bg-[var(--farm-green-soft)]"
            >
              凭印象验证（不附证据）
            </button>
            {candidates.map((c, i) => (
              <button
                key={`${c.date}-${c.time}-${i}`}
                onClick={() =>
                  void submitVerify(card, "confirm", {
                    date: c.date,
                    anchor: c.time,
                  })
                }
                disabled={busy}
                className="min-h-[32px] w-full rounded-md px-2 py-1 text-left text-xs text-[var(--farm-ink)] hover:bg-[var(--farm-green-soft)]"
              >
                {c.date.slice(5)} {c.time} · {c.text}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function addDays(date: string, delta: number): string {
    const ms = Date.parse(`${date}T00:00:00+08:00`) + delta * 86_400_000;
    return formatBeijingDate(new Date(ms));
  }

  // ── Render ──────────────────────────────────────────

  if (!board) {
    return (
      <Card className="farm-panel">
        <CardHeader className="pb-4 pt-1">
          <div className="flex items-center gap-3">
            <div className="farm-section-icon">
              <FlaskConical className="size-5" strokeWidth={1.8} />
            </div>
            <div>
              <p className="farm-kicker mb-0.5">VERIFY BENCH</p>
              <CardTitle className="farm-display text-xl font-semibold text-[var(--farm-ink)]">
                验证台
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 rounded-lg bg-[var(--farm-paper-deep)] px-3 py-2 text-xs text-[var(--farm-muted)]">
            <TriangleAlert className="h-3.5 w-3.5" />
            数据截至 {staleSince ?? "—"}（GitHub 暂不可达，展示上次快照，验证已停用）
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="farm-panel">
      <CardHeader className="pb-4 pt-1">
        <div className="flex items-center gap-3">
          <div className="farm-section-icon">
            <FlaskConical className="size-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="farm-kicker mb-0.5">VERIFY BENCH</p>
            <CardTitle className="farm-display text-xl font-semibold text-[var(--farm-ink)]">
              验证台
            </CardTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void runReconcile(false)}
            disabled={reconciling}
            className="h-8 shrink-0 gap-1 text-xs text-[var(--farm-muted)] hover:bg-[var(--farm-green-soft)] hover:text-[var(--farm-green)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reconciling ? "animate-spin" : ""}`} />
            对账
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {staleSince && (
          <p className="flex items-center gap-2 rounded-lg bg-[var(--farm-paper-deep)] px-3 py-2 text-xs text-[var(--farm-muted)]">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            数据截至 {staleSince}，验证已停用
          </p>
        )}
        {banner && (
          <p className="farm-alert-error px-3 py-2 text-xs" role="alert">{banner}</p>
        )}
        {pending > 0 && (
          <p className="rounded-lg bg-[var(--farm-paper-deep)] px-3 py-2 text-xs text-[var(--farm-muted)]">
            📤 有 {pending} 条验证/加冕待同步（网络恢复后自动重试）
          </p>
        )}

        {welcome && (
          <div className="rounded-xl border border-[var(--farm-line)] bg-[var(--farm-green-soft)]/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-[var(--farm-ink)]">欢迎回来 👋</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--farm-muted)]">
                  超过 14 天没有验证了。存活假设 {board.todayTop.length} 条，行为流在下方——挑一条最近的继续。
                </p>
              </div>
              <button
                onClick={() => {
                  setWelcomeDismissed(true);
                  try {
                    localStorage.setItem(WELCOME_DISMISS_KEY, today);
                  } catch { /* private mode */ }
                }}
                className="shrink-0 text-xs text-[var(--farm-muted)] underline"
              >
                知道了
              </button>
            </div>
          </div>
        )}

        {reconcileReport && (
          <div className="rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper-deep)]/40 p-3 text-xs">
            <p className="mb-1 font-medium text-[var(--farm-ink)]">
              对账报告 · {reconcileReport.events} 条事件
              <span className="ml-2 font-normal text-[var(--farm-muted)]">{reconcileReport.scope}</span>
            </p>
            {reconcileReport.drift.length === 0 &&
            reconcileReport.conflictMarkers.length === 0 &&
            reconcileReport.damagedLines === 0 ? (
              <p className="text-[var(--farm-green)]">全部一致 ✓</p>
            ) : (
              <div className="space-y-1">
                {reconcileReport.drift.length > 0 && (
                  <p className="text-[var(--farm-danger)]">
                    drift {reconcileReport.drift.length} 处：
                    {reconcileReport.drift.map((d) => `${d.insightId}.${d.field}`).join("、")}
                  </p>
                )}
                {reconcileReport.conflictMarkers.length > 0 && (
                  <p className="text-[var(--farm-danger)]">
                    冲突标记 {reconcileReport.conflictMarkers.length} 处：
                    {reconcileReport.conflictMarkers.map((m) => `${m.date}:${m.line}`).join("、")}
                  </p>
                )}
                {reconcileReport.damagedLines > 0 && (
                  <p className="text-[var(--farm-muted)]">损坏行 {reconcileReport.damagedLines} 条（不计入，已上报）</p>
                )}
                <Button
                  size="sm"
                  onClick={() => void runReconcile(true)}
                  disabled={reconciling}
                  className="farm-primary-button h-8 text-xs"
                >
                  一键修复（以事件流为准回写）
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 真知常驻 */}
        {board.knowledge.length > 0 && (
          <section className="space-y-2">
            <p className="farm-kicker">TRUE KNOWLEDGE</p>
            {board.knowledge.map((c) => renderCard(c, { compact: true }))}
          </section>
        )}

        {/* 今日浮现 top15 */}
        <section className="space-y-2">
          <p className="farm-kicker">TODAY · TOP {board.todayTop.length}</p>
          {board.todayTop.length === 0 ? (
            <p className="py-3 text-center text-xs text-[var(--farm-muted)]">
              还没有存活假设——从杂记里「转洞察」种下第一颗。
            </p>
          ) : (
            board.todayTop.map((c) => renderCard(c, { crownable: true }))
          )}
        </section>

        {/* 新芽 */}
        {board.sprouts.length > 0 && (
          <section className="space-y-2">
            <p className="farm-kicker">SPROUTS · 新芽</p>
            {board.sprouts.map((c) => renderCard(c, { compact: true }))}
          </section>
        )}

        {/* 已证伪（折叠） */}
        {board.falsified.length > 0 && (
          <details className="rounded-xl border border-[var(--farm-line)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-[var(--farm-muted)]">
              已证伪（{board.falsified.length}）
            </summary>
            <div className="mt-2 space-y-2">
              {board.falsified.map((c) => renderCard(c, { compact: true }))}
            </div>
          </details>
        )}

        {/* 近 3 天行为流 */}
        <section className="space-y-2">
          <p className="farm-kicker">BEHAVIOR · 近 3 天行为流</p>
          {board.behaviorFlow.length === 0 ? (
            <p className="py-3 text-center text-xs text-[var(--farm-muted)]">
              还没有 📌 行为记录——杂记 tab 顶部切到「记录」模式即可。
            </p>
          ) : (
            <div className="space-y-0.5">
              {board.behaviorFlow.map((e, i) => (
                <p key={i} className="text-xs leading-relaxed text-[var(--farm-muted)]">
                  <span className="mr-2 font-mono text-[10px]">{e.date.slice(5)} {e.time}</span>
                  {e.kind === "behavior" ? "📌" : e.verdict === "confirm" ? "✅" : e.verdict === "refute" ? "❌" : "👀"}{" "}
                  <span className="text-[var(--farm-ink)]">{e.text}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
