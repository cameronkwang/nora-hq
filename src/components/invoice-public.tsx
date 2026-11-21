import type { ReactNode } from "react";
import { HtmlLang, IntakeLangSwitch } from "./intake-lang";
import { InvoicePublicCopy } from "./invoice-public-copy";
import { Status, buttonClass, type Tone } from "./ui";
import { INTAKE_COPY, type IntakeLangCode } from "@/lib/intake-copy";
import { invoiceCopy, longDate, shortDue, type InvoiceCopy } from "@/lib/invoice-copy";
import { addressLines, formatCents, type PayOption, type PublicInvoice } from "@/lib/invoices-types";

/**
 * The customer's invoice page (/i/<token>): no app chrome, one column on paper, in English, 简体 or 繁體.
 * Shows only this invoice: who it's from, the number, the status line, Bill to, the lines and totals, the notes, and
 * then How to pay with EXACTLY the invoice's chosen ways (PayOption[], already in the PDF's order: her bank account
 * for a transfer, with Copy buttons for the account and the routing number, then Zelle, then checks), Pay online only
 * when the invoice has bank transfer online or card and Stripe is set up (the page's one primary button, cinnabar as
 * on every page without the app shell), and Download PDF. Never the private note, the deal, the contract or anything
 * else.
 * Server component; the Copy buttons are the only client bits (invoice-public-copy). Styles: the ps- classes of the
 * other public pages plus the few ip- rules below (tokens only, so Light / Dark follow the theme).
 */

const CSS = `
@layer pages {
  .ip-top { align-items: flex-start; }
  .ip-from .meta { margin-top: 2px; }
  .ip-hero .ip-status { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
  .ip-hero .ip-status .status { white-space: normal; }
  .ip-due { margin-top: 24px; }
  .ip-due .eyebrow { display: block; }
  .ip-figure { display: block; margin-top: 2px; font-family: var(--font-display); font-size: 2.75rem; line-height: 3rem; font-weight: 450; letter-spacing: -0.02em; font-variant-numeric: lining-nums tabular-nums; font-optical-sizing: auto; }
  :lang(zh) .ip-figure { font-weight: 600; letter-spacing: 0; }
  @media (max-width: 767px) { .ip-figure { font-size: 2.375rem; line-height: 2.75rem; } }
  .ip-notice { margin-bottom: 28px; }
  .ip-lines { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .ip-lines th { text-align: left; font-size: var(--text-sm); line-height: 1.25rem; font-weight: 500; color: var(--muted); padding: 0 0 6px; border-bottom: var(--rule); }
  .ip-lines td { padding: calc((var(--row-h) - var(--leading-base)) / 2) 0; border-bottom: var(--rule); vertical-align: baseline; }
  .ip-lines :is(th, td) + :is(th, td) { padding-left: 16px; }
  .ip-lines .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ip-desc { display: block; font-weight: 500; overflow-wrap: anywhere; }
  .ip-each { display: block; }
  @media (min-width: 640px) { .ip-each { display: none; } }
  @media (max-width: 639px) { .ip-wide { display: none; } }
  .ip-totals { margin: 10px 0 0 auto; }
  @media (min-width: 640px) { .ip-totals { max-width: 21rem; } }
  .ip-items { margin-top: 32px; }
  .ip-totals > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 3px 0; }
  .ip-totals dt { color: var(--muted); }
  .ip-totals dd { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ip-totals .is-strong { margin-top: 6px; padding-top: 9px; border-top: var(--rule); font-weight: 600; }
  .ip-totals .is-strong dt { color: var(--text); }
  .ip-pre { white-space: pre-line; overflow-wrap: anywhere; }
  .ip-ways > * { padding: 16px 0; }
  .ip-ways > * + * { border-top: var(--rule); }
  .ip-ways > :first-child { padding-top: 4px; }
  .ip-way-title { font-weight: 600; }
  .ip-copyrow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 4px; min-height: 2.25rem; }
  .ip-val { font-size: 1.125rem; line-height: 1.75rem; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .ip-pay { margin-top: 12px; }
  .ip-paid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 6px 0; }
  .ip-paid + .ip-paid { border-top: var(--rule); }
  .ip-paid .r { font-variant-numeric: tabular-nums; }
  .ip-end { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-top: 32px; }
  .ip-foot { margin-top: 20px; }
  .ip-foot a { overflow-wrap: anywhere; }
}
`;

