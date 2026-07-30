"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  ExternalLink,
  ListMusic,
  LoaderCircle,
  Plus,
  Settings2,
  Sprout,
  Trash2,
  X,
} from "lucide-react";

import { LockScreen } from "@/app/lock-screen";
import { ThemeToggle } from "@/app/theme-toggle";
import { ToastContainer, toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, AuthError, hasPin } from "@/lib/api";
import {
  deleteFocusPlaylistCache,
  writeFocusPlaylistCache,
} from "@/lib/focus-playlist-cache";
import type { FocusPlaylist, FocusPlaylistItem } from "@/lib/focus-playlists";

interface PlaylistListResponse {
  ok: true;
  version: 1;
  updatedAt: string;
  playlists: FocusPlaylist[];
}

interface PlaylistMutationResponse {
  ok: true;
  created: boolean;
  updated: boolean;
  reason: "DUPLICATE_PLAYLIST" | null;
  playlist: FocusPlaylist;
  items: FocusPlaylistItem[];
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_URL: "请输入完整的 Bilibili 视频链接。",
  UNSUPPORTED_HOST: "目前只支持 www.bilibili.com 的视频链接。",
  INVALID_BVID: "链接中没有可识别的 BVID。",
  NOT_IN_COLLECTION: "这个视频不属于可用的 Bilibili 合集。",
  BILIBILI_UNAVAILABLE: "Bilibili 暂时不可用，请稍后再试。",
  BILIBILI_RATE_LIMITED: "Bilibili 请求较多，请稍后再试。",
  BILIBILI_RISK_CONTROL: "Bilibili 暂时拒绝了解析请求，请稍后再试。",
  INVALID_UPSTREAM_RESPONSE: "合集信息暂时无法识别。",
  CONFIG_CORRUPTED: "播放队列配置需要手动检查，应用没有覆盖它。",
  CONFIG_CONFLICT: "配置刚刚在其他位置发生变化，请重试。",
  PLAYLIST_NOT_FOUND: "这个合集已经不在播放队列中。",
  GITHUB_UNAVAILABLE: "暂时无法读取 GitHub 配置。",
};

function errorMessage(code: unknown): string {
  return typeof code === "string" && ERROR_MESSAGES[code]
    ? ERROR_MESSAGES[code]
    : "操作没有完成，请稍后再试。";
}

function formatAddedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(timestamp));
}

