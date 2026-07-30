import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const relayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(relayRoot, "../..");
const appEnvPath = resolve(repositoryRoot, "inspirations-farm-app/.env.local");
const relayEnvPath = resolve(relayRoot, ".env");

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function readValue(contents, key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(contents);
  return match?.[1]?.trim() || null;
}

function upsert(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  const prefix = contents.length === 0 || contents.endsWith("\n") ? contents : `${contents}\n`;
  return `${prefix}${line}\n`;
}

const appEnv = await readOptional(appEnvPath);
const existingRelayEnv = await readOptional(relayEnvPath);
const secret = readValue(appEnv, "FOCUS_AUDIO_RELAY_SIGNING_SECRET")
  ?? readValue(existingRelayEnv, "FOCUS_RELAY_SIGNING_SECRET")
  ?? randomBytes(32).toString("hex");
const baseUrl = readValue(appEnv, "FOCUS_AUDIO_RELAY_BASE_URL")
  ?? "http://192.168.31.108:8787";

if (secret.length < 32) throw new Error("Existing focus relay secret is too short");
const parsedBaseUrl = new URL(baseUrl);
if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
  throw new Error("Existing focus relay base URL must use HTTP or HTTPS");
}

let nextAppEnv = appEnv;
nextAppEnv = upsert(nextAppEnv, "FOCUS_AUDIO_RELAY_BASE_URL", baseUrl);
nextAppEnv = upsert(nextAppEnv, "FOCUS_AUDIO_RELAY_SIGNING_SECRET", secret);
nextAppEnv = upsert(nextAppEnv, "FOCUS_AUDIO_PROBE_BVID", "BV1f53B6qEB6");
nextAppEnv = upsert(nextAppEnv, "FOCUS_AUDIO_PROBE_CID", "40377256216");

let nextRelayEnv = existingRelayEnv;
nextRelayEnv = upsert(nextRelayEnv, "FOCUS_RELAY_HOST", "0.0.0.0");
nextRelayEnv = upsert(nextRelayEnv, "FOCUS_RELAY_PORT", parsedBaseUrl.port || "8787");
nextRelayEnv = upsert(nextRelayEnv, "FOCUS_RELAY_SIGNING_SECRET", secret);
nextRelayEnv = upsert(nextRelayEnv, "FOCUS_RELAY_MAX_TICKET_TTL_SECONDS", "28800");
nextRelayEnv = upsert(nextRelayEnv, "FOCUS_RELAY_ALLOWED_CDN_SUFFIXES", "bilivideo.com,bilivideo.cn");

await mkdir(dirname(appEnvPath), { recursive: true });
await writeFile(appEnvPath, nextAppEnv, { mode: 0o600 });
await writeFile(relayEnvPath, nextRelayEnv, { mode: 0o600 });
await chmod(relayEnvPath, 0o600);

console.log(JSON.stringify({
  ok: true,
  relayBaseUrl: baseUrl,
  appEnvironmentUpdated: appEnvPath,
  relayEnvironmentUpdated: relayEnvPath,
  secret: "configured (redacted)",
}));
