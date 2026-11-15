"use client";

import { useId, useState } from "react";
import type { IntakeCopy } from "@/lib/intake-copy";
import { Status, buttonClass, cx } from "./ui";

export type IntakeUploadedFile = { url: string; name: string; contentType?: string };

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 30;
const okType = (t: string) => t.startsWith("image/") || t.startsWith("video/") || t === "application/pdf";
/** 12 random hex characters. */
const randomPrefix = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Optional photo/video/logo upload on the onboarding form. Only rendered when Vercel Blob is configured:
 * files go straight from the phone to Blob (token from /start/<token>/upload), under intake/<intake id>/.
 * The parent owns the list and posts it as JSON in a hidden "uploads" field.
 *
 * The owner drop link (/drop/<token>) reuses it with its own folder, upload route, label and file cap; left out,
 * everything works as on the onboarding form.
 */
export function IntakeUpload({
  C, token, intakeId, files, onChange, folder, endpoint, label, hint, maxFiles = MAX_FILES, optional = true, uniqueNames = false,
}: {
  C: IntakeCopy; token: string; intakeId: string; files: IntakeUploadedFile[]; onChange: (files: IntakeUploadedFile[]) => void;
  /** Folder in our Blob store, without a trailing slash. Default: intake/<intake id>. */
  folder?: string;
  /** Route that hands out upload tokens. Default: /start/<token>/upload. */
  endpoint?: string;
  label?: string;
  hint?: string;
  maxFiles?: number;
  /** Show "(optional)" after the label. */
  optional?: boolean;
  /**
   * Put a random prefix on each file name. For an upload route whose tokens make exactly one file (no random suffix,
   * no overwrite): phone photos are often all called "image.jpg".
   */
  uniqueNames?: boolean;
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
    const room = Math.max(0, maxFiles - files.length);
    const todo = good.slice(0, room);
    if (!todo.length) return;
    setBusy({ done: 0, total: todo.length });
    const added: IntakeUploadedFile[] = [];
    try {
      const { upload } = await import("@vercel/blob/client");
      for (const f of todo) {
        const safe = f.name.replace(/[^\w.\-]+/g, "-").replace(/^[-.]+/, "").slice(-80) || "file";
        const res = await upload(`${folder ?? `intake/${intakeId}`}/${uniqueNames ? `${randomPrefix()}-` : ""}${safe}`, f, {
          access: "public",
          handleUploadUrl: endpoint ?? `/start/${encodeURIComponent(token)}/upload`,
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
      <p className="ps-q">{label ?? C.fields.uploads.label}{optional && <> <span className="font-normal text-muted">({C.common.optional})</span></>}</p>
      <p className="ps-q-help mb-3">{hint ?? C.fields.uploads.hint}</p>
      <input
        id={id}
        type="file"
        accept="image/*,video/*,application/pdf"
        multiple
        disabled={!!busy}
        className="peer sr-only"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          void pick(picked);
        }}
      />
      {/* The picker is the label of the hidden file input; the ring shows on it when the input has keyboard focus. */}
      <label
        htmlFor={id}
        className={cx(
          buttonClass("secondary"),
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-text peer-focus-visible:outline",
          busy && "pointer-events-none opacity-45",
        )}
      >
        <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
        {C.upload.pick}
      </label>
      <p aria-live="polite" className="mt-2 min-h-[1px]">
        {busy ? <span className="meta">{C.upload.uploading(busy.done, busy.total)}</span> : files.length ? <Status tone="ok" small>{C.upload.done(files.length)}</Status> : null}
      </p>
      {error && <p role="alert" className="status is-danger is-small ps-err flex">{error}</p>}
      {files.length > 0 && (
        <ul className="list is-ruled mt-2">
          {files.map((f, i) => (
            <li key={f.url} className="row items-center py-0">
              <span className="row-title is-plain truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className={buttonClass("ghost", "sm")}
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
