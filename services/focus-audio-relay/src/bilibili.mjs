const PLAYURL_ENDPOINT = "https://api.bilibili.com/x/player/wbi/playurl";
export const DEFAULT_CDN_SUFFIXES = ["bilivideo.com", "bilivideo.cn"];

export class BilibiliUpstreamError extends Error {
  constructor(code, message, status = 502, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "BilibiliUpstreamError";
    this.code = code;
    this.status = status;
  }
}

function hostMatchesSuffix(hostname, suffix) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function isAllowedCdnUrl(value, suffixes = DEFAULT_CDN_SUFFIXES) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const hostname = url.hostname.toLowerCase();
    return suffixes.some((suffix) => hostMatchesSuffix(hostname, suffix.toLowerCase()));
  } catch {
    return false;
  }
}

export function extractDeadline(value) {
  try {
    const raw = new URL(value).searchParams.get("deadline");
    if (!raw || !/^[0-9]{1,12}$/.test(raw)) return null;
    const deadline = Number(raw);
    return Number.isSafeInteger(deadline) && deadline > 0 ? deadline : null;
  } catch {
    return null;
  }
}

function getTrackUrls(track) {
  const base = track.baseUrl ?? track.base_url;
  const backups = track.backupUrl ?? track.backup_url ?? [];
  return [base, ...(Array.isArray(backups) ? backups : [])]
    .filter((value) => typeof value === "string");
}

export function selectAacAudio(dash, suffixes = DEFAULT_CDN_SUFFIXES) {
  if (!dash || !Array.isArray(dash.audio)) {
    throw new BilibiliUpstreamError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili did not return a DASH audio list"
    );
  }

  const candidates = dash.audio
    .filter((track) => {
      const mimeType = track?.mimeType ?? track?.mime_type;
      const codecs = typeof track?.codecs === "string"
        ? track.codecs.split(",").map((codec) => codec.trim())
        : [];
      return mimeType === "audio/mp4" && codecs.includes("mp4a.40.2");
    })
    .map((track) => ({
      track,
      urls: [...new Set(getTrackUrls(track).filter((url) => isAllowedCdnUrl(url, suffixes)))],
    }))
    .filter((candidate) => candidate.urls.length > 0)
    .sort((left, right) => (right.track.bandwidth ?? 0) - (left.track.bandwidth ?? 0));

  const selected = candidates[0];
  if (!selected) {
    throw new BilibiliUpstreamError(
      "AUDIO_NOT_AVAILABLE",
      "No public AAC-LC audio track was available",
      404
    );
  }

  const primary = selected.urls[0];
  return {
    urls: selected.urls,
    mimeType: "audio/mp4",
    codecs: "mp4a.40.2",
    bandwidth: Number.isFinite(selected.track.bandwidth)
      ? selected.track.bandwidth
      : null,
    cdnHost: new URL(primary).hostname,
    deadline: extractDeadline(primary),
  };
}

async function readJsonWithLimit(response, maxBytes = 1_048_576) {
  if (!response.body) {
    throw new BilibiliUpstreamError("INVALID_UPSTREAM_RESPONSE", "Empty Bilibili response");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BilibiliUpstreamError(
          "INVALID_UPSTREAM_RESPONSE",
          "Bilibili response exceeded the size limit"
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new BilibiliUpstreamError(
      "INVALID_UPSTREAM_RESPONSE",
      "Bilibili returned invalid JSON",
      502,
      error
    );
  }
}

function createTimedSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Upstream request timed out")), timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function resolveBilibiliAudio({
  bvid,
  cid,
  signal,
  fetchImpl = fetch,
  timeoutMs = 5_000,
  cdnSuffixes = DEFAULT_CDN_SUFFIXES,
}) {
  const endpoint = new URL(PLAYURL_ENDPOINT);
  endpoint.searchParams.set("bvid", bvid);
  endpoint.searchParams.set("cid", cid);
  endpoint.searchParams.set("fnval", "16");
  endpoint.searchParams.set("fnver", "0");
  endpoint.searchParams.set("fourk", "0");

  const timed = createTimedSignal(signal, timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      cache: "no-store",
      redirect: "error",
      signal: timed.signal,
      headers: {
        Accept: "application/json",
        Referer: `https://www.bilibili.com/video/${bvid}/`,
        "User-Agent": "InspirationsFarmFocusRelay/0.1",
      },
    });
  } catch (error) {
    timed.dispose();
    throw new BilibiliUpstreamError(
      "BILIBILI_UNAVAILABLE",
      "Unable to reach Bilibili playurl",
      502,
      error
    );
  }

  if (!response.ok) {
    await response.body?.cancel();
    timed.dispose();
    throw new BilibiliUpstreamError(
      "BILIBILI_UNAVAILABLE",
      `Bilibili playurl returned HTTP ${response.status}`
    );
  }

  let payload;
  try {
    payload = await readJsonWithLimit(response);
  } catch (error) {
    if (error instanceof BilibiliUpstreamError) throw error;
    throw new BilibiliUpstreamError(
      "BILIBILI_UNAVAILABLE",
      "Bilibili playurl response timed out",
      502,
      error
    );
  } finally {
    timed.dispose();
  }
  if (payload?.code === -352) {
    throw new BilibiliUpstreamError(
      "BILIBILI_RISK_CONTROL",
      "Bilibili risk control rejected the request",
      503
    );
  }
  if (payload?.code !== 0 || !payload?.data) {
    throw new BilibiliUpstreamError(
      "INVALID_UPSTREAM_RESPONSE",
      `Bilibili playurl returned business code ${String(payload?.code)}`
    );
  }

  return selectAacAudio(payload.data.dash, cdnSuffixes);
}
