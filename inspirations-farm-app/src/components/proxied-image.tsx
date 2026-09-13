"use client";

import { useEffect, useState } from "react";

import { apiFetch, AuthError } from "@/lib/api";

/**
 * Image renderer for attachments stored in the private GitHub repo.
 *
 * `![[file.png]]` embeds are rewritten (transformWikilinkImages) to
 * `![](/api/attachment?file=…)` — a relative URL that passes rehype-sanitize's
 * default schema. But <img src> can't attach the x-app-pin header, so this
 * component fetches the bytes via apiFetch (header auth, 401 → lock screen)
 * and renders a locally-created blob: object URL instead. Object URLs are
 * shared through a small module-level cache so repeated renders of the same
 * image don't re-fetch.
 */

const ATTACHMENT_SRC_PREFIX = "/api/attachment";
const CACHE_LIMIT = 40;

const objectUrlCache = new Map<string, string>();

function getCachedObjectUrl(url: string): string | null {
  const hit = objectUrlCache.get(url) ?? null;
  if (hit) {
    // Refresh LRU position (Map keeps insertion order).
    objectUrlCache.delete(url);
    objectUrlCache.set(url, hit);
  }
  return hit;
}

async function loadObjectUrl(url: string): Promise<string> {
  const cached = getCachedObjectUrl(url);
  if (cached) return cached;

  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`attachment ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/png";
  const objectUrl = URL.createObjectURL(
    new Blob([await res.arrayBuffer()], { type })
  );

  objectUrlCache.set(url, objectUrl);
  // Evict the oldest entries past the cap. Object URLs stay valid for the
  // page lifetime; eviction just stops the cache (not the blobs in the DOM)
  // from growing without bound in a long session.
  while (objectUrlCache.size > CACHE_LIMIT) {
    const oldest = objectUrlCache.keys().next().value;
    if (oldest === undefined) break;
    objectUrlCache.delete(oldest);
  }
  return objectUrl;
}

interface ProxiedImageProps {
  src?: string | Blob;
  alt?: string;
}

export function ProxiedImage({ src, alt = "" }: ProxiedImageProps) {
  // react-markdown hands us its parsed src (string | Blob per React's img
  // types); anything that isn't the attachment route's string URL renders
  // natively below.
  const url = typeof src === "string" ? src : undefined;
  const [objectUrl, setObjectUrl] = useState<string | null>(() =>
    url && url.startsWith(ATTACHMENT_SRC_PREFIX) ? getCachedObjectUrl(url) : null
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || !url.startsWith(ATTACHMENT_SRC_PREFIX)) return;

    let cancelled = false;
    // State updates happen in the async callbacks only (never synchronously
    // in the effect body); a cache hit resolves on the microtask queue.
    loadObjectUrl(url).then(
      (loaded) => {
        if (!cancelled) setObjectUrl(loaded);
      },
      (err) => {
        // AuthError already fired auth:expired (lock screen); anything else
        // is a missing/broken image — show the muted fallback row.
        if (!cancelled && !(err instanceof AuthError)) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Non-attachment images (regular http(s) markdown images) render natively.
  if (!url || !url.startsWith(ATTACHMENT_SRC_PREFIX)) {
    // eslint-disable-next-line @next/next/no-img-element -- plain markdown images
    return <img src={url} alt={alt} className="my-1 max-w-full rounded-lg" />;
  }

  if (failed) {
    return <span className="my-1 block text-xs text-[var(--farm-muted)]">图片加载失败</span>;
  }

  if (!objectUrl) {
    return (
      <span
        aria-label="加载图片中"
        className="my-1 block h-28 w-56 animate-pulse rounded-lg bg-[var(--farm-paper-deep)]"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob URL, next/image not applicable
    <img
      src={objectUrl}
      alt={alt}
      className="my-1 block h-auto max-h-96 w-auto max-w-full cursor-zoom-in rounded-lg border border-[var(--farm-line)]/60"
      onClick={() => window.open(objectUrl, "_blank")}
    />
  );
}
