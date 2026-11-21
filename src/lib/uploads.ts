import "server-only";
import { randomBytes } from "node:crypto";
import type { Attachment } from "./schema";

/**
 * File uploads for asks and other modules.
 *  - Production (BLOB_READ_WRITE_TOKEN set): Vercel Blob, public URLs.
 *  - Local dev: written to public/uploads and served by Next as /uploads/...
 *
 * Note: Vercel functions accept at most ~4.5MB per request, so the browser uploads straight to Blob
 * (see /api/upload + components/upload-picker) when Blob is configured. saveUpload() is the server-side path.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = ["image/*", "video/*"];

export class UploadError extends Error {}

export function blobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** This app's own Blob store host, from BLOB_READ_WRITE_TOKEN (vercel_blob_rw_<storeId>_<secret>). Null when uploads are off. */
export function ownBlobHost(): string | null {
  const storeId = (process.env.BLOB_READ_WRITE_TOKEN ?? "").split("_")[3] ?? "";
  return /^[a-z0-9]+$/i.test(storeId) ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

/**
 * True only for a file in OUR Blob store under `folder` ("drop/<link id>/"). Public pages post the URLs of files the
 * browser uploaded, so they're never trusted otherwise (same check as the onboarding form's isIntakeUploadUrl).
 */
export function isOwnBlobUrl(url: unknown, folder: string): url is string {
  if (typeof url !== "string" || url.length > 1000 || !folder || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/$/.test(folder)) return false;
  const host = ownBlobHost();
  if (!host) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.host.toLowerCase() === host && !u.username && !u.password && !u.port
    && u.pathname.startsWith(`/${folder}`) && !/(^|\/)\.\.?(\/|$)|%2e%2e|%2f|%5c/i.test(u.pathname);
}

export function isAllowedType(contentType: string | null | undefined): boolean {
  return !!contentType && (contentType.startsWith("image/") || contentType.startsWith("video/"));
}

export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(-80);
  return cleaned || "file";
}

export function validateUpload(file: { name: string; size: number; type: string }) {
  if (!file.size) throw new UploadError(`${file.name || "File"} is empty.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`${file.name} is over 25MB.`);
  if (!isAllowedType(file.type)) throw new UploadError(`${file.name} isn't a photo or video.`);
}

export async function saveUpload(file: File): Promise<Required<Attachment>> {
  validateUpload(file);
  const name = safeName(file.name);

  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    const res = await put(`uploads/${name}`, file, { access: "public", addRandomSuffix: true, contentType: file.type });
    return { url: res.url, name: file.name || name, contentType: file.type };
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const fileName = `${randomBytes(6).toString("hex")}-${name}`;
  await writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));
  return { url: `/uploads/${fileName}`, name: file.name || name, contentType: file.type };
}

/** Pulls real File entries (non-empty) out of a FormData field. */
export function filesFrom(formData: FormData, field: string): File[] {
  return formData.getAll(field).filter((f): f is File => typeof f !== "string" && f.size > 0);
}

/** Parses attachments the browser already uploaded (JSON array in a hidden field). Only trusts our own URL shapes. */
export function attachmentsFromJson(raw: FormDataEntryValue | null): Attachment[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Attachment[] = [];
  for (const a of parsed) {
    if (!a || typeof a !== "object") continue;
    const { url, name, contentType } = a as Record<string, unknown>;
    if (typeof url !== "string" || typeof name !== "string") continue;
    const ok = url.startsWith("/uploads/") || /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);
    if (!ok) continue;
    out.push({ url, name: name.slice(0, 200), contentType: typeof contentType === "string" ? contentType : undefined });
  }
  return out.slice(0, 20);
}

/* ───────────── Files Cameron sends to Nora (lib/ops-files): documents as well as pictures ───────────── */

/** Blob folder (and local file prefix) for files sent to Nora. */
export const SHARED_FILE_FOLDER = "files/";
export const SHARED_FILE_TYPES = [
  "application/pdf",
  "image/*",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export function isSharedFileType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return SHARED_FILE_TYPES.some((t) => (t.endsWith("/*") ? contentType.startsWith(t.slice(0, -1)) : contentType === t));
}

/** True for a file this app stored for the Files tab: our Blob store under files/, or a local dev upload. */
export function isSharedFileUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (!blobEnabled()) return /^\/uploads\/files-[a-f0-9]{12}-[\w.\-]+$/.test(url);
  return isOwnBlobUrl(url, SHARED_FILE_FOLDER);
}

/** Server-side save for the Files tab (local dev, or a small file in production). */
export async function saveSharedFile(file: File): Promise<{ url: string; name: string; contentType: string; size: number }> {
  if (!file.size) throw new UploadError(`${file.name || "File"} is empty.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`${file.name} is over 25MB.`);
  if (!isSharedFileType(file.type)) throw new UploadError(`${file.name} isn't a PDF, picture or document.`);
  const name = safeName(file.name);
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    const res = await put(`${SHARED_FILE_FOLDER}${name}`, file, { access: "public", addRandomSuffix: true, contentType: file.type });
    return { url: res.url, name: file.name || name, contentType: file.type, size: file.size };
  }
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const fileName = `files-${randomBytes(6).toString("hex")}-${name}`;
  await writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));
  return { url: `/uploads/${fileName}`, name: file.name || name, contentType: file.type, size: file.size };
}
