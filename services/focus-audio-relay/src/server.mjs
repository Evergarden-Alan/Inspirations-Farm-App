import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  BilibiliUpstreamError,
  isAllowedCdnUrl,
  resolveBilibiliAudio,
} from "./bilibili.mjs";
import { createConcurrencyLimiter, createFixedWindowRateLimiter } from "./limiter.mjs";
import { verifyTicket } from "./ticket.mjs";

const AUDIO_PATH_PATTERN = /^\/v1\/audio\/(BV[0-9A-Za-z]{10})$/;
const ALLOWED_QUERY_KEYS = new Set(["cid", "exp", "sig"]);
const FORWARDED_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

function defaultLogger(level, entry) {
  const method = level === "error" ? console.error : console.log;
  method(JSON.stringify({ timestamp: new Date().toISOString(), level, ...entry }));
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  if (res.req.method === "HEAD") res.end();
  else res.end(body);
}

function getClientIp(req) {
  return req.socket.remoteAddress ?? "unknown";
}

function getSingleQueryValue(searchParams, key) {
  const values = searchParams.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function parseAudioRequest(req) {
  const url = new URL(req.url ?? "/", "http://relay.invalid");
  const match = AUDIO_PATH_PATTERN.exec(url.pathname);
  if (!match) return null;
  if ([...url.searchParams.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
    return { error: "INVALID_RELAY_TOKEN" };
  }

  const expRaw = getSingleQueryValue(url.searchParams, "exp");
  const exp = expRaw && /^[0-9]{1,12}$/.test(expRaw) ? Number(expRaw) : Number.NaN;
  return {
    bvid: match[1],
    cid: getSingleQueryValue(url.searchParams, "cid"),
    exp,
    sig: getSingleQueryValue(url.searchParams, "sig"),
  };
}

function createChildSignal(parentSignal, timeoutMs, reason) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(reason)), timeoutMs);
  return {
    controller,
    dispose() {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

async function openCandidate({
  initialUrl,
  req,
  bvid,
  signal,
  fetchImpl,
  connectTimeoutMs,
  isAllowedUrl,
}) {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    if (!isAllowedUrl(currentUrl)) return null;
    const timed = createChildSignal(signal, connectTimeoutMs, "CDN connection timed out");
    let response;
    try {
      const headers = {
        Accept: "audio/mp4,application/octet-stream;q=0.8,*/*;q=0.1",
        Referer: `https://www.bilibili.com/video/${bvid}/`,
        "User-Agent": "InspirationsFarmFocusRelay/0.1",
      };
      const range = req.headers.range;
      const ifRange = req.headers["if-range"];
      if (typeof range === "string") headers.Range = range;
      if (typeof ifRange === "string") headers["If-Range"] = ifRange;

      response = await fetchImpl(currentUrl, {
        method: req.method,
        headers,
        redirect: "manual",
        signal: timed.controller.signal,
      });
    } catch {
      timed.dispose();
      return null;
    }
    timed.dispose();

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const rangeRequested = typeof req.headers.range === "string";
    const statusAllowed = rangeRequested
      ? response.status === 206 || response.status === 416
      : response.status === 200 || response.status === 206;
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim();
    const contentTypeAllowed = response.status === 416
      || contentType === "audio/mp4"
      // Some Bilibili CDNs label an AAC-only DASH segment as generic MP4.
      || contentType === "video/mp4"
      || contentType === "application/octet-stream";

    if (!statusAllowed || !contentTypeAllowed) {
      await response.body?.cancel();
      return null;
    }
    return { response, finalUrl: currentUrl };
  }
  return null;
}

function forwardHeaders(upstream, res, fallbackMimeType) {
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) res.setHeader(name, value);
  }
  if (upstream.status !== 416) {
    res.setHeader("Content-Type", fallbackMimeType);
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function pathHash(value) {
  return createHash("sha256").update(new URL(value).pathname).digest("hex").slice(0, 12);
}

export function createRelayServer({
  config,
  fetchImpl = fetch,
  resolveAudio = resolveBilibiliAudio,
  logger = defaultLogger,
  isAllowedUrl = (url) => isAllowedCdnUrl(url, config.cdnSuffixes),
} = {}) {
  if (!config) throw new TypeError("Relay config is required");
  const concurrency = createConcurrencyLimiter({
    maxTotal: config.maxConcurrent,
    maxPerIp: config.maxConcurrentPerIp,
  });
  const rate = createFixedWindowRateLimiter({
    windowMs: 60_000,
    maxRequests: config.maxRequestsPerMinute,
  });

  return createServer(async (req, res) => {
    const startedAt = Date.now();
    const ip = getClientIp(req);
    const pathname = new URL(req.url ?? "/", "http://relay.invalid").pathname;

    if (pathname === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" }, { Allow: "GET, HEAD" });
        return;
      }
      sendJson(res, 200, { ok: true, service: "focus-audio-relay", version: 1 });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" }, { Allow: "GET, HEAD" });
      return;
    }

    const parsed = parseAudioRequest(req);
    if (!parsed) {
      sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
      return;
    }
    if (parsed.error) {
      sendJson(res, 401, { ok: false, error: parsed.error });
      return;
    }

    const verification = verifyTicket(parsed, {
      secrets: config.signingSecrets,
      maxTtlSeconds: config.maxTicketTtlSeconds,
    });
    if (!verification.ok) {
      sendJson(res, 401, { ok: false, error: verification.code });
      return;
    }

    const rateResult = rate.consume(ip);
    if (!rateResult.allowed) {
      sendJson(res, 429, { ok: false, error: "RATE_LIMITED" }, {
        "Retry-After": String(rateResult.retryAfterSeconds),
      });
      return;
    }

    const release = concurrency.tryAcquire(ip);
    if (!release) {
      sendJson(res, 503, { ok: false, error: "RELAY_BUSY" }, { "Retry-After": "5" });
      return;
    }

    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(new Error("Client disconnected"));
    req.once("aborted", abortRequest);
    res.once("close", () => {
      if (!res.writableEnded) abortRequest();
    });
    res.setTimeout(config.idleTimeoutMs, abortRequest);
    const maxStreamTimer = setTimeout(
      () => requestController.abort(new Error("Maximum stream duration reached")),
      config.maxStreamMs
    );

    let selectedHost = null;
    let selectedPathHash = null;
    try {
      const audio = await resolveAudio({
        bvid: parsed.bvid,
        cid: parsed.cid,
        signal: requestController.signal,
        timeoutMs: config.connectTimeoutMs,
        cdnSuffixes: config.cdnSuffixes,
      });

      let opened = null;
      for (const url of audio.urls) {
        opened = await openCandidate({
          initialUrl: url,
          req,
          bvid: parsed.bvid,
          signal: requestController.signal,
          fetchImpl,
          connectTimeoutMs: config.connectTimeoutMs,
          isAllowedUrl,
        });
        if (opened) break;
      }
      if (!opened) {
        throw new BilibiliUpstreamError(
          "AUDIO_NOT_AVAILABLE",
          "No Bilibili CDN returned a compatible media response",
          502
        );
      }

      selectedHost = new URL(opened.finalUrl).hostname;
      selectedPathHash = pathHash(opened.finalUrl);
      forwardHeaders(opened.response, res, audio.mimeType);
      res.statusCode = opened.response.status;

      if (req.method === "HEAD" || !opened.response.body) {
        await opened.response.body?.cancel();
        res.end();
      } else {
        await pipeline(Readable.fromWeb(opened.response.body), res, {
          signal: requestController.signal,
        });
      }

      logger("info", {
        event: "media_stream",
        status: opened.response.status,
        cdnHost: selectedHost,
        pathHash: selectedPathHash,
        range: typeof req.headers.range === "string",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const code = error instanceof BilibiliUpstreamError
        ? error.code
        : requestController.signal.aborted
          ? "STREAM_ABORTED"
          : "RELAY_UPSTREAM_ERROR";
      const status = error instanceof BilibiliUpstreamError ? error.status : 502;

      logger(error instanceof BilibiliUpstreamError ? "error" : "info", {
        event: "media_error",
        code,
        cdnHost: selectedHost,
        pathHash: selectedPathHash,
        durationMs: Date.now() - startedAt,
      });

      if (!res.headersSent) sendJson(res, status, { ok: false, error: code });
      else if (!res.writableEnded) res.destroy();
    } finally {
      clearTimeout(maxStreamTimer);
      req.removeListener("aborted", abortRequest);
      release();
    }
  });
}
