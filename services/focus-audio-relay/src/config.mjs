import { DEFAULT_CDN_SUFFIXES } from "./bilibili.mjs";

function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const signingSecret = env.FOCUS_RELAY_SIGNING_SECRET ?? "";
  if (signingSecret.length < 32) {
    throw new Error("FOCUS_RELAY_SIGNING_SECRET must contain at least 32 characters");
  }

  const previousSecret = env.FOCUS_RELAY_SIGNING_SECRET_PREVIOUS?.trim();
  if (previousSecret && previousSecret.length < 32) {
    throw new Error("FOCUS_RELAY_SIGNING_SECRET_PREVIOUS must contain at least 32 characters");
  }

  const cdnSuffixes = (env.FOCUS_RELAY_ALLOWED_CDN_SUFFIXES ?? DEFAULT_CDN_SUFFIXES.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (cdnSuffixes.length === 0 || cdnSuffixes.some((value) => !/^[a-z0-9.-]+$/.test(value))) {
    throw new Error("FOCUS_RELAY_ALLOWED_CDN_SUFFIXES contains an invalid hostname suffix");
  }

  return {
    host: env.FOCUS_RELAY_HOST ?? "0.0.0.0",
    port: readInteger(env, "FOCUS_RELAY_PORT", 8787, { min: 1, max: 65_535 }),
    signingSecrets: [signingSecret, previousSecret].filter(Boolean),
    maxTicketTtlSeconds: readInteger(env, "FOCUS_RELAY_MAX_TICKET_TTL_SECONDS", 28_800, { min: 60, max: 86_400 }),
    connectTimeoutMs: readInteger(env, "FOCUS_RELAY_CONNECT_TIMEOUT_MS", 8_000, { min: 1_000, max: 60_000 }),
    idleTimeoutMs: readInteger(env, "FOCUS_RELAY_IDLE_TIMEOUT_MS", 30_000, { min: 5_000, max: 300_000 }),
    maxStreamMs: readInteger(env, "FOCUS_RELAY_MAX_STREAM_MS", 28_800_000, { min: 60_000, max: 86_400_000 }),
    maxConcurrent: readInteger(env, "FOCUS_RELAY_MAX_CONCURRENT", 8, { min: 1, max: 128 }),
    maxConcurrentPerIp: readInteger(env, "FOCUS_RELAY_MAX_CONCURRENT_PER_IP", 4, { min: 1, max: 32 }),
    maxRequestsPerMinute: readInteger(env, "FOCUS_RELAY_MAX_REQUESTS_PER_MINUTE", 120, { min: 1, max: 10_000 }),
    cdnSuffixes,
  };
}
