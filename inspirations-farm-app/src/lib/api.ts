/**
 * Client-side fetch wrapper.
 * - Attaches x-app-pin header from localStorage on every request.
 * - Throws AuthError on 401 so the UI can show the lock screen.
 */

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
}
