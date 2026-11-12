import "server-only";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

/**
 * Shared checks for /api/push/*: signed-in session (middleware also enforces it), JSON body, and a
 * same-origin request (Origin header must match the host) so another site can't post with the cookie.
 */
export async function pushGuard(req: Request) {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    let ok = false;
    try {
      ok = new URL(origin).host === host;
    } catch {
      ok = false;
    }
    if (!ok) return { error: NextResponse.json({ error: "bad_origin" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const noStore = { "Cache-Control": "no-store" };
