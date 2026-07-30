import {
  createFocusPlaylistId,
  FOCUS_PLAYLIST_CONFIG_VERSION,
  type FocusPlaylist,
  type FocusPlaylistConfig,
  type ResolvedFocusPlaylist,
} from "./focus-playlists";

export type FocusPlaylistConfigErrorCode =
  | "CONFIG_CORRUPTED"
  | "CONFIG_CONFLICT"
  | "PLAYLIST_NOT_FOUND";

export class FocusPlaylistConfigError extends Error {
  readonly code: FocusPlaylistConfigErrorCode;
  readonly status: number;

  constructor(code: FocusPlaylistConfigErrorCode, message: string, status = 500) {
    super(message);
    this.name = "FocusPlaylistConfigError";
    this.code = code;
    this.status = status;
  }
}

const PLAYLIST_KEYS = [
  "id",
  "provider",
  "kind",
  "sourceUrl",
  "sourceBvid",
  "canonicalUrl",
  "seasonId",
  "ownerMid",
  "ownerName",
  "title",
  "cover",
  "itemCount",
  "addedAt",
  "metadataUpdatedAt",
] as const;
const CONFIG_KEYS = ["version", "updatedAt", "playlists"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && [...expected].sort().every((key, index) => keys[index] === key);
}

function isExternalId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && value.length <= maxLength;
}

function isAllowedCover(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && ["hdslb.com", "biliimg.com"].some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`)
      );
  } catch {
    return false;
  }
}

function parsePlaylist(value: unknown): FocusPlaylist | null {
  const playlist = asRecord(value);
  if (!playlist || !hasExactKeys(playlist, PLAYLIST_KEYS)) return null;
  if (!isExternalId(playlist.seasonId) || !isExternalId(playlist.ownerMid)) return null;
  if (
    playlist.provider !== "bilibili"
    || playlist.kind !== "ugc-season"
    || playlist.id !== createFocusPlaylistId(playlist.seasonId)
    || typeof playlist.sourceBvid !== "string"
    || !/^BV[0-9A-Za-z]{10}$/.test(playlist.sourceBvid)
    || playlist.sourceUrl !== `https://www.bilibili.com/video/${playlist.sourceBvid}/`
    || playlist.canonicalUrl !== `https://space.bilibili.com/${playlist.ownerMid}/lists/${playlist.seasonId}?type=season`
    || !isBoundedText(playlist.ownerName, 100)
    || !isBoundedText(playlist.title, 300)
    || !isAllowedCover(playlist.cover)
    || typeof playlist.itemCount !== "number"
    || !Number.isSafeInteger(playlist.itemCount)
    || playlist.itemCount < 1
    || playlist.itemCount > 2_000
    || !isTimestamp(playlist.addedAt)
    || !isTimestamp(playlist.metadataUpdatedAt)
  ) {
    return null;
  }
  return playlist as unknown as FocusPlaylist;
}

export function createEmptyFocusPlaylistConfig(now: string): FocusPlaylistConfig {
  if (!isTimestamp(now)) throw new TypeError("A valid ISO timestamp is required");
  return { version: FOCUS_PLAYLIST_CONFIG_VERSION, updatedAt: now, playlists: [] };
}

