"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionFormState } from "./client-form";
import { buttonClass, cx } from "./ui";

type Action = (s: ActionFormState, fd: FormData) => Promise<ActionFormState>;

/**
 * Buttons for an approved external report: email it to the owner (Gmail) or, if it went out another way,
 * mark it sent. Sending asks for confirmation first — it goes straight to the business owner.
 */
export function ReportSendActions({
  send,
  markSent,
  ownerEmail,
  business,
}: {
  send: Action | null;
  markSent: Action;
  ownerEmail: string | null;
  business: string;
}) {
  const [manual, setManual] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {send && ownerEmail ? (
        <ActionForm action={send} ariaLabel="Send report" className="flex flex-col gap-1">
          <ConfirmSubmit confirm={`Email this report to ${ownerEmail} (${business}) now?`}>Send to owner</ConfirmSubmit>
          <p className="break-words text-xs text-muted">Goes to {ownerEmail} from the shared Gmail inbox, as plain text.</p>
        </ActionForm>
      ) : (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          No owner email yet — add it in the business settings to send from here, or copy it and send it yourself.
        </p>
      )}
      {!manual ? (
        <button type="button" onClick={() => setManual(true)} className={cx(buttonClass("ghost", "sm"), "self-start")}>
          Sent it another way? Mark sent
        </button>
      ) : (
        <ActionForm action={markSent} ariaLabel="Mark report sent" className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
          <label className="label" htmlFor="r-sent-to">Sent to</label>
          <input id="r-sent-to" name="sentTo" type="email" inputMode="email" autoCapitalize="none" defaultValue={ownerEmail ?? ""} className="input" placeholder="owner@business.com" />
          <div>
            <SubmitButton size="md" variant="secondary" pendingLabel="Saving…">Mark sent</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

function ConfirmSubmit({ children, confirm }: { children: React.ReactNode; confirm: string }) {
  return (
    <span
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("button") && !window.confirm(confirm)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className="contents"
    >
      <SubmitButton pendingLabel="Sending…" className="w-full sm:w-auto">{children}</SubmitButton>
    </span>
  );
}

/** "Ask Claude to draft" for a month with no report yet. */
export function ReportRequestButton({ action, label = "Ask Claude to draft this month" }: { action: Action; label?: string }) {
  return (
    <ActionForm action={action} ariaLabel="Ask Claude to draft reports">
      <SubmitButton variant="primary" pendingLabel="Asking…">{label}</SubmitButton>
    </ActionForm>
  );
}
