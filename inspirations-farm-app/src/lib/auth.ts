/**
 * Server-side PIN authentication.
 * All API routes call validatePin(request) before executing.
 */

import { NextRequest } from "next/server";

export function validatePin(req: NextRequest): boolean {
  const expected = process.env.APP_PIN;
  if (!expected) {
    // If APP_PIN is not configured, allow all requests (dev mode)
    return true;
  }
  const provided = req.headers.get("x-app-pin");
  return provided === expected;
}
