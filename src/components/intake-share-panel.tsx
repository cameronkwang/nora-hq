"use client";

import { useState, useTransition } from "react";
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

/** Buttons + link + ready-to-paste messages for the business page's onboarding form card. */
export function IntakeSharePanel({ clientId, clientName, status }: { clientId: string; clientName: string; status: IntakeCardStatus }) {
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
    <div className="space-y-3">
      {(status.kind === "off" || live) && <p className="text-sm">{status.line}</p>}

      <div className="flex flex-wrap gap-2">
        {status.kind === "none" || status.kind === "off" ? (
          <button type="button" disabled={pending} onClick={make} className={buttonClass("primary")}>
            {pending ? "Making link…" : status.kind === "none" ? "Send onboarding form" : "Send a new link"}
          </button>
        ) : null}
        {live && !url && (
          <button type="button" disabled={pending} onClick={show} className={buttonClass("primary")}>
            {pending ? "Loading…" : "Copy link & message"}
          </button>
        )}
        {live && (
          <>
            {confirmNew ? (
              <button type="button" disabled={pending} onClick={make} className={buttonClass("secondary")}>
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
        {status.kind === "submitted" && (
          confirmNew ? (
            <button type="button" disabled={pending} onClick={make} className={buttonClass("secondary", "sm")}>
              Yes — send a fresh form
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirmNew(true)} className={buttonClass("ghost", "sm")}>
              Send another form
            </button>
          )
        )}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {url && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={url} aria-label="Onboarding form link" className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={url} label="Copy link" variant="primary" />
          </div>
          <p className="text-xs text-muted">Private to this client — anyone with the link can fill it in. Paste one of these into a text or WeChat:</p>
          {INTAKE_LANG_CODES.map((code) => {
            const msg = INTAKE_COPY[code].share.message(clientName, url);
            return (
              <details key={code} className="group rounded-lg bg-surface-2 px-3 py-2" open={code === "en"}>
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
                  <span>Message · {INTAKE_COPY[code].share.label}</span>
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
