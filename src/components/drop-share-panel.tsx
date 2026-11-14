"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyDropLinkAction, createDropLinkAction, revokeDropLinkAction } from "@/app/(app)/clients/[id]/drop-actions";
import { DROP_COPY } from "@/lib/drop-copy";
import { INTAKE_COPY, INTAKE_LANG_CODES, type IntakeLangCode } from "@/lib/intake-copy";
import { CopyButton } from "./copy-button";
import { buttonClass, cx } from "./ui";

/**
 * Buttons + link + ready-to-text messages for the business page's "Owner drop link" card.
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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!live && (
          <button type="button" disabled={pending} onClick={() => make(false)} className={buttonClass("primary")}>
            {pending ? "Making link…" : "Make drop link"}
          </button>
        )}
        {live && !url && (
          <button type="button" disabled={pending} onClick={show} className={buttonClass("primary")}>
            {pending ? "Loading…" : "Copy link & message"}
          </button>
        )}
        {live && (
          <>
            {confirmNew ? (
              <button type="button" disabled={pending} onClick={() => make(true)} className={buttonClass("secondary")}>
                Yes — make a new link (old one stops working)
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => setConfirmNew(true)} className={buttonClass("ghost")}>
                New link
              </button>
            )}
            <button type="button" disabled={pending} onClick={revoke} className={cx(buttonClass("ghost"), "text-danger")}>
              Turn off
            </button>
          </>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {url && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={url} aria-label="Owner drop link" className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={url} label="Copy link" variant="primary" />
          </div>
          <p className="text-xs text-muted">Private to this owner — anyone with the link can send a flyer for {clientName}. Paste one of these into a text or WeChat:</p>
          {INTAKE_LANG_CODES.map((code) => {
            const msg = DROP_COPY[code].share.message(clientName, url);
            return (
              <details key={code} className="group rounded-lg bg-surface-2 px-3 py-2" open={code === (lang ?? "en")}>
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
                  <span>Message · {DROP_COPY[code].share.label}</span>
                  <span aria-hidden className="text-muted group-open:rotate-90">›</span>
                </summary>
                <p lang={INTAKE_COPY[code].htmlLang} className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{msg}</p>
                <div className="mt-2">
                  <CopyButton text={msg} label="Copy message" size="sm" />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
