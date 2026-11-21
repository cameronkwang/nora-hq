import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { OpsError } from "@/lib/ops";
import { listCustomers } from "@/lib/ops-invoices";
import type { CustomerSummary } from "@/lib/invoices-types";
import { InvoicingNotice, moneyShort } from "@/components/invoice-bits";
import { EmptyState, LinkButton, PageHeader, Status, Tag, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** Who gets billed (docs/invoicing.md "customers"): outstanding and overdue first, then everyone else by name. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const archived = one(sp.archived) === "1";
  const q = one(sp.q).slice(0, 80) || undefined;
  let rows: CustomerSummary[] = [];
  let error: string | null = null;
  try {
    rows = await listCustomers({ includeArchived: archived, q });
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }
  const sorted = [...rows].sort((a, b) => b.overdueCents - a.overdueCents || b.outstandingCents - a.outstandingCents || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Everyone you bill: managed businesses and collab partners. Balances come from their invoices."
        actions={<LinkButton href="/invoices/customers/new" variant="primary" size="sm">New customer</LinkButton>}
      />
      <InvoicingNotice error={error} />

      <form action="/invoices/customers" className="inv-search" role="search">
        {archived && <input type="hidden" name="archived" value="1" />}
        <label htmlFor="cus-q" className="sr-only">Find a customer</label>
        <input id="cus-q" name="q" defaultValue={q ?? ""} className="input" placeholder="Name or contact" autoComplete="off" />
        <button className={buttonClass("secondary")}>Find</button>
      </form>

      {sorted.length === 0 && !error ? (
        <EmptyState title={q ? "No one matches" : "No customers yet"}>
          {q ? <Link href="/invoices/customers" className="link">Show everyone</Link> : <>A customer is made the first time you <Link href="/invoices/new" className="link">make an invoice</Link> for them.</>}
        </EmptyState>
      ) : (
        <ul className="list is-ruled">
          {sorted.map((c) => (
            <li key={c.id}>
              <Link href={`/invoices/customers/${encodeURIComponent(c.id)}`} className="row">
                <div className="min-w-0 flex-1">
                  <p className="row-title">
                    {c.name}
                    {c.archived && <Tag>Archived</Tag>}
                    {c.activeRetainers > 0 && <Tag>Monthly</Tag>}
                  </p>
                  <p className="meta whitespace-normal">
                    {[
                      c.contactName,
                      c.client ? "Managed business" : null,
                      `${c.invoiceCount} ${c.invoiceCount === 1 ? "invoice" : "invoices"}`,
                      c.lastInvoiceAt ? `last ${formatDate(c.lastInvoiceAt)}` : null,
                      c.paidThisYearCents ? `${moneyShort(c.paidThisYearCents)} paid this year` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="grid shrink-0 justify-items-end text-right">
                  {c.outstandingCents > 0 ? <span className="num font-medium">{moneyShort(c.outstandingCents)}</span> : <span className="meta">Nothing owed</span>}
                  {c.overdueCents > 0 && <Status tone="danger" small>{moneyShort(c.overdueCents)} overdue</Status>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4">
        <Link href={archived ? "/invoices/customers" : "/invoices/customers?archived=1"} className="link-quiet">
          {archived ? "Hide archived customers" : "Show archived customers"}
        </Link>
      </p>
    </>
  );
}