/** The page frame: who it's from (the serif name and the address) on the left, the language switch on the right. */
export function InvoicePublicShell({ lang, fromName, fromAddress, children }: { lang: IntakeLangCode; fromName: string | null; fromAddress?: string | null; children: ReactNode }) {
  const htmlLang = INTAKE_COPY[lang].htmlLang;
  const lines = addressLines(fromAddress);
  return (
    <main lang={htmlLang} className="ps-page" style={{ ["--tabbar-h" as string]: "0px" }}>
      <HtmlLang lang={htmlLang} />
      <style>{CSS}</style>
      <div className="ps-col">
        <header className="ps-top ip-top">
          <div className="ip-from min-w-0">
            <p className="ps-mark">{fromName || invoiceCopy(lang).page.meta.generic}</p>
            {lines.length > 0 && (
              <p className="meta">
                {lines.map((l, i) => (
                  <span key={i} className="block">{l}</span>
                ))}
              </p>
            )}
          </div>
          <IntakeLangSwitch lang={lang} remember={false} />
        </header>
        {children}
      </div>
    </main>
  );
}

/** A cancelled invoice: one line and who to ask. No number, no amounts, no customer. */
export function InvoicePublicVoid({ lang, fromName }: { lang: IntakeLangCode; fromName: string | null }) {
  const P = invoiceCopy(lang).page;
  return (
    <InvoicePublicShell lang={lang} fromName={fromName}>
      <div role="status" className="ps-hero">
        <h1 className="display">{P.void.title}</h1>
        <p className="sub">{fromName ? P.questions(fromName) : P.questionsNoName}</p>
      </div>
    </InvoicePublicShell>
  );
}

export type InvoicePublicNotice = { kind: "thanks" } | { kind: "error"; message: string } | null;

