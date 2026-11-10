"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { createPost, deletePost, schedulePost, updatePost } from "@/lib/ops";
import type { PostFormat, PostStatus } from "@/lib/schema";
import { zonedToUtc } from "./tz";

export type PostFormState = { error?: string } | undefined;

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function withFlash(path: string, msg: string, tone: "ok" | "warn" | "danger" = "ok") {
  const u = new URL(path, "http://x");
  u.searchParams.set("msg", msg.slice(0, 400));
  u.searchParams.set("tone", tone);
  return `${u.pathname}${u.search}`;
}

function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const first = (e as { issues: Array<{ path?: unknown[]; message?: string }> }).issues[0];
    const field = first?.path?.join(".");
    if (field?.startsWith("mediaUrls")) return "One of the media links isn't a valid URL.";
    return field ? `${field}: ${first?.message}` : (first?.message ?? "Invalid input");
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

function refresh() {
  revalidatePath("/", "layout");
}

/** Uploads in local dev come back as "/uploads/x.jpg"; Instagram needs absolute public URLs. */
async function absolutize(urls: string[]) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.|0\.0\.0\.0)/.test(host) ? "http" : "https");
  return urls.map((u) => (u.startsWith("/") && !u.startsWith("//") ? `${proto}://${host}${u}` : u));
}

/** Media = previously kept URLs + newly uploaded files (JSON) + pasted links (one per line). */
async function mediaFrom(formData: FormData): Promise<string[] | { error: string }> {
  const kept = formData.getAll("keepMedia").map((v) => str(v)).filter(Boolean);
  let uploaded: string[] = [];
  const raw = str(formData.get("uploaded"));
  if (raw) {
    try {
      const arr = JSON.parse(raw) as Array<{ url?: string }>;
      uploaded = Array.isArray(arr) ? arr.map((x) => String(x?.url ?? "")).filter(Boolean) : [];
    } catch {
      return { error: "Couldn't read the uploaded files. Try again." };
    }
  }
  const pasted = str(formData.get("mediaUrls")).split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const all = await absolutize([...kept, ...uploaded, ...pasted]);
  for (const u of all) {
    try {
      const p = new URL(u);
      if (p.protocol !== "https:" && p.protocol !== "http:") throw new Error();
    } catch {
      return { error: `“${u.slice(0, 80)}” isn't a valid link. Paste full URLs starting with https://` };
    }
  }
  return [...new Set(all)];
}

function scheduleFrom(formData: FormData): Date | null | { error: string } {
  const date = str(formData.get("date"));
  const time = str(formData.get("time"));
  if (!date) {
    if (time) return { error: "Pick a date to go with the time." };
    return null;
  }
  const d = zonedToUtc(date, time || "12:00");
  return d ?? { error: "That date or time doesn't look right." };
}

const FORMATS = schema.POST_FORMATS as readonly string[];
const EDITABLE_STATUSES: PostStatus[] = ["idea", "drafted", "approved"];

