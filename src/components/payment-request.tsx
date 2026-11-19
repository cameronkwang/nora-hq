"use client";

import { useState } from "react";
import { mailtoHref, type PaymentText } from "@/lib/payment-request";
import { CopyButton } from "./copy-button";
import { PaymentLineForm } from "./payment-line-form";
import { buttonClass } from "./ui";

type Kind = "invoice" | "reminder";
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "invoice", label: "Invoice" },
  { value: "reminder", label: "Friendly reminder" },
];

/**
 * "Request payment" on a deal: the invoice / friendly-reminder text (written from a template on the server —
 * no AI), editable, with Copy and "Email it" (opens the person's own mail app). Nothing is sent from here.
 * Collapsed until asked for. When the deal changes (fee, a post link, the payment line) the text starts
 * again from the fresh version; the panel stays open and on the same tab.
 */
export function PaymentRequest({
  invoice,
  reminder,
  missing,
  to,
  paymentLine,
  invoiced,
}: {
  invoice: PaymentText;
  reminder: PaymentText;
  /** Plain-words gaps ("the fee", "how you get paid"). */
  missing: string[];
  /** The deal's contact email, if any. */
  to: string | null;
  paymentLine: string | null;
  /** Already marked "Invoice sent" → opens on the reminder. */
  invoiced: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(invoiced ? "reminder" : "invoice");
  // What's been typed, per tab — thrown away when the server's text changes (new fee, link or payment line).
  const version = `${invoice.body}\n${reminder.body}`;
  const fresh = { version, invoice: invoice.body, reminder: reminder.body };
  const [edits, setEdits] = useState(fresh);
  const text = edits.version === version ? edits : fresh;
  const subject = kind === "invoice" ? invoice.subject : reminder.subject;
  const taId = "payment-request-text";

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="g-disc mt-5">
      <summary className="select-none">
        {invoiced ? "Send a reminder" : "Request payment"}
        <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="g-disc-body flex flex-col gap-4">
        {!paymentLine && <PaymentLineForm line={null} id="deal-payment-line" />}

        <div role="group" aria-label="Which text" className="chips">
          {KINDS.map((k) => (
            <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => setKind(k.value)} className="chip">
              <span>{k.label}</span>
            </button>
          ))}
        </div>

        {missing.length > 0 && (
          <p className="status is-warn is-small whitespace-normal">
            Still missing: {missing.join(" and ")}. {missing.includes("the fee") ? "Set the fee in Terms and save, or type it in below." : "Save it above, or type it in below."}
          </p>
        )}

        <div>
          <label className="label" htmlFor={taId}>Text (change anything before you send it)</label>
          <textarea
            id={taId}
            rows={14}
            className="input"
            value={text[kind]}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setEdits({ ...text, [kind]: v });
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton targetId={taId} label="Copy text" />
          <a href={mailtoHref(to, { subject, body: text[kind] })} className={buttonClass("secondary")}>Email it</a>
        </div>
        <p className="meta">
          {to ? `“Email it” opens your mail app to ${to}.` : "No contact email on this deal. “Email it” opens your mail app with the text; add the address there."}{" "}
          Nothing is sent from Nora HQ.{invoiced ? "" : " Once it’s sent, tap “Invoice sent” above."}
        </p>
      </div>
    </details>
  );
}
