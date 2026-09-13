import assert from "node:assert/strict";
import test from "node:test";

import { planCompression } from "../src/lib/image-compress.ts";

const MB = 1024 * 1024;

function assertMode(input, mode) {
  const plan = planCompression(input);
  assert.equal(plan.mode, mode, `expected ${mode} for ${JSON.stringify(input)}`);
  return plan;
}

test("gifs always pass through untouched (animation preserved)", () => {
  assertMode({ type: "image/gif", size: 3 * MB }, "passthrough");
});

test("files at or under 1MB pass through regardless of type", () => {
  assertMode({ type: "image/png", size: 1024 * 1024 }, "passthrough");
  assertMode({ type: "image/jpeg", size: 300 * 1024 }, "passthrough");
  // Unknown/empty declared type still passes when small (server sniffs anyway).
  assertMode({ type: "", size: 500 * 1024 }, "passthrough");
});

test("files over 1MB (non-gif) are compressed", () => {
  assertMode({ type: "image/jpeg", size: 3 * MB }, "compress");
  assertMode({ type: "image/heic", size: 2 * MB }, "compress");
  assertMode({ type: "", size: 2 * MB }, "compress");
});

test("anything over the 4MB hard cap is rejected up front", () => {
  for (const type of ["image/gif", "image/png", "image/jpeg", ""]) {
    const plan = assertMode({ type, size: 4 * MB + 1 }, "reject");
    assert.ok(plan.reason, "rejections carry a user-facing reason");
  }
  // Exactly at the cap still passes the gate (server enforces the boundary).
  assertMode({ type: "image/png", size: 4 * MB }, "compress");
});
