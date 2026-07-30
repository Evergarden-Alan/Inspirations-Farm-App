const PLAYURL_ENDPOINT = "https://api.bilibili.com/x/player/wbi/playurl";
const DEFAULT_CDN_SUFFIXES = ["bilivideo.com", "bilivideo.cn"];

export const BILIBILI_BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
export const BILIBILI_CID_PATTERN = /^[1-9][0-9]{0,19}$/;

interface BilibiliAudioTrack {
  mimeType?: unknown;
  mime_type?: unknown;
  codecs?: unknown;
  baseUrl?: unknown;
  base_url?: unknown;
  backupUrl?: unknown;
  backup_url?: unknown;
  bandwidth?: unknown;
}

interface BilibiliPlayurlPayload {
  code?: unknown;
  data?: {
    dash?: {
      audio?: unknown;
    };
  };
}

export interface BilibiliAudioSource {
  urls: string[];
  mimeType: "audio/mp4";
  codecs: "mp4a.40.2";
  bandwidth: number | null;
  cdnHost: string;
  deadline: number | null;
}

type BilibiliErrorCode =
  | "BILIBILI_UNAVAILABLE"
  | "BILIBILI_RISK_CONTROL"
  | "INVALID_UPSTREAM_RESPONSE"
  | "AUDIO_NOT_AVAILABLE";

export class BilibiliError extends Error {
  readonly code: BilibiliErrorCode;
  readonly status: number;

  constructor(
    code: BilibiliErrorCode,
    message: string,
    status = 502,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "BilibiliError";
    this.code = code;
    this.status = status;
  }
}

export function isValidBilibiliBvid(value: unknown): value is string {
  return typeof value === "string" && BILIBILI_BVID_PATTERN.test(value);
}

export function isValidBilibiliCid(value: unknown): value is string {
  return typeof value === "string" && BILIBILI_CID_PATTERN.test(value);
}

export function extractBvidFromVideoUrl(value: string): string | null {
  if (value.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "www.bilibili.com") return null;
  const match = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
  return match?.[1] ?? null;
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function isAllowedBilibiliCdnUrl(
  value: string,
  suffixes = DEFAULT_CDN_SUFFIXES
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const hostname = url.hostname.toLowerCase();
    return suffixes.some((suffix) => hostMatchesSuffix(hostname, suffix.toLowerCase()));
  } catch {
    return false;
  }
}

export function getBilibiliAudioDeadline(value: string): number | null {
  try {
    const raw = new URL(value).searchParams.get("deadline");
    if (!raw || !/^[0-9]{1,12}$/.test(raw)) return null;
    const deadline = Number(raw);
    return Number.isSafeInteger(deadline) && deadline > 0 ? deadline : null;
  } catch {
    return null;
  }
}

function trackUrls(track: BilibiliAudioTrack): string[] {
  const base = track.baseUrl ?? track.base_url;
  const backup = track.backupUrl ?? track.backup_url;
  return [base, ...(Array.isArray(backup) ? backup : [])]
    .filter((value): value is string => typeof value === "string");
}

export function selectBilibiliAacAudio(
  dash: { audio?: unknown } | undefined,
  suffixes = DEFAULT_CDN_SUFFIXES
): BilibiliAudioSource {
  if (!dash || !Array.isArray(dash.audio)) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili did not return a DASH audio list"
    );
  }

  const candidates = (dash.audio as BilibiliAudioTrack[])
    .filter((track) => {
      const mimeType = track?.mimeType ?? track?.mime_type;
      const codecs = typeof track?.codecs === "string"
        ? track.codecs.split(",").map((codec) => codec.trim())
        : [];
      return mimeType === "audio/mp4" && codecs.includes("mp4a.40.2");
    })
    .map((track) => ({
      track,
      urls: [...new Set(trackUrls(track).filter((url) => isAllowedBilibiliCdnUrl(url, suffixes)))],
    }))
    .filter((candidate) => candidate.urls.length > 0)
    .sort((left, right) => {
      const leftBandwidth = typeof left.track.bandwidth === "number" ? left.track.bandwidth : 0;
      const rightBandwidth = typeof right.track.bandwidth === "number" ? right.track.bandwidth : 0;
      return rightBandwidth - leftBandwidth;
    });

  const selected = candidates[0];
  if (!selected) {
    throw new BilibiliError(
      "AUDIO_NOT_AVAILABLE",
      "No public AAC-LC audio track was available",
      404
    );
  }

  const primary = selected.urls[0];
  return {
    urls: selected.urls,
    mimeType: "audio/mp4",
    codecs: "mp4a.40.2",
    bandwidth: typeof selected.track.bandwidth === "number"
      && Number.isFinite(selected.track.bandwidth)
      ? selected.track.bandwidth
      : null,
    cdnHost: new URL(primary).hostname,
    deadline: getBilibiliAudioDeadline(primary),
  };
}

async function readJsonWithLimit(response: Response, maxBytes = 1_048_576): Promise<unknown> {
  if (!response.body) {
    throw new BilibiliError("INVALID_UPSTREAM_RESPONSE", "Empty Bilibili response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BilibiliError(
          "INVALID_UPSTREAM_RESPONSE",
          "Bilibili response exceeded the size limit"
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili returned invalid JSON",
      502,
      { cause: error }
    );
  }
}

export async function resolveBilibiliAudio(
  bvid: string,
  cid: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    cdnSuffixes?: string[];
  } = {}
): Promise<BilibiliAudioSource> {
  if (!isValidBilibiliBvid(bvid) || !isValidBilibiliCid(cid)) {
    throw new TypeError("A valid BVID and CID are required");
  }

  const endpoint = new URL(PLAYURL_ENDPOINT);
  endpoint.searchParams.set("bvid", bvid);
  endpoint.searchParams.set("cid", cid);
  endpoint.searchParams.set("fnval", "16");
  endpoint.searchParams.set("fnver", "0");
  endpoint.searchParams.set("fourk", "0");

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 5_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        Accept: "application/json",
        Referer: `https://www.bilibili.com/video/${bvid}/`,
        "User-Agent": "InspirationsFarmFocusProbe/0.1",
      },
    });
  } catch (error) {
    throw new BilibiliError(
      "BILIBILI_UNAVAILABLE",
      "Unable to reach Bilibili playurl",
      502,
      { cause: error }
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new BilibiliError(
      "BILIBILI_UNAVAILABLE",
      `Bilibili playurl returned HTTP ${response.status}`
    );
  }

  const payload = await readJsonWithLimit(response) as BilibiliPlayurlPayload;
  if (payload.code === -352) {
    throw new BilibiliError(
      "BILIBILI_RISK_CONTROL",
      "Bilibili risk control rejected the request",
      503
    );
  }
  if (payload.code !== 0 || !payload.data) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      `Bilibili playurl returned business code ${String(payload.code)}`
    );
  }
  return selectBilibiliAacAudio(payload.data.dash, options.cdnSuffixes);
}
