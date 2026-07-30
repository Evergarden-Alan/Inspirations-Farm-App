import assert from "node:assert/strict";
import test from "node:test";

import {
  BilibiliError,
  extractBvidFromVideoUrl,
  isAllowedBilibiliCdnUrl,
  resolveBilibiliAudio,
  selectBilibiliAacAudio,
} from "../src/lib/bilibili.ts";

const AUDIO_URL = "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=1800000000";

test("Bilibili video URLs accept only the exact supported host and path", () => {
  assert.equal(
    extractBvidFromVideoUrl("https://www.bilibili.com/video/BV1f53B6qEB6/?share=1#reply"),
    "BV1f53B6qEB6"
  );
  assert.equal(extractBvidFromVideoUrl("https://bilibili.com/video/BV1f53B6qEB6/"), null);
  assert.equal(extractBvidFromVideoUrl("https://www.bilibili.com.evil.test/video/BV1f53B6qEB6/"), null);
  assert.equal(extractBvidFromVideoUrl("https://www.bilibili.com/list/BV1f53B6qEB6/"), null);
});

test("audio selection accepts only allowlisted AAC-LC tracks", () => {
  assert.equal(isAllowedBilibiliCdnUrl(AUDIO_URL), true);
  assert.equal(isAllowedBilibiliCdnUrl("https://bilivideo.com.evil.test/a"), false);
  const selected = selectBilibiliAacAudio({
    audio: [
      { mimeType: "audio/mp4", codecs: "ec-3", baseUrl: AUDIO_URL, bandwidth: 500_000 },
      { mimeType: "audio/mp4", codecs: "mp4a.40.2", baseUrl: AUDIO_URL, bandwidth: 128_000 },
    ],
  });
  assert.equal(selected.codecs, "mp4a.40.2");
  assert.equal(selected.deadline, 1_800_000_000);
});

test("playurl parsing maps Bilibili risk control without leaking payloads", async () => {
  await assert.rejects(
    resolveBilibiliAudio("BV1f53B6qEB6", "40377256216", {
      fetchImpl: async () => Response.json({ code: -352 }),
    }),
    (error) => error instanceof BilibiliError && error.code === "BILIBILI_RISK_CONTROL"
  );
});

test("playurl parsing returns the selected public AAC diagnostics", async () => {
  const result = await resolveBilibiliAudio("BV1f53B6qEB6", "40377256216", {
    fetchImpl: async () => Response.json({
      code: 0,
      data: {
        dash: {
          audio: [{
            mimeType: "audio/mp4",
            codecs: "mp4a.40.2",
            baseUrl: AUDIO_URL,
            bandwidth: 128_000,
          }],
        },
      },
    }),
  });
  assert.equal(result.cdnHost, "upos-sz-mirrorcos.bilivideo.com");
  assert.equal(result.bandwidth, 128_000);
});
