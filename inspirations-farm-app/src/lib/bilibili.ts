import {
  createFocusPlaylistId,
  type FocusPlaylistItem,
  type FocusPlaylistResolution,
  type ResolvedFocusPlaylist,
} from "./focus-playlists";

const VIEW_ENDPOINT = "https://api.bilibili.com/x/web-interface/view";
const SEASON_ARCHIVES_ENDPOINT = "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list";
const PLAYURL_ENDPOINT = "https://api.bilibili.com/x/player/wbi/playurl";
const DEFAULT_CDN_SUFFIXES = ["bilivideo.com", "bilivideo.cn"];
const BILIBILI_IMAGE_SUFFIXES = ["hdslb.com", "biliimg.com"];
const MAX_PLAYLIST_ITEMS = 2_000;
const SEASON_PAGE_SIZE = 30;

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

export interface BilibiliVideoReference {
  bvid: string;
  sourceUrl: string;
}

export interface ParsedEmbeddedSeason {
  playlist: ResolvedFocusPlaylist;
  items: FocusPlaylistItem[];
  complete: boolean;
}

export interface BilibiliAudioSource {
  urls: string[];
  mimeType: "audio/mp4";
  codecs: "mp4a.40.2";
  bandwidth: number | null;
  cdnHost: string;
  deadline: number | null;
}

export type BilibiliErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "INVALID_BVID"
  | "NOT_IN_COLLECTION"
  | "BILIBILI_UNAVAILABLE"
  | "BILIBILI_RATE_LIMITED"
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

export function parseBilibiliVideoUrl(value: string): BilibiliVideoReference {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_048) {
    throw new BilibiliError("INVALID_URL", "The playlist URL is empty or too long", 400);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (error) {
    throw new BilibiliError("INVALID_URL", "The playlist URL is invalid", 400, { cause: error });
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new BilibiliError("INVALID_URL", "The playlist URL must use HTTP(S)", 400);
  }
  if (url.hostname !== "www.bilibili.com" || (url.port && url.port !== "443")) {
    throw new BilibiliError("UNSUPPORTED_HOST", "Only www.bilibili.com video URLs are supported", 400);
  }
  const match = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
  if (!match) {
    throw new BilibiliError("INVALID_BVID", "The URL does not contain a valid BVID", 400);
  }
  return {
    bvid: match[1],
    sourceUrl: `https://www.bilibili.com/video/${match[1]}/`,
  };
}

export function extractBvidFromVideoUrl(value: string): string | null {
  try {
    return parseBilibiliVideoUrl(value).bvid;
  } catch {
    return null;
  }
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveIntegerString(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value)
    ? value
    : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function nonNegativeDuration(value: unknown): number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 604_800
    ? Math.floor(value)
    : 0;
}

function normalizeBilibiliImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (!BILIBILI_IMAGE_SUFFIXES.some((suffix) => hostMatchesSuffix(url.hostname, suffix))) {
      return null;
    }
    url.protocol = "https:";
    url.port = "";
    return url.toString();
  } catch {
    return null;
  }
}

function throwForBusinessCode(payload: Record<string, unknown>, operation: string): void {
  if (payload.code === -352) {
    throw new BilibiliError(
      "BILIBILI_RISK_CONTROL",
      `Bilibili risk control rejected ${operation}`,
      503
    );
  }
  if (payload.code !== 0) {
    throw new BilibiliError(
      "BILIBILI_UNAVAILABLE",
      `Bilibili ${operation} returned business code ${String(payload.code)}`
    );
  }
}

function parsePlaylistItem(value: unknown, sourceIndex: number): FocusPlaylistItem | null {
  const item = asRecord(value);
  if (!item || !isValidBilibiliBvid(item.bvid)) return null;
  const arc = asRecord(item.arc);
  const title = boundedText(item.title, 500) ?? boundedText(arc?.title, 500);
  if (!title) return null;
  return {
    bvid: item.bvid,
    cid: positiveIntegerString(item.cid),
    sourceIndex,
    title,
    duration: nonNegativeDuration(arc?.duration ?? item.duration),
  };
}

