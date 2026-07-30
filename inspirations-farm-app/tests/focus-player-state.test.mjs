import assert from "node:assert/strict";
import test from "node:test";

import {
  createFocusPlaylistCache,
  FOCUS_PLAYLIST_CACHE_MAX_AGE_MS,
  isFocusPlaylistCacheFresh,
  parseFocusPlaylistCache,
} from "../src/lib/focus-playlist-cache.ts";
import {
  appendFocusPlayerTrack,
  createFocusPlayerState,
  FOCUS_PLAYER_HISTORY_LIMIT,
  FOCUS_PLAYER_STORAGE_KEY,
  nextFocusPlayerHistoryTrack,
  parseFocusPlayerState,
  previousFocusPlayerTrack,
  readStoredFocusPlayerState,
  updateFocusPlayerTime,
  writeStoredFocusPlayerState,
} from "../src/lib/focus-player-state.ts";

const PLAYLIST_ID = "bilibili:ugc-season:3458136";
const FETCHED_AT = "2026-07-31T02:00:00.000Z";
const ITEM = {
  bvid: "BV1f53B6qEB6",
  cid: "40377256216",
  sourceIndex: 484,
  title: "潮水带星来",
  duration: 5356,
};
const TRACK = {
  playlistId: PLAYLIST_ID,
  bvid: ITEM.bvid,
  cid: ITEM.cid,
  sourceIndex: ITEM.sourceIndex,
};
const OTHER_TRACK = {
  playlistId: PLAYLIST_ID,
  bvid: "BV1Ff421B7sS",
  cid: "1622386333",
  sourceIndex: 0,
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("playlist caches validate derived items and expire after 24 hours", () => {
  const cache = createFocusPlaylistCache(PLAYLIST_ID, [ITEM], FETCHED_AT);
  const fetchedAt = Date.parse(FETCHED_AT);
  assert.deepEqual(parseFocusPlaylistCache(cache), cache);
  assert.equal(isFocusPlaylistCacheFresh(cache, fetchedAt + FOCUS_PLAYLIST_CACHE_MAX_AGE_MS - 1), true);
  assert.equal(isFocusPlaylistCacheFresh(cache, fetchedAt + FOCUS_PLAYLIST_CACHE_MAX_AGE_MS), false);
  assert.equal(parseFocusPlaylistCache({ ...cache, items: [{ ...ITEM, sourceIndex: -1 }] }), null);
});

test("player history supports real previous and forward navigation", () => {
  const initial = createFocusPlayerState("focus-session", TRACK, 1_000);
  const second = appendFocusPlayerTrack(initial, OTHER_TRACK, 2_000);
  const previous = previousFocusPlayerTrack(second, 3_000);
  assert.equal(previous.bvid, TRACK.bvid);
  assert.equal(previous.currentTime, 0);
  assert.equal(nextFocusPlayerHistoryTrack(previous, 4_000)?.bvid, OTHER_TRACK.bvid);

  const replacement = appendFocusPlayerTrack(previous, {
    ...OTHER_TRACK,
    cid: "1622386334",
    sourceIndex: 1,
  }, 5_000);
  assert.equal(replacement.history.length, 2);
  assert.equal(replacement.history[1].cid, "1622386334");
});

test("player state caps history and never accepts persisted audio URLs", () => {
  let state = createFocusPlayerState("focus-session", TRACK, 1_000);
  for (let index = 0; index < FOCUS_PLAYER_HISTORY_LIMIT + 4; index += 1) {
    state = appendFocusPlayerTrack(state, { ...OTHER_TRACK, sourceIndex: index }, 2_000 + index);
  }
  assert.equal(state.history.length, FOCUS_PLAYER_HISTORY_LIMIT);
  assert.equal(state.historyCursor, FOCUS_PLAYER_HISTORY_LIMIT - 1);
  assert.equal(parseFocusPlayerState({ ...state, audioUrl: "https://example.test/?sig=secret" }), null);
  assert.equal(JSON.stringify(state).includes("sig="), false);
});

test("stored state restores only the matching focus session and clears corruption", () => {
  const storage = memoryStorage();
  const state = updateFocusPlayerTime(
    createFocusPlayerState("focus-session", TRACK, 1_000),
    1284.5,
    2_000
  );
  assert.equal(writeStoredFocusPlayerState(state, storage), true);
  assert.equal(readStoredFocusPlayerState("focus-session", storage)?.currentTime, 1284.5);
  assert.equal(readStoredFocusPlayerState("another-session", storage), null);
  assert.equal(storage.values.has(FOCUS_PLAYER_STORAGE_KEY), false);

  storage.setItem(FOCUS_PLAYER_STORAGE_KEY, "not-json");
  assert.equal(readStoredFocusPlayerState("focus-session", storage), null);
  assert.equal(storage.values.has(FOCUS_PLAYER_STORAGE_KEY), false);
});
