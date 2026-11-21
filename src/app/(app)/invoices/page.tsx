import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { invoiceReport, listInvoices } from "@/lib/ops-invoices";
import type { InvoiceListFilter, InvoiceListRow, InvoiceReport } from "@/lib/invoices-types";
import { InvoiceRows, InvoicingNotice, moneyShort } from "@/components/invoice-bits";
import { EmptyState, Figure, LinkButton, PageHeader, Status, buttonClass, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Drafts" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * /invoices (docs/invoicing.md "The team's pages"): four figures, filter chips, one list with a one-tap PDF on every
 * row. Head actions: New invoice (the focal button), Import, Export payments (CSV). Both Cameron and Nora.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const status: FilterKey = (FILTERS.map((f) => f.key) as string[]).includes(one(sp.status)) ? (one(sp.status) as FilterKey) : "all";
  const customerId = one(sp.customer) || undefined;
  const q = one(sp.q).slice(0, 80) || undefined;

  let rows: InvoiceListRow[] = [];
  let report: InvoiceReport | null = null;
  let error: string | null = null;
  try {
    const filter: InvoiceListFilter = { status, customerId, q, limit: 200 };
    [rows, report] = await Promise.all([listInvoices(filter), invoiceReport()]);
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }
  const forCustomer = customerId ? rows[0]?.customerName ?? null : null;
  const href = (k: FilterKey) => {
    const u = new URLSearchParams();
    if (k !== "all") u.set("status", k);
    if (customerId) u.set("customer", customerId);
    if (q) u.set("q", q);
    const s = u.toString();
    return s ? `/invoices?${s}` : "/invoices";
  };
  const count = (k: FilterKey) => (!report ? null : k === "open" ? report.outstandingCount : k === "overdue" ? report.overdueCount : k === "draft" ? report.draftCount : null);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Make the PDF, send it from your phone, record the payment. Zelle and check unless you choose otherwise."
        actions={
          <>
            <LinkButton href="/invoices/new" variant="primary" size="sm">New invoice</LinkButton>
            <LinkButton href="/invoices/import" size="sm" variant="ghost">Import</LinkButton>
            {/* Phones: Export lives on Reports, so the head stays one row. */}
            <a href="/invoices/export" className={cx(buttonClass("ghost", "sm"), "max-md:hidden")}>Export payments (CSV)</a>
          </>
        }
      />

      {one(sp.deleted) && <p role="status" className="notice mb-6"><Status tone="ok">Draft deleted.</Status></p>}
      <InvoicingNotice error={error} />

      {report && (
        <div className="figures">
          <Link href={href("open")} className="figure">
            <span className="eyebrow">Outstanding</span>
            <span className="value num">{moneyShort(report.outstandingCents)}</span>
            <span className="meta">{report.outstandingCount} open</span>
          </Link>
          <Link href={href("overdue")} className="figure">
            <span className="eyebrow">Overdue</span>
            <span className="value num">{moneyShort(report.overdueCents)}</span>
            <span className="meta">{report.overdueCount ? <span className="status is-danger is-small">{report.overdueCount} late</span> : "Nothing late"}</span>
          </Link>
          <Figure label="Paid this month" value={<span className="num">{moneyShort(report.paidThisMonthCents)}</span>} hint="By payment date" />
          <Link href="/invoices/reports" className="figure">
            <span className="eyebrow">Paid this year</span>
            <span className="value num">{moneyShort(report.paidThisYearCents)}</span>
            <span className="meta">Reports</span>
          </Link>
        </div>
      )}

      <nav aria-label="Show" className="chips inv-filters">
        {FILTERS.map((f) => {
          const n = count(f.key);
          return (
            <Link key={f.key} href={href(f.key)} aria-current={status === f.key ? "page" : undefined} className="chip">
              <span>
                {f.label}
                {n != null && n > 0 && <i>{n}</i>}
              </span>
            </Link>
          );
        })}
      </nav>

      <form action="/invoices" className="inv-search" role="search">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        {customerId && <input type="hidden" name="customer" value={customerId} />}
        <label htmlFor="inv-q" className="sr-only">Find an invoice</label>
        <input id="inv-q" name="q" defaultValue={q ?? ""} className="input" placeholder="Number or customer" autoComplete="off" />
        <button className={buttonClass("secondary")}>Find</button>
      </form>

      {(customerId || q) && (
        <p className="meta mb-3">
          {customerId && <>For {forCustomer ?? "this customer"}</>}
          {customerId && q && " · "}
          {q && <>Matching “{q}”</>}
          {" · "}
          <Link href={status !== "all" ? `/invoices?status=${status}` : "/invoices"} className="link">Show all</Link>
        </p>
      )}

      <InvoiceRows
        rows={rows}
        empty={
          !error && (
            <EmptyState title={status === "all" && !q ? "No invoices yet" : "Nothing here"}>
              {status === "all" && !q ? (
                <>
                  <Link href="/invoices/new" className="link">Make the first one</Link>, or <Link href="/invoices/import" className="link">import from Skynova</Link>.
                </>
              ) : (
                <Link href="/invoices" className="link">Show all invoices</Link>
              )}
            </EmptyState>
          )
        }
      />
    </>
  );
}