export function parseBilibiliUgcSeasonView(
  payload: unknown,
  reference: BilibiliVideoReference
): ParsedEmbeddedSeason {
  if (!isValidBilibiliBvid(reference.bvid)) {
    throw new TypeError("A valid source BVID is required");
  }
  const root = asRecord(payload);
  if (!root) {
    throw new BilibiliError("INVALID_UPSTREAM_RESPONSE", "Bilibili view was not an object");
  }
  throwForBusinessCode(root, "view");
  const data = asRecord(root.data);
  if (!data) {
    throw new BilibiliError("INVALID_UPSTREAM_RESPONSE", "Bilibili view omitted data");
  }
  const season = asRecord(data.ugc_season);
  if (!season) {
    throw new BilibiliError(
      "NOT_IN_COLLECTION",
      "The submitted video does not belong to a UGC season",
      422
    );
  }

  const seasonId = positiveIntegerString(season.id);
  const ownerMid = positiveIntegerString(season.mid);
  const owner = asRecord(data.owner);
  const ownerName = boundedText(owner?.name, 100);
  const title = boundedText(season.title, 300);
  const cover = normalizeBilibiliImageUrl(season.cover);
  const itemCount = typeof season.ep_count === "number"
    && Number.isSafeInteger(season.ep_count)
    && season.ep_count > 0
    && season.ep_count <= MAX_PLAYLIST_ITEMS
    ? season.ep_count
    : null;
  if (!seasonId || !ownerMid || !ownerName || !title || !cover || itemCount === null) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili returned invalid UGC season metadata"
    );
  }
  if (!Array.isArray(season.sections)) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili returned invalid UGC season sections"
    );
  }

  const items: FocusPlaylistItem[] = [];
  const identities = new Set<string>();
  let sourceIndex = 0;
  for (const rawSection of season.sections) {
    const section = asRecord(rawSection);
    if (!section || !Array.isArray(section.episodes)) continue;
    for (const episode of section.episodes) {
      const item = parsePlaylistItem(episode, sourceIndex);
      sourceIndex += 1;
      if (!item) continue;
      const identity = `${item.bvid}:${item.cid ?? ""}`;
      if (identities.has(identity)) continue;
      identities.add(identity);
      items.push(item);
    }
  }

  return {
    playlist: {
      id: createFocusPlaylistId(seasonId),
      provider: "bilibili",
      kind: "ugc-season",
      sourceUrl: reference.sourceUrl,
      sourceBvid: reference.bvid,
      canonicalUrl: `https://space.bilibili.com/${ownerMid}/lists/${seasonId}?type=season`,
      seasonId,
      ownerMid,
      ownerName,
      title,
      cover,
      itemCount,
    },
    items,
    complete: items.length === itemCount,
  };
}

export interface BilibiliSeasonPage {
  items: FocusPlaylistItem[];
  total: number;
}

export function parseBilibiliSeasonArchivesPage(
  payload: unknown,
  pageNumber: number,
  pageSize = SEASON_PAGE_SIZE
): BilibiliSeasonPage {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new TypeError("A valid page number is required");
  }
  const root = asRecord(payload);
  if (!root) {
    throw new BilibiliError("INVALID_UPSTREAM_RESPONSE", "Bilibili season page was not an object");
  }
  throwForBusinessCode(root, "season archives");
  const data = asRecord(root.data);
  const meta = asRecord(data?.meta);
  const page = asRecord(data?.page);
  const totalValue = meta?.total ?? page?.total;
  const total = typeof totalValue === "number"
    && Number.isSafeInteger(totalValue)
    && totalValue >= 0
    && totalValue <= MAX_PLAYLIST_ITEMS
    ? totalValue
    : null;
  if (!data || !Array.isArray(data.archives) || total === null) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili returned invalid season archives"
    );
  }
  const offset = (pageNumber - 1) * pageSize;
  const items = data.archives
    .map((archive, index) => parsePlaylistItem(archive, offset + index))
    .filter((item): item is FocusPlaylistItem => item !== null);
  return { items, total };
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

