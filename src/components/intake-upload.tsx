"use client";

import { useId, useState } from "react";
import type { IntakeCopy } from "@/lib/intake-copy";
import { cx } from "./ui";

export type IntakeUploadedFile = { url: string; name: string; contentType?: string };

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 30;
const okType = (t: string) => t.startsWith("image/") || t.startsWith("video/") || t === "application/pdf";

/**
 * Optional photo/video/logo upload on the onboarding form. Only rendered when Vercel Blob is configured:
 * files go straight from the phone to Blob (token from /start/<token>/upload), under intake/<intake id>/.
 * The parent owns the list and posts it as JSON in a hidden "uploads" field.
 */
export function IntakeUpload({
  C, token, intakeId, files, onChange,
}: {
  C: IntakeCopy; token: string; intakeId: string; files: IntakeUploadedFile[]; onChange: (files: IntakeUploadedFile[]) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(list: File[]) {
    setError(null);
    const good: File[] = [];
    for (const f of list) {
      if (!okType(f.type)) setError(C.upload.badType(f.name));
      else if (f.size > MAX_BYTES) setError(C.upload.tooBig(f.name));
      else good.push(f);
    }
    const room = Math.max(0, MAX_FILES - files.length);
    const todo = good.slice(0, room);
    if (!todo.length) return;
    setBusy({ done: 0, total: todo.length });
    const added: IntakeUploadedFile[] = [];
    try {
      const { upload } = await import("@vercel/blob/client");
      for (const f of todo) {
        const safe = f.name.replace(/[^\w.\-]+/g, "-").replace(/^[-.]+/, "").slice(-80) || "file";
        const res = await upload(`intake/${intakeId}/${safe}`, f, {
          access: "public",
          handleUploadUrl: `/start/${encodeURIComponent(token)}/upload`,
          contentType: f.type,
          multipart: f.size > 8 * 1024 * 1024,
        });
        added.push({ url: res.url, name: f.name.slice(0, 200), contentType: f.type });
        setBusy({ done: added.length, total: todo.length });
      }
    } catch (e) {
      console.error("[intake] upload failed", e);
      setError(C.upload.failed);
    } finally {
      if (added.length) onChange([...files, ...added]);
      setBusy(null);
    }
  }

  return (
    <div className="intake-js">
      <p className="mb-1.5 text-[16px] font-medium">{C.fields.uploads.label} <span className="font-normal text-muted">({C.common.optional})</span></p>
      <p className="mb-2 text-[15px] text-muted">{C.fields.uploads.hint}</p>
      <input
        id={id}
        type="file"
        accept="image/*,video/*,application/pdf"
        multiple
        disabled={!!busy}
        className="sr-only"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          void pick(picked);
        }}
      />
      <label
        htmlFor={id}
        className={cx(
          "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-2 text-[16px] font-medium hover:bg-surface-2",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <span aria-hidden className="text-lg leading-none">+</span> {C.upload.pick}
      </label>
      <p aria-live="polite" className="mt-2 text-[15px]">
        {busy ? <span className="text-muted">{C.upload.uploading(busy.done, busy.total)}</span> : files.length ? <span className="text-ok">{C.upload.done(files.length)}</span> : null}
      </p>
      {error && <p role="alert" className="mt-1 text-[15px] text-danger">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <li key={f.url} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-[15px]">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="min-h-10 shrink-0 rounded-lg px-2 text-sm text-muted hover:bg-surface hover:text-text"
              >
                {C.upload.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
