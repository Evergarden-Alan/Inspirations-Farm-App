import {
  isValidBilibiliBvid,
  isValidBilibiliCid,
  resolveBilibiliPlaylist,
  resolveBilibiliVideoCids,
} from "./bilibili";
import {
  readFocusPlaylistConfigFromGitHub,
  removeFocusPlaylistFromGitHub,
  upsertFocusPlaylistOnGitHub,
} from "./focus-playlist-github";
import {
  createFocusRelayUrl,
  FocusRelayConfigError,
} from "./focus-relay-ticket";
import type {
  FocusPlaylistConfig,
  FocusPlaylistItem,
  FocusPlaylistResolution,
} from "./focus-playlists";

export type FocusPlaylistServiceErrorCode =
  | "PLAYLIST_NOT_FOUND"
  | "NOT_IN_COLLECTION"
  | "INVALID_BVID"
  | "INVALID_CID"
  | "RELAY_UNAVAILABLE";

export class FocusPlaylistServiceError extends Error {
  readonly code: FocusPlaylistServiceErrorCode;
  readonly status: number;

  constructor(code: FocusPlaylistServiceErrorCode, message: string, status: number) {
    super(message);
    this.name = "FocusPlaylistServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface FocusPlaylistServiceDependencies {
  readConfig?: typeof readFocusPlaylistConfigFromGitHub;
  resolvePlaylist?: typeof resolveBilibiliPlaylist;
  upsertPlaylist?: typeof upsertFocusPlaylistOnGitHub;
  removePlaylist?: typeof removeFocusPlaylistFromGitHub;
  resolveVideoCids?: typeof resolveBilibiliVideoCids;
  relayBaseUrl?: string;
  relaySecret?: string;
  nowSeconds?: number;
  requireHttps?: boolean;
}

function findPlaylist(config: FocusPlaylistConfig, playlistId: string) {
  const playlist = config.playlists.find((candidate) => candidate.id === playlistId);
  if (!playlist) {
    throw new FocusPlaylistServiceError(
      "PLAYLIST_NOT_FOUND",
      "The focus playlist is not configured",
      404
    );
  }
  return playlist;
}

async function resolveConfiguredPlaylist(
  playlistId: string,
  dependencies: FocusPlaylistServiceDependencies
): Promise<FocusPlaylistResolution> {
  const readConfig = dependencies.readConfig ?? readFocusPlaylistConfigFromGitHub;
  const resolvePlaylist = dependencies.resolvePlaylist ?? resolveBilibiliPlaylist;
  const playlist = findPlaylist(await readConfig(), playlistId);
  const resolution = await resolvePlaylist(playlist.sourceUrl);
  if (resolution.playlist.id !== playlist.id) {
    throw new FocusPlaylistServiceError(
      "NOT_IN_COLLECTION",
      "The configured source video no longer resolves to this playlist",
      409
    );
  }
  return resolution;
}

export async function listFocusPlaylists(
  dependencies: FocusPlaylistServiceDependencies = {}
): Promise<FocusPlaylistConfig> {
  return (dependencies.readConfig ?? readFocusPlaylistConfigFromGitHub)();
}

export async function addFocusPlaylist(
  url: string,
  dependencies: FocusPlaylistServiceDependencies = {}
) {
  const resolution = await (dependencies.resolvePlaylist ?? resolveBilibiliPlaylist)(url);
  const write = await (dependencies.upsertPlaylist ?? upsertFocusPlaylistOnGitHub)(
    resolution.playlist
  );
  return {
    ...write,
    reason: !write.created && !write.updated ? "DUPLICATE_PLAYLIST" as const : null,
    items: resolution.items,
  };
}

export async function deleteFocusPlaylist(
  playlistId: string,
  dependencies: FocusPlaylistServiceDependencies = {}
) {
  return (dependencies.removePlaylist ?? removeFocusPlaylistFromGitHub)(playlistId);
}

export async function getFocusPlaylistItems(
  playlistId: string,
  dependencies: FocusPlaylistServiceDependencies = {}
): Promise<FocusPlaylistResolution> {
  return resolveConfiguredPlaylist(playlistId, dependencies);
}

async function resolveAuthorizedCid(
  item: FocusPlaylistItem,
  requestedCid: string | null,
  dependencies: FocusPlaylistServiceDependencies
): Promise<string> {
  if (item.cid) {
    if (requestedCid && requestedCid !== item.cid) {
      throw new FocusPlaylistServiceError(
        "NOT_IN_COLLECTION",
        "The requested CID does not belong to this playlist item",
        403
      );
    }
    return item.cid;
  }
  const cids = await (dependencies.resolveVideoCids ?? resolveBilibiliVideoCids)(item.bvid);
  if (requestedCid && !cids.includes(requestedCid)) {
    throw new FocusPlaylistServiceError(
      "NOT_IN_COLLECTION",
      "The requested CID does not belong to this video",
      403
    );
  }
  return requestedCid ?? cids[0];
}

export async function createFocusAudioTicket(
  input: { playlistId: string; bvid: string; cid: string | null },
  dependencies: FocusPlaylistServiceDependencies = {}
) {
  if (!isValidBilibiliBvid(input.bvid)) {
    throw new FocusPlaylistServiceError("INVALID_BVID", "A valid BVID is required", 400);
  }
  if (input.cid !== null && !isValidBilibiliCid(input.cid)) {
    throw new FocusPlaylistServiceError("INVALID_CID", "A valid CID is required", 400);
  }
  const resolution = await resolveConfiguredPlaylist(input.playlistId, dependencies);
  const item = resolution.items.find((candidate) => candidate.bvid === input.bvid);
  if (!item) {
    throw new FocusPlaylistServiceError(
      "NOT_IN_COLLECTION",
      "The requested BVID does not belong to this playlist",
      403
    );
  }
  const cid = await resolveAuthorizedCid(item, input.cid, dependencies);
  const relayBaseUrl = dependencies.relayBaseUrl ?? process.env.FOCUS_AUDIO_RELAY_BASE_URL;
  const relaySecret = dependencies.relaySecret ?? process.env.FOCUS_AUDIO_RELAY_SIGNING_SECRET;
  if (!relayBaseUrl || !relaySecret) {
    throw new FocusPlaylistServiceError(
      "RELAY_UNAVAILABLE",
      "The focus audio relay is not configured",
      503
    );
  }
  try {
    const ticket = createFocusRelayUrl({
      baseUrl: relayBaseUrl,
      secret: relaySecret,
      bvid: item.bvid,
      cid,
      nowSeconds: dependencies.nowSeconds,
      requireHttps: dependencies.requireHttps ?? process.env.NODE_ENV === "production",
    });
    return {
      audio: {
        url: ticket.url,
        mimeType: "audio/mp4" as const,
        expiresAt: ticket.expiresAt,
      },
      track: {
        playlistId: resolution.playlist.id,
        bvid: item.bvid,
        cid,
        sourceIndex: item.sourceIndex,
      },
    };
  } catch (error) {
    if (error instanceof FocusRelayConfigError) {
      throw new FocusPlaylistServiceError(
        "RELAY_UNAVAILABLE",
        "The focus audio relay configuration is invalid",
        503
      );
    }
    throw error;
  }
}