export function FocusPlaylistSettings() {
  const [unlocked, setUnlocked] = useState(false);
  const [playlists, setPlaylists] = useState<FocusPlaylist[] | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/focus-playlists", { retryOnNetworkError: true });
      const payload = await response.json() as PlaylistListResponse | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(errorMessage("error" in payload ? payload.error : null));
      }
      setPlaylists(payload.playlists);
    } catch (loadError) {
      if (!(loadError instanceof AuthError)) {
        setError(loadError instanceof Error ? loadError.message : errorMessage(null));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unlockTimer: ReturnType<typeof setTimeout> | undefined;
    if (hasPin()) unlockTimer = setTimeout(() => setUnlocked(true), 0);
    const handleAuthExpired = () => setUnlocked(false);
    window.addEventListener("auth:expired", handleAuthExpired);
    return () => {
      if (unlockTimer) clearTimeout(unlockTimer);
      window.removeEventListener("auth:expired", handleAuthExpired);
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const loadTimer = setTimeout(() => void loadPlaylists(), 0);
    return () => clearTimeout(loadTimer);
  }, [loadPlaylists, unlocked]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const candidate = url.trim();
    if (!candidate || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/focus-playlists", {
        method: "POST",
        body: JSON.stringify({ url: candidate }),
        retryOnNetworkError: false,
      });
      const payload = await response.json() as PlaylistMutationResponse | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(errorMessage("error" in payload ? payload.error : null));
      }
      setPlaylists((current) => {
        const list = current ?? [];
        const index = list.findIndex((playlist) => playlist.id === payload.playlist.id);
        if (index === -1) return [...list, payload.playlist];
        const next = [...list];
        next[index] = payload.playlist;
        return next;
      });
      try {
        await writeFocusPlaylistCache(payload.playlist.id, payload.items);
      } catch {
        console.warn("[FOCUS_PLAYLIST_CACHE] Unable to cache resolved playlist items");
      }
      setUrl("");
      if (payload.reason === "DUPLICATE_PLAYLIST") {
        toast.info("该合集已经在专注播放队列中");
      } else if (payload.updated) {
        toast.success("合集信息已更新");
      } else {
        toast.success("已加入专注播放队列");
      }
    } catch (saveError) {
      if (!(saveError instanceof AuthError)) {
        setError(saveError instanceof Error ? saveError.message : errorMessage(null));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(playlist: FocusPlaylist) {
    if (deletingId) return;
    setDeletingId(playlist.id);
    setError(null);
    try {
      const response = await apiFetch("/api/focus-playlists", {
        method: "DELETE",
        body: JSON.stringify({ id: playlist.id }),
        retryOnNetworkError: false,
      });
      const payload = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload.error));
      setPlaylists((current) => current?.filter((item) => item.id !== playlist.id) ?? []);
      try {
        await deleteFocusPlaylistCache(playlist.id);
      } catch {
        console.warn("[FOCUS_PLAYLIST_CACHE] Unable to delete cached playlist items");
      }
      setConfirmDeleteId(null);
      toast.success("已移出专注播放队列");
    } catch (deleteError) {
      if (!(deleteError instanceof AuthError)) {
        setError(deleteError instanceof Error ? deleteError.message : errorMessage(null));
      }
    } finally {
      setDeletingId(null);
    }
  }

  const count = playlists?.length ?? 0;

  return (
    <div className="farm-app min-h-screen font-sans antialiased">
      <header className="farm-header sticky top-0 z-20">
        <div className="mx-auto flex min-h-[68px] max-w-[1120px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="farm-brand-mark" aria-hidden="true">
              <Sprout className="size-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="farm-kicker hidden sm:block">FARM SETTINGS</p>
              <h1 className="farm-display truncate text-xl font-semibold text-[var(--farm-ink)] sm:text-2xl">设置</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--farm-line)] bg-[var(--farm-paper)]/75 px-3 text-sm font-medium text-[var(--farm-text)] transition-colors hover:border-[var(--farm-green)] hover:text-[var(--farm-green)]"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">返回农场</span>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
        <section className="max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-[var(--farm-clay)]">
            <Settings2 className="size-4" strokeWidth={1.8} />
            <p className="farm-kicker">FOCUS PLAYBACK</p>
          </div>
          <h2 className="farm-display text-[clamp(2rem,5vw,4rem)] font-medium leading-[1.05] tracking-[-0.035em] text-[var(--farm-ink)]">
            只留下声音，
            <span className="block text-[var(--farm-green)]">不把注意力带走。</span>
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--farm-muted)] sm:text-[15px]">
            粘贴合集内任意一个视频链接。农场会识别整个合集并参与随机播放，不需要再配置顺序、权重或音质。
          </p>
        </section>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="farm-panel p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="farm-section-icon"><Plus className="size-4" /></div>
              <div>
                <p className="farm-kicker">ADD PLAYLIST</p>
                <h3 className="farm-display mt-1 text-xl font-semibold">加入合集</h3>
              </div>
            </div>
            <form onSubmit={handleAdd} className="mt-5 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold tracking-wide text-[var(--farm-muted)]">Playlist URL</span>
                <Input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.bilibili.com/video/BV.../"
                  disabled={!unlocked || saving}
                  className="farm-input h-12"
                  autoComplete="off"
                />
              </label>
              <Button type="submit" disabled={!unlocked || saving || !url.trim()} className="farm-primary-button h-11 w-full">
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <AudioLines className="size-4" />}
                {saving ? "正在解析合集..." : "解析并加入"}
              </Button>
            </form>
            <p className="mt-4 text-xs leading-5 text-[var(--farm-faint)]">
              仅支持公开 UGC 合集。不会保存 Bilibili 登录信息、音频地址或媒体文件。
            </p>
          </section>

          <section className="farm-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="farm-section-icon"><ListMusic className="size-4" /></div>
                <div>
                  <p className="farm-kicker">PLAY QUEUE</p>
                  <h3 className="farm-display mt-1 text-xl font-semibold">已配置合集</h3>
                </div>
              </div>
              <span className="rounded-full border border-[var(--farm-line)] bg-[var(--farm-paper)] px-2.5 py-1 font-mono text-xs text-[var(--farm-muted)]">
                {count}
              </span>
            </div>

            {error && (
              <div className="farm-alert-error mt-5 px-3 py-2.5 text-sm" role="alert">{error}</div>
            )}

            {loading && playlists === null ? (
              <div className="mt-6 flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--farm-muted)]">
                <LoaderCircle className="size-4 animate-spin" /> 正在读取播放队列
              </div>
            ) : count === 0 ? (
              <div className="mt-6 rounded-[1.2rem_1.2rem_0.55rem_1.2rem] border border-dashed border-[var(--farm-line-strong)] bg-[var(--farm-paper)]/55 px-5 py-9 text-center">
                <ListMusic className="mx-auto size-6 text-[var(--farm-green)]" strokeWidth={1.6} />
                <p className="farm-display mt-3 text-lg font-semibold">播放队列还是空的</p>
                <p className="mt-1 text-sm text-[var(--farm-muted)]">加入一个常听的合集，就可以在专注时只听声音。</p>
              </div>
            ) : (
              <div className="mt-5 divide-y divide-[var(--farm-line)]">
                {playlists?.map((playlist) => {
                  const confirming = confirmDeleteId === playlist.id;
                  const deleting = deletingId === playlist.id;
                  return (
                    <article key={playlist.id} className="grid gap-4 py-5 first:pt-1 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center">
                      <div className="relative aspect-[4/3] w-24 overflow-hidden rounded-[1rem_1rem_0.4rem_1rem] border border-[var(--farm-line)] bg-[var(--farm-paper-deep)]">
                        <Image src={playlist.cover} alt="" fill sizes="96px" className="object-cover" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="farm-display line-clamp-2 text-lg font-semibold leading-snug text-[var(--farm-ink)]">{playlist.title}</h4>
                        <p className="mt-1 text-sm text-[var(--farm-muted)]">{playlist.ownerName} · {playlist.itemCount.toLocaleString("zh-CN")} 个视频</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--farm-faint)]">
                          <span>{formatAddedAt(playlist.addedAt)} 加入</span>
                          <a href={playlist.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--farm-green)]">
                            来源 <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        {confirming ? (
                          <>
                            <Button type="button" variant="destructive" size="sm" disabled={deleting} onClick={() => void handleDelete(playlist)}>
                              {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                              确认删除
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label="取消删除" disabled={deleting} onClick={() => setConfirmDeleteId(null)}>
                              <X />
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-lg"
                            aria-label={`删除「${playlist.title}」`}
                            title="移出播放队列"
                            onClick={() => setConfirmDeleteId(playlist.id)}
                            className="text-[var(--farm-muted)] hover:text-[var(--farm-danger)]"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      <ToastContainer />
      {!unlocked && (
        <div className="fixed inset-0 z-50">
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </div>
      )}
    </div>
  );
}
