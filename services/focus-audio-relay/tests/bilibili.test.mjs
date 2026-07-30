import assert from "node:assert/strict";
import test from "node:test";

import {
  BilibiliUpstreamError,
  extractDeadline,
  isAllowedCdnUrl,
  resolveBilibiliAudio,
  selectAacAudio,
} from "../src/bilibili.mjs";

const GOOD_URL = "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1800000000";

test("CDN allowlist rejects non-HTTPS, credentials, and lookalike hosts", () => {
  assert.equal(isAllowedCdnUrl(GOOD_URL), true);
  assert.equal(isAllowedCdnUrl("http://x.bilivideo.com/audio.m4s"), false);
  assert.equal(isAllowedCdnUrl("https://bilivideo.com.evil.test/audio.m4s"), false);
  assert.equal(isAllowedCdnUrl("https://user@bilivideo.com/audio.m4s"), false);
  assert.equal(extractDeadline(GOOD_URL), 1_800_000_000);
});

test("AAC selector ignores video, Dolby-like codecs, and unapproved URLs", () => {
  const selected = selectAacAudio({
    audio: [
      { mimeType: "video/mp4", codecs: "avc1.640032", baseUrl: GOOD_URL, bandwidth: 999_999 },
      { mimeType: "audio/mp4", codecs: "ec-3", baseUrl: GOOD_URL, bandwidth: 500_000 },
      { mimeType: "audio/mp4", codecs: "mp4a.40.2", baseUrl: "https://evil.test/a", bandwidth: 300_000 },
      {
        mimeType: "audio/mp4",
        codecs: "mp4a.40.2",
        baseUrl: GOOD_URL,
        backupUrl: ["https://backup.bilivideo.cn/audio.m4s"],
        bandwidth: 192_000,
      },
    ],
  });

  assert.deepEqual(selected.urls, [GOOD_URL, "https://backup.bilivideo.cn/audio.m4s"]);
  assert.equal(selected.mimeType, "audio/mp4");
  assert.equal(selected.codecs, "mp4a.40.2");
  assert.equal(selected.deadline, 1_800_000_000);
});

test("playurl resolver validates the business response and returns no raw payload", async () => {
  const fetchImpl = async () => Response.json({
    code: 0,
    data: {
      dash: {
        audio: [{
          mimeType: "audio/mp4",
          codecs: "mp4a.40.2",
          baseUrl: GOOD_URL,
          bandwidth: 128_000,
        }],
      },
    },
  });
  const result = await resolveBilibiliAudio({
    bvid: "BV1f53B6qEB6",
    cid: "40377256216",
    fetchImpl,
  });
  assert.equal(result.cdnHost, "upos-sz-mirrorcos.bilivideo.com");
  assert.equal("dash" in result, false);
});

test("risk control receives a stable structured error", async () => {
  await assert.rejects(
    resolveBilibiliAudio({
      bvid: "BV1f53B6qEB6",
      cid: "40377256216",
      fetchImpl: async () => Response.json({ code: -352 }),
    }),
    (error) => error instanceof BilibiliUpstreamError
      && error.code === "BILIBILI_RISK_CONTROL"
  );
});
