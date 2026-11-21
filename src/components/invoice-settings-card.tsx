"use client";

import { useState } from "react";
import { DEFAULTABLE_PAY_WAYS, NEW_INVOICE_PAY_WAYS, PAY_WAY_LABEL, centsToDollarsInput, maskAccountNumber, parseDollars, type InvoiceSettings, type PayWay, type SavedItem } from "@/lib/invoices-types";
import { removeBankDetailsAction, saveInvoiceSettingsAction, saveSavedItemsAction } from "@/app/(app)/settings/invoice-actions";
import { setNextNumberAction } from "@/app/(app)/invoices/actions";
import { ActionForm, SubmitButton } from "./client-form";
import { CopyButton } from "./copy-button";
import { Status, buttonClass, cx } from "./ui";

export type StripeStatus = { configured: boolean; testMode: boolean; webhook: boolean; webhookUrl: string };

/**
 * Settings → Invoices and payments (#invoicing), for both of them: who the invoice is from, Zelle, her own bank account
 * for a transfer (ACH), check, Venmo, PayPal, the saved lines, the next invoice number, Pay online (Stripe status from
 * the environment, bank transfer on, card OFF by default), the ways ticked for new invoices and the default due days
 * and note. Never a password, a card number or a Stripe key.
 *
 * Her bank account is the one account number Nora HQ keeps (docs/invoicing.md "Her own bank account"). This card only
 * ever RECEIVES it: `settings` carries the last digits (shown as ••••6789) and the routing number, never the account
 * number, so it is not in this page's HTML. Replacing it means typing both numbers again. What she types lives in
 * this component's state until Save, is sent once to the server action, and is cleared when the save worked.
 *
 * The tick boxes and the two switches live in state (a way's box turns on the moment its details are typed), inside a
 * form with a server action. React resets such a form every time the action answers, saved or refused, and a reset
 * puts a tick box back to how it was when the page opened. `Tick` below keeps every box's reset value equal to its
 * state, so the page always shows what was just saved and the next Save sends the same ticks again.
 */