export function parseFocusPlaylistConfig(raw: string): FocusPlaylistConfig {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FocusPlaylistConfigError(
      "CONFIG_CORRUPTED",
      "Focus playlist configuration is not valid JSON",
      500
    );
  }
  const config = asRecord(value);
  if (
    !config
    || !hasExactKeys(config, CONFIG_KEYS)
    || config.version !== FOCUS_PLAYLIST_CONFIG_VERSION
    || !isTimestamp(config.updatedAt)
    || !Array.isArray(config.playlists)
  ) {
    throw new FocusPlaylistConfigError(
      "CONFIG_CORRUPTED",
      "Focus playlist configuration has an unsupported structure",
      500
    );
  }
  const playlists = config.playlists.map(parsePlaylist);
  if (playlists.some((playlist) => playlist === null)) {
    throw new FocusPlaylistConfigError(
      "CONFIG_CORRUPTED",
      "Focus playlist configuration contains an invalid playlist",
      500
    );
  }
  const typedPlaylists = playlists as FocusPlaylist[];
  if (new Set(typedPlaylists.map((playlist) => playlist.id)).size !== typedPlaylists.length) {
    throw new FocusPlaylistConfigError(
      "CONFIG_CORRUPTED",
      "Focus playlist configuration contains duplicate IDs",
      500
    );
  }
  return {
    version: FOCUS_PLAYLIST_CONFIG_VERSION,
    updatedAt: config.updatedAt,
    playlists: typedPlaylists,
  };
}

export function serializeFocusPlaylistConfig(config: FocusPlaylistConfig): string {
  const validated = parseFocusPlaylistConfig(JSON.stringify(config));
  return `${JSON.stringify(validated, null, 2)}\n`;
}

const METADATA_KEYS = [
  "canonicalUrl",
  "ownerMid",
  "ownerName",
  "title",
  "cover",
  "itemCount",
] as const satisfies readonly (keyof ResolvedFocusPlaylist)[];

export interface UpsertFocusPlaylistResult {
  config: FocusPlaylistConfig;
  playlist: FocusPlaylist;
  created: boolean;
  updated: boolean;
}

export function upsertFocusPlaylistConfig(
  config: FocusPlaylistConfig,
  resolved: ResolvedFocusPlaylist,
  now: string
): UpsertFocusPlaylistResult {
  if (!isTimestamp(now)) throw new TypeError("A valid ISO timestamp is required");
  const existingIndex = config.playlists.findIndex((playlist) => playlist.id === resolved.id);
  if (existingIndex === -1) {
    const playlist: FocusPlaylist = { ...resolved, addedAt: now, metadataUpdatedAt: now };
    const nextConfig = {
      version: FOCUS_PLAYLIST_CONFIG_VERSION,
      updatedAt: now,
      playlists: [...config.playlists, playlist],
    };
    parseFocusPlaylistConfig(JSON.stringify(nextConfig));
    return { config: nextConfig, playlist, created: true, updated: false };
  }

  const existing = config.playlists[existingIndex];
  const metadataChanged = METADATA_KEYS.some((key) => existing[key] !== resolved[key]);
  if (!metadataChanged) {
    return { config, playlist: existing, created: false, updated: false };
  }
  const playlist: FocusPlaylist = {
    ...existing,
    canonicalUrl: resolved.canonicalUrl,
    ownerMid: resolved.ownerMid,
    ownerName: resolved.ownerName,
    title: resolved.title,
    cover: resolved.cover,
    itemCount: resolved.itemCount,
    metadataUpdatedAt: now,
  };
  const playlists = [...config.playlists];
  playlists[existingIndex] = playlist;
  const nextConfig = {
    version: FOCUS_PLAYLIST_CONFIG_VERSION,
    updatedAt: now,
    playlists,
  };
  parseFocusPlaylistConfig(JSON.stringify(nextConfig));
  return { config: nextConfig, playlist, created: false, updated: true };
}

export function removeFocusPlaylistConfig(
  config: FocusPlaylistConfig,
  playlistId: string,
  now: string
): { config: FocusPlaylistConfig; playlist: FocusPlaylist } {
  if (!isTimestamp(now)) throw new TypeError("A valid ISO timestamp is required");
  const playlist = config.playlists.find((candidate) => candidate.id === playlistId);
  if (!playlist) {
    throw new FocusPlaylistConfigError(
      "PLAYLIST_NOT_FOUND",
      "The focus playlist does not exist",
      404
    );
  }
  return {
    playlist,
    config: {
      version: FOCUS_PLAYLIST_CONFIG_VERSION,
      updatedAt: now,
      playlists: config.playlists.filter((candidate) => candidate.id !== playlistId),
    },
  };
}
