import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatConfigError,
  createChatModelFor,
  listChatProviders,
} from "../src/lib/chat/model.ts";

test("listChatProviders discovers known ids by API key and reports availability", () => {
  const providers = listChatProviders({
    GLM_API_KEY: "g",
    DEEPSEEK_API_KEY: "d",
  });
  assert.deepEqual(providers.map((p) => p.id), ["deepseek", "glm"]);
  assert.ok(providers.every((p) => p.hasKey));
});

test("listChatProviders: known id without key is listed with hasKey false", () => {
  const providers = listChatProviders({ GLM_API_KEY: "g" });
  const deepseek = providers.find((p) => p.id === "deepseek");
  assert.equal(deepseek.hasKey, false);
});

test("listChatProviders: unknown id needs explicit BASE_URL to be discovered", () => {
  const providers = listChatProviders({
    MOONSHOT_API_KEY: "m",
    MOONSHOT_BASE_URL: "https://api.moonshot.cn/v1",
    MOONSHOT_MODEL: "kimi-latest",
  });
  const moonshot = providers.find((p) => p.id === "moonshot");
  assert.ok(moonshot, "配了 BASE_URL 的未知供应商被发现");
  assert.equal(moonshot.hasKey, true);
  assert.ok(!providers.some((p) => p.id === "ai"), "裸 AI_API_KEY（无 BASE_URL）不算可用供应商");
});

test("createChatModelFor builds known provider from just a key", () => {
  const model = createChatModelFor("glm", { GLM_API_KEY: "g" });
  assert.ok(model);
  const model2 = createChatModelFor("deepseek", { DEEPSEEK_API_KEY: "d" });
  assert.ok(model2);
});

test("createChatModelFor honors per-provider overrides", () => {
  const model = createChatModelFor("glm", {
    GLM_API_KEY: "g",
    GLM_BASE_URL: "http://proxy/v1",
    GLM_MODEL: "glm-turbo",
  });
  assert.ok(model);
});

test("createChatModelFor unknown custom provider needs BASE_URL and MODEL", () => {
  assert.throws(
    () => createChatModelFor("moonshot", { MOONSHOT_API_KEY: "m" }),
    ChatConfigError
  );
  const ok = createChatModelFor("moonshot", {
    MOONSHOT_API_KEY: "m",
    MOONSHOT_BASE_URL: "https://api.moonshot.cn/v1",
    MOONSHOT_MODEL: "kimi",
  });
  assert.ok(ok);
});

test("createChatModelFor errors clearly on missing key or unknown id", () => {
  assert.throws(() => createChatModelFor("glm", {}), ChatConfigError);
  assert.throws(() => createChatModelFor("nope", {}), ChatConfigError);
});
