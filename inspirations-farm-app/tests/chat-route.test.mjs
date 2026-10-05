import assert from "node:assert/strict";
import test from "node:test";

import { createChatRoute, resolveChatModel } from "../src/app/api/chat/route.ts";

const PIN = "246810";

function req(body, headers = { "x-app-pin": PIN }) {
  return {
    headers: new Headers(headers),
    json: async () => body,
  };
}

const MESSAGES = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "这周计划怎么调？" }] },
];

test.before(() => {
  process.env.APP_PIN = PIN;
});
test.after(() => {
  delete process.env.APP_PIN;
});

test("chat route: 401 without PIN", async () => {
  const { POST } = createChatRoute({ model: {}, tools: {}, system: "s" });
  assert.equal((await POST(req({}, {}))).status, 401);
});

test("chat route: 400 on missing messages", async () => {
  const { POST } = createChatRoute({ model: {}, tools: {}, system: "s" });
  assert.equal((await POST(req({}))).status, 400);
  assert.equal((await POST(req({ messages: "no" }))).status, 400);
});

test("chat route: 503 when model factory raises ChatConfigError", async () => {
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    const { POST } = createChatRoute({ tools: {}, system: "s" });
    const res = await POST(req({ messages: MESSAGES }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.ok(body.error.includes("AI_API_KEY"));
  } finally {
    if (saved !== undefined) process.env.AI_API_KEY = saved;
  }
});

test("resolveChatModel picks requested provider, first available, then legacy key", () => {
  // 指定 id 直接命中
  assert.ok(resolveChatModel("glm", { GLM_API_KEY: "g" }));
  // 未指定 → 注册表里第一个有 key 的
  assert.ok(resolveChatModel(undefined, { DEEPSEEK_API_KEY: "d" }));
  // 注册表空 → 旧 AI_API_KEY
  assert.ok(resolveChatModel(undefined, { AI_API_KEY: "a" }));
  // 全空 → ChatConfigError
  assert.throws(() => resolveChatModel(undefined, {}), (err) => err.name === "ChatConfigError");
  // 指定了但没 key → ChatConfigError 带供应商名
  assert.throws(
    () => resolveChatModel("deepseek", { GLM_API_KEY: "g" }),
    /DEEPSEEK_API_KEY/
  );
});

test("chat route: unknown provider string → 503 naming the provider", async () => {
  const { POST } = createChatRoute({ tools: {}, system: "s" });
  const res = await POST(req({ messages: MESSAGES, provider: "nope" }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.ok(body.error.includes("nope"));
});

test("chat route: streams a mocked model response", async () => {
  const { MockLanguageModelV2, simulateReadableStream } = await import("ai/test");
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "r0", modelId: "mock", timestamp: new Date(0) },
          { type: "text-start", id: "t0" },
          { type: "text-delta", id: "t0", delta: "本周建议……" },
          { type: "text-end", id: "t0" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        ],
      }),
    }),
  });
  const { POST } = createChatRoute({
    model,
    tools: {},
    system: "测试系统提示",
  });
  const res = await POST(req({ messages: MESSAGES }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("本周建议"));
});
