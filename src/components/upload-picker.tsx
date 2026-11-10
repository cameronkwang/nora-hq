"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { cx } from "./ui";

export type UploadedFile = { url: string; name: string; contentType?: string };

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Client-side check so people hear about a bad file before they hit send. */
export function checkFile(f: File): string | null {
  if (!(f.type.startsWith("image/") || f.type.startsWith("video/"))) return `${f.name} isn't a photo or video.`;
  if (f.size > MAX_UPLOAD_BYTES) return `${f.name} is over 25MB.`;
  return null;
}

/**
 * Uploads files from the browser.
 * direct=true: straight to Vercel Blob (token from /api/upload) — no function size limit.
 * direct=false: multipart POST to /api/upload (local dev).
 */
export async function uploadFiles(files: File[], direct: boolean, onProgress?: (done: number) => void): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const f of files) {
    if (direct) {
      const { upload } = await import("@vercel/blob/client");
      const safe = f.name.replace(/[^\w.\-]+/g, "-").slice(-80) || "file";
      const res = await upload(`uploads/${safe}`, f, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: f.type,
        multipart: f.size > 8 * 1024 * 1024,
      });
      out.push({ url: res.url, name: f.name, contentType: f.type });
    } else {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string; name?: string; contentType?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? `Couldn't upload ${f.name}.`);
      out.push({ url: json.url, name: json.name ?? f.name, contentType: json.contentType ?? f.type });
    }
    onProgress?.(out.length);
  }
  return out;
}

/** Photo/video picker with previews. The parent owns the File list. */
export function UploadPicker({
  files,
  onChange,
  disabled,
  label = "Add photos or videos",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*,video/*"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          onChange([...files, ...picked]);
          e.target.value = "";
        }}
      />
      <label
        htmlFor={id}
        className={cx(
          "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span aria-hidden className="text-base leading-none">+</span> {label}
      </label>
      {previews.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {previews.map(({ f, url }, i) => {
            const err = checkFile(f);
            return (
              <li key={`${f.name}-${i}`} className={cx("relative w-24", err && "opacity-60")}>
                <div className="size-24 overflow-hidden rounded-lg border border-border bg-surface-2">
                  {f.type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="size-full object-cover" />
                  ) : f.type.startsWith("video/") ? (
                    <video src={url} muted playsInline className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center p-1 text-center text-xs text-muted">{f.name}</span>
                  )}
                </div>
                <p className={cx("mt-1 truncate text-xs", err ? "text-danger" : "text-muted")} title={err ?? f.name}>
                  {err ? "Not allowed" : f.name}
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  aria-label={`Remove ${f.name}`}
                  className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-xs shadow-sm hover:bg-surface-2"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
