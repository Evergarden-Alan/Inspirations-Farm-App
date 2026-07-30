import { readFile } from "node:fs/promises";

const DEVTOOLS_ORIGIN = process.argv[2] ?? "http://127.0.0.1:9223";
const PAGE_ORIGIN = process.argv[3] ?? "http://127.0.0.1:3000";

function readEnvValue(contents, key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(contents);
  return match?.[1]?.trim() ?? "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const pin = readEnvValue(env, "APP_PIN");
if (!pin) throw new Error("APP_PIN is required for browser verification");

const pages = await fetch(`${DEVTOOLS_ORIGIN}/json`).then((response) => response.json());
const page = pages.find((candidate) => (
  candidate.type === "page"
  && candidate.url.startsWith(`${PAGE_ORIGIN}/settings/focus-playlist-lab`)
));
if (!page) throw new Error("Focus relay lab page is not open in Chromium");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const resolve = pending.get(message.id);
  pending.delete(message.id);
  resolve(message);
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(
      response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? "Browser evaluation failed"
    );
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await delay(250);
  }
  const diagnostics = await evaluate(`(() => {
    const input = document.querySelector('input[type="password"]');
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.includes('获取中继音频地址'));
    return {
      inputLength: input?.value.length ?? null,
      activeElement: document.activeElement?.tagName ?? null,
      buttonFound: Boolean(button),
      buttonDisabled: button?.disabled ?? null,
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    };
  })()`);
  socket.close();
  throw new Error(`Browser condition timed out: ${expression}\n${JSON.stringify(diagnostics)}`);
}

await send("Page.reload", { ignoreCache: true });
await waitFor("document.readyState === 'complete'");
await evaluate(`(async () => {
  localStorage.setItem('app_pin', ${JSON.stringify(pin)});
  const response = await fetch('/api/focus-playlists/audio-probe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-pin': ${JSON.stringify(pin)},
    },
    body: JSON.stringify({ bvid: 'BV1f53B6qEB6', cid: '40377256216' }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error('Audio probe failed in Chromium');
  }
  const audio = document.querySelector('audio');
  audio.src = payload.audio.url;
  audio.load();
  return true;
})()`);

await waitFor(`(() => {
  const audio = document.querySelector('audio');
  return audio?.src.startsWith('https://media.alanevergarden.xyz/focus-audio/')
    ? audio.src
    : false;
})()`);
await waitFor("document.querySelector('audio')?.readyState >= 1");

const compatibility = await evaluate(`(() => {
  const audio = document.querySelector('audio');
  const url = new URL(audio.src);
  return {
    canPlayType: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    relay: { protocol: url.protocol, host: url.host, pathname: url.pathname },
  };
})()`);

await evaluate(`(async () => {
  const audio = document.querySelector('audio');
  await audio.play();
  return true;
})()`);
await waitFor("!document.querySelector('audio')?.paused", 10_000);
await delay(31_000);

const beforeSeek = await evaluate(`(() => {
  const audio = document.querySelector('audio');
  return {
    currentTime: audio.currentTime,
    duration: audio.duration,
    readyState: audio.readyState,
    paused: audio.paused,
    error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
  };
})()`);
if (beforeSeek.currentTime < 30 || beforeSeek.error) {
  throw new Error(`Playback did not reach 30 seconds: ${JSON.stringify(beforeSeek)}`);
}

const seekTarget = await evaluate(`(async () => {
  const audio = document.querySelector('audio');
  const target = Math.min(audio.duration - 5, audio.currentTime + 60);
  audio.currentTime = target;
  await audio.play();
  return target;
})()`);
await delay(5_000);

const afterSeek = await evaluate(`(() => {
  const audio = document.querySelector('audio');
  return {
    currentTime: audio.currentTime,
    readyState: audio.readyState,
    paused: audio.paused,
    error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
  };
})()`);
socket.close();

if (afterSeek.currentTime < seekTarget + 3 || afterSeek.error) {
  throw new Error(`Playback did not recover after seek: ${JSON.stringify(afterSeek)}`);
}

console.log(JSON.stringify({
  ok: true,
  compatibility,
  beforeSeek,
  seekTarget,
  afterSeek,
}, null, 2));
