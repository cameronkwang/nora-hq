"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createAskAction, type AskFormState } from "@/app/(app)/asks/actions";
import { UploadPicker, checkFile, uploadFiles } from "./upload-picker";
import { buttonClass } from "./ui";

type Opt = { id: string; label: string };

/** Text-message style "drop an ask" form. Files upload from the browser first, then the ask is saved. */
export function AskForm({ clients, defaultClientId, directUpload }: { clients: Opt[]; defaultClientId?: string; directUpload: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, startUpload] = useTransition();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const busy = uploading;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) {
      setError(bad);
      return;
    }
    startUpload(async () => {
      try {
        setProgress(0);
        setPhase("uploading");
        const uploaded = files.length ? await uploadFiles(files, directUpload, setProgress) : [];
        formData.delete("files");
        formData.set("attachments", JSON.stringify(uploaded));
        setPhase("saving");
        const res: AskFormState = await createAskAction(undefined, formData); // redirects on success
        if (res?.error) setError(res.error);
      } catch (err) {
        // redirect() from the server action surfaces as a navigation, not an error we should show
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) return;
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      } finally {
        setPhase("idle");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="ask-body" className="sr-only">
          What do you need?
        </label>
        <textarea
          id="ask-body"
          name="body"
          required
          autoFocus
          rows={6}
          placeholder="e.g. Poke Bros has a new mango bowl this week — can we get a reel up by Friday? Photos attached."
          className="input min-h-40 text-base"
          readOnly={busy}
        />
        <p className="mt-1.5 text-xs text-muted">Claude picks these up next time it checks the queue.</p>
      </div>

      <div>
        <label htmlFor="ask-client" className="label">
          Business (optional)
        </label>
        <select id="ask-client" name="clientId" defaultValue={defaultClientId ?? ""} className="input" disabled={busy}>
          <option value="">Not sure / several</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <UploadPicker files={files} onChange={setFiles} disabled={busy} />

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={buttonClass("primary") + " w-full py-3 text-base sm:w-auto"}>
          {phase === "uploading" && files.length
            ? `Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…`
            : busy
              ? "Sending…"
              : "Send ask"}
        </button>
      </div>
    </form>
  );
}
