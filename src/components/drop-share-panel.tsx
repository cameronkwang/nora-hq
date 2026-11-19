"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyDropLinkAction, createDropLinkAction, revokeDropLinkAction } from "@/app/(app)/clients/[id]/drop-actions";
import { DROP_COPY } from "@/lib/drop-copy";
import { INTAKE_COPY, INTAKE_LANG_CODES, type IntakeLangCode } from "@/lib/intake-copy";
import { CopyButton } from "./copy-button";
import { buttonClass, cx } from "./ui";

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Buttons + link + ready-to-text messages for the business page's "Owner drop link" section.
 * No link yet → "Make drop link". A working link → "Copy link & message", "New link" (the old one stops working)
 * and "Turn off". The message opens in the language the owner uses (when we know it).
 */
export function DropSharePanel({ clientId, clientName, live, lang }: { clientId: string; clientName: string; live: boolean; lang: IntakeLangCode | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  const make = (replace: boolean) =>
    start(async () => {
      setError(null);
      setConfirmNew(false);
      const r = await createDropLinkAction(clientId, replace);
      if (r.ok) {
        setUrl(r.url);
        router.refresh();
      } else setError(r.error);
    });

  const show = () =>
    start(async () => {
      setError(null);
      const r = await copyDropLinkAction(clientId);
      if (r.ok) setUrl(r.url);
      else setError(r.error);
    });

  const revoke = () =>
    start(async () => {
      if (!window.confirm("Turn off this link? The owner won't be able to send flyers with it any more.")) return;
      setError(null);
      const r = await revokeDropLinkAction(clientId);
      if (r.ok) {
        setUrl(null);
        router.refresh();
      } else setError(r.error);
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {!live && (
          <button type="button" disabled={pending} onClick={() => make(false)} className={buttonClass("secondary")}>
            {pending ? "Making link…" : "Make drop link"}
          </button>
        )}
        {live && !url && (
          <button type="button" disabled={pending} onClick={show} className={buttonClass("secondary")}>
            {pending ? "Loading…" : "Copy link & message"}
          </button>
        )}
        {live && (
          <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
            {confirmNew ? (
              <button type="button" disabled={pending} onClick={() => make(true)} className={cx(buttonClass("secondary"), "btn-wrap ml-2")}>
                Yes, make a new link (old one stops working)
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => setConfirmNew(true)} className={buttonClass("ghost")}>
                New link
              </button>
            )}
            <button type="button" disabled={pending} onClick={revoke} className={cx(buttonClass("ghost"), "text-danger")}>
              Turn off
            </button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="status is-danger is-small mt-2 flex whitespace-normal">{error}</p>}

      {url && (
        <div className="share-box">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={url} aria-label="Owner drop link" className="input min-w-0 font-mono sm:flex-1" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={url} label="Copy link" />
          </div>
          <p className="hint">Private to this owner: anyone with the link can send a flyer for {clientName}. Paste one of these into a text or WeChat:</p>
          <div className="share-msgs">
            {INTAKE_LANG_CODES.map((code) => {
              const msg = DROP_COPY[code].share.message(clientName, url);
              return (
                <details key={code} open={code === (lang ?? "en")}>
                  <summary>
                    <span>Message · {DROP_COPY[code].share.label}</span>
                    <Chevron />
                  </summary>
                  <p lang={INTAKE_COPY[code].htmlLang}>{msg}</p>
                  <div>
                    <CopyButton text={msg} label="Copy message" size="sm" />
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
