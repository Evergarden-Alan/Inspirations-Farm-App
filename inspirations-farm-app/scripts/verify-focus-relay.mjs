import { readFile } from "node:fs/promises";

function parseEnv(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

async function fetchRange(url, range) {
  const response = await fetch(url, {
    headers: { Range: range },
    redirect: "error",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentRange: response.headers.get("content-range"),
    acceptRanges: response.headers.get("accept-ranges"),
    byteCount: bytes.byteLength,
    prefixHex: [...bytes.slice(0, 12)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
  };
}

const env = parseEnv(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
const pin = env.get("APP_PIN") ?? "";
const expectedRelayOrigin = new URL(env.get("FOCUS_AUDIO_RELAY_BASE_URL")).origin;
const appOrigin = process.argv[2] ?? "http://127.0.0.1:3000";

const probeResponse = await fetch(`${appOrigin}/api/focus-playlists/audio-probe`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-app-pin": pin,
  },
  body: JSON.stringify({
    bvid: env.get("FOCUS_AUDIO_PROBE_BVID") ?? "BV1f53B6qEB6",
    cid: env.get("FOCUS_AUDIO_PROBE_CID") ?? "40377256216",
  }),
});
const probe = await probeResponse.json();
if (!probeResponse.ok || !probe.ok) {
  throw new Error(`Probe failed: HTTP ${probeResponse.status} ${probe.error ?? "UNKNOWN_ERROR"}`);
}

const relayUrl = new URL(probe.audio.url);
if (relayUrl.origin !== expectedRelayOrigin) {
  throw new Error("Probe returned an unexpected relay origin");
}

const initial = await fetchRange(relayUrl, "bytes=0-1023");
const seek = await fetchRange(relayUrl, "bytes=1048576-1049599");
if (initial.status !== 206 || seek.status !== 206) {
  throw new Error(`Expected two 206 responses, received ${initial.status} and ${seek.status}`);
}

console.log(JSON.stringify({
  ok: true,
  probe: {
    status: probeResponse.status,
    mimeType: probe.diagnostics.mimeType,
    codecs: probe.diagnostics.codecs,
    cdnHost: probe.diagnostics.cdnHost,
    deadlineRemainingSeconds: probe.diagnostics.deadlineRemainingSeconds,
    relayHost: probe.diagnostics.relayHost,
  },
  initialRange: initial,
  seekRange: seek,
}, null, 2));
