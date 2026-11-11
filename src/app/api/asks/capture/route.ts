import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { OpsError } from "@/lib/ops";
import { captureAsk, parseCaptureRoute, recentCaptureCount, verifyCaptureToken } from "@/lib/ops-capture";
import { UploadError, saveUpload } from "@/lib/uploads";
import type { Attachment } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/asks/capture — one-tap capture from the iPhone Shortcut (or anything that can send HTTP).
 * Auth: "Authorization: Bearer nhq_…" (a personal key from Settings → Quick capture). Middleware lets
 * this path through without a session; this handler authenticates itself.
 *
 * Body, either:
 *  - JSON { text, url?, route?, client? }
 *  - multipart/form-data with fields text/url/route/client and one or more "file" parts (photos/videos, ≤4MB each)
 * route: auto | claude | cameron | nora | idea | fyi | adhoc (menu labels like "Claude decides" work too).
 *
 * Always answers JSON { ok, id?, message } — `message` is short because Shortcuts shows it as a notification.
 * The token is never logged or echoed.
 */

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 10;
const RATE_PER_MIN = 30;
const BAD_ROUTE = "Pick one of: Claude decides, Claude, Cameron, Nora, Ad hoc task, Idea, FYI.";

// Best-effort per-token limiter (per server instance); the DB count below is the real backstop.
const hits = new Map<string, number[]>();
function tooFast(tokenId: string) {
  const now = Date.now();
  const recent = (hits.get(tokenId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(tokenId, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > RATE_PER_MIN;
}

const reply = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: status < 300, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v",
};

/** Shortcuts sometimes sends application/octet-stream; fall back to the file extension. */
function withType(f: File): File {
  if (f.type.startsWith("image/") || f.type.startsWith("video/")) return f;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const t = EXT_TYPES[ext];
  return t ? new File([f], f.name, { type: t }) : f;
}

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : null;
};

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const raw = /^Bearer\s+(\S+)\s*$/i.exec(auth)?.[1] ?? null;
  const who = await verifyCaptureToken(raw);
  if (!who) return reply(401, "Nora HQ didn’t recognise this key. Make a new one in Settings → Quick capture.");

  const actor = who.user.email;
  if (tooFast(who.tokenId) || (await recentCaptureCount(actor)) >= RATE_PER_MIN) {
    return reply(429, "Slow down a little — try again in a minute.");
  }

  const type = req.headers.get("content-type") ?? "";
  let text: string | null = null;
  let url: string | null = null;
  let routeIn: unknown = null;
  let client: string | null = null;
  const attachments: Attachment[] = [];

  try {
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > MAX_FILES * MAX_FILE_BYTES) return reply(413, "That’s too big to send. Photos must be under 4MB — resize to 1600 first.");
      let fd: FormData;
      try {
        fd = await req.formData();
      } catch {
        return reply(400, "Couldn’t read that. Send text, url, route and file fields.");
      }
      text = field(fd, "text");
      url = field(fd, "url");
      routeIn = field(fd, "route");
      client = field(fd, "client");
      const files = [...fd.getAll("file"), ...fd.getAll("files")].filter((f): f is File => typeof f !== "string" && f.size > 0);
      if (files.length > MAX_FILES) return reply(413, `Up to ${MAX_FILES} files at a time.`);
      const big = files.find((f) => f.size > MAX_FILE_BYTES);
      if (big) return reply(413, `${big.name || "That file"} is over 4MB. Resize photos to 1600 in the Shortcut, or add videos in the app.`);
      if (!parseCaptureRoute(routeIn ?? "auto")) return reply(400, BAD_ROUTE); // before saving files, so nothing is orphaned
      for (const f of files) attachments.push(await saveUpload(withType(f)));
    } else {
      let json: unknown;
      try {
        json = await req.json();
      } catch {
        return reply(400, "Couldn’t read that. Send JSON like {\"text\": \"…\"}.");
      }
      if (!json || typeof json !== "object") return reply(400, "Send JSON like {\"text\": \"…\"}.");
      const j = json as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : null);
      text = s(j.text);
      url = s(j.url);
      routeIn = j.route ?? null;
      client = s(j.client);
    }
  } catch (e) {
    if (e instanceof UploadError) return reply(400, e.message);
    console.error("[capture] upload failed", e instanceof Error ? e.message : e);
    return reply(500, "Couldn’t save the photo. Try again, or send it from the app.");
  }

  if (!parseCaptureRoute(routeIn ?? "auto")) {
    return reply(400, BAD_ROUTE);
  }

  try {
    const r = await captureAsk({ text, url, route: typeof routeIn === "string" ? routeIn : "auto", client, attachments }, actor);
    revalidatePath("/", "layout");
    return reply(200, r.message, { id: r.id, kind: r.kind, route: r.route });
  } catch (e) {
    if (e instanceof OpsError) return reply(400, e.message);
    if (e && typeof e === "object" && "issues" in e) return reply(400, "That didn’t look right — check the text and try again.");
    console.error("[capture] failed", e instanceof Error ? e.message : e);
    return reply(500, "Something went wrong on Nora HQ. Try again in a bit.");
  }
}

export function GET() {
  return reply(405, "Use POST from the iPhone Shortcut. Setup: Settings → Quick capture.");
}
