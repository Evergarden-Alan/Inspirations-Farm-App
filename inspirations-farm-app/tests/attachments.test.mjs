import assert from "node:assert/strict";
import test from "node:test";

import {
  EXT_BY_TYPE,
  generateAttachmentFilename,
  isSafeAttachmentFilename,
  sniffImageType,
} from "../src/lib/attachments.ts";

test("sniffImageType detects all four magic signatures", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const gif89 = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00,
  ]);
  const gif87 = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x10, 0x00,
  ]);

  assert.equal(sniffImageType(jpeg), "jpeg");
  assert.equal(sniffImageType(png), "png");
  assert.equal(sniffImageType(webp), "webp");
  assert.equal(sniffImageType(gif89), "gif");
  assert.equal(sniffImageType(gif87), "gif");
});

test("sniffImageType rejects garbage, empty input, and look-alikes", () => {
  assert.equal(sniffImageType(new TextEncoder().encode("<html><script>")), null);
  assert.equal(sniffImageType(new Uint8Array([])), null);
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8])), null); // truncated
  // RIFF container that is NOT webp (e.g. WAV).
  assert.equal(
    sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
    null
  );
  // Text that happens to start with GIF87a but isn't 6 clean bytes of header
  // followed by binary — sniff is signature-only by design.
  assert.equal(sniffImageType(new TextEncoder().encode("GIF89a")), "gif");
});

test("EXT_BY_TYPE maps sniffed types to canonical extensions", () => {
  assert.equal(EXT_BY_TYPE.jpeg, "jpg");
  assert.equal(EXT_BY_TYPE.png, "png");
  assert.equal(EXT_BY_TYPE.webp, "webp");
  assert.equal(EXT_BY_TYPE.gif, "gif");
});

test("generateAttachmentFilename uses Beijing time and the Obsidian convention", () => {
  // 2026-09-13 22:13:01 Beijing == 14:13:01 UTC — the formatter must use
  // Asia/Shanghai, not the host timezone.
  const utcInstant = new Date("2026-09-13T14:13:01Z");
  assert.equal(
    generateAttachmentFilename("png", utcInstant),
    "Pasted image 20260913221301.png"
  );
  assert.equal(
    generateAttachmentFilename("jpg", utcInstant, "-2"),
    "Pasted image 20260913221301-2.jpg"
  );
});

test("isSafeAttachmentFilename accepts vault-style names and rejects traversal", () => {
  // Real styles present in Assets/Sources.
  assert.equal(isSafeAttachmentFilename("Pasted image 20260913120000.png"), true);
  assert.equal(isSafeAttachmentFilename("331735633320_.pic.jpg"), true);
  assert.equal(isSafeAttachmentFilename("截图 备注.webp"), true);
  assert.equal(isSafeAttachmentFilename("Pasted image 20260913221301-2.jpg"), true);
  assert.equal(isSafeAttachmentFilename("UPPER.PNG"), true);

  // Traversal / directories / dotfiles / wrong types.
  assert.equal(isSafeAttachmentFilename("../secret.png"), false);
  assert.equal(isSafeAttachmentFilename("Assets/Sources/x.png"), false);
  assert.equal(isSafeAttachmentFilename("a\\b.png"), false);
  assert.equal(isSafeAttachmentFilename("/abs/path.png"), false);
  assert.equal(isSafeAttachmentFilename(".hidden.png"), false);
  assert.equal(isSafeAttachmentFilename("notes.md"), false);
  assert.equal(isSafeAttachmentFilename("archive.zip"), false);
  assert.equal(isSafeAttachmentFilename(""), false);
  assert.equal(isSafeAttachmentFilename("x".repeat(201) + ".png"), false);
  assert.equal(isSafeAttachmentFilename(42), false);
  assert.equal(isSafeAttachmentFilename(null), false);
});
