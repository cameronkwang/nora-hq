import "server-only";

/** Small fetch helpers shared by the integrations. Plain fetch, no SDKs. */

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

/** Pulls a readable message out of Meta / Google error payloads. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      const msg = e.error_user_msg ?? e.message ?? e.status;
      if (typeof msg === "string" && msg) return msg;
    }
    if (typeof err === "string") {
      const desc = b.error_description ?? b.error_message;
      return typeof desc === "string" && desc ? `${err}: ${desc}` : err;
    }
    if (typeof b.error_message === "string") return b.error_message;
    if (typeof b.message === "string") return b.message;
  }
  return fallback;
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    throw new HttpError(name === "TimeoutError" ? "The request timed out" : `Network error: ${e instanceof Error ? e.message : String(e)}`, 0, null);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new HttpError(apiErrorMessage(body, `HTTP ${res.status}`), res.status, body);
  return body as T;
}

export function form(params: Record<string, string | number | boolean | undefined | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
