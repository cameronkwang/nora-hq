import Link from "next/link";
import type { ReactNode } from "react";
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  PDF_LETTERS,
  contractRefLabel,
  formatCents,
  invoicePdfPath,
  invoiceRefLabel,
  pdfText,
  pdfUnprintable,
  shortDate,
  type ContractInvoiceRef,
  type ContractRef,
  type InvoiceDisplayStatus,
  type InvoiceDocument,
  type InvoiceListRow,
  type NextStep,
  type StatusTone,
} from "@/lib/invoices-types";
import { Status, buttonClass, cx, type Tone } from "./ui";
import { ContractDownloadAgain, MonthlyInvoicesButton } from "./invoice-contract-bits";

/**
 * Invoicing's shared, server-safe pieces (docs/invoicing.md "The team's pages"): the status dot, the one-tap PDF link
 * every row has, the invoice list, the invoice drawn as its PDF, next steps and the contract line. The area styles are
 * src/app/styles/invoicing.css (imported by globals.css, like the other area sheets).
 */

/** Money on an invoice ("$600.00") and in a list ("$600"). */
export const money = (cents: number) => formatCents(cents, { decimals: "always" });
export const moneyShort = (cents: number) => formatCents(cents, { decimals: "auto" });

const TONE: Record<StatusTone, Tone> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  info: "info",
  idle: "neutral",
  ink: "ink",
};

/** Draft (hollow), Sent (info), Partly paid (warn), Overdue (danger, "12 days"), Paid (ok), Void (hollow). A dot and words. */
export function InvoiceStatus({ display, daysOverdue = 0, small = true, className }: { display: InvoiceDisplayStatus; daysOverdue?: number; small?: boolean; className?: string }) {
  return (
    <Status tone={TONE[INVOICE_STATUS_TONE[display]]} small={small} className={className}>
      {INVOICE_STATUS_LABEL[display]}
      {display === "overdue" && daysOverdue > 0 && <span className="text-muted">{` ${daysOverdue} ${daysOverdue === 1 ? "day" : "days"}`}</span>}
    </Status>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
    </svg>
  );
}

/**
 * One tap: the PDF downloads (Content-Disposition attachment). A plain <a>, never prefetched. A draft prints "DRAFT".
 * `label` shows words next to the icon ("PDF"); the accessible name always says which invoice.
 */
export function PdfLink({ id, number, customer, label = "PDF", className }: { id: string; number: string | null; customer?: string; label?: string; className?: string }) {
  return (
    <a
      href={invoicePdfPath(id, { download: true })}
      download
      className={cx(buttonClass("ghost", "sm"), "inv-pdf", className)}
      aria-label={`Download PDF of ${number ? `invoice ${number}` : "the draft"}${customer ? ` for ${customer}` : ""}`}
    >
      <DownloadIcon />
      {label && <span aria-hidden>{label}</span>}
    </a>
  );
}

/** "Due Dec 4", "Paid Nov 8", "Not made yet" or "Cancelled" for a list row. */
function dueText(r: Pick<InvoiceListRow, "status" | "dueDate" | "paidAt">): string {
  if (r.status === "draft") return "Not made yet";
  if (r.status === "paid") return r.paidAt ? `Paid ${shortDate(r.paidAt.toISOString().slice(0, 10))}` : "Paid";
  if (r.status === "void") return "Cancelled";
  return r.dueDate ? `Due ${shortDate(r.dueDate)}` : "";
}

/**
 * The invoice list: number, customer, due, amount due, status, and a one-tap PDF on every row. Wide: one line with
 * columns that line up. Narrow: the customer and amount, then one meta line (number · due · status).
 */
