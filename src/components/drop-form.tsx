"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitDropAction, type DropFormState } from "@/app/drop/[token]/actions";
import { DROP_MAX_FILES, DROP_NOTE_MAX, dropCopy } from "@/lib/drop-copy";
import { intakeCopy, type IntakeLangCode } from "@/lib/intake-copy";
import { IntakeExpired } from "./intake-screens";
import { IntakeUpload, type IntakeUploadedFile } from "./intake-upload";
import { buttonClass, cx } from "./ui";

/**
 * The owner drop page (/drop/<token>): one short screen, made for one hand on a phone.
 * A photo of the flyer (straight to our Blob store, like the onboarding form's uploads) and one box:
 * "What's the deal? When does it end?". Either one is enough to send. After sending: a thank-you with "Send another".
 * With JavaScript off the photo picker is hidden (the page's <noscript> style) and the note still sends.
 * Server-side checks in lib/ops-drop are the source of truth.
 */
export function DropForm(props: { token: string; lang: IntakeLangCode; businessName: string; folder: string; uploadsEnabled: boolean }) {
  // "Send another" starts a fresh form (new action state, empty picker).
  const [round, setRound] = useState(0);
  return <DropFormRound key={round} {...props} onAgain={() => setRound((r) => r + 1)} />;
}

function DropFormRound({
  token, lang, businessName, folder, uploadsEnabled, onAgain,
}: {
  token: string; lang: IntakeLangCode; businessName: string; folder: string; uploadsEnabled: boolean; onAgain: () => void;
}) {
  const C = intakeCopy(lang);
  const D = dropCopy(lang);
  const [state, formAction, pending] = useActionState<DropFormState, FormData>(submitDropAction, {});
  const [uploads, setUploads] = useState<IntakeUploadedFile[]>([]);
  const [local, setLocal] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const error = local ?? state.error ?? null;

  useEffect(() => {
    if (state.done) doneRef.current?.focus();
  }, [state.done]);

  if (state.gone) return <IntakeExpired C={C} />;

  if (state.done) {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" data-intake-done="" className="px-1 py-6 text-center outline-none sm:px-4">
        <span aria-hidden className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-ok-soft text-2xl text-ok">✓</span>
        <h1 className="text-2xl font-semibold tracking-tight">{D.thanks.title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[17px] leading-relaxed text-muted">{D.thanks.body}</p>
        <button type="button" onClick={onAgain} className={cx(buttonClass("secondary"), "mt-8 min-h-12 px-5 text-[16px]")}>
          {D.thanks.again}
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        // A photo or a few words: either is enough.
        if (!uploads.length && !noteRef.current?.value.trim()) {
          e.preventDefault();
          setLocal(D.needOne);
          noteRef.current?.focus();
        } else setLocal(null);
      }}
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="uploads" value={JSON.stringify(uploads)} />
      {/* Honeypot: invisible to people, irresistible to bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input type="text" name="homepage" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <header>
        <p className="mb-1 text-[15px] font-semibold text-accent">{D.hi(businessName)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{D.title}</h1>
        <p className="mt-1 text-[16px] leading-relaxed text-muted">{D.intro}</p>
      </header>

      {uploadsEnabled ? (
        <IntakeUpload
          C={C}
          token={token}
          intakeId=""
          folder={folder}
          endpoint={`/drop/${encodeURIComponent(token)}/upload`}
          label={D.photo.label}
          hint={D.photo.hint}
          maxFiles={DROP_MAX_FILES}
          optional={false}
          uniqueNames // one upload token = one file, so two photos both named "image.jpg" need different names
          files={uploads}
          onChange={(next) => {
            setUploads(next);
            if (next.length) setLocal(null);
          }}
        />
      ) : (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-[15px] leading-relaxed text-muted">{D.uploadsOff}</p>
      )}

      <div>
        <label htmlFor="drop-note" className="mb-2 block text-[16px] font-medium leading-snug">{D.note.label}</label>
        <textarea
          key={state.at ?? 0} // after an error the server hands the note back: remount with it
          ref={noteRef}
          id="drop-note"
          name="note"
          rows={4}
          maxLength={DROP_NOTE_MAX}
          defaultValue={state.note ?? ""}
          placeholder={D.note.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "drop-note-err" : undefined}
          onInput={() => setLocal(null)}
          className={cx("input !min-h-0 !text-[16px] leading-relaxed", error && "!border-danger")}
        />
        {error && <p id="drop-note-err" role="alert" className="mt-1.5 text-[15px] text-danger">{error}</p>}
      </div>

      <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "min-h-12 w-full text-[16px]")}>
        {pending ? D.sending : D.send}
      </button>

      <p className="text-center text-sm leading-relaxed text-muted">
        {C.common.privacy} {C.common.neverPasswords}
      </p>
    </form>
  );
}
