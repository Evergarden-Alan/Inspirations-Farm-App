/**
 * Client-side fetch wrapper.
 * - Attaches x-app-pin header from localStorage on every request.
 * - Throws AuthError on 401 so the UI can show the lock screen.
 */

import { captureError } from "./sentry";

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthError";
  }
}

function getPin(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("app_pin");
}

export function setPin(pin: string): void {
  localStorage.setItem("app_pin", pin);
}

export function clearPin(): void {
  localStorage.removeItem("app_pin");
}

export function hasPin(): boolean {
  return !!getPin();
}

export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Retry on network errors (not on HTTP errors like 4xx/5xx).
  // Useful for transient network issues, especially on mobile.
  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-app-pin": getPin() ?? "",
          ...options.headers,
        },
      });

      if (res.status === 401) {
        clearPin();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth:expired"));
        }
        throw new AuthError();
      }

      return res;
    } catch (err) {
      // If AuthError, rethrow immediately (don't retry auth failures)
      if (err instanceof AuthError) {
        throw err;
      }

      lastError = err instanceof Error ? err : new Error("Network error");

      // 上报到 Sentry（非 AuthError）
      captureError(lastError, {
        url,
        attempt,
        maxRetries,
      });

      // If this was the last attempt, throw
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 200ms, 400ms
      const delay = 200 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