async function fetchBilibiliJson(
  endpoint: URL,
  options: {
    operation: string;
    referer: string;
    signal?: AbortSignal;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    maxBytes: number;
  }
): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  let response: Response;
  try {
    response = await options.fetchImpl(endpoint, {
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        Accept: "application/json",
        Referer: options.referer,
        "User-Agent": "InspirationsFarmFocusPlaylist/1.0",
      },
    });
  } catch (error) {
    throw new BilibiliError(
      "BILIBILI_UNAVAILABLE",
      `Unable to reach Bilibili ${options.operation}`,
      502,
      { cause: error }
    );
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new BilibiliError(
      "BILIBILI_RATE_LIMITED",
      `Bilibili rate limited ${options.operation}`,
      503
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new BilibiliError(
      "BILIBILI_UNAVAILABLE",
      `Bilibili ${options.operation} returned HTTP ${response.status}`
    );
  }
  return readJsonWithLimit(response, options.maxBytes);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function resolveBilibiliPlaylist(
  value: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    retryDelay?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<FocusPlaylistResolution> {
  const reference = parseBilibiliVideoUrl(value);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const viewEndpoint = new URL(VIEW_ENDPOINT);
  viewEndpoint.searchParams.set("bvid", reference.bvid);
  const viewPayload = await fetchBilibiliJson(viewEndpoint, {
    operation: "view",
    referer: reference.sourceUrl,
    signal: options.signal,
    fetchImpl,
    timeoutMs,
    maxBytes: 8_388_608,
  });
  const embedded = parseBilibiliUgcSeasonView(viewPayload, reference);
  if (embedded.complete) {
    return { playlist: embedded.playlist, items: embedded.items };
  }

  const pageCount = Math.ceil(embedded.playlist.itemCount / SEASON_PAGE_SIZE);
  const byBvid = new Map(embedded.items.map((item) => [item.bvid, item]));
  const retryDelay = options.retryDelay ?? delay;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const endpoint = new URL(SEASON_ARCHIVES_ENDPOINT);
    endpoint.searchParams.set("mid", embedded.playlist.ownerMid);
    endpoint.searchParams.set("season_id", embedded.playlist.seasonId);
    endpoint.searchParams.set("sort_reverse", "false");
    endpoint.searchParams.set("page_num", String(pageNumber));
    endpoint.searchParams.set("page_size", String(SEASON_PAGE_SIZE));

    let parsedPage: BilibiliSeasonPage | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const payload = await fetchBilibiliJson(endpoint, {
          operation: "season archives",
          referer: embedded.playlist.canonicalUrl,
          signal: options.signal,
          fetchImpl,
          timeoutMs,
          maxBytes: 1_048_576,
        });
        parsedPage = parseBilibiliSeasonArchivesPage(payload, pageNumber);
        break;
      } catch (error) {
        const retryable = error instanceof BilibiliError
          && (error.code === "BILIBILI_RISK_CONTROL" || error.code === "BILIBILI_RATE_LIMITED");
        if (!retryable || attempt === 2) throw error;
        await retryDelay(200 * (2 ** attempt));
      }
    }
    if (!parsedPage || parsedPage.total !== embedded.playlist.itemCount) {
      throw new BilibiliError(
        "INVALID_UPSTREAM_RESPONSE",
        "Bilibili season totals changed during pagination"
      );
    }
    for (const item of parsedPage.items) {
      const existing = byBvid.get(item.bvid);
      byBvid.set(item.bvid, existing?.cid ? { ...item, cid: existing.cid } : item);
    }
  }

  const items = [...byBvid.values()].sort((left, right) => left.sourceIndex - right.sourceIndex);
  if (items.length !== embedded.playlist.itemCount) {
    throw new BilibiliError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili did not return the complete UGC season"
    );
  }
  return { playlist: embedded.playlist, items };
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
