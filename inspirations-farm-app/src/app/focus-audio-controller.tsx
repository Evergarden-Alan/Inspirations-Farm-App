"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { apiFetch } from "@/lib/api";
import {
  createFocusPlaylistCache,
  isFocusPlaylistCacheFresh,
  readFocusPlaylistCache,
  writeFocusPlaylistCache,
} from "@/lib/focus-playlist-cache";
import {
  appendFocusPlayerTrack,
  clearStoredFocusPlayerState,
  createFocusPlayerState,
  nextFocusPlayerHistoryTrack,
  previousFocusPlayerTrack,
  readStoredFocusPlayerState,
  updateFocusPlayerTime,
  writeStoredFocusPlayerState,
  type FocusPlayerState,
  type FocusPlayerTrack,
} from "@/lib/focus-player-state";
import { selectRandomFocusItem, type FocusShufflePool } from "@/lib/focus-shuffle";
import type {
  FocusPlaylist,
  FocusPlaylistCache,
  FocusPlaylistItem,
} from "@/lib/focus-playlists";

export type FocusAudioPhase = "loading" | "empty" | "ready" | "playing" | "paused" | "error";

export interface FocusAudioSnapshot {
  configured: boolean | null;
  phase: FocusAudioPhase;
  message: string | null;
  isPlaying: boolean;
  canPrevious: boolean;
  canNext: boolean;
}

export const INITIAL_FOCUS_AUDIO_SNAPSHOT: FocusAudioSnapshot = {
  configured: null,
  phase: "loading",
  message: "正在准备声音...",
  isPlaying: false,
  canPrevious: false,
  canNext: false,
};

export interface FocusAudioControllerHandle {
  previous: () => void;
  toggle: () => void;
  next: () => void;
  persist: () => void;
  stopAndClear: () => void;
}

interface FocusAudioControllerProps {
  focusSessionId: string;
  isFocusPaused: boolean;
  onSnapshotChange: (snapshot: FocusAudioSnapshot) => void;
}

interface PlaylistListResponse {
  ok: true;
  playlists: FocusPlaylist[];
}

interface PlaylistItemsResponse {
  ok: true;
  fetchedAt: string;
  items: FocusPlaylistItem[];
}

interface AudioTicketResponse {
  ok: true;
  audio: {
    url: string;
    mimeType: "audio/mp4";
    expiresAt: number;
  };
  track: FocusPlayerTrack;
}

class FocusAudioRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(code ?? `Focus audio request failed with status ${status}`);
    this.name = "FocusAudioRequestError";
    this.status = status;
    this.code = code;
  }
}

function responseErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

async function fetchPlaylistList(): Promise<FocusPlaylist[]> {
  const response = await apiFetch("/api/focus-playlists");
  const payload: unknown = await response.json();
  if (!response.ok || !payload || typeof payload !== "object" || !(payload as { ok?: unknown }).ok) {
    throw new FocusAudioRequestError(response.status, responseErrorCode(payload));
  }
  const playlists = (payload as PlaylistListResponse).playlists;
  if (!Array.isArray(playlists)) throw new FocusAudioRequestError(502, "INVALID_PLAYLIST_RESPONSE");
  return playlists;
}

async function fetchPlaylistItems(playlistId: string): Promise<FocusPlaylistCache> {
  const query = new URLSearchParams({ id: playlistId });
  const response = await apiFetch(`/api/focus-playlists/items?${query.toString()}`);
  const payload: unknown = await response.json();
  if (!response.ok || !payload || typeof payload !== "object" || !(payload as { ok?: unknown }).ok) {
    throw new FocusAudioRequestError(response.status, responseErrorCode(payload));
  }
  const { fetchedAt, items } = payload as PlaylistItemsResponse;
  const cache = createFocusPlaylistCache(playlistId, items, fetchedAt);
  try {
    await writeFocusPlaylistCache(playlistId, cache.items, cache.fetchedAt);
  } catch {
    console.warn("[FOCUS_PLAYLIST_CACHE] Unable to persist refreshed items");
  }
  return cache;
}

