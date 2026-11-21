"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type InvoiceDone,
  type InvoiceMessages,
  type ManualPaymentMethod,
} from "@/lib/invoices-types";
import type { IntakeLang } from "@/lib/schema";
import { finalizeAction, invoiceLinkAction, recordPaymentAction, reminderSentAction, replaceLinkAction } from "@/app/(app)/invoices/actions";
import { ActionForm, SubmitButton } from "./client-form";
import { copyText } from "./copy-button";
import { InvoiceDoneView } from "./invoice-done";
import { Status, buttonClass, cx } from "./ui";

/**
 * The invoice page's actions (people only). Make PDF on a draft turns the page into the done state; Record payment
 * is the focal button once it is finalized; Remind shows the text to send (Nora HQ never sends it itself).
 */

export function FinalizeButton({ id, canPrint }: { id: string; canPrint: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<InvoiceDone | null>(null);
  if (done) return <InvoiceDoneView done={done} />;
  return (
    <div className="grid justify-items-start gap-2">
      {!canPrint && (
        <p className="notice w-full">
          <Status tone="warn" className="is-wrap">Add how you get paid in Settings first.</Status>
          <a href="/settings#invoicing" className="link">Settings</a>
        </p>
      )}
      <button
        type="button"
        className={buttonClass("primary")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const r = await finalizeAction(id).catch(() => ({ ok: false as const, error: "Couldn't reach Nora HQ. Try again." }));
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setDone(r.done);
          router.refresh();
        }}
      >
        {busy ? "Making PDF…" : "Make PDF"}
      </button>
      {error && <p role="alert"><Status tone="danger" small className="is-wrap">{error}</Status></p>}
      <p className="hint">Takes the next number, marks it sent and makes the customer link. Then share or download the PDF.</p>
    </div>
  );
}

export function RecordPaymentForm({ invoiceId, balance, today, method }: { invoiceId: string; balance: string; today: string; method: ManualPaymentMethod }) {
  return (
    <ActionForm action={recordPaymentAction} className="inv-pay-form" resetOnSuccess>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="inv-pair">
        <div>
          <label htmlFor="pay-amount" className="label">Amount ($)</label>
          <input id="pay-amount" name="amount" className="input num" inputMode="decimal" defaultValue={balance} required autoComplete="off" />
        </div>
        <div>
          <label htmlFor="pay-on" className="label">Paid on</label>
          <input id="pay-on" name="paidOn" type="date" className="input" defaultValue={today} max={today} required />
        </div>
      </div>
      <div className="inv-pair">
        <div>
          <label htmlFor="pay-method" className="label">How</label>
          <select id="pay-method" name="method" className="input" defaultValue={method}>
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pay-ref" className="label">Reference <span className="font-normal text-muted">(optional)</span></label>
          <input id="pay-ref" name="reference" className="input" maxLength={120} placeholder="Check # or Zelle code" autoComplete="off" />
        </div>
      </div>
      <div>
        <label htmlFor="pay-note" className="label">Note <span className="font-normal text-muted">(optional)</span></label>
        <input id="pay-note" name="note" className="input" maxLength={300} autoComplete="off" />
      </div>
      <div>
        <SubmitButton variant="primary" pendingLabel="Recording…">Record payment</SubmitButton>
      </div>
      <p className="hint">Never a card or bank account number. Claude never marks anything paid.</p>
    </ActionForm>
  );
}

const LANG_LABEL: Record<IntakeLang, string> = { en: "English", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };

function CopyBtn({ text, label, size = "sm" }: { text: string; label: string; size?: "sm" | "md" }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={buttonClass("secondary", size)}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "copied" : "failed");
        window.setTimeout(() => setState("idle"), 2000);
      }}
    >
      <span aria-live="polite">{state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}

/** Remind: the friendly email and the short text in the customer's language, both with the Zelle memo line. */
export function RemindPanel({ id, messages, lang, reminded }: { id: string; messages: InvoiceMessages; lang: IntakeLang; reminded: string | null }) {
  const router = useRouter();
  const [textLang, setTextLang] = useState<IntakeLang>(lang);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const body = `${messages.reminder.subject}\n\n${messages.reminder.body}`;
  return (
    <div className="grid gap-3">
      {messages.missing.length > 0 && (
        <p><Status tone="warn" small className="is-wrap">Still to fill in: {messages.missing.join(", ")}.</Status></p>
      )}
      <div>
        <p className="label">Email</p>
        <p className="meta">{messages.reminder.subject}</p>
        <details className="g-disc is-quiet">
          <summary>Show the email</summary>
          <p className="inv-text">{body}</p>
        </details>
        <div className="inv-steps mt-2">
          <CopyBtn text={messages.reminder.body} label="Copy email" />
          <a href={messages.reminderMailto} className={buttonClass("ghost", "sm")}>Open in Mail</a>
        </div>
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label mb-0">Text message</p>
          <div className="seg" role="group" aria-label="Text language">
            {(Object.keys(LANG_LABEL) as IntakeLang[]).map((l) => (
              <button key={l} type="button" lang={l} aria-pressed={textLang === l} onClick={() => setTextLang(l)} className="text-sm">{LANG_LABEL[l]}</button>
            ))}
          </div>
        </div>
        <p lang={textLang} className="inv-text mt-1">{messages.text[textLang]}</p>
        <div className="inv-steps mt-2">
          <CopyBtn text={messages.text[textLang]} label="Copy text" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {sent ? (
          <Status tone="ok" small>Noted. Reminder sent today.</Status>
        ) : (
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            onClick={async () => {
              setError("");
              const r = await reminderSentAction(id).catch(() => ({ ok: false as const, error: "Couldn't save that." }));
              if (!r.ok) return setError(r.error);
              setSent(true);
              router.refresh();
            }}
          >
            I sent it
          </button>
        )}
        {reminded && !sent && <span className="meta">{reminded}</span>}
        {error && <Status tone="danger" small>{error}</Status>}
      </div>
    </div>
  );
}

/** Copy link (the customer's page) and New link (the old one stops working at once). */
export function LinkTools({ id, hasLink }: { id: string; hasLink: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replaced, setReplaced] = useState(false);

  async function copy(fresh: boolean) {
    setBusy(true);
    setError("");
    const r = await (fresh ? replaceLinkAction(id) : url ? Promise.resolve({ ok: true as const, url }) : invoiceLinkAction(id)).catch(() => ({ ok: false as const, error: "Couldn't get the link." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setUrl(r.url);
    if (fresh) setReplaced(true);
    const ok = await copyText(r.url);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className="grid gap-2">
      <div className="inv-steps">
        <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => copy(false)}>
          <span aria-live="polite">{state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed" : hasLink || url ? "Copy link" : "Make link"}</span>
        </button>
        {(hasLink || url) && (
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            disabled={busy}
            onClick={() => {
              if (window.confirm("Make a new link? The old one stops working at once.")) void copy(true);
            }}
          >
            New link
          </button>
        )}
      </div>
      {url && <p className={cx("meta break-all", state === "failed" && "text-text")}>{url}</p>}
      {replaced && <Status tone="ok" small>New link copied. The old one no longer works.</Status>}
      {error && <Status tone="danger" small className="is-wrap">{error}</Status>}
      <p className="hint">Their own page for this invoice: the PDF and how to pay. No other invoices, nothing else.</p>
    </div>
  );
}
