import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatDate, monthLabel, today } from "@/lib/dates";
import { OpsError } from "@/lib/ops";
import { getCustomer } from "@/lib/ops-invoices";
import { PAYMENT_METHOD_LABEL, centsToDollarsInput, oneLineAddress, type CustomerDetail } from "@/lib/invoices-types";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client-form";
import { ContractInvoiceLinks, ContractLine, InvoiceRows, NextSteps, money, moneyShort } from "@/components/invoice-bits";
import { CustomerFields } from "@/components/invoice-customer-fields";
import { Card, EmptyState, Figure, LinkButton, PageHeader, Status, Tag } from "@/components/ui";
import {
  archiveCustomerAction, createRetainerAction, deleteCustomerAction, deleteRetainerAction, toggleRetainerAction, updateCustomerAction, updateRetainerAction,
} from "../../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/**
 * A customer (docs/invoicing.md "The team's pages"): balance, invoices (one-tap PDF each), contracts with their
 * invoices and next step, payments, monthly invoices (retainers: add, edit, pause), and their details.
 */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = today();
  let c: CustomerDetail | null = null;
  let error: string | null = null;
  try {
    c = await getCustomer(id, { today: t });
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }
  if (error)
    return (
      <>
        <PageHeader crumb={<Link href="/invoices/customers">Customers</Link>} title="Customer" />
        <p role="status" className="notice"><Status tone="warn" className="is-wrap">{error}</Status></p>
      </>
    );
  if (!c) notFound();
  const err = one(sp.error);

  return (
    <>
      <PageHeader
        crumb={<Link href="/invoices/customers">Customers</Link>}
        title={c.name}
        subtitle={
          <span className="g-meta">
            {c.archived && <Tag bare>Archived</Tag>}
            {c.contactName && <span>{c.contactName}</span>}
            {c.email && <a href={`mailto:${c.email}`} className="link">{c.email}</a>}
            {c.phone && <span>{c.phone}</span>}
            {c.client && <Link href={`/clients/${encodeURIComponent(c.client.id)}`} className="link">Managed business</Link>}
            {c.billingAddress && <span>{oneLineAddress(c.billingAddress)}</span>}
          </span>
        }
        actions={<LinkButton href={`/invoices/new?customer=${encodeURIComponent(c.id)}`} variant="primary" size="sm">New invoice for them</LinkButton>}
      />
      {one(sp.new) && <p role="status" className="notice mb-6"><Status tone="ok">Customer saved.</Status></p>}
      {err && <p role="alert" className="notice mb-6"><Status tone="danger" className="is-wrap">{err}</Status></p>}

      <div className="figures">
        <Figure label="Outstanding" value={<span className="num">{moneyShort(c.outstandingCents)}</span>} hint={`${c.openCount} open`} />
        <Figure label="Overdue" value={<span className="num">{moneyShort(c.overdueCents)}</span>} hint={c.overdueCents ? <span className="status is-danger is-small">Late</span> : "Nothing late"} />
        <Figure label="Paid this year" value={<span className="num">{moneyShort(c.paidThisYearCents)}</span>} hint="By payment date" />
        <Figure label="All time" value={<span className="num">{moneyShort(c.paidAllTimeCents)}</span>} hint={`of ${moneyShort(c.invoicedAllTimeCents)} invoiced`} />
      </div>

      <Card title={<>Invoices<span className="meta">{c.invoices.length}</span></>} padded={false}>
        <InvoiceRows
          rows={c.invoices}
          showCustomer={false}
          empty={<EmptyState title="No invoices yet"><Link href={`/invoices/new?customer=${encodeURIComponent(c.id)}`} className="link">Make the first one</Link></EmptyState>}
        />
      </Card>

      <Card title={<>Contracts<span className="meta">{c.contracts.length}</span></>} padded={false}>
        {c.contracts.length === 0 ? (
          <div className="py-3">
            <p className="meta">No contracts for {c.name} yet. Make one from any of their invoices (Make contract), or on <Link href="/contracts" className="link">Contracts</Link>.</p>
          </div>
        ) : (
          <ul className="list">
            {c.contracts.map((k) => (
              <li key={k.id} className="py-3">
                <ContractLine contract={k}>
                  <NextSteps steps={k.nextSteps} />
                </ContractLine>
                {k.invoices.length > 0 && <p className="meta mt-1">Invoices: <ContractInvoiceLinks invoices={k.invoices} /></p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Payments" padded={false}>
        {c.payments.length === 0 ? (
          <p className="meta py-3">Nothing received yet.</p>
        ) : (
          <ul className="list">
            {c.payments.map((p) => (
              <li key={p.id} className="row">
                <div className="min-w-0 flex-1">
                  <p className="row-title">{money(p.amountCents)} <span className="meta">· {PAYMENT_METHOD_LABEL[p.method]}</span></p>
                  <p className="meta whitespace-normal">{[formatDate(p.paidOn), p.invoiceNumber ? `Invoice ${p.invoiceNumber}` : null, p.reference].filter(Boolean).join(" · ")}</p>
                </div>
                <Link href={`/invoices/${encodeURIComponent(p.invoiceId)}`} className="link-quiet">Invoice</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section id="retainers" className="sec scroll-mt-4">
        <header className="sec-head"><h2 className="title">Monthly invoices</h2></header>
        <p className="sec-note">On the day you pick, a draft is made for the month (a person presses Make PDF). Zelle, due on receipt.</p>
        {c.retainers.length > 0 && (
          <ul className="list is-ruled">
            {c.retainers.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0">
                    <span className="font-medium">{r.description}</span>
                    <span className="meta"> · {money(r.amountCents)} a month · day {r.dayOfMonth}{r.startMonth ? ` · from ${monthLabel(r.startMonth)}` : ""}{r.lastRunMonth ? ` · last made ${monthLabel(r.lastRunMonth)}` : ""}{r.contractId ? " · from a contract" : ""}</span>
                  </p>
                  <Status tone={r.active ? "ok" : "neutral"} small>{r.active ? "On" : "Paused"}</Status>
                </div>
                <details className="g-disc is-quiet mt-1">
                  <summary>Change</summary>
                  <div className="g-disc-body grid gap-3">
                    <ActionForm action={updateRetainerAction} className="grid gap-3">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="customerId" value={c.id} />
                      <RetainerFields d={{ description: r.description, amount: centsToDollarsInput(r.amountCents), day: r.dayOfMonth, start: r.startMonth ?? "" }} idp={r.id} />
                      <div><SubmitButton>Save</SubmitButton></div>
                    </ActionForm>
                    <div className="flex flex-wrap gap-2">
                      <form action={toggleRetainerAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="customerId" value={c.id} />
                        <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                        <SubmitButton variant="ghost" size="sm">{r.active ? "Pause" : "Turn back on"}</SubmitButton>
                      </form>
                      <form action={deleteRetainerAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="customerId" value={c.id} />
                        <ConfirmButton size="sm" confirm="Remove this monthly invoice? Drafts it already made stay.">Remove</ConfirmButton>
                      </form>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <details className="g-disc mt-3">
          <summary>Add a monthly invoice</summary>
          <div className="g-disc-body">
            <ActionForm action={createRetainerAction} className="grid max-w-xl gap-3" resetOnSuccess>
              <input type="hidden" name="customerId" value={c.id} />
              <RetainerFields d={{ description: "Social media services", amount: "", day: 1, start: t.slice(0, 7) }} idp="new" />
              <div><SubmitButton>Add</SubmitButton></div>
            </ActionForm>
          </div>
        </details>
      </section>

      <Card title="Details">
        <ActionForm action={updateCustomerAction} className="grid max-w-xl gap-4">
          <input type="hidden" name="id" value={c.id} />
          <CustomerFields c={c} />
          <div><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
        <div className="mt-8 flex flex-wrap gap-2">
          <form action={archiveCustomerAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="archived" value={c.archived ? "0" : "1"} />
            <SubmitButton variant="ghost" size="sm">{c.archived ? "Bring back" : "Archive"}</SubmitButton>
          </form>
          {c.invoiceCount === 0 && (
            <form action={deleteCustomerAction}>
              <input type="hidden" name="id" value={c.id} />
              <ConfirmButton confirm={`Delete ${c.name}? Their monthly invoices go too.`}>Delete customer</ConfirmButton>
            </form>
          )}
        </div>
        {c.invoiceCount > 0 && <p className="hint">A customer with invoices can be archived, not deleted.</p>}
      </Card>
    </>
  );
}

function RetainerFields({ d, idp }: { d: { description: string; amount: string; day: number; start: string }; idp: string }) {
  return (
    <>
      <div>
        <label htmlFor={`ret-desc-${idp}`} className="label">Line on the invoice</label>
        <input id={`ret-desc-${idp}`} name="description" className="input" required maxLength={200} defaultValue={d.description} />
        <p className="hint">The month is added: “{d.description || "Social media services"} (December 2026)”.</p>
      </div>
      <div className="inv-pair">
        <div>
          <label htmlFor={`ret-amt-${idp}`} className="label">Each month ($)</label>
          <input id={`ret-amt-${idp}`} name="amount" className="input num" inputMode="decimal" required defaultValue={d.amount} placeholder="800" autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`ret-day-${idp}`} className="label">Day of the month</label>
          <input id={`ret-day-${idp}`} name="dayOfMonth" type="number" min={1} max={28} className="input num" defaultValue={d.day} />
        </div>
      </div>
      <div>
        <label htmlFor={`ret-start-${idp}`} className="label">First month</label>
        <input id={`ret-start-${idp}`} name="startMonth" type="month" className="input" defaultValue={d.start} />
      </div>
    </>
  );
}