async function requestAudioTicket(track: {
  playlistId: string;
  bvid: string;
  cid: string | null;
}): Promise<AudioTicketResponse> {
  const response = await apiFetch("/api/focus-playlists/audio-ticket", {
    method: "POST",
    body: JSON.stringify(track),
    retryOnNetworkError: false,
  });
  const payload: unknown = await response.json();
  if (!response.ok || !payload || typeof payload !== "object" || !(payload as { ok?: unknown }).ok) {
    throw new FocusAudioRequestError(response.status, responseErrorCode(payload));
  }
  const ticket = payload as AudioTicketResponse;
  if (
    !ticket.audio
    || typeof ticket.audio.url !== "string"
    || !/^https?:\/\//.test(ticket.audio.url)
    || !ticket.track
  ) {
    throw new FocusAudioRequestError(502, "INVALID_AUDIO_TICKET");
  }
  return ticket;
}

function isTrackSpecificFailure(error: unknown): boolean {
  return error instanceof FocusAudioRequestError && [
    "PLAYLIST_NOT_FOUND",
    "NOT_IN_COLLECTION",
    "INVALID_BVID",
    "INVALID_CID",
  ].includes(error.code ?? "");
}

function playbackErrorMessage(error: unknown): string {
  if (error instanceof FocusAudioRequestError && error.code === "RELAY_UNAVAILABLE") {
    return "专注播放暂不可用";
  }
  return "声音暂时没有准备好";
}

export const FocusAudioController = forwardRef<
  FocusAudioControllerHandle,
  FocusAudioControllerProps