export function InvoiceSettingsCard({ settings, nextNumber, stripe }: { settings: InvoiceSettings; nextNumber: string | null; stripe: StripeStatus }) {
  const s = settings;
  // What decides whether a way can be ticked for new invoices: its details, as typed right now.
  const [zelle, setZelle] = useState(s.zelle ?? "");
  const [fromName, setFromName] = useState(s.fromName ?? "");
  const [checkPayee, setCheckPayee] = useState(s.checkPayee ?? "");
  const [venmo, setVenmo] = useState(s.venmo ?? "");
  const [paypal, setPaypal] = useState(s.paypal ?? "");
  const [bankOnline, setBankOnline] = useState(s.achEnabled);
  const [cardOnline, setCardOnline] = useState(s.cardEnabled);
  const [bankLabel, setBankLabel] = useState(s.ownBankLabel ?? "");
  const [account, setAccount] = useState("");
  const [routing, setRouting] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [bankMsg, setBankMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Nothing ticked yet is the built-in default: Zelle and check (a bank transfer only when a customer asks for it).
  const [ticked, setTicked] = useState<PayWay[]>(s.payDefaults.length ? s.payDefaults : [...NEW_INVOICE_PAY_WAYS]);
  // True once she ticked or unticked a way on this page: only then does Save send the ticks (see the boxes below).
  const [ticksChanged, setTicksChanged] = useState(false);

  const bankSaved = !!s.ownBankLast4;
  const typingBank = !bankSaved || replacing;
  const stripeWhy = "Pay online needs Stripe set up first.";
  const ready: Record<(typeof DEFAULTABLE_PAY_WAYS)[number], string | null> = {
    zelle: zelle.trim() ? null : "Add your Zelle number above first.",
    ach: bankSaved || (account.trim() && routing.trim()) ? null : "Add your account and routing numbers above first.",
    check: checkPayee.trim() || fromName.trim() ? null : "Add your name above first.",
    venmo: venmo.trim() ? null : "Add your Venmo above first.",
    paypal: paypal.trim() ? null : "Add your PayPal above first.",
    bank: !stripe.configured ? stripeWhy : bankOnline ? null : "Turn on Bank transfer online above first.",
    card: !stripe.configured ? stripeWhy : cardOnline ? null : "Turn on Card online above first.",
  };

  async function removeBank() {
    if (!window.confirm("Remove the bank account from Nora HQ? Invoices that offer a bank transfer stop printing it until you add one again.")) return;
    setRemoving(true);
    setBankMsg(null);
    const r = await removeBankDetailsAction().catch(() => ({ ok: false as const, error: "Couldn't remove it. Try again." }));
    setRemoving(false);
    if (!r.ok) return setBankMsg({ ok: false, text: r.error });
    setAccount("");
    setRouting("");
    setReplacing(false);
    setTicked((t) => t.filter((w) => w !== "ach"));
    setBankMsg({ ok: true, text: "Removed. No bank account is saved." });
  }

  return (
    <div className="grid gap-8">
      <ActionForm
        action={saveInvoiceSettingsAction}
        className="grid gap-6"
        ariaLabel="Invoice settings"
        onSaved={() => {
          // The numbers were sent and stored: nothing of them stays in the browser.
          setAccount("");
          setRouting("");
          setReplacing(false);
          setBankMsg(null);
        }}
      >
        <fieldset className="grid gap-3">
          <legend className="eyebrow mb-2">From (top left of every invoice)</legend>
          <div className="inv-pair">
            <Field id="is-from" label="Your name">
              <input id="is-from" name="fromName" className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={120} autoComplete="name" />
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
          <p className="meta -mt-1">Fill in the ways you take. An invoice can offer a way once its details are here; which ones a new invoice starts with is under <b className="font-semibold text-text">New invoices</b> below.</p>
          <div className="inv-pair">
            <Field id="is-zelle" label="Zelle number" hint="The phone or email customers send to. Printed as “Please send payment via Zelle to …” with “Put invoice 0000170 in the Zelle memo” under it.">
              <input id="is-zelle" name="zelle" className="input" value={zelle} onChange={(e) => setZelle(e.target.value)} maxLength={120} autoComplete="off" />
            </Field>
            <Field id="is-zelle-name" label="Name Zelle shows" optional>
              <input id="is-zelle-name" name="zelleName" className="input" defaultValue={s.zelleName ?? ""} maxLength={120} autoComplete="off" />
            </Field>
          </div>

          <div className="inv-bank" role="group" aria-labelledby="is-bank-title">
            <div>
              <p id="is-bank-title" className="label">Bank transfer (ACH)</p>
              <p className="hint mt-0!">A customer sends it from their bank straight to your account. Nothing to pay, nothing connected. The invoice prints the label, “ACH to ACCT#:” and “ROUTING:”.</p>
            </div>
            <Field id="is-bank-label" label="Bank label" hint="The line above the numbers, like “Sample Bank Checking”.">
              <input id="is-bank-label" name="ownBankLabel" className="input" value={bankLabel} onChange={(e) => setBankLabel(e.target.value)} maxLength={80} autoComplete="off" />
            </Field>
            {bankSaved && (
              <div className="inv-bank-saved">
                <dl className="inv-bank-facts">
                  <div>
                    <dt>Account number</dt>
                    <dd className="num" aria-label={`ending in ${s.ownBankLast4}`}>{maskAccountNumber(s.ownBankLast4!)}</dd>
                  </div>
                  <div>
                    <dt>Routing number</dt>
                    <dd className="num">{s.ownBankRouting}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={buttonClass("ghost", "sm")} aria-expanded={replacing} aria-label={replacing ? "Keep these numbers" : "Replace the bank account"} onClick={() => { setReplacing((r) => !r); setAccount(""); setRouting(""); setBankMsg(null); }}>
                    {replacing ? "Keep these" : "Replace"}
                  </button>
                  <button type="button" className={buttonClass("ghost", "sm")} aria-label="Remove the bank account" disabled={removing} onClick={removeBank}>{removing ? "Removing…" : "Remove"}</button>
                </div>
              </div>
            )}
            {s.ownBankUnreadable && !bankSaved && (
              <p><Status tone="warn" small className="is-wrap">The saved bank account can&apos;t be read on this server any more. Type both numbers again.</Status></p>
            )}
            {typingBank && (
              <div className="inv-pair">
                <Field id="is-bank-account" label={bankSaved ? "New account number" : "Account number"}>
                  <input id="is-bank-account" name="ownBankAccount" className="input num" value={account} onChange={(e) => setAccount(e.target.value)} inputMode="numeric" maxLength={40} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
                </Field>
                <Field id="is-bank-routing" label={bankSaved ? "New routing number" : "Routing number"} hint="9 digits.">
                  <input id="is-bank-routing" name="ownBankRouting" className="input num" value={routing} onChange={(e) => setRouting(e.target.value)} inputMode="numeric" maxLength={20} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-1p-ignore data-lpignore="true" />
                </Field>
              </div>
            )}
            {bankMsg && <p role="status"><Status tone={bankMsg.ok ? "ok" : "danger"} small className="is-wrap">{bankMsg.text}</Status></p>}
            <p className="hint mt-0!">{bankSaved ? "Saved encrypted. Only the last digits show here; to change the account, type both numbers again." : "Saved encrypted when you press Save. After that only the last 4 digits show here."}</p>
          </div>

          <div className="inv-pair">
            <Field id="is-check" label="Checks payable to" optional hint="Blank means your name above.">
              <input id="is-check" name="checkPayee" className="input" value={checkPayee} onChange={(e) => setCheckPayee(e.target.value)} maxLength={120} autoComplete="off" />
            </Field>
            <Field id="is-check-addr" label="Mail checks to" optional hint="Blank means your address above: the invoice prints “Mail to the address above”.">
              <textarea id="is-check-addr" name="checkAddress" rows={2} className="input min-h-0!" defaultValue={s.checkAddress ?? ""} maxLength={300} />
            </Field>
          </div>
          <div className="inv-pair">
            <Field id="is-venmo" label="Venmo" optional>
              <input id="is-venmo" name="venmo" className="input" value={venmo} onChange={(e) => setVenmo(e.target.value)} maxLength={80} placeholder="@handle" autoComplete="off" />
            </Field>
            <Field id="is-paypal" label="PayPal" optional>
              <input id="is-paypal" name="paypal" className="input" value={paypal} onChange={(e) => setPaypal(e.target.value)} maxLength={200} placeholder="paypal.me/…" autoComplete="off" />
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
            <Tick name="achEnabled" checked={bankOnline} onChange={(e) => setBankOnline(e.target.checked)} />
            <span className="switch-track" aria-hidden />
            Bank transfer online
          </label>
          <label className="switch">
            <Tick name="cardEnabled" checked={cardOnline} onChange={(e) => setCardOnline(e.target.checked)} />
            <span className="switch-track" aria-hidden />
            Card online <span className="font-normal text-muted">(off unless you turn it on)</span>
          </label>
          <table className="inv-table inv-fees" aria-label="What each way costs Nora">
            <thead>
              <tr><th scope="col">Way</th><th scope="col">What you pay</th></tr>
            </thead>
            <tbody>
              <tr><td>Zelle, bank transfer (ACH), check</td><td>Nothing</td></tr>
              <tr><td>Bank transfer online</td><td>0.8%, at most $5</td></tr>
              <tr><td>Card online</td><td>2.9% + 30¢</td></tr>
            </tbody>
          </table>
          <p className="hint">No fee is ever added for the customer: the total is the same however they pay. Stripe keys live only in the environment, never here.</p>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="eyebrow mb-2">New invoices</legend>
          <div role="group" aria-labelledby="is-defaults-title">
            <p id="is-defaults-title" className="label">Ways to pay on a new invoice</p>
            {/* The ticks are sent only once she changed one here. A way that isn't ready is a disabled box, and a form
                does not send those: saving her name before her Zelle number would otherwise store "check only" in
                place of the built-in "Zelle and check", and Zelle would stay off after the number arrives. */}
            {ticksChanged && <input type="hidden" name="payDefaultsSet" value="1" />}
            <ul className="inv-ways">
              {DEFAULTABLE_PAY_WAYS.map((w) => {
                const why = ready[w];
                const on = ticked.includes(w) && !why;
                return (
                  <li key={w}>
                    <label className={cx("inv-way", why && "is-off")}>
                      <Tick
                        className="check"
                        name="payDefaults"
                        value={w}
                        checked={on}
                        disabled={!!why}
                        onChange={(e) => {
                          setTicksChanged(true);
                          setTicked((t) => (e.target.checked ? [...t.filter((x) => x !== w), w] : t.filter((x) => x !== w)));
                        }}
                      />
                      <span>
                        {PAY_WAY_LABEL[w]}
                        {why && <span className="meta block whitespace-normal">{why}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="hint">Every new invoice starts with the ticked ways. You can still change them on any invoice, and invoices already made keep theirs. Nothing ticked means Zelle and check. Bank transfer (ACH) is for when a customer asks: add it on that invoice.</p>
          </div>
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

/**
 * A tick box held in state, safe inside a form with a server action: its reset value (`defaultChecked`, which React
 * sets once for a box held in state) follows the state on every render, so the form reset React runs after each save
 * leaves it showing what state says, never what the page opened with.
 */
function Tick({ checked, ...rest }: Omit<React.ComponentProps<"input">, "type" | "checked" | "ref"> & { checked: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.defaultChecked = checked;
      }}
      {...rest}
    />
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
