import assert from "node:assert/strict";
import test from "node:test";

import { createConcurrencyLimiter, createFixedWindowRateLimiter } from "../src/limiter.mjs";

test("concurrency limits apply globally and per client", () => {
  const limiter = createConcurrencyLimiter({ maxTotal: 2, maxPerIp: 1 });
  const releaseA = limiter.tryAcquire("a");
  assert.equal(typeof releaseA, "function");
  assert.equal(limiter.tryAcquire("a"), null);
  const releaseB = limiter.tryAcquire("b");
  assert.equal(typeof releaseB, "function");
  assert.equal(limiter.tryAcquire("c"), null);
  releaseA();
  assert.equal(typeof limiter.tryAcquire("c"), "function");
  releaseB();
});

test("rate limits reset on the next fixed window", () => {
  const limiter = createFixedWindowRateLimiter({ windowMs: 1_000, maxRequests: 2 });
  assert.equal(limiter.consume("a", 0).allowed, true);
  assert.equal(limiter.consume("a", 100).allowed, true);
  assert.equal(limiter.consume("a", 200).allowed, false);
  assert.equal(limiter.consume("a", 1_001).allowed, true);
});