const qty = (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: 2 });
const isWebLink = (v: string) => /^(https?:\/\/)?(www\.)?(paypal\.me|paypal\.com|venmo\.com|account\.venmo\.com)\//i.test(v.trim());
const href = (v: string) => (/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`);

function statusLine(P: InvoiceCopy["page"], lang: IntakeLangCode, inv: PublicInvoice): { tone: Tone; text: string } {
  const clearing = inv.processing.reduce((s, p) => s + p.amountCents, 0);
  if (inv.display === "paid" || inv.balanceCents <= 0) return { tone: "ok", text: P.status.paid };
  if (clearing > 0) return { tone: "info", text: P.status.processing(formatCents(clearing)) };
  if (inv.display === "overdue") return { tone: "danger", text: P.status.overdue(shortDue(lang, inv.dueDate)) };
  if (inv.dueDate <= inv.issueDate) return { tone: "info", text: P.status.dueOnReceipt };
  return { tone: "info", text: P.status.due(shortDue(lang, inv.dueDate)) };
}

/** One value the customer types into their app (a Zelle number, a handle), with its Copy button. */
function CopyRow({ P, value, copyValue }: { P: InvoiceCopy["page"]; value: ReactNode; copyValue: string }) {
  return (
    <div className="ip-copyrow">
      <span className="ip-val">{value}</span>
      <InvoicePublicCopy text={copyValue} label={P.copy} copied={P.copied} failed={P.copyFailed} what={P.copyWhat(copyValue)} />
    </div>
  );
}

function Way({ P, o, number }: { P: InvoiceCopy["page"]; o: PayOption; number: string }) {
  switch (o.way) {
    case "ach":
      // Her own account, for a transfer from the customer's bank: the label, then each number with its own Copy.
      return (
        <div>
          <h3 className="ip-way-title">{P.ach.title}</h3>
          {o.label && <p className="mt-1">{o.label}</p>}
          <p className="meta mt-3">{P.ach.account}</p>
          <CopyRow P={P} value={o.account} copyValue={o.account} />
          <p className="meta mt-3">{P.ach.routing}</p>
          <CopyRow P={P} value={o.routing} copyValue={o.routing} />
        </div>
      );
    case "zelle":
      return (
        <div>
          <h3 className="ip-way-title">{P.zelle.title}</h3>
          <p className="meta mt-1">{P.zelle.sendTo}</p>
          <CopyRow P={P} value={o.to} copyValue={o.to} />
          {o.name && <p className="meta">{P.zelle.shownAs(o.name)}</p>}
          <p className="meta mt-3">{P.zelle.memo(number)}</p>
          <CopyRow P={P} value={number} copyValue={number} />
        </div>
      );
    case "check":
      return (
        <div>
          <h3 className="ip-way-title">{P.check.title}</h3>
          <p className="mt-1">{P.check.payable(o.payee)}</p>
          {o.address && (
            <>
              <p className="meta mt-2">{P.check.mailTo}</p>
              <p className="ip-pre">{addressLines(o.address).join("\n")}</p>
            </>
          )}
        </div>
      );
    case "venmo":
    case "paypal":
      return (
        <div>
          <h3 className="ip-way-title">{o.way === "venmo" ? P.venmo : P.paypal}</h3>
          {isWebLink(o.handle) ? (
            <p className="mt-1 ip-val">
              <a className="link" href={href(o.handle)} target="_blank" rel="noopener noreferrer">{o.handle}</a>
            </p>
          ) : (
            <CopyRow P={P} value={o.handle} copyValue={o.handle} />
          )}
        </div>
      );
    case "custom":
      return (
        <div>
          <h3 className="ip-way-title">{P.custom}</h3>
          <p className="mt-1 ip-pre">{o.text}</p>
        </div>
      );
    default:
      return null; // bank / card: drawn once, together, as Pay online
  }
}

function PayOnline({ P, token, lang, bank, card, clearing }: { P: InvoiceCopy["page"]; token: string; lang: IntakeLangCode; bank: boolean; card: boolean; clearing: boolean }) {
  return (
    <div>
      <h3 className="ip-way-title">{P.online.title}</h3>
      <p className="meta mt-1">{bank && card ? P.online.both : bank ? P.online.bank : P.online.card}</p>
      {clearing ? (
        <p className="mt-3">{P.errors.processing}</p>
      ) : (
        // A plain form post: works without JavaScript. The amount is read on the server, never sent from here.
        <form method="post" action={`/i/${encodeURIComponent(token)}/pay`} className="ip-pay">
          <input type="hidden" name="lang" value={lang} />
          <button type="submit" className={buttonClass("primary")}>{P.online.button}</button>
        </form>
      )}
      {bank && !clearing && <p className="meta mt-2">{P.online.bankNote}</p>}
    </div>
  );
}

/** The open (or paid) invoice. `token` is the page's own link token (for the PDF and Pay online). */
export function InvoicePublicView({ lang, token, invoice: inv, options, notice }: { lang: IntakeLangCode; token: string; invoice: PublicInvoice; options: PayOption[]; notice: InvoicePublicNotice }) {
  const P = invoiceCopy(lang).page;
  const status = statusLine(P, lang, inv);
  const paid = inv.display === "paid" || inv.balanceCents <= 0;
  const clearing = inv.processing.length > 0;
  // A bank transfer that already covers what is owed: no "How to pay" (it would invite paying twice).
  const covered = clearing && inv.processing.reduce((sum, p) => sum + p.amountCents, 0) >= inv.balanceCents;
  const bank = options.some((o) => o.way === "bank");
  const card = options.some((o) => o.way === "card");
  const free = options.filter((o) => o.way !== "bank" && o.way !== "card");
  const billTo = addressLines(inv.billTo.address);
  const pdfHref = `/i/${encodeURIComponent(token)}/pdf`;

  return (
    <InvoicePublicShell lang={lang} fromName={inv.from.name} fromAddress={inv.from.address}>
      {notice && (
        <p role="status" className="notice ip-notice">
          <Status tone={notice.kind === "thanks" ? "ok" : "warn"}>{notice.kind === "thanks" ? P.thanks : notice.message}</Status>
        </p>
      )}

      <div className="ps-hero ip-hero">
        <h1 className="display">{P.invoice(inv.number)}</h1>
        <p className="ip-status">
          <Status tone={status.tone}>{status.text}</Status>
          {!paid && inv.paidCents > 0 && <span className="meta">{P.status.paidSoFar(formatCents(inv.paidCents))}</span>}
        </p>
        <p className="ip-due">
          <span className="eyebrow">{paid ? P.total : P.balanceDue}</span>
          <span className="ip-figure">{formatCents(paid ? inv.totalCents : inv.balanceCents)}</span>
        </p>
      </div>

      <section className="sec is-untitled">
        <dl className="ps-facts">
          <div>
            <dt>{P.billTo}</dt>
            <dd>
              {inv.billTo.name}
              {billTo.length > 0 && <span className="block font-normal text-muted">{billTo.join("\n")}</span>}
            </dd>
          </div>
          <div>
            <dt>{P.invoiceDate}</dt>
            <dd>{longDate(lang, inv.issueDate)}</dd>
          </div>
          <div>
            <dt>{P.dueDate}</dt>
            <dd>{inv.dueDate <= inv.issueDate ? `${longDate(lang, inv.dueDate)} · ${P.status.dueOnReceipt}` : longDate(lang, inv.dueDate)}</dd>
          </div>
        </dl>
      </section>

      <div className="ip-items">
        <table className="ip-lines">
          <thead>
            <tr>
              <th scope="col">{P.table.description}</th>
              <th scope="col" className="r ip-wide">{P.table.unitPrice}</th>
              <th scope="col" className="r ip-wide">{P.table.quantity}</th>
              <th scope="col" className="r">{P.table.amount}</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <span className="ip-desc">{l.description}</span>
                  {l.quantity !== 1 && <span className="ip-each meta">{P.table.each(qty(l.quantity), formatCents(l.unitCents))}</span>}
                </td>
                <td className="r ip-wide">{formatCents(l.unitCents)}</td>
                <td className="r ip-wide">{qty(l.quantity)}</td>
                <td className="r">{formatCents(l.lineCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ip-totals">
          {inv.discountCents > 0 && (
            <>
              <div>
                <dt>{P.subtotal}</dt>
                <dd>{formatCents(inv.subtotalCents)}</dd>
              </div>
              <div>
                <dt>{inv.discountLabel ? `${P.discount} (${inv.discountLabel})` : P.discount}</dt>
                <dd>{`-${formatCents(inv.discountCents)}`}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{P.total}</dt>
            <dd>{formatCents(inv.totalCents)}</dd>
          </div>
          {inv.paidCents > 0 && (
            <div>
              <dt>{P.amountPaid}</dt>
              <dd>{formatCents(inv.paidCents)}</dd>
            </div>
          )}
          <div className="is-strong">
            <dt>{P.balanceDue}</dt>
            <dd>{formatCents(inv.balanceCents)}</dd>
          </div>
        </dl>
      </div>

      {inv.notes && (
        <section className="sec">
          <header className="sec-head">
            <h2 className="title">{P.notes}</h2>
          </header>
          <p className="sec-body ip-pre">{inv.notes}</p>
        </section>
      )}

      {inv.payments.length > 0 && (
        <section className="sec">
          <header className="sec-head">
            <h2 className="title">{P.payments}</h2>
          </header>
          <div className="sec-body">
            {inv.payments.map((p, i) => (
              <p key={i} className="ip-paid">
                <span>{longDate(lang, p.paidOn)}</span>
                <span className="r">{formatCents(p.amountCents)}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      {!paid && !covered && (
        <section className="sec">
          <header className="sec-head">
            <h2 className="title">{P.howToPay}</h2>
          </header>
          <div className="sec-body ip-ways">
            {free.map((o) => (
              <Way key={o.way} P={P} o={o} number={inv.number} />
            ))}
            {(bank || card) && <PayOnline P={P} token={token} lang={lang} bank={bank} card={card} clearing={clearing} />}
            {options.length === 0 && <p>{inv.from.name ? P.questions(inv.from.name) : P.questionsNoName}</p>}
          </div>
        </section>
      )}

      <div className="ip-end">
        <a className={buttonClass("secondary")} href={pdfHref} download>
          {P.pdf}
        </a>
      </div>

      <p className="meta ip-foot">
        {inv.from.name ? P.questions(inv.from.name) : P.questionsNoName}
        {inv.from.email && (
          <>
            {" "}
            <a className="link" href={`mailto:${inv.from.email}`}>{inv.from.email}</a>
          </>
        )}
        {inv.from.phone && (
          <>
            {" "}
            <a className="link" href={`tel:${inv.from.phone.replace(/[^\d+]/g, "")}`}>{inv.from.phone}</a>
          </>
        )}
      </p>
    </InvoicePublicShell>
  );
}
