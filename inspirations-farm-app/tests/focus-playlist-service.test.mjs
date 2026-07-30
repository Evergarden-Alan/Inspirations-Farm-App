import assert from "node:assert/strict";
import test from "node:test";

import {
  createFocusAudioTicket,
  FocusPlaylistServiceError,
} from "../src/lib/focus-playlist-service.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const PLAYLIST_ID = "bilibili:ugc-season:3458136";
const BVID = "BV1f53B6qEB6";
const CID = "40377256216";
const playlist = {
  id: PLAYLIST_ID,
  provider: "bilibili",
  kind: "ugc-season",
  sourceUrl: `https://www.bilibili.com/video/${BVID}/`,
  sourceBvid: BVID,
  canonicalUrl: "https://space.bilibili.com/31467140/lists/3458136?type=season",
  seasonId: "3458136",
  ownerMid: "31467140",
  ownerName: "Verasmelody",
  title: "新古典主义·学习｜工作｜居家｜冥想",
  cover: "https://archive.biliimg.com/bfs/archive/cover.jpg",
  itemCount: 1,
  addedAt: "2026-07-31T01:30:00.000Z",
  metadataUpdatedAt: "2026-07-31T01:30:00.000Z",
};

function dependencies(item = { bvid: BVID, cid: CID, sourceIndex: 0, title: "音频", duration: 5356 }) {
  return {
    readConfig: async () => ({
      version: 1,
      updatedAt: "2026-07-31T01:30:00.000Z",
      playlists: [playlist],
    }),
    resolvePlaylist: async () => ({
      playlist: {
        id: playlist.id,
        provider: playlist.provider,
        kind: playlist.kind,
        sourceUrl: playlist.sourceUrl,
        sourceBvid: playlist.sourceBvid,
        canonicalUrl: playlist.canonicalUrl,
        seasonId: playlist.seasonId,
        ownerMid: playlist.ownerMid,
        ownerName: playlist.ownerName,
        title: playlist.title,
        cover: playlist.cover,
        itemCount: playlist.itemCount,
      },
      items: [item],
    }),
    relayBaseUrl: "https://media.alanevergarden.xyz/focus-audio",
    relaySecret: SECRET,
    nowSeconds: 1_700_000_000,
    requireHttps: true,
  };
}

test("audio tickets authorize one configured playlist item", async () => {
  const result = await createFocusAudioTicket({
    playlistId: PLAYLIST_ID,
    bvid: BVID,
    cid: CID,
  }, dependencies());
  const url = new URL(result.audio.url);
  assert.equal(url.pathname, `/focus-audio/v1/audio/${BVID}`);
  assert.equal(url.searchParams.get("cid"), CID);
  assert.equal(result.audio.mimeType, "audio/mp4");
  assert.deepEqual(result.track, {
    playlistId: PLAYLIST_ID,
    bvid: BVID,
    cid: CID,
    sourceIndex: 0,
  });
});

test("audio tickets reject BVID and CID values outside configured membership", async () => {
  await assert.rejects(
    createFocusAudioTicket({
      playlistId: PLAYLIST_ID,
      bvid: "BV1Ff421B7sS",
      cid: CID,
    }, dependencies()),
    (error) => error instanceof FocusPlaylistServiceError && error.code === "NOT_IN_COLLECTION"
  );
  await assert.rejects(
    createFocusAudioTicket({
      playlistId: PLAYLIST_ID,
      bvid: BVID,
      cid: "1622386333",
    }, dependencies()),
    (error) => error instanceof FocusPlaylistServiceError && error.code === "NOT_IN_COLLECTION"
  );
});

test("missing cached CID is resolved server-side before signing", async () => {
  let resolutions = 0;
  const deps = dependencies({
    bvid: BVID,
    cid: null,
    sourceIndex: 0,
    title: "音频",
    duration: 5356,
  });
  deps.resolveVideoCids = async () => {
    resolutions += 1;
    return [CID];
  };
  const result = await createFocusAudioTicket({
    playlistId: PLAYLIST_ID,
    bvid: BVID,
    cid: null,
  }, deps);
  assert.equal(resolutions, 1);
  assert.equal(result.track.cid, CID);
});
