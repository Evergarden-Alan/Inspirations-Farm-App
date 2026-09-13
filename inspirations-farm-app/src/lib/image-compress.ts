/**
 * Client-side smart image compression for attachment uploads.
 *
 * Policy (planCompression is pure & unit-tested; compressImage is the thin
 * DOM/canvas wrapper):
 *   - GIF always passes through untouched (canvas re-encoding would flatten
 *     the animation to a single frame).
 *   - ≤1MB passes through untouched.
 *   - Everything larger is downscaled to ≤2000px on the long edge and
 *     re-encoded at ~q0.85 — WebP when the image has transparency, JPEG
 *     (white matte) otherwise.
 *   - Anything over MAX_UPLOAD_BYTES is rejected up front (matches the
 *     server cap; production deploys on Vercel with a 4.5MB body limit).
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const PASSTHROUGH_BYTES = 1024 * 1024;
export const MAX_DIMENSION = 2000;

export type CompressPlan =
  | { mode: "passthrough"; reason?: undefined }
  | { mode: "compress"; reason?: undefined }
  | { mode: "reject"; reason: string };

/** Decide what to do with an upload from its declared type + size. */
export function planCompression(input: { type: string; size: number }): CompressPlan {
  if (input.size > MAX_UPLOAD_BYTES) {
    return { mode: "reject", reason: "图片超过 4MB 上限" };
  }
  if (input.type === "image/gif") {
    return { mode: "passthrough" }; // animated — never re-encode
  }
  if (input.size <= PASSTHROUGH_BYTES) {
    return { mode: "passthrough" };
  }
  return { mode: "compress" };
}

/** A decoded image source plus its cleanup (object URLs must stay alive
 *  until drawImage has run). */
interface DecodedSource {
  source: ImageBitmap | HTMLImageElement;
  dispose: () => void;
}

async function decodeBitmap(file: File): Promise<DecodedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, dispose: () => bitmap.close() };
    } catch {
      // fall through to <img> decode (exotic formats / older engines)
    }
  }
  // Fallback: object-URL <img> decode (also handles HEIC on Safari).
  const url = URL.createObjectURL(file);
  const img = document.createElement("img");
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  // Revoke AFTER the caller is done with drawImage, not now — revoking
  // immediately after decode() can blank the element's pixels.
  return { source: img, dispose: () => URL.revokeObjectURL(url) };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** Encode the canvas as JPEG, filling transparency with white. */
function flattenToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return canvasToBlob(flat, "image/jpeg", quality);
}

/** Scan the alpha channel for any transparency. */
function hasAlphaData(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Compress a File for upload per the plan above. Returns the (possibly
 * untouched) File to send. Throws on undecodable images or when the result
 * still exceeds the cap.
 */
export async function compressImage(file: File): Promise<File> {
  const plan = planCompression({ type: file.type, size: file.size });
  if (plan.mode === "passthrough") return file;
  if (plan.mode === "reject") throw new Error(plan.reason);

  const { source, dispose } = await decodeBitmap(file);
  const srcW =
    source instanceof ImageBitmap ? source.width : source.naturalWidth;
  const srcH =
    source instanceof ImageBitmap ? source.height : source.naturalHeight;
  if (!srcW || !srcH) {
    dispose();
    throw new Error("无法解码该图片");
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.drawImage(source, 0, 0, width, height);
  dispose();

  // Preserve transparency with WebP when present; otherwise JPEG (smaller,
  // universally renderable). WebP unsupported → JPEG with white matte.
  let blob: Blob | null = null;
  let ext = "jpg";
  if (hasAlphaData(canvas)) {
    blob = await canvasToBlob(canvas, "image/webp", 0.85);
    if (blob) ext = "webp";
  }
  if (!blob) {
    blob = await flattenToJpeg(canvas, 0.85);
  }

  // Pathological case (huge noisy screenshot): step quality down once, then
  // give up so the user gets a clear error instead of the server 413.
  if (blob && blob.size > MAX_UPLOAD_BYTES) {
    blob = await flattenToJpeg(canvas, 0.7);
  }
  if (!blob) throw new Error("图片编码失败");
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("压缩后仍超过 4MB，请换一张更小的图片");
  }

  return new File([blob], `upload.${ext}`, {
    type: ext === "webp" ? "image/webp" : "image/jpeg",
  });
}
