import assert from "node:assert/strict";
import test from "node:test";

import { ChatConfigError } from "../src/lib/chat/repos.ts";
import { createChatModel } from "../src/lib/chat/model.ts";
import { buildSystemPrompt } from "../src/lib/chat/prompt.ts";

test("createChatModel throws ChatConfigError without key; returns model with key", () => {
  assert.throws(() => createChatModel({}), ChatConfigError);
  const model = createChatModel({ AI_API_KEY: "k" });
  assert.ok(model); // LanguageModel 实例即可
});

test("createChatModel honors env overrides", () => {
  const model = createChatModel({ AI_API_KEY: "k", AI_BASE_URL: "http://x/v1", AI_MODEL: "m1" });
  assert.ok(model);
});

test("buildSystemPrompt embeds hot set, coverage, discipline and degrade note", () => {
  const system = buildSystemPrompt({
    hotSet: {
      text: "### [复习计划库] 数学/w40/本周复习计划.md\n\n- 周三 套卷",
      degraded: false,
      missing: ["英语/w40/本周复习计划.md"],
    },
    coverage: { note: "12/143 (partial)", review: "9/9" },
    nowIso: "2026-10-05T12:00:00+08:00",
  });
  assert.ok(system.includes("计划参谋"));
  assert.ok(system.includes("数学/w40/本周复习计划.md"));
  assert.ok(system.includes("12/143"));
  assert.ok(system.includes("英语/w40/本周复习计划.md"), "缺失文件要列出");
  assert.ok(system.includes("修订依据"));
  assert.ok(system.includes("只能追加"));
  assert.ok(system.includes("update_plan_file"));
});
