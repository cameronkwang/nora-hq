"use client";

import { useState, useTransition, type FormEvent } from "react";
import { deliverAction, type DeliverFormState } from "@/app/(app)/delivered/actions";
import { UploadPicker, checkFile, uploadFiles } from "./upload-picker";
import { buttonClass, cx } from "./ui";

type Opt = { id: string; label: string };

/**
 * "Deliver to Nora": a title, the finished files (photos, videos or a PDF like a flyer), an optional note, and the ask
 * it answers. Files upload from the browser first, then the delivery is saved and lands in her Delivered tab.
 */
export function DeliveryForm({
  to,
  clients,
  asks,
  defaultClientId,
  defaultAskId,
  directUpload,
}: {
  to: string;
  clients: Opt[];
  asks: Opt[];
  defaultClientId?: string;
  defaultAskId?: string;
  directUpload: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, start] = useTransition();
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [askId, setAskId] = useState(defaultAskId ?? "");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) {
      setError(bad);
      return;
    }
    if (!files.length && !String(formData.get("note") ?? "").trim()) {
      setError("Add a file or a note: there's nothing to deliver yet.");
      return;
    }
    start(async () => {
      try {
        setProgress(0);
        setPhase("uploading");
        const uploaded = files.length ? await uploadFiles(files, directUpload, setProgress) : [];
        formData.delete("files");
        formData.set("attachments", JSON.stringify(uploaded));
        setPhase("saving");
        const res: DeliverFormState = await deliverAction(undefined, formData); // redirects on success
        if (res?.error) setError(res.error);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) return;
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      } finally {
        setPhase("idle");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div>
        <label htmlFor="dlv-title" className="label">What is it?</label>
        <input id="dlv-title" name="title" required maxLength={140} placeholder="New holiday flyer for Poke Bros" className="input" readOnly={busy} />
      </div>

      <div>
        <span className="label">Files</span>
        <UploadPicker files={files} onChange={setFiles} disabled={busy} label="Add files" accept="image/*,video/*,application/pdf" />
        <p className="meta mt-2">Photos, videos or a PDF, up to 25MB each.</p>
      </div>

      <div>
        <label htmlFor="dlv-note" className="label">
          Note for {to} <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="dlv-note" name="note" rows={4} maxLength={4000} placeholder="Where it goes, what to post with it, anything to check." className="input" readOnly={busy} />
      </div>

      <div>
        <label htmlFor="dlv-ask" className="label">
          The ask it answers <span className="font-normal text-muted">(optional)</span>
        </label>
        <select id="dlv-ask" name="askId" value={askId} onChange={(e) => setAskId(e.target.value)} className="input" disabled={busy}>
          <option value="">None</option>
          {asks.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        {askId && (
          <label className="mt-3 flex min-h-11 items-center gap-2 md:pointer-fine:min-h-0">
            <input type="checkbox" name="closeAsk" defaultChecked className="check" disabled={busy} />
            <span>Mark that ask done</span>
          </label>
        )}
      </div>

      <div>
        <label htmlFor="dlv-client" className="label">
          Business <span className="font-normal text-muted">(optional)</span>
        </label>
        <select id="dlv-client" name="clientId" defaultValue={defaultClientId ?? ""} className="input" disabled={busy}>
          <option value="">{askId ? "Same as the ask" : "Not set"}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="status is-danger whitespace-normal">
          {error}
        </p>
      )}

      <div className="ask-bar md:static md:border-0 md:p-0">
        <button type="submit" disabled={busy} className={cx(buttonClass("primary"), "w-full md:w-auto md:px-6")}>
          {phase === "uploading" && files.length
            ? `Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…`
            : busy
              ? "Delivering…"
              : `Deliver to ${to}`}
        </button>
      </div>
    </form>
  );
}
