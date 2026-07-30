"use client";

import { useRef, useState } from "react";
import {
  CirclePause,
  CirclePlay,
  Eraser,
  KeyRound,
  LoaderCircle,
  Radio,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, setPin as savePin } from "@/lib/api";

const EXAMPLE_BVID = "BV1f53B6qEB6";
const EXAMPLE_CID = "40377256216";

interface ProbeResult {
  ok: true;
  audio: {
    url: string;
    mimeType: string;
    expiresAt: number;
  };
  diagnostics: {
    mimeType: string;
    codecs: string;
    bandwidth: number | null;
    cdnHost: string;
    deadline: number | null;
    deadlineRemainingSeconds: number | null;
    relayHost: string;
  };
}

interface MediaLog {
  id: number;
  time: string;
  event: string;
  detail: string;
}

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "--:--";
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${Math.floor(value / 60)}:${seconds}`;
}

function diagnosticValue(value: string | number | null): string {
  if (value === null) return "未提供";
  return String(value);
}

function sanitizeMediaMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/sig=[^&\s]+/gi, "sig=[redacted]");
}

export function FocusPlaylistLab() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const logSequence = useRef(0);
  const lastLoggedSecond = useRef(-10);
  const [pin, setPin] = useState("");
  const [bvid, setBvid] = useState(EXAMPLE_BVID);
  const [cid, setCid] = useState(EXAMPLE_CID);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canPlayType, setCanPlayType] = useState("尚未检测");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [logs, setLogs] = useState<MediaLog[]>([]);

  function appendLog(event: string, detail = "") {
    const entry: MediaLog = {
      id: ++logSequence.current,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      event,
      detail,
    };
    setLogs((current) => [...current.slice(-199), entry]);
  }

  function snapshot(audio: HTMLAudioElement): string {
    return `t=${audio.currentTime.toFixed(1)} ready=${audio.readyState} network=${audio.networkState}`;
  }

  function handleMediaEvent(event: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (event === "timeupdate") {
      setCurrentTime(audio.currentTime);
      const wholeSecond = Math.floor(audio.currentTime);
      if (wholeSecond - lastLoggedSecond.current < 5) return;
      lastLoggedSecond.current = wholeSecond;
    }
    if (event === "loadedmetadata" || event === "durationchange") {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    }
    if (event === "play" || event === "playing") setIsPlaying(true);
    if (event === "pause" || event === "ended" || event === "error") setIsPlaying(false);

    let detail = snapshot(audio);
    if (event === "error" && audio.error) {
      const message = audio.error.message
        ? sanitizeMediaMessage(audio.error.message)
        : detail;
      detail = `${MEDIA_ERROR_NAMES[audio.error.code] ?? `code=${audio.error.code}`} · ${message}`;
    }
    appendLog(event, detail);
  }

  async function requestAudio() {
    if (!pin.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    savePin(pin.trim());
    try {
      const response = await apiFetch("/api/focus-playlists/audio-probe", {
        method: "POST",
        body: JSON.stringify({ bvid: bvid.trim(), cid: cid.trim() }),
      });
      const payload = await response.json() as ProbeResult | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : `HTTP_${response.status}`);
      }
      setResult(payload);
      setCanPlayType(
        audio?.canPlayType(`${payload.diagnostics.mimeType}; codecs="${payload.diagnostics.codecs}"`)
          || "(空字符串)"
      );
      appendLog("ticket", `relay=${payload.diagnostics.relayHost}`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "UNKNOWN_ERROR";
      setError(message);
      appendLog("probe-error", message);
    } finally {
      setLoading(false);
    }
  }

  async function playManually() {
    const audio = audioRef.current;
    if (!audio || !result) return;
    try {
      await audio.play();
    } catch (playError) {
      const message = playError instanceof Error
        ? `${playError.name}: ${playError.message}`
        : "PLAY_FAILED";
      setError(message);
      appendLog("play-rejected", message);
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  const diagnostics = result ? [
    ["MIME", result.diagnostics.mimeType],
    ["codec", result.diagnostics.codecs],
    ["canPlayType", canPlayType],
    ["CDN host", result.diagnostics.cdnHost],
    ["deadline", result.diagnostics.deadline],
    ["deadline 距今秒数", result.diagnostics.deadlineRemainingSeconds],
    ["中继 host", result.diagnostics.relayHost],
    ["音频带宽", result.diagnostics.bandwidth],
  ] as const : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-[1.75rem_1.75rem_0.8rem_1.75rem] border border-[var(--farm-line)] bg-[var(--farm-panel)] p-5 shadow-[0_24px_60px_rgb(var(--farm-panel-shadow)_/_10%)] sm:p-6">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-[var(--farm-green)]" />
          <h3 className="farm-display text-xl font-semibold text-[var(--farm-ink)]">固定音轨票据</h3>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold tracking-wide text-[var(--farm-muted)]">PIN</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="farm-input h-11"
              placeholder="输入农场密钥"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold tracking-wide text-[var(--farm-muted)]">BVID</span>
              <Input value={bvid} onChange={(event) => setBvid(event.target.value)} className="farm-input h-11 font-mono" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold tracking-wide text-[var(--farm-muted)]">CID</span>
              <Input value={cid} onChange={(event) => setCid(event.target.value)} className="farm-input h-11 font-mono" />
            </label>
          </div>

          <Button
            type="button"
            onClick={requestAudio}
            disabled={loading || !pin.trim()}
            className="farm-primary-button h-11 w-full"
          >
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Radio className="size-4" />}
            {loading ? "正在解析..." : "获取中继音频地址"}
          </Button>

          {error && (
            <div className="farm-alert-error px-3 py-2 text-sm" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-[var(--farm-line)] pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--farm-muted)]">手动播放</p>
              <p className="mt-1 font-mono text-sm text-[var(--farm-text)]">
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                onClick={() => seek(0)}
                disabled={!result}
                aria-label="回到开头"
              >
                <RotateCcw />
              </Button>
              <Button
                type="button"
                size="icon-lg"
                onClick={isPlaying ? () => audioRef.current?.pause() : playManually}
                disabled={!result}
                aria-label={isPlaying ? "暂停" : "手动播放"}
              >
                {isPlaying ? <CirclePause /> : <CirclePlay />}
              </Button>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!result || !duration}
            aria-label="音频进度"
            className="mt-4 h-2 w-full cursor-pointer accent-[var(--farm-green)] disabled:cursor-not-allowed disabled:opacity-40"
          />
          <audio
            ref={audioRef}
            src={result?.audio.url}
            preload="metadata"
            onLoadStart={() => handleMediaEvent("loadstart")}
            onLoadedMetadata={() => handleMediaEvent("loadedmetadata")}
            onDurationChange={() => handleMediaEvent("durationchange")}
            onCanPlay={() => handleMediaEvent("canplay")}
            onPlay={() => handleMediaEvent("play")}
            onPlaying={() => handleMediaEvent("playing")}
            onPause={() => handleMediaEvent("pause")}
            onTimeUpdate={() => handleMediaEvent("timeupdate")}
            onSeeking={() => handleMediaEvent("seeking")}
            onSeeked={() => handleMediaEvent("seeked")}
            onWaiting={() => handleMediaEvent("waiting")}
            onStalled={() => handleMediaEvent("stalled")}
            onEnded={() => handleMediaEvent("ended")}
            onError={() => handleMediaEvent("error")}
          />
        </div>
      </section>

      <div className="space-y-5">
        <section className="overflow-hidden rounded-[1.75rem_1.75rem_1.75rem_0.8rem] border border-[var(--farm-line)] bg-[var(--farm-panel)]">
          <div className="border-b border-[var(--farm-line)] px-5 py-4 sm:px-6">
            <h3 className="farm-display text-xl font-semibold text-[var(--farm-ink)]">脱敏诊断</h3>
            <p className="mt-1 text-xs text-[var(--farm-muted)]">不展示 CDN 路径、查询签名或完整中继 URL。</p>
          </div>
          {result ? (
            <dl className="divide-y divide-[var(--farm-line)]">
              {diagnostics.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.3fr)] gap-3 px-5 py-3 text-sm sm:px-6">
                  <dt className="font-medium text-[var(--farm-muted)]">{label}</dt>
                  <dd className="break-all font-mono text-[var(--farm-ink)]">{diagnosticValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-[var(--farm-muted)] sm:px-6">
              获取票据后显示 MIME、codec、CDN host 和 deadline。
            </p>
          )}
        </section>

        <section className="rounded-[1.5rem] border border-[var(--farm-line)] bg-[var(--farm-paper-deep)]/70 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="farm-display text-lg font-semibold text-[var(--farm-ink)]">媒体事件日志</h3>
              <p className="mt-1 text-xs text-[var(--farm-muted)]">播放 30 秒后拖动进度条，确认出现 seeking → seeked → playing。</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLogs([])} disabled={logs.length === 0}>
              <Eraser />清空
            </Button>
          </div>
          <div className="mt-4 h-60 overflow-auto rounded-xl border border-[var(--farm-line)] bg-[var(--farm-code-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--farm-text)]" role="log" aria-live="polite">
            {logs.length === 0 ? (
              <p className="text-[var(--farm-muted)]">等待媒体事件...</p>
            ) : logs.map((entry) => (
              <p key={entry.id}>
                <span className="text-[var(--farm-muted)]">[{entry.time}]</span>{" "}
                <span className="font-semibold text-[var(--farm-green)]">{entry.event}</span>{" "}
                {entry.detail}
              </p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