export function InvoiceRows({ rows, showCustomer = true, empty }: { rows: InvoiceListRow[]; showCustomer?: boolean; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? null}</>;
  return (
    <ul className={cx("list inv-rows", !showCustomer && "is-one-customer")}>
      {rows.map((r) => {
        const owed = r.status === "paid" || r.status === "void" ? r.totalCents : r.balanceCents;
        return (
          <li key={r.id} className="inv-row">
            <Link href={`/invoices/${encodeURIComponent(r.id)}`} className="inv-row-main">
              {/* A draft has no number yet: its status says Draft (on one customer's list the number is the title, so it says Draft). */}
              <span className="inv-c-num num">{r.number ?? (showCustomer ? "" : "Draft")}</span>
              {showCustomer && <span className="inv-c-who row-title">{r.customerName}</span>}
              <span className={cx("inv-c-due meta", r.display === "overdue" && "is-late")}>{dueText(r)}</span>
              <span className={cx("inv-c-amt num", r.status === "void" && "is-void")}>
                {moneyShort(owed)}
                {r.status === "partially_paid" && <span className="meta"> of {moneyShort(r.totalCents)}</span>}
              </span>
              <span className="inv-c-status">
                <InvoiceStatus display={r.display} daysOverdue={r.daysOverdue} />
              </span>
            </Link>
            <PdfLink id={r.id} number={r.number} customer={r.customerName} className="inv-c-pdf" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The invoice as its PDF prints it (InvoiceDocument: every word already formatted), on a hairline sheet. The PDF has
 * English letters only, so the text is shown the way it is drawn (invoices-types pdfText: the same rule as lib/invoice-pdf),
 * and anything it leaves out (Chinese) is said above the sheet instead of being shown as if it printed. One thing
 * differs from the PDF on purpose: her bank account number is masked here (ops-invoices getInvoice builds the
 * document from masked details), and a line under the block says so.
 */
export function InvoicePaper({ doc }: { doc: InvoiceDocument }) {
  const total = doc.totals[doc.totals.length - 1];
  const leftOut = pdfUnprintable([doc.from.name, ...doc.from.addressLines, doc.billTo.name, doc.billTo.address, ...doc.rows.map((r) => r.description), doc.notes, ...doc.paymentLines].filter(Boolean).join(" "));
  return (
    <>
    {leftOut && <p className="notice mb-4"><Status tone="warn" className="is-wrap">{PDF_LETTERS.isLeftOut(leftOut)}</Status></p>}
    <article className="inv-paper" aria-label={`Invoice ${doc.facts[0]?.value ?? ""} as the PDF shows it`}>
      <header className="inv-paper-top">
        <div className="min-w-0">
          <p className="font-medium">{doc.from.name ? pdfText(doc.from.name) : <span className="text-muted">Your name (Settings)</span>}</p>
          {doc.from.addressLines.map((l, i) => (
            <p key={i} className="meta">{pdfText(l)}</p>
          ))}
          {doc.from.email && <p className="meta">{doc.from.email}</p>}
          {doc.from.phone && <p className="meta">{doc.from.phone}</p>}
        </div>
        <p className="inv-paper-title" aria-hidden>
          {doc.title}
          {doc.stamp && <span className="tag is-bare inv-stamp">{doc.stamp}</span>}
        </p>
      </header>
      <div className="inv-paper-mid">
        <div className="min-w-0">
          <p className="font-medium [overflow-wrap:anywhere]">{pdfText(doc.billTo.name) || "Customer"}</p>
          {doc.billTo.address && <p className="meta [overflow-wrap:anywhere]">{pdfText(doc.billTo.address)}</p>}
        </div>
        <dl className="inv-facts">
          {doc.facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className="num">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <table className="inv-table">
        <thead>
          <tr>
            {doc.columns.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.rows.map((r, i) => (
            <tr key={i}>
              <td>{pdfText(r.description)}</td>
              <td className="num">{r.unitPrice}</td>
              <td className="num">{r.quantity}</td>
              <td className="num">{r.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inv-paper-notes">
        {doc.notes ? (
          <>
            <p><u>NOTES:</u></p>
            <p className="whitespace-pre-line">{pdfText(doc.notes)}</p>
            <p className="mt-3">{doc.paymentHeading}</p>
          </>
        ) : (
          <p><u>NOTES:</u> {doc.paymentHeading}</p>
        )}
        {doc.paymentLines.length ? (
          // "" is the blank line between two ways (her bank account, Zelle, checks).
          doc.paymentLines.map((l, i) => (l ? <p key={i} className="[overflow-wrap:anywhere]">{pdfText(l)}</p> : <p key={i} aria-hidden className="h-3" />))
        ) : (
          <p className="status is-warn is-small is-wrap">No way to pay prints yet. Add your Zelle number in Settings.</p>
        )}
        {doc.paymentMasked && <p className="meta mt-3 whitespace-normal">Shown masked here. The PDF and the customer&apos;s page print the full account number.</p>}
      </div>
      <dl className="inv-totals">
        {doc.totals.map((t) => (
          <div key={t.label} className={cx(t === total && "is-strong")}>
            <dt>{t.label}</dt>
            <dd className="num">{t.value}</dd>
          </div>
        ))}
      </dl>
    </article>
    </>
  );
}

/**
 * The next step, one tap away (invoiceNextSteps / contractNextSteps). Links are plain buttons; "Set up monthly
 * invoices" is an action. `skip` leaves out kinds the page already shows elsewhere (Record payment, Remind).
 */
export function NextSteps({ steps, skip = [], size = "sm", className }: { steps: NextStep[]; skip?: NextStep["kind"][]; size?: "sm" | "md"; className?: string }) {
  const shown = steps.filter((s) => !skip.includes(s.kind));
  if (!shown.length) return null;
  return (
    <div className={cx("inv-steps", className)}>
      {shown.map((s) =>
        s.kind === "monthly_invoices" ? (
          <MonthlyInvoicesButton key={s.kind} contractId={s.contractId} size={size} />
        ) : (
          <Link key={`${s.kind}-${s.href}`} href={s.href} className={buttonClass("secondary", size)}>
            {s.label}
          </Link>
        ),
      )}
    </div>
  );
}

/** A contract's invoices, as its row shows them: "0000170 · Paid", each a link. */
export function ContractInvoiceLinks({ invoices }: { invoices: ContractInvoiceRef[] }) {
  if (!invoices.length) return null;
  return (
    <span className="inv-refs">
      {invoices.map((i) => (
        <Link key={i.id} href={`/invoices/${encodeURIComponent(i.id)}`} className="link">
          {invoiceRefLabel(i)}
        </Link>
      ))}
    </span>
  );
}

/** "Contract Nov 20 · Download again" (the PDF is rebuilt in the browser from its fields, lazily). */
export function ContractLine({ contract, children }: { contract: ContractRef; children?: ReactNode }) {
  return (
    <div className="inv-contract">
      <p>
        <span className="font-medium">{contractRefLabel(contract)}</span>
        <span className="meta">
          {" · "}
          {contract.kind === "monthly" ? "Monthly" : "Collab"}
          {contract.feeCents ? ` · ${moneyShort(contract.feeCents)}${contract.kind === "monthly" ? "/mo" : ""}` : " · No fee"}
        </span>
      </p>
      <div className="inv-steps">
        <ContractDownloadAgain fields={contract.fields} />
        {children}
      </div>
    </div>
  );
}

/** A quiet notice while a read failed (for example, before the invoicing ops exist): the page still renders. */
export function InvoicingNotice({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="status" className="notice">
      <Status tone="warn">{error}</Status>
    </p>
  );
}
