"use client";

import { useState } from "react";
import { centsToDollarsInput, parseDollars, type InvoiceSettings, type SavedItem } from "@/lib/invoices-types";
import { saveInvoiceSettingsAction, saveSavedItemsAction } from "@/app/(app)/settings/invoice-actions";
import { setNextNumberAction } from "@/app/(app)/invoices/actions";
import { ActionForm, SubmitButton } from "./client-form";
import { CopyButton } from "./copy-button";
import { Status, buttonClass, cx } from "./ui";

export type StripeStatus = { configured: boolean; testMode: boolean; webhook: boolean; webhookUrl: string };

/**
 * Settings → Invoices and payments (#invoicing), for both of them: who the invoice is from, Zelle (the default way to
 * pay), check, Venmo, PayPal, the saved lines, the next invoice number, Pay online (Stripe status from the
 * environment, bank transfer on, card OFF by default) and the default due days and note. Never a password, card or
 * bank account number, never a Stripe key.
 */
export function InvoiceSettingsCard({ settings, nextNumber, stripe }: { settings: InvoiceSettings; nextNumber: string | null; stripe: StripeStatus }) {
  const s = settings;
  return (
    <div className="grid gap-8">
      <ActionForm action={saveInvoiceSettingsAction} className="grid gap-6" ariaLabel="Invoice settings">
        <fieldset className="grid gap-3">
          <legend className="eyebrow mb-2">From (top left of every invoice)</legend>
          <div className="inv-pair">
            <Field id="is-from" label="Your name">
              <input id="is-from" name="fromName" className="input" defaultValue={s.fromName ?? ""} maxLength={120} autoComplete="name" />
            </Field>
            <Field id="is-from-email" label="Email" optional>
              <input id="is-from-email" name="fromEmail" type="email" className="input" defaultValue={s.fromEmail ?? ""} maxLength={200} autoComplete="off" />
            </Field>
          </div>
          <div className="inv-pair">
            <Field id="is-addr" label="Address">
              <textarea id="is-addr" name="fromAddress" rows={2} className="input min-h-0!" defaultValue={s.fromAddress ?? ""} maxLength={300} placeholder={"Street\nCity, state ZIP"} />
            </Field>
            <Field id="is-phone" label="Phone" optional hint="Printed only when set.">
              <input id="is-phone" name="fromPhone" type="tel" className="input" defaultValue={s.fromPhone ?? ""} maxLength={40} autoComplete="off" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="eyebrow mb-2">Ways to pay</legend>
          <p className="meta -mt-1">Every invoice is paid by <b className="font-semibold text-text">Zelle</b> unless you choose another way on that invoice. A way shows up there once its details are here.</p>
          <div className="inv-pair">
            <Field id="is-zelle" label="Zelle number" hint="The phone or email customers send to. Printed with “Put invoice 0000170 in the Zelle memo”.">
              <input id="is-zelle" name="zelle" className="input" defaultValue={s.zelle ?? ""} maxLength={120} autoComplete="off" />
            </Field>
            <Field id="is-zelle-name" label="Name Zelle shows" optional>
              <input id="is-zelle-name" name="zelleName" className="input" defaultValue={s.zelleName ?? ""} maxLength={120} autoComplete="off" />
            </Field>
          </div>
          <div className="inv-pair">
            <Field id="is-check" label="Checks payable to" optional>
              <input id="is-check" name="checkPayee" className="input" defaultValue={s.checkPayee ?? ""} maxLength={120} autoComplete="off" />
            </Field>
            <Field id="is-check-addr" label="Mail checks to" optional>
              <textarea id="is-check-addr" name="checkAddress" rows={2} className="input min-h-0!" defaultValue={s.checkAddress ?? ""} maxLength={300} />
            </Field>
          </div>
          <div className="inv-pair">
            <Field id="is-venmo" label="Venmo" optional>
              <input id="is-venmo" name="venmo" className="input" defaultValue={s.venmo ?? ""} maxLength={80} placeholder="@handle" autoComplete="off" />
            </Field>
            <Field id="is-paypal" label="PayPal" optional>
              <input id="is-paypal" name="paypal" className="input" defaultValue={s.paypal ?? ""} maxLength={200} placeholder="paypal.me/…" autoComplete="off" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="eyebrow mb-2">Pay online (Stripe)</legend>
          <p>
            {stripe.configured ? (
              <Status tone="ok">On{stripe.testMode ? " (test mode)" : ""}</Status>
            ) : (
              <Status tone="neutral" className="is-wrap">Off: add STRIPE_SECRET_KEY (docs/stripe-setup.md)</Status>
            )}
          </p>
          {stripe.configured && (
            <div>
              <p className="label">Webhook</p>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <code className="min-w-0 break-all font-mono text-[0.8125rem]">{stripe.webhookUrl}</code>
                <CopyButton text={stripe.webhookUrl} size="sm" />
              </div>
              <p className="mt-1">{stripe.webhook ? <Status tone="ok" small>STRIPE_WEBHOOK_SECRET set</Status> : <Status tone="warn" small className="is-wrap">Add STRIPE_WEBHOOK_SECRET so payments are recorded</Status>}</p>
            </div>
          )}
          <label className="switch">
            <input type="checkbox" name="achEnabled" defaultChecked={s.achEnabled} />
            <span className="switch-track" aria-hidden />
            Bank transfer online
          </label>
          <label className="switch">
            <input type="checkbox" name="cardEnabled" defaultChecked={s.cardEnabled} />
            <span className="switch-track" aria-hidden />
            Card online <span className="font-normal text-muted">(off unless you turn it on)</span>
          </label>
          <table className="inv-table inv-fees" aria-label="What each way costs Nora">
            <thead>
              <tr><th scope="col">Way</th><th scope="col">What you pay</th></tr>
            </thead>
            <tbody>
              <tr><td>Zelle, check</td><td>Nothing</td></tr>
              <tr><td>Bank transfer online</td><td>0.8%, at most $5</td></tr>
              <tr><td>Card online</td><td>2.9% + 30¢</td></tr>
            </tbody>
          </table>
          <p className="hint">No fee is ever added for the customer: the total is the same however they pay. Stripe keys live only in the environment, never here.</p>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="eyebrow mb-2">New invoices</legend>
          <div className="inv-pair">
            <Field id="is-days" label="Due in (days)" hint="0 = due on receipt, like your Skynova invoices.">
              <input id="is-days" name="termsDays" type="number" min={0} max={120} className="input num" defaultValue={s.termsDays} />
            </Field>
            <Field id="is-footer" label="Default note" optional hint="Printed after NOTES: on new invoices.">
              <textarea id="is-footer" name="footer" rows={2} className="input min-h-0!" defaultValue={s.footer ?? ""} maxLength={500} />
            </Field>
          </div>
        </fieldset>

        <div>
          <SubmitButton pendingLabel="Saving…">Save invoice settings</SubmitButton>
        </div>
      </ActionForm>

      <SavedLines initial={s.savedItems} />
      <NextNumber initial={nextNumber} />
    </div>
  );
}