export async function createPostAction(_prev: PostFormState, formData: FormData): Promise<PostFormState> {
  const user = await requireUser();
  const clientId = str(formData.get("clientId"));
  const platform = str(formData.get("platform")) === "tiktok" ? "tiktok" : "instagram";
  const format = FORMATS.includes(str(formData.get("format"))) ? (str(formData.get("format")) as PostFormat) : platform === "tiktok" ? "video" : "feed";
  const statusIn = str(formData.get("status")) as PostStatus;
  const status = EDITABLE_STATUSES.includes(statusIn) ? statusIn : "idea";
  const publishMode = platform === "instagram" && str(formData.get("publishMode")) === "auto" ? "auto" : "manual";
  if (!clientId) return { error: "Pick a business." };

  const media = await mediaFrom(formData);
  if (!Array.isArray(media)) return media;
  const when = scheduleFrom(formData);
  if (when && !(when instanceof Date)) return when;

  let id: string;
  try {
    id = await createPost(
      { clientId, platform, format, caption: str(formData.get("caption")) || null, mediaUrls: media, scheduledFor: when, publishMode, status },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }

  let flash = "Post added to the calendar.";
  let tone: "ok" | "warn" = "ok";
  if (str(formData.get("scheduleNow")) === "1" && publishMode === "auto") {
    try {
      await schedulePost(id, user.email);
      flash = "Post added and scheduled to auto-publish.";
    } catch (e) {
      flash = `Post added, but it isn't scheduled yet: ${errorMessage(e)}`;
      tone = "warn";
    }
  }
  refresh();
  redirect(withFlash(`/calendar/${id}`, flash, tone));
}

export async function updatePostAction(_prev: PostFormState, formData: FormData): Promise<PostFormState> {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing post." };
  const db = await getDb();
  const [cur] = await db.select().from(schema.contentPosts).where(eq(schema.contentPosts.id, id));
  if (!cur) return { error: "This post was deleted." };

  const media = await mediaFrom(formData);
  if (!Array.isArray(media)) return media;
  const when = scheduleFrom(formData);
  if (when && !(when instanceof Date)) return when;
  const formatIn = str(formData.get("format"));
  const publishMode = cur.platform === "instagram" && str(formData.get("publishMode")) === "auto" ? "auto" : "manual";

  const patch: Parameters<typeof updatePost>[1] = { mediaUrls: media, scheduledFor: when, publishMode };
  if (FORMATS.includes(formatIn)) patch.format = formatIn as PostFormat;
  if (formData.has("caption")) patch.caption = str(formData.get("caption")) || null;

  let flash = "Saved.";
  let tone: "ok" | "warn" = "ok";
  // A scheduled post that can no longer auto-publish comes off the schedule instead of getting stuck.
  if (cur.status === "scheduled" && (publishMode !== "auto" || !when || media.length === 0)) {
    patch.status = "approved";
    flash = "Saved. It's no longer scheduled to auto-publish (it needs Instagram auto mode, a date/time and media). Schedule it again when ready.";
    tone = "warn";
  }
  try {
    await updatePost(id, patch, user.email);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  redirect(withFlash(`/calendar/${id}`, flash, tone));
}

export async function markPublishedAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const permalink = str(formData.get("permalink"));
  if (permalink) {
    try {
      new URL(permalink);
    } catch {
      redirect(withFlash(`/calendar/${id}`, "The post link isn't a valid URL.", "danger"));
    }
  }
  try {
    await updatePost(id, { status: "published", permalink: permalink || null }, user.email);
  } catch (e) {
    redirect(withFlash(`/calendar/${id}`, errorMessage(e), "danger"));
  }
  refresh();
  redirect(withFlash(`/calendar/${id}`, "Marked published. Any linked task is checked off."));
}

export async function schedulePostAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  try {
    await schedulePost(id, user.email);
  } catch (e) {
    redirect(withFlash(`/calendar/${id}`, errorMessage(e), "danger"));
  }
  refresh();
  redirect(withFlash(`/calendar/${id}`, "Scheduled. It will publish to Instagram automatically at the set time."));
}

export async function setPostStatusAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as PostStatus;
  if (!EDITABLE_STATUSES.includes(status)) redirect(withFlash(`/calendar/${id}`, "That status can't be set by hand.", "danger"));
  try {
    await updatePost(id, { status }, user.email);
  } catch (e) {
    redirect(withFlash(`/calendar/${id}`, errorMessage(e), "danger"));
  }
  refresh();
  const msg = status === "approved" ? "Marked ready to post." : `Status set to ${status}.`;
  redirect(withFlash(`/calendar/${id}`, msg));
}

export async function deletePostAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const back = str(formData.get("returnTo"));
  if (id) await deletePost(id, user.email);
  refresh();
  redirect(withFlash(back.startsWith("/calendar") ? back : "/calendar", "Post deleted."));
}