>(function FocusAudioController(
  { focusSessionId, isFocusPaused, onSnapshotChange },
  ref
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerStateRef = useRef<FocusPlayerState | null>(null);
  const cacheByIdRef = useRef(new Map<string, FocusPlaylistCache>());
  const configuredIdsRef = useRef<string[]>([]);
  const poolsRef = useRef<FocusShufflePool[]>([]);
  const snapshotRef = useRef<FocusAudioSnapshot>(INITIAL_FOCUS_AUDIO_SNAPSHOT);
  const operationIdRef = useRef(0);
  const mountedRef = useRef(false);
  const focusPausedRef = useRef(isFocusPaused);
  const playbackIntentRef = useRef(true);
  const resumeAfterFocusPauseRef = useRef(false);
  const pendingResumeAtRef = useRef<number | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const nextCommandRef = useRef<() => void>(() => undefined);
  const recoverCommandRef = useRef<() => void>(() => undefined);

  const publish = useCallback((change: Partial<FocusAudioSnapshot>) => {
    if (!mountedRef.current) return;
    const next = { ...snapshotRef.current, ...change };
    snapshotRef.current = next;
    onSnapshotChange(next);
  }, [onSnapshotChange]);

  const rebuildPools = useCallback(() => {
    poolsRef.current = configuredIdsRef.current.flatMap((playlistId) => {
      const cache = cacheByIdRef.current.get(playlistId);
      return cache && cache.items.length > 0
        ? [{ playlistId, items: cache.items }]
        : [];
    });
    publish({ canNext: poolsRef.current.length > 0 });
  }, [publish]);

  const persistCurrentPosition = useCallback(() => {
    const state = playerStateRef.current;
    if (!state) return;
    const audio = audioRef.current;
    const currentTime = pendingResumeAtRef.current ?? (audio && Number.isFinite(audio.currentTime)
      ? Math.max(0, audio.currentTime)
      : state.currentTime);
    try {
      const next = updateFocusPlayerTime(state, currentTime);
      playerStateRef.current = next;
      writeStoredFocusPlayerState(next);
    } catch {
      console.warn("[FOCUS_AUDIO_STATE] Unable to persist playback position");
    }
  }, []);

  const persistPlayerState = useCallback((state: FocusPlayerState) => {
    playerStateRef.current = state;
    try {
      writeStoredFocusPlayerState(state);
    } catch {
      console.warn("[FOCUS_AUDIO_STATE] Unable to persist playback state");
    }
    publish({ canPrevious: state.historyCursor > 0 });
  }, [publish]);

  const tryPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !playerStateRef.current) return;
    if (focusPausedRef.current) {
      publish({
        phase: "paused",
        isPlaying: false,
        message: "专注计时已暂停",
      });
      return;
    }
    playbackIntentRef.current = true;
    const operationId = operationIdRef.current;
    try {
      await audio.play();
      if (
        !mountedRef.current
        || operationId !== operationIdRef.current
        || audio.paused
      ) return;
      consecutiveFailuresRef.current = 0;
      publish({ phase: "playing", isPlaying: true, message: null });
      persistCurrentPosition();
    } catch (error) {
      if (!mountedRef.current || operationId !== operationIdRef.current) return;
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      publish({
        phase: blocked ? "ready" : "error",
        isPlaying: false,
        message: blocked ? "点击播放声音" : "声音暂时没有准备好",
      });
    }
  }, [persistCurrentPosition, publish]);

  const attachTicket = useCallback(async (
    ticket: AudioTicketResponse,
    resumeAt: number,
    autoplay: boolean,
    operationId: number
  ) => {
    const audio = audioRef.current;
    if (!audio || operationId !== operationIdRef.current) return;

    audio.pause();
    audio.src = ticket.audio.url;
    pendingResumeAtRef.current = resumeAt > 0 ? resumeAt : null;
    if (resumeAt > 0) {
      const restorePosition = () => {
        if (operationId !== operationIdRef.current) return;
        try {
          audio.currentTime = resumeAt;
          pendingResumeAtRef.current = null;
        } catch {
          // Some browsers only permit seeking after additional media data arrives.
        }
      };
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) restorePosition();
      else audio.addEventListener("loadedmetadata", restorePosition, { once: true });
    }
    audio.load();
    if (autoplay && !focusPausedRef.current) {
      await tryPlay();
      return;
    }
    publish({
      phase: focusPausedRef.current ? "paused" : "ready",
      isPlaying: false,
      message: focusPausedRef.current ? "专注计时已暂停" : "点击播放声音",
    });
  }, [publish, tryPlay]);

  const loadStoredTrack = useCallback(async (
    state: FocusPlayerState,
    autoplay: boolean,
    resumeAt = state.currentTime
  ) => {
    const operationId = ++operationIdRef.current;
    audioRef.current?.pause();
    publish({ phase: "loading", isPlaying: false, message: "正在准备声音..." });
    const ticket = await requestAudioTicket({
      playlistId: state.playlistId,
      bvid: state.bvid,
      cid: state.cid,
    });
    if (!mountedRef.current || operationId !== operationIdRef.current) return;
    persistPlayerState(state);
    await attachTicket(ticket, resumeAt, autoplay, operationId);
  }, [attachTicket, persistPlayerState, publish]);

  const loadRandomTrack = useCallback(async (autoplay: boolean) => {
    const current = playerStateRef.current;
    persistCurrentPosition();
    audioRef.current?.pause();
    publish({ phase: "loading", isPlaying: false, message: "正在准备声音..." });
    const rejected = new Set<string>();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidatePools = poolsRef.current
        .map((pool) => ({
          ...pool,
          items: pool.items.filter(
            (item) => !rejected.has(`${pool.playlistId}:${item.bvid}:${item.sourceIndex}`)
          ),
        }))
        .filter((pool) => pool.items.length > 0);
      const selection = selectRandomFocusItem(
        candidatePools,
        current?.history ?? [],
        current,
      );
      if (!selection) break;

      const operationId = ++operationIdRef.current;
      try {
        const ticket = await requestAudioTicket({
          playlistId: selection.playlistId,
          bvid: selection.item.bvid,
          cid: selection.item.cid,
        });
        if (!mountedRef.current || operationId !== operationIdRef.current) return;

        const nextState = current
          ? appendFocusPlayerTrack(playerStateRef.current ?? current, ticket.track)
          : createFocusPlayerState(focusSessionId, ticket.track);
        persistPlayerState(nextState);
        await attachTicket(ticket, 0, autoplay, operationId);
        return;
      } catch (error) {
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        lastError = error;
        if (!isTrackSpecificFailure(error)) throw error;
        rejected.add(`${selection.playlistId}:${selection.item.bvid}:${selection.item.sourceIndex}`);
      }
    }

    if (lastError) throw lastError;
    publish({
      phase: "error",
      isPlaying: false,
      message: "播放列表暂时没有可用内容",
      canNext: false,
    });
  }, [attachTicket, focusSessionId, persistCurrentPosition, persistPlayerState, publish]);

  const showPlaybackFailure = useCallback((error: unknown) => {
    publish({
      phase: "error",
      isPlaying: false,
      message: playbackErrorMessage(error),
    });
  }, [publish]);

  const handlePrevious = useCallback(() => {
    const current = playerStateRef.current;
    if (!current || current.historyCursor === 0) return;
    const autoplay = playbackIntentRef.current && !focusPausedRef.current;
    persistCurrentPosition();
    const previous = previousFocusPlayerTrack(playerStateRef.current ?? current);
    persistPlayerState(previous);
    void loadStoredTrack(previous, autoplay, 0).catch(showPlaybackFailure);
  }, [loadStoredTrack, persistCurrentPosition, persistPlayerState, showPlaybackFailure]);

  const handleNext = useCallback(() => {
    const current = playerStateRef.current;
    const autoplay = playbackIntentRef.current && !focusPausedRef.current;
    persistCurrentPosition();
    const forward = current ? nextFocusPlayerHistoryTrack(current) : null;
    if (forward) {
      persistPlayerState(forward);
      void loadStoredTrack(forward, autoplay, 0).catch((error) => {
        if (isTrackSpecificFailure(error)) {
          void loadRandomTrack(autoplay).catch(showPlaybackFailure);
        } else {
          showPlaybackFailure(error);
        }
      });
      return;
    }
    void loadRandomTrack(autoplay).catch(showPlaybackFailure);
  }, [loadRandomTrack, loadStoredTrack, persistCurrentPosition, persistPlayerState, showPlaybackFailure]);

  const handleToggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || focusPausedRef.current) return;
    if (!audio.paused && snapshotRef.current.isPlaying) {
      playbackIntentRef.current = false;
      resumeAfterFocusPauseRef.current = false;
      audio.pause();
      persistCurrentPosition();
      publish({ phase: "paused", isPlaying: false, message: "音频已暂停" });
      return;
    }
    if (snapshotRef.current.phase === "error") {
      const state = playerStateRef.current;
      if (state) {
        void loadStoredTrack(state, true, state.currentTime).catch(showPlaybackFailure);
      } else {
        void loadRandomTrack(true).catch(showPlaybackFailure);
      }
      return;
    }
    const state = playerStateRef.current;
    if (!state) {
      void loadRandomTrack(true).catch(showPlaybackFailure);
      return;
    }
    if (!audio.currentSrc) {
      void loadStoredTrack(state, true, state.currentTime).catch((error) => {
        if (isTrackSpecificFailure(error)) {
          playerStateRef.current = null;
          clearStoredFocusPlayerState();
          void loadRandomTrack(true).catch(showPlaybackFailure);
        } else {
          showPlaybackFailure(error);
        }
      });
      return;
    }
    void tryPlay();
  }, [loadRandomTrack, loadStoredTrack, persistCurrentPosition, publish, showPlaybackFailure, tryPlay]);

  const recoverFromAudioError = useCallback(() => {
    const state = playerStateRef.current;
    if (!state || operationIdRef.current === 0) return;
    if (!playbackIntentRef.current) {
      showPlaybackFailure(new Error("Media failed while playback was paused"));
      return;
    }
    const autoplay = playbackIntentRef.current && !focusPausedRef.current;
    const resumeAt = audioRef.current?.currentTime || state.currentTime;
    const failures = consecutiveFailuresRef.current;
    consecutiveFailuresRef.current += 1;

    if (failures === 0) {
      void loadStoredTrack(state, autoplay, resumeAt).catch((error) => {
        if (isTrackSpecificFailure(error)) nextCommandRef.current();
        else showPlaybackFailure(error);
      });
      return;
    }
    if (failures === 1) {
      void loadRandomTrack(autoplay).catch(showPlaybackFailure);
      return;
    }
    showPlaybackFailure(new Error("Repeated media failures"));
  }, [loadRandomTrack, loadStoredTrack, showPlaybackFailure]);

  nextCommandRef.current = handleNext;
  recoverCommandRef.current = recoverFromAudioError;

  const stopAndClear = useCallback(() => {
    operationIdRef.current += 1;
    playbackIntentRef.current = false;
    resumeAfterFocusPauseRef.current = false;
    pendingResumeAtRef.current = null;
    playerStateRef.current = null;
    clearStoredFocusPlayerState();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    publish(INITIAL_FOCUS_AUDIO_SNAPSHOT);
  }, [publish]);

  useImperativeHandle(ref, () => ({
    previous: handlePrevious,
    toggle: handleToggle,
    next: handleNext,
    persist: persistCurrentPosition,
    stopAndClear,
  }), [handleNext, handlePrevious, handleToggle, persistCurrentPosition, stopAndClear]);

  useEffect(() => {
    focusPausedRef.current = isFocusPaused;
    const audio = audioRef.current;
    if (!audio) return;

    if (isFocusPaused) {
      resumeAfterFocusPauseRef.current = playbackIntentRef.current && !audio.paused;
      audio.pause();
      persistCurrentPosition();
      if (playerStateRef.current) {
        publish({ phase: "paused", isPlaying: false, message: "专注计时已暂停" });
      }
      return;
    }

    if (resumeAfterFocusPauseRef.current) {
      resumeAfterFocusPauseRef.current = false;
      void tryPlay();
    }
  }, [isFocusPaused, persistCurrentPosition, publish, tryPlay]);

  useEffect(() => {
    mountedRef.current = true;
    const audioElement = audioRef.current;
    snapshotRef.current = INITIAL_FOCUS_AUDIO_SNAPSHOT;
    onSnapshotChange(INITIAL_FOCUS_AUDIO_SNAPSHOT);
    let cancelled = false;

    async function initialize() {
      try {
        const playlists = await fetchPlaylistList();
        if (cancelled) return;
        configuredIdsRef.current = playlists.map((playlist) => playlist.id);
        if (playlists.length === 0) {
          publish({
            configured: false,
            phase: "empty",
            message: null,
            isPlaying: false,
            canPrevious: false,
            canNext: false,
          });
          return;
        }

        publish({ configured: true, phase: "loading", message: "正在准备声音..." });
        const cached = await Promise.all(playlists.map(async (playlist) => {
          try {
            return await readFocusPlaylistCache(playlist.id);
          } catch {
            return null;
          }
        }));
        if (cancelled) return;
        cached.forEach((cache) => {
          if (cache) cacheByIdRef.current.set(cache.id, cache);
        });
        rebuildPools();

        let stored: FocusPlayerState | null = null;
        try {
          stored = readStoredFocusPlayerState(focusSessionId);
        } catch {
          clearStoredFocusPlayerState();
        }
        if (stored && !configuredIdsRef.current.includes(stored.playlistId)) {
          clearStoredFocusPlayerState();
          stored = null;
        }

        const needsRefresh = playlists.filter((_, index) => {
          const cache = cached[index];
          return !cache || !isFocusPlaylistCacheFresh(cache);
        });
        const refresh = async () => {
          const results = await Promise.allSettled(
            needsRefresh.map((playlist) => fetchPlaylistItems(playlist.id))
          );
          if (cancelled) return;
          results.forEach((result) => {
            if (result.status === "fulfilled") {
              cacheByIdRef.current.set(result.value.id, result.value);
            }
          });
          rebuildPools();
        };

        if (stored) {
          playbackIntentRef.current = false;
          persistPlayerState(stored);
          publish({
            phase: "ready",
            isPlaying: false,
            message: "需要时可手动播放环境音",
          });
          if (needsRefresh.length > 0) void refresh();
          return;
        }

        playbackIntentRef.current = false;
        if (poolsRef.current.length === 0 && needsRefresh.length > 0) await refresh();
        if (poolsRef.current.length === 0) {
          publish({
            phase: "error",
            isPlaying: false,
            message: "播放列表暂时无法加载",
            canNext: false,
          });
          return;
        }
        publish({
          phase: "ready",
          isPlaying: false,
          message: "需要时可手动播放环境音",
        });
        if (needsRefresh.length > 0 && cached.some(Boolean)) void refresh();
      } catch (error) {
        if (!cancelled) showPlaybackFailure(error);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      operationIdRef.current += 1;
      persistCurrentPosition();
      if (audioElement) {
        audioElement.pause();
        audioElement.removeAttribute("src");
        audioElement.load();
      }
    };
  }, [
    focusSessionId,
    loadRandomTrack,
    loadStoredTrack,
    onSnapshotChange,
    persistCurrentPosition,
    persistPlayerState,
    publish,
    rebuildPools,
    showPlaybackFailure,
  ]);

  useEffect(() => {
    const interval = window.setInterval(persistCurrentPosition, 10_000);
    const handlePageHide = () => persistCurrentPosition();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") persistCurrentPosition();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistCurrentPosition]);

  return (
    <audio
      ref={audioRef}
      className="hidden"
      preload="metadata"
      onPlay={() => {
        if (focusPausedRef.current) {
          audioRef.current?.pause();
          return;
        }
        consecutiveFailuresRef.current = 0;
        publish({ phase: "playing", isPlaying: true, message: null });
      }}
      onEnded={() => nextCommandRef.current()}
      onError={() => recoverCommandRef.current()}
    />
  );
});

FocusAudioController.displayName = "FocusAudioController";
