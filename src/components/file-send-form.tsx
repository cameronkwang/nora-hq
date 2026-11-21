"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendFileAction } from "@/app/(app)/files/actions";
import { buttonClass, cx } from "./ui";

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*";
const KINDS = [
  { value: "contract", label: "Contract" },
  { value: "invoice", label: "Invoice" },
  { value: "other", label: "Other" },
] as const;

type Uploaded = { url: string; name: string; contentType: string; size: number };

/** direct=true: the browser sends the file straight to Blob (token from /api/files/upload). Otherwise a plain POST. */
async function uploadShared(file: File, direct: boolean): Promise<Uploaded> {
  if (direct) {
    const { upload } = await import("@vercel/blob/client");
    const safe = file.name.replace(/[^\w.\-]+/g, "-").slice(-80) || "file";
    const res = await upload(`files/${safe}`, file, { access: "public", handleUploadUrl: "/api/files/upload", contentType: file.type, multipart: file.size > 8 * 1024 * 1024 });
    return { url: res.url, name: file.name, contentType: file.type, size: file.size };
  }
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/files/upload", { method: "POST", body: fd });
  const json = (await res.json().catch(() => ({}))) as Partial<Uploaded> & { error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? `Couldn't upload ${file.name}.`);
  return { url: json.url, name: json.name ?? file.name, contentType: json.contentType ?? file.type, size: json.size ?? file.size };
}

/** "Invoice-Royal-Farms.pdf" becomes "Invoice Royal Farms": a first guess at the name Nora will see. */
function guessTitle(name: string) {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}
function guessKind(name: string): (typeof KINDS)[number]["value"] {
  if (/contract|agreement/i.test(name)) return "contract";
  if (/invoice|receipt|bill/i.test(name)) return "invoice";
  return "other";
}

/**
 * Cameron's "Send to Nora": choose a file, name it the way she will recognise it, say what kind it is, add a note
 * and (if it needs doing by a day) a reminder on her list. The file uploads first, then it is listed in her Files.
 */
export function FileSendForm({ directUpload }: { directUpload: boolean }) {
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("other");
  const [note, setNote] = useState("");
  const [remindOn, setRemindOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function pick(f: File | null) {
    setError(null);
    setSent(null);
    setFile(f);
    if (f) {
      if (!title.trim()) setTitle(guessTitle(f.name));
      setKind(guessKind(f.name));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    if (!file) return setError("Choose a file first.");
    if (file.size > MAX_BYTES) return setError(`${file.name} is over 25MB.`);
    if (!title.trim()) return setError("Give it a name Nora will recognise.");
    start(async () => {
      try {
        const up = await uploadShared(file, directUpload);
        const res = await sendFileAction({ url: up.url, fileName: up.name, contentType: up.contentType, sizeBytes: up.size, title, kind, note, remindOn: remindOn || null });
        if (!res.ok) return setError(res.error);
        setSent(`Sent. “${title.trim()}” is in Nora's Files.`);
        setFile(null);
        setTitle("");
        setNote("");
        setRemindOn("");
        setKind("other");
        if (input.current) input.current.value = "";
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't send it. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      <div>
        <input ref={input} id={`${id}-file`} type="file" accept={ACCEPT} disabled={busy} className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label htmlFor={`${id}-file`} className={cx(buttonClass("secondary"), busy && "pointer-events-none opacity-50")}>
            {file ? "Choose a different file" : "Choose a file"}
          </label>
          <span className="meta min-w-0 break-words">{file ? `${file.name} · ${sizeLabel(file.size)}` : "A PDF, picture or document, up to 25MB"}</span>
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-title`} className="label">Name she&rsquo;ll see</label>
        <input id={`${id}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Invoice for Royal Farms" disabled={busy} />
      </div>

      <fieldset disabled={busy} className="min-w-0">
        <legend className="label">Kind</legend>
        <div className="chips ask-chips">
          {KINDS.map((k) => (
            <label key={k.value} className="chip select-none">
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
              <span>{k.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${id}-note`} className="label">Note for Nora <span className="font-normal text-muted">(optional)</span></label>
        <input id={`${id}-note`} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Send this to their manager" disabled={busy} />
      </div>

      <div>
        <label htmlFor={`${id}-remind`} className="label">Remind her on <span className="font-normal text-muted">(optional)</span></label>
        <input id={`${id}-remind`} type="date" className="input sm:w-auto" value={remindOn} onChange={(e) => setRemindOn(e.target.value)} disabled={busy} />
        <p className="hint">Adds a reminder to her list for that day.</p>
      </div>

      {error && <p role="alert" className="status is-danger whitespace-normal">{error}</p>}
      {sent && <p role="status" className="status is-ok whitespace-normal">{sent}</p>}

      <div>
        <button type="submit" disabled={busy} className={cx(buttonClass("primary"), "w-full sm:w-auto sm:px-6")}>
          {busy ? "Sending…" : "Send to Nora"}
        </button>
      </div>
    </form>
  );
}

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
