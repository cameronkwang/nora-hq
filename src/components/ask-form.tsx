"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { createAskAction, type AskFormState } from "@/app/(app)/asks/actions";
import { UploadPicker, checkFile, uploadFiles } from "./upload-picker";
import { ROUTE_LABEL, type AskRoute } from "./ask-route";
import { buttonClass, cx } from "./ui";

type Opt = { id: string; label: string };

/** Rotating examples in the empty box — shows the range of things you can drop in. */
const EXAMPLES = [
  "Poke Bros wants a holiday promo. Can we plan something by Friday?",
  "Idea: weekly crab-cracking reel",
  "FYI: Max's is closed Monday",
  "Cameron, can you reset the TikTok password?",
  "Here are October's numbers for Poke Bros…",
];

/**
 * "New ask": one big box, optional photos and business, and one optional row of "Who's it for?" chips.
 * Anything goes — a request, an idea, an FYI, a question. Claude sorts it unless you pick.
 * Files upload from the browser first, then the ask is saved.
 */
export function AskForm({
  clients,
  defaultClientId,
  directUpload,
  routes,
}: {
  clients: Opt[];
  defaultClientId?: string;
  directUpload: boolean;
  routes: AskRoute[];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, startUpload] = useTransition();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [example, setExample] = useState(0);
  const busy = uploading;

  useEffect(() => {
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 4000);
    return () => clearInterval(t);
  }, []);

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
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div>
        <label htmlFor="ask-body" className="sr-only">
          What&rsquo;s on your mind?
        </label>
        <textarea
          id="ask-body"
          name="body"
          required
          autoFocus
          rows={6}
          placeholder={EXAMPLES[example]}
          className="input min-h-40 text-base"
          readOnly={busy}
        />
      </div>

      <fieldset disabled={busy} className="min-w-0">
        <legend className="label">Who&rsquo;s it for?</legend>
        {/* Choice chips: each wraps a radio; the checked one is ink (see .ask-chips in home-inbox.css). */}
        <div className="chips ask-chips">
          {routes.map((r) => (
            <label key={r} className="chip select-none">
              <input type="radio" name="route" value={r} defaultChecked={r === "auto"} className="sr-only" />
              <span>{ROUTE_LABEL[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="ask-client" className="label">
          Business <span className="font-normal text-muted">(optional)</span>
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
        <p role="alert" className="status is-danger whitespace-normal">
          {error}
        </p>
      )}

      {/* Phones: the one button stays in reach, just above the tab bar (a solid bar with a hairline on top). */}
      <div className="ask-bar md:static md:border-0 md:p-0">
        <button type="submit" disabled={busy} className={cx(buttonClass("secondary"), "w-full md:w-auto md:px-6")}>
          {phase === "uploading" && files.length
            ? `Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…`
            : busy
              ? "Sending…"
              : "Send"}
        </button>
      </div>
    </form>
  );
}
