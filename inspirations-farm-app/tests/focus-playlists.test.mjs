import assert from "node:assert/strict";
import test from "node:test";

import {
  BilibiliError,
  parseBilibiliUgcSeasonView,
  parseBilibiliVideoUrl,
  resolveBilibiliPlaylist,
  resolveBilibiliVideoCids,
} from "../src/lib/bilibili.ts";
import {
  createFocusPlaylistId,
  FOCUS_PLAYLIST_CONFIG_PATH,
} from "../src/lib/focus-playlists.ts";

const SOURCE_BVID = "BV1f53B6qEB6";
const OTHER_BVID = "BV1Ff421B7sS";
const SOURCE_URL = `https://www.bilibili.com/video/${SOURCE_BVID}/`;

function episode(bvid, cid, title, duration) {
  return { bvid, cid, title, arc: { title, duration } };
}

function viewPayload(episodes, epCount = episodes.length) {
  return {
    code: 0,
    data: {
      owner: { mid: 31467140, name: "Verasmelody" },
      ugc_season: {
        id: 3458136,
        mid: 31467140,
        title: "新古典主义·学习｜工作｜居家｜冥想",
        cover: "http://archive.biliimg.com/bfs/archive/cover.jpg",
        ep_count: epCount,
        sections: [{ episodes }],
      },
    },
  };
}

test("playlist URLs normalize to one canonical Bilibili video reference", () => {
  assert.deepEqual(
    parseBilibiliVideoUrl(` http://www.bilibili.com/video/${SOURCE_BVID}?share=1#reply `),
    { bvid: SOURCE_BVID, sourceUrl: SOURCE_URL }
  );
  assert.throws(
    () => parseBilibiliVideoUrl(`https://www.bilibili.com.evil.test/video/${SOURCE_BVID}/`),
    (error) => error instanceof BilibiliError && error.code === "UNSUPPORTED_HOST"
  );
  assert.throws(
    () => parseBilibiliVideoUrl("https://www.bilibili.com/video/not-a-bvid/"),
    (error) => error instanceof BilibiliError && error.code === "INVALID_BVID"
  );
});

test("UGC season metadata creates a stable playlist identity and typed items", () => {
  const parsed = parseBilibiliUgcSeasonView(
    viewPayload([
      episode(OTHER_BVID, 1622386333, "第一首", 3187),
      episode(SOURCE_BVID, 40377256216, "第二首", 5356),
    ]),
    { bvid: SOURCE_BVID, sourceUrl: SOURCE_URL }
  );

  assert.equal(FOCUS_PLAYLIST_CONFIG_PATH, "Areas/FocusPlaylists/playlists.json");
  assert.equal(createFocusPlaylistId("3458136"), "bilibili:ugc-season:3458136");
  assert.equal(parsed.playlist.id, "bilibili:ugc-season:3458136");
  assert.equal(parsed.playlist.canonicalUrl, "https://space.bilibili.com/31467140/lists/3458136?type=season");
  assert.equal(parsed.playlist.cover, "https://archive.biliimg.com/bfs/archive/cover.jpg");
  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.items[1], {
    bvid: SOURCE_BVID,
    cid: "40377256216",
    sourceIndex: 1,
    title: "第二首",
    duration: 5356,
  });
});

test("videos outside a UGC season are rejected without creating metadata", () => {
  assert.throws(
    () => parseBilibiliUgcSeasonView(
      { code: 0, data: { owner: { mid: 1, name: "owner" } } },
      { bvid: SOURCE_BVID, sourceUrl: SOURCE_URL }
    ),
    (error) => error instanceof BilibiliError && error.code === "NOT_IN_COLLECTION"
  );
});

test("incomplete embedded episodes use bounded pagination and retain known CIDs", async () => {
  let seasonAttempts = 0;
  const retryDelays = [];
  const resolution = await resolveBilibiliPlaylist(SOURCE_URL, {
    retryDelay: async (milliseconds) => { retryDelays.push(milliseconds); },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/x/web-interface/view") {
        return Response.json(viewPayload([
          episode(OTHER_BVID, 1622386333, "第一首", 3187),
        ], 2));
      }
      seasonAttempts += 1;
      if (seasonAttempts === 1) return Response.json({ code: -352 });
      return Response.json({
        code: 0,
        data: {
          meta: { total: 2 },
          archives: [
            { bvid: OTHER_BVID, title: "第一首", duration: 3187 },
            { bvid: SOURCE_BVID, title: "第二首", duration: 5356 },
          ],
        },
      });
    },
  });

  assert.deepEqual(retryDelays, [200]);
  assert.equal(seasonAttempts, 2);
  assert.equal(resolution.items.length, 2);
  assert.equal(resolution.items[0].cid, "1622386333");
  assert.equal(resolution.items[1].cid, null);
});

test("video view resolves only validated CIDs for the requested BVID", async () => {
  const cids = await resolveBilibiliVideoCids(SOURCE_BVID, {
    fetchImpl: async () => Response.json({
      code: 0,
      data: {
        bvid: SOURCE_BVID,
        cid: 40377256216,
        pages: [{ cid: 40377256216 }, { cid: 40377256217 }],
      },
    }),
  });
  assert.deepEqual(cids, ["40377256216", "40377256217"]);
});
