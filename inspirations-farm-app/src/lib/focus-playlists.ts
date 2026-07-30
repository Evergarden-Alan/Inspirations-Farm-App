export const FOCUS_PLAYLIST_CONFIG_PATH = "Areas/FocusPlaylists/playlists.json";
export const FOCUS_PLAYLIST_CONFIG_VERSION = 1 as const;
export const FOCUS_PLAYLIST_CACHE_VERSION = 1 as const;

export interface FocusPlaylist {
  id: string;
  provider: "bilibili";
  kind: "ugc-season";
  sourceUrl: string;
  sourceBvid: string;
  canonicalUrl: string;
  seasonId: string;
  ownerMid: string;
  ownerName: string;
  title: string;
  cover: string;
  itemCount: number;
  addedAt: string;
  metadataUpdatedAt: string;
}

export type ResolvedFocusPlaylist = Omit<FocusPlaylist, "addedAt" | "metadataUpdatedAt">;

export interface FocusPlaylistItem {
  bvid: string;
  cid: string | null;
  sourceIndex: number;
  title: string;
  duration: number;
}

export interface FocusPlaylistResolution {
  playlist: ResolvedFocusPlaylist;
  items: FocusPlaylistItem[];
}

export interface FocusPlaylistConfig {
  version: typeof FOCUS_PLAYLIST_CONFIG_VERSION;
  updatedAt: string;
  playlists: FocusPlaylist[];
}

export interface FocusPlaylistCache {
  id: string;
  schemaVersion: typeof FOCUS_PLAYLIST_CACHE_VERSION;
  fetchedAt: string;
  total: number;
  items: FocusPlaylistItem[];
}

export function createFocusPlaylistId(seasonId: string): string {
  if (!/^[1-9][0-9]{0,19}$/.test(seasonId)) {
    throw new TypeError("A valid UGC season ID is required");
  }
  return `bilibili:ugc-season:${seasonId}`;
}
