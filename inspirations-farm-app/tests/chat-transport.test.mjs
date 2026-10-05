import assert from "node:assert/strict";
import test from "node:test";

import { getChatHeaders } from "../src/features/chat/transport.ts";

test("getChatHeaders carries x-app-pin from localStorage app_pin", () => {
  const store = new Map([["app_pin", "246810"]]);
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.deepEqual(getChatHeaders(), { "x-app-pin": "246810" });
  } finally {
    delete globalThis.localStorage;
  }
});

test("getChatHeaders returns empty pin when unset (never throws)", () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  try {
    assert.deepEqual(getChatHeaders(), { "x-app-pin": "" });
  } finally {
    delete globalThis.localStorage;
  }
});
