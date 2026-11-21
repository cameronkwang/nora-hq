"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { createNoteAction, createReminderAction, type NoteFormState } from "@/app/(app)/notes/actions";
import { UploadPicker, checkFile, uploadFiles } from "./upload-picker";
import { SubmitButton } from "./client-form";
import { buttonClass, cx } from "./ui";

/**
 * A note: one box, an optional reminder day, optional photos, and two ways to finish. "Save for me" keeps it
 * private; "Send to Cameron" hands it over (it becomes an ask). Photos upload from the browser first.
 */
export function NoteForm({ directUpload }: { directUpload: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, start] = useTransition();
  const [phase, setPhase] = useState<"idle" | "uploading" | "save" | "send">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const intent = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "send" ? "send" : "save";
    formData.set("intent", intent);
    setError(null);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) return setError(bad);
    start(async () => {
      try {
        setProgress(0);
        setPhase("uploading");
        const uploaded = files.length ? await uploadFiles(files, directUpload, setProgress) : [];
        formData.set("attachments", JSON.stringify(uploaded));
        setPhase(intent);
        const res: NoteFormState = await createNoteAction(undefined, formData); // redirects on success
        if (res?.error) setError(res.error);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) return;
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      } finally {
        setPhase("idle");
      }
    });
  }

  const uploading = phase === "uploading" && files.length > 0;
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div>
        <label htmlFor="note-body" className="sr-only">Your note</label>
        <textarea id="note-body" name="body" required autoFocus rows={6} placeholder="Reel ideas, something to remember, a question for Cameron…" className="input min-h-40 text-base" readOnly={busy} />
      </div>

      <div>
        <label htmlFor="note-remind" className="label">Remind me on <span className="font-normal text-muted">(optional)</span></label>
        <input id="note-remind" name="remindOn" type="date" className="input sm:w-auto" disabled={busy} />
      </div>

      <UploadPicker files={files} onChange={setFiles} disabled={busy} label="Add a photo" />

      {error && <p role="alert" className="status is-danger whitespace-normal">{error}</p>}

      {/* Phones: both buttons stay in reach, just above the tab bar. */}
      <div className="ask-bar md:static md:border-0 md:p-0">
        <div className="flex gap-2">
          <button type="submit" name="intent" value="save" disabled={busy} className={cx(buttonClass("secondary"), "flex-1 md:flex-none md:px-6")}>
            {uploading ? `Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…` : phase === "save" ? "Saving…" : "Save for me"}
          </button>
          <button type="submit" name="intent" value="send" disabled={busy} className={cx(buttonClass("primary"), "flex-1 md:flex-none md:px-6")}>
            {phase === "send" ? "Sending…" : "Send to Cameron"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** A reminder: what, and which day. It goes on your own list and on the calendar. */
export function ReminderForm({ today }: { today: string }) {
  const [state, action] = useActionState(createReminderAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-5">
      <div>
        <label htmlFor="rem-title" className="label">Remind me to</label>
        <input id="rem-title" name="title" required autoFocus maxLength={200} placeholder="Post the Sample Pizzeria reel" className="input" />
      </div>
      <div>
        <label htmlFor="rem-date" className="label">On</label>
        <input id="rem-date" name="dueDate" type="date" defaultValue={today} className="input sm:w-auto" />
      </div>
      {state?.error && <p role="alert" className="status is-danger whitespace-normal">{state.error}</p>}
      <div className="ask-bar md:static md:border-0 md:p-0">
        <SubmitButton variant="primary" className="w-full md:w-auto md:px-6">Add reminder</SubmitButton>
      </div>
    </form>
  );
}