function Field({ id, label, optional, hint, children }: { id: string; label: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
        {optional && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

type Row = { key: number; id: string | null; description: string; amount: string };
let k = 1;

/** The creator's one-tap chips, in order. Amount empty = typed each time (Food Stipend). */
function SavedLines({ initial }: { initial: SavedItem[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((i) => ({ key: k++, id: i.id, description: i.description, amount: centsToDollarsInput(i.unitCents) })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => {
    const j = i + d;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function save() {
    setMsg(null);
    const items = [];
    for (const r of rows) {
      if (!r.description.trim() && !r.amount.trim()) continue;
      let unitCents: number | null;
      try {
        unitCents = parseDollars(r.amount);
      } catch (e) {
        return setMsg({ ok: false, text: `${r.description || "A line"}: ${e instanceof Error ? e.message : "check the amount."}` });
      }
      items.push({ id: r.id, description: r.description.trim(), unitCents });
    }
    setBusy(true);
    const res = await saveSavedItemsAction(items).catch(() => ({ ok: false as const, error: "Couldn't save the lines. Try again." }));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setRows(res.items.map((i) => ({ key: k++, id: i.id, description: i.description, amount: centsToDollarsInput(i.unitCents) })));
    setMsg({ ok: true, text: "Saved. The creator shows these as one-tap lines." });
  }

  return (
    <section aria-labelledby="saved-lines" className="grid gap-3 border-t border-border pt-6">
      <div>
        <h3 id="saved-lines" className="eyebrow">Saved lines</h3>
        <p className="meta mt-1">One tap in New invoice. Leave the amount empty for a line you type each time.</p>
      </div>
      <ul className="inv-saved">
        {rows.map((r, i) => (
          <li key={r.key} className="inv-saved-row">
            <input aria-label={`Saved line ${i + 1}`} className="input" value={r.description} maxLength={120} onChange={(e) => patch(r.key, { description: e.target.value })} />
            <span className="inv-l-amt">
              <span aria-hidden className="inv-dollar">$</span>
              <input aria-label={`Saved line ${i + 1} amount`} className="input num" inputMode="decimal" value={r.amount} placeholder="Typed" onChange={(e) => patch(r.key, { amount: e.target.value })} />
            </span>
            <span className="inv-saved-moves">
              <button type="button" className={buttonClass("ghost", "sm")} aria-label={`Move ${r.description || `line ${i + 1}`} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className={buttonClass("ghost", "sm")} aria-label={`Move ${r.description || `line ${i + 1}`} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("ghost", "sm")} disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, { key: k++, id: null, description: "", amount: "" }])}>Add a line</button>
        <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save lines"}</button>
        {msg && <span role="status"><Status tone={msg.ok ? "ok" : "danger"} small className="is-wrap">{msg.text}</Status></span>}
      </div>
    </section>
  );
}

function NextNumber({ initial }: { initial: string | null }) {
  const [next, setNext] = useState(initial);
  const [text, setText] = useState(initial ? String(Number(initial)) : "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section aria-labelledby="next-number" className="grid gap-2 border-t border-border pt-6">
      <h3 id="next-number" className="eyebrow">Next invoice number</h3>
      <p className="meta">{next ? <>The next invoice is <b className="num font-semibold text-text">{next}</b>. Your Skynova numbers carry on: 7 digits, no prefix.</> : "Shown once invoicing is set up."}</p>
      <form
        className="inv-inline max-w-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = Number(text.replace(/[#\s,]/g, ""));
          if (!Number.isInteger(n) || n < 1) return setMsg({ ok: false, text: "Use a whole number, like 170." });
          setBusy(true);
          const r = await setNextNumberAction(n).catch(() => ({ ok: false as const, error: "Couldn't save it. Try again." }));
          setBusy(false);
          if (!r.ok) return setMsg({ ok: false, text: r.error });
          setNext(r.next);
          setText(String(Number(r.next)));
          setMsg({ ok: true, text: Number(r.next) === n ? `Set. The next invoice is ${r.next}.` : `That one is already used, so the next is ${r.next}.` });
        }}
      >
        <label htmlFor="is-next" className="sr-only">Next invoice number</label>
        <input id="is-next" className="input num" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
        <button className={cx(buttonClass("secondary"))} disabled={busy}>{busy ? "Setting…" : "Set"}</button>
      </form>
      {msg ? <p role="status"><Status tone={msg.ok ? "ok" : "danger"} small className="is-wrap">{msg.text}</Status></p> : <p className="hint">You can skip ahead, never back onto a number already used.</p>}
    </section>
  );
}
