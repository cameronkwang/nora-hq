import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { formatDate, today } from "@/lib/dates";
import { OpsError } from "@/lib/ops";
import { getInvoice, getInvoiceDone, getInvoiceMessages } from "@/lib/ops-invoices";
import {
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PAY_WAY_METHOD,
  centsToDollarsInput,
  contractRefLabel,
  dueLabel,
  invoicePdfPath,
  isOpenStatus,
  noPayOptions,
  payWaysLabel,
  shortDate,
  type InvoiceDetail,
  type InvoiceDone,
  type InvoiceMessages,
  type ManualPaymentMethod,
} from "@/lib/invoices-types";
import { ConfirmButton } from "@/components/client-form";
import { ContractLine, InvoicePaper, InvoiceStatus, NextSteps, money } from "@/components/invoice-bits";
import { InvoiceDoneView } from "@/components/invoice-done";
import { FinalizeButton, LinkTools, RecordPaymentForm, RemindPanel } from "@/components/invoice-page-actions";
import { Card, LinkButton, PageHeader, Status, buttonClass } from "@/components/ui";
import { deleteDraftAction, deletePaymentAction, voidInvoiceAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const SOURCE_NOTE: Partial<Record<InvoiceDetail["source"], string>> = {
  claude: "Claude made this draft because one of you asked. Check it, then press Make PDF.",
  retainer: "Made by the monthly invoice.",
  import: "Imported from Skynova.",
  contract: "Made from a contract.",
  deal: "Made from a collab deal.",
};

/**
 * One invoice (docs/invoicing.md "The team's pages"): the invoice as its PDF prints it, plus the team's side: status,
 * Share / Download / Copy message, the customer link, Record payment (the focal button once finalized), Remind, its
 * contract or Make contract, the deal, the private note, payments, and Void. On a draft: Make PDF (the focal button),
 * Edit, Preview PDF, Delete draft.
 */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = today();

  let inv: InvoiceDetail | null = null;
  let done: InvoiceDone | null = null;
  let messages: InvoiceMessages | null = null;
  let error: string | null = null;
  try {
    inv = await getInvoice(id, { today: t });
    if (inv && inv.status !== "draft" && inv.status !== "void") {
      const o = await origin();
      [done, messages] = await Promise.all([
        getInvoiceDone(inv.id, user.email, { origin: o, today: t }),
        isOpenStatus(inv.status) ? getInvoiceMessages(inv.id, user.email, { origin: o, today: t }) : Promise.resolve(null),
      ]);
    }
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }
  if (error)
    return (
      <>
        <PageHeader crumb={<Link href="/invoices">Invoices</Link>} title="Invoice" />
        <p role="status" className="notice"><Status tone="warn" className="is-wrap">{error}</Status></p>
      </>
    );
  if (!inv) notFound();

  const draft = inv.status === "draft";
  const open = isOpenStatus(inv.status);
  const editable = draft || open;
  const flash = one(sp.saved) === "draft" ? "Draft saved." : one(sp.saved) === "edit" ? "Saved. The PDF shows the change." : one(sp.made) ? "Invoice made." : "";
  const err = one(sp.error);
  const firstWay = inv.payWays[0] ?? "zelle";
  const method = (MANUAL_PAYMENT_METHODS as readonly string[]).includes(PAY_WAY_METHOD[firstWay]) ? (PAY_WAY_METHOD[firstWay] as ManualPaymentMethod) : "zelle";
  const makeContract = inv.nextSteps.find((s) => s.kind === "make_contract");
  const reminded = inv.lastRemindedAt ? `Reminded ${formatDate(inv.lastRemindedAt)}${inv.reminderCount > 1 ? ` (${inv.reminderCount} times)` : ""}` : null;

  return (
    <>
      <PageHeader
        crumb={<Link href="/invoices">Invoices</Link>}
        title={<span className="num">{inv.number ?? "Draft"}</span>}
        subtitle={
          <span className="g-meta">
            <InvoiceStatus display={inv.display} daysOverdue={inv.daysOverdue} small={false} />
            <Link href={`/invoices/customers/${encodeURIComponent(inv.customerId)}`} className="link">{inv.customer.name}</Link>
            <span>{money(inv.totalCents)}</span>
            {!draft && inv.issueDate && inv.dueDate && inv.status !== "paid" && inv.status !== "void" && <span>{dueLabel(inv.issueDate, inv.dueDate)}{inv.dueDate > inv.issueDate ? "" : ` (${shortDate(inv.dueDate)})`}</span>}
            {inv.paidAt && <span>Paid {formatDate(inv.paidAt)}</span>}
            {inv.viewedAt && <span>Viewed {formatDate(inv.viewedAt)}</span>}
            {/* The other half of the pair, one tap from the top: its contract, or Make contract. */}
            {inv.contract ? (
              <a href="#contract" className="link">{contractRefLabel(inv.contract)}</a>
            ) : makeContract ? (
              <Link href={makeContract.href} className="link">Make contract</Link>
            ) : null}
          </span>
        }
        actions={
          <>
            {editable && (
              <LinkButton href={draft ? `/invoices/new?draft=${encodeURIComponent(inv.id)}` : `/invoices/new?edit=${encodeURIComponent(inv.id)}`} size="sm">
                Edit
              </LinkButton>
            )}
            <a href={invoicePdfPath(inv.id)} target="_blank" rel="noopener" className={buttonClass("ghost", "sm")}>
              {draft ? "Preview PDF" : "Open PDF"}
            </a>
          </>
        }
      />

      {flash && <p role="status" className="notice mb-6"><Status tone="ok">{flash}</Status></p>}
      {err && <p role="alert" className="notice mb-6"><Status tone="danger" className="is-wrap">{err}</Status></p>}
      {SOURCE_NOTE[inv.source] && inv.source === "claude" && draft && <p className="notice mb-6"><Status tone="ink" className="is-wrap">{SOURCE_NOTE[inv.source]}</Status></p>}
      {inv.status !== "void" && inv.overpaidCents > 0 && <p className="notice mb-6"><Status tone="warn" className="is-wrap">Overpaid by {money(inv.overpaidCents)}. Hand it back (a Stripe payment is refunded in Stripe) or delete the extra payment.</Status></p>}
      {inv.status === "void" && inv.paidCents > 0 && <p className="notice mb-6"><Status tone="warn" className="is-wrap">{money(inv.paidCents)} came in after this invoice was cancelled. Refund it in Stripe.</Status></p>}
      {inv.processing.map((pr, i) => (
        <p key={i} className="notice mb-6"><Status tone="info" className="is-wrap">A bank payment of {money(pr.amountCents)} is on its way (started {formatDate(pr.startedAt)}). Bank transfers take about 4 business days.</Status></p>
      ))}

      <div className="inv-cols">
        <div className="is-side">
          {draft && (
            <section className="inv-side-sec" aria-label="Make the PDF">
              <FinalizeButton id={inv.id} canPrint={!noPayOptions(inv.payOptions)} />
            </section>
          )}

          {done && (
            <Card title="Send it" className="inv-side-sec">
              <InvoiceDoneView done={done} focal={false} showHead={false} />
              <div className="mt-5 border-t border-border pt-4">
                <LinkTools id={inv.id} hasLink={inv.hasLink} />
              </div>
            </Card>
          )}

          {open && (
            <section id="record-payment" className="sec inv-side-sec scroll-mt-4">
              <header className="sec-head"><h2 className="title">Record payment</h2></header>
              <div className="sec-body">
                <p className="meta mb-3">{money(inv.balanceCents)} still owed{inv.paidCents > 0 ? ` of ${money(inv.totalCents)}` : ""}.</p>
                <RecordPaymentForm invoiceId={inv.id} balance={centsToDollarsInput(inv.balanceCents)} today={t} method={method} />
              </div>
            </section>
          )}

          {open && messages && (
            <section id="remind" className="sec inv-side-sec scroll-mt-4">
              <header className="sec-head"><h2 className="title">Remind</h2></header>
              <div className="sec-body">
                <RemindPanel id={inv.id} messages={messages} lang={inv.lang ?? inv.customer.lang ?? "en"} reminded={reminded} />
              </div>
            </section>
          )}

          <section id="contract" className="sec inv-side-sec scroll-mt-4">
            <header className="sec-head"><h2 className="title">Contract</h2></header>
            <div className="sec-body">
              {inv.contract ? (
                <ContractLine contract={inv.contract} />
              ) : (
                <div className="grid gap-2">
                  <p className="meta">No contract for this invoice yet.</p>
                  <NextSteps steps={inv.nextSteps} skip={["record_payment", "remind"]} />
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="is-main">
          <InvoicePaper doc={inv.document} />

          {(inv.payments.length > 0 || !draft) && (
            <Card title={<>Payments{inv.payments.length > 0 && <span className="meta">{money(inv.paidCents)} received</span>}</>} padded={false}>
              {inv.payments.length === 0 ? (
                <p className="meta py-3">Nothing received yet.</p>
              ) : (
                <ul className="list">
                  {inv.payments.map((pm) => (
                    <li key={pm.id} className="row">
                      <div className="min-w-0 flex-1">
                        <p className="row-title">{money(pm.amountCents)} <span className="meta">· {PAYMENT_METHOD_LABEL[pm.method]}</span></p>
                        <p className="meta whitespace-normal">
                          {[formatDate(pm.paidOn), pm.reference, pm.note, pm.feeCents ? `Stripe fee ${money(pm.feeCents)}` : null, pm.recordedBy === "system" ? "Recorded by Stripe" : `Recorded by ${pm.recordedBy.split("@")[0]}`].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <form action={deletePaymentAction}>
                        <input type="hidden" name="paymentId" value={pm.id} />
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <ConfirmButton variant="ghost" size="sm" confirm={`Delete the ${money(pm.amountCents)} payment? The invoice goes back to owing it.`}>Delete</ConfirmButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Details">
            <dl className="inv-kv">
              <div><dt>Ways to pay</dt><dd>{payWaysLabel(inv.payWays)}{inv.payWays.includes("custom") && inv.payNote ? ` (${inv.payNote})` : ""}</dd></div>
              <div><dt>Customer</dt><dd><Link href={`/invoices/customers/${encodeURIComponent(inv.customerId)}`} className="link">{inv.customer.name}</Link>{inv.customer.contactName ? ` · ${inv.customer.contactName}` : ""}</dd></div>
              {inv.deal && <div><dt>Deal</dt><dd><Link href={`/deals/${encodeURIComponent(inv.deal.id)}`} className="link">{inv.deal.businessName}</Link></dd></div>}
              {inv.privateNotes && <div><dt>Private note</dt><dd className="whitespace-pre-line">{inv.privateNotes}</dd></div>}
              <div><dt>Made</dt><dd>{[SOURCE_NOTE[inv.source] ?? null, inv.sentAt ? `Finalized ${formatDate(inv.sentAt)}${inv.sentBy ? ` by ${inv.sentBy.split("@")[0]}` : ""}` : `Started ${formatDate(inv.createdAt)} by ${inv.createdBy.split("@")[0]}`].filter(Boolean).join(" ")}</dd></div>
              {reminded && <div><dt>Reminders</dt><dd>{reminded}</dd></div>}
              {inv.status === "void" && <div><dt>Void</dt><dd>{[inv.voidedAt ? formatDate(inv.voidedAt) : null, inv.voidReason].filter(Boolean).join(" · ") || "Cancelled"}</dd></div>}
            </dl>
          </Card>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {draft && (
              <form action={deleteDraftAction}>
                <input type="hidden" name="id" value={inv.id} />
                <ConfirmButton confirm="Delete this draft? It has no number yet, so nothing is lost.">Delete draft</ConfirmButton>
              </form>
            )}
            {open && inv.payments.length === 0 && inv.processing.length === 0 && (
              <form action={voidInvoiceAction}>
                <input type="hidden" name="id" value={inv.id} />
                <ConfirmButton confirm={`Void invoice ${inv.number ?? ""}? It keeps its number, and its link then says it was cancelled.`}>Void invoice</ConfirmButton>
              </form>
            )}
            {open && inv.payments.length > 0 && <p className="meta">To void it, delete its payments first.</p>}
            {open && inv.payments.length === 0 && inv.processing.length > 0 && <p className="meta">A bank payment is on its way. It can be voided once that arrives or fails.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
