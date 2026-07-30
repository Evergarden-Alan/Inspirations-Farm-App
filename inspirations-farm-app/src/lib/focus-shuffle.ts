import type { FocusPlayerTrack } from "./focus-player-state";
import type { FocusPlaylistItem } from "./focus-playlists";

export interface FocusShufflePool {
  playlistId: string;
  items: FocusPlaylistItem[];
}

export interface FocusShuffleSelection {
  playlistId: string;
  item: FocusPlaylistItem;
}

export type FocusRandomSource = () => number;

function randomIndex(length: number, random: FocusRandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("The random source must return a number in [0, 1)");
  }
  return Math.floor(value * length);
}

function sameItem(
  playlistId: string,
  item: FocusPlaylistItem,
  track: FocusPlayerTrack
): boolean {
  return playlistId === track.playlistId
    && item.bvid === track.bvid
    && item.sourceIndex === track.sourceIndex;
}

function eligiblePools(
  pools: FocusShufflePool[],
  excluded: FocusPlayerTrack[]
): FocusShufflePool[] {
  return pools
    .map((pool) => ({
      playlistId: pool.playlistId,
      items: pool.items.filter(
        (item) => !excluded.some((track) => sameItem(pool.playlistId, item, track))
      ),
    }))
    .filter((pool) => pool.items.length > 0);
}

export function selectRandomFocusItem(
  pools: FocusShufflePool[],
  history: FocusPlayerTrack[] = [],
  current: FocusPlayerTrack | null = null,
  random: FocusRandomSource = Math.random
): FocusShuffleSelection | null {
  const playablePools = pools.filter((pool) => pool.items.length > 0);
  if (playablePools.length === 0) return null;

  const recent = history.slice(-20);
  const withoutRecent = eligiblePools(playablePools, recent);
  const withoutCurrent = current ? eligiblePools(playablePools, [current]) : playablePools;
  const candidates = withoutRecent.length > 0
    ? withoutRecent
    : withoutCurrent.length > 0
      ? withoutCurrent
      : playablePools;

  const pool = candidates[randomIndex(candidates.length, random)];
  return {
    playlistId: pool.playlistId,
    item: pool.items[randomIndex(pool.items.length, random)],
  };
}
