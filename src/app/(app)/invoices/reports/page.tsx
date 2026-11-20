import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { monthLabel, today } from "@/lib/dates";
import { OpsError } from "@/lib/ops";
import { invoiceReport } from "@/lib/ops-invoices";
import { PAYMENT_METHOD_LABEL, type InvoiceReport } from "@/lib/invoices-types";
import { InvoiceRows, InvoicingNotice, moneyShort } from "@/components/invoice-bits";
import { Card, EmptyState, Figure, PageHeader, buttonClass, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/**
 * Reports (docs/invoicing.md "Reports"): cash basis, by payment date. Paid by month for the year, by method, Stripe
 * fees, by customer; Export payments (CSV) per year for taxes.
 */
export default async function InvoiceReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const thisYear = Number(today().slice(0, 4));
  const y = Number(one(sp.year));
  const year = Number.isInteger(y) && y >= 2000 && y <= thisYear ? y : thisYear;
  let r: InvoiceReport | null = null;
  let error: string | null = null;
  try {
    r = await invoiceReport({ year });
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    error = e.message;
  }
  const max = r ? Math.max(1, ...r.paidByMonth.map((m) => m.cents)) : 1;
  const yearPaid = r ? r.paidByMonth.reduce((s, m) => s + m.cents, 0) : 0;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Money received, by the day it arrived. Export the payments for taxes."
        actions={<a href={`/invoices/export?year=${year}`} className={buttonClass("primary", "sm")}>Export {year} payments (CSV)</a>}
      />
      <nav aria-label="Year" className="seg mb-6">
        {[thisYear, thisYear - 1, thisYear - 2].map((yy) => (
          <Link key={yy} href={yy === thisYear ? "/invoices/reports" : `/invoices/reports?year=${yy}`} aria-current={yy === year ? "page" : undefined}>{yy}</Link>
        ))}
      </nav>
      <InvoicingNotice error={error} />

      {r && (
        <>
          <div className="figures">
            <Figure label={`Paid in ${year}`} value={<span className="num">{moneyShort(yearPaid)}</span>} hint={year === thisYear ? `${moneyShort(r.paidThisMonthCents)} this month` : "By payment date"} />
            <Figure label="Outstanding" value={<span className="num">{moneyShort(r.outstandingCents)}</span>} hint={`${r.outstandingCount} open now`} />
            <Figure label="Overdue" value={<span className="num">{moneyShort(r.overdueCents)}</span>} hint={r.overdueCount ? <span className="status is-danger is-small">{r.overdueCount} late</span> : "Nothing late"} />
            <Figure label="Stripe fees" value={<span className="num">{moneyShort(r.feesThisYearCents)}</span>} hint="Known fees, this year" />
          </div>

          <Card title={`Paid by month, ${year}`}>
            <div className="inv-bars" role="img" aria-label={`Paid by month in ${year}: ${r.paidByMonth.map((m) => `${monthLabel(m.month, "short")} ${moneyShort(m.cents)}`).join(", ")}`}>
              {r.paidByMonth.map((m) => (
                <div key={m.month} className="inv-bar" title={`${monthLabel(m.month)}: ${moneyShort(m.cents)}`}>
                  <i className={cx(m.cents === 0 && "is-zero")} style={{ height: `${Math.max(1, Math.round((m.cents / max) * 100))}%` }} />
                  <span>{monthLabel(m.month, "short").slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-10 max-md:gap-8 min-[1200px]:grid-cols-2 min-[1200px]:gap-x-16">
            <Card title="By how they paid" className="!mt-0 min-[1200px]:!mt-10" padded={false}>
              {r.byMethodThisYear.length === 0 ? (
                <p className="meta py-3">No payments in {year}.</p>
              ) : (
                <ul className="list">
                  {r.byMethodThisYear.map((m) => (
                    <li key={m.method} className="row">
                      <span className="row-title is-plain">{PAYMENT_METHOD_LABEL[m.method]}</span>
                      <span className="num">{moneyShort(m.cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Due in the next 7 days" className="!mt-0 min-[1200px]:!mt-10" padded={false}>
              <InvoiceRows rows={r.dueSoon} empty={<p className="meta py-3">Nothing coming due.</p>} />
            </Card>
          </div>

          <Card title="By customer" padded={false}>
            {r.byCustomer.length === 0 ? (
              <EmptyState title="Nothing yet" />
            ) : (
              <div className="inv-preview">
                <table className="inv-table is-report">
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col">Owed</th>
                      <th scope="col">Overdue</th>
                      <th scope="col">Invoiced {year}</th>
                      <th scope="col">Paid {year}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byCustomer.map((c) => (
                      <tr key={c.customerId}>
                        <td><Link href={`/invoices/customers/${encodeURIComponent(c.customerId)}`} className="link">{c.name}</Link></td>
                        <td className="num">{moneyShort(c.outstandingCents)}</td>
                        <td className={cx("num", c.overdueCents > 0 && "text-danger")}>{moneyShort(c.overdueCents)}</td>
                        <td className="num">{moneyShort(c.invoicedThisYearCents)}</td>
                        <td className="num">{moneyShort(c.paidThisYearCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="meta mt-4">The CSV has one row per payment, oldest first: date, invoice, customer, how, reference, amount, Stripe fee and net.</p>
        </>
      )}
    </>
  );
}
