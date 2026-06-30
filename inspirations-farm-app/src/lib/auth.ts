/**
 * Server-side PIN authentication.
 * All API routes call validatePin(request) before executing.
 */

import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison to avoid PIN timing side-channels. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Different lengths still compare to avoid leaking length info, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function validatePin(req: NextRequest): boolean {
  const expected = process.env.APP_PIN;
  if (!expected) {
    // If APP_PIN is not configured, allow all requests (dev mode)
    return true;
  }
  const provided = req.headers.get("x-app-pin") ?? "";
  return safeEqual(provided, expected);
}
