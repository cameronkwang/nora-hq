"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { copyIntakeLinkAction, createIntakeLinkAction, revokeIntakeAction } from "@/app/(app)/clients/[id]/intake/actions";
import { INTAKE_COPY, INTAKE_LANG_CODES } from "@/lib/intake-copy";
import { CopyButton } from "./copy-button";
import { buttonClass, cx } from "./ui";

export type IntakeCardStatus =
  | { kind: "none" }
  | { kind: "off"; line: string }
  | { kind: "sent" | "opened"; id: string; line: string }
  | { kind: "submitted"; id: string };

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Buttons + link + ready-to-paste messages for the business page's onboarding form section.
 * `lead` is put first in the row of buttons (the section passes "View answers" once the form is back).
 */
export function IntakeSharePanel({ clientId, clientName, status, lead }: { clientId: string; clientName: string; status: IntakeCardStatus; lead?: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const live = status.kind === "sent" || status.kind === "opened";

  const make = () =>
    start(async () => {
      setError(null);
      setConfirmNew(false);
      const r = await createIntakeLinkAction(clientId);
      if (r.ok) {
        setUrl(r.url);
        router.refresh();
      } else setError(r.error);
    });

  const show = () =>
    start(async () => {
      if (!live) return;
      setError(null);
      const r = await copyIntakeLinkAction(status.id);
      if (r.ok) setUrl(r.url);
      else setError(r.error);
    });

  const revoke = () =>
    start(async () => {
      if (!live) return;
      if (!window.confirm("Turn off this link? The client won't be able to open it any more.")) return;
      setError(null);
      const r = await revokeIntakeAction(status.id, clientId);
      if (r.ok) {
        setUrl(null);
        router.refresh();
      } else setError(r.error);
    });

  return (
    <div>
      {(status.kind === "off" || live) && <p className="mb-3">{status.line}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {lead}
        {status.kind === "none" || status.kind === "off" ? (
          <button type="button" disabled={pending} onClick={make} className={buttonClass("secondary")}>
            {pending ? "Making link…" : status.kind === "none" ? "Send onboarding form" : "Send a new link"}
          </button>
        ) : null}
        {live && !url && (
          <button type="button" disabled={pending} onClick={show} className={buttonClass("secondary")}>
            {pending ? "Loading…" : "Copy link & message"}
          </button>
        )}
        {live && (
          <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
            {confirmNew ? (
              <button type="button" disabled={pending} onClick={make} className={cx(buttonClass("secondary"), "btn-wrap ml-2")}>
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
        {status.kind === "submitted" && (
          confirmNew ? (
            <button type="button" disabled={pending} onClick={make} className={buttonClass("secondary")}>
              Yes — send a fresh form
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirmNew(true)} className={buttonClass("ghost")}>
              Send another form
            </button>
          )
        )}
      </div>

      {error && <p role="alert" className="status is-danger is-small mt-2 flex whitespace-normal">{error}</p>}

      {url && (
        <div className="share-box">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={url} aria-label="Onboarding form link" className="input min-w-0 font-mono sm:flex-1" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={url} label="Copy link" />
          </div>
          <p className="hint">Private to this client: anyone with the link can fill it in. Paste one of these into a text or WeChat:</p>
          <div className="share-msgs">
            {INTAKE_LANG_CODES.map((code) => {
              const msg = INTAKE_COPY[code].share.message(clientName, url);
              return (
                <details key={code} open={code === "en"}>
                  <summary>
                    <span>Message · {INTAKE_COPY[code].share.label}</span>
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
