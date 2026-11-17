import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { CREATOR_WORKSPACE_ID } from "@/lib/ops-collab";
import { dealGroup, dealsOwed, listDeals, type DealGroup, type DealWithDeliverables } from "@/lib/ops-deals";
import { SubmitButton } from "@/components/client-form";
import { DealStatusBadge, DeliverablesProgress, PaymentChip, compText, formatMoney, formatVisit } from "@/components/deal-bits";
import { Card, EmptyState, PageHeader, buttonClass, cx } from "@/components/ui";
import { createDealAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const SECTIONS: { key: DealGroup; title: string; empty: string }[] = [
  { key: "upcoming", title: "Upcoming visits", empty: "No visits planned. Accept a collab request and press “Create deal”." },
  { key: "in_progress", title: "In progress", empty: "Nothing shot and waiting to post." },
  { key: "awaiting_payment", title: "Awaiting payment", empty: "Nobody owes you anything right now." },
  { key: "done", title: "Done", empty: "Finished deals land here." },
];

export default async function DealsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const t = today();
  const [deals, owed] = await Promise.all([listDeals(), dealsOwed(t)]);
  const groups: Record<DealGroup, DealWithDeliverables[]> = { upcoming: [], in_progress: [], awaiting_payment: [], done: [] };
  for (const d of deals) groups[dealGroup(d)].push(d);
  // Done: most recently touched first. Upcoming: soonest visit first (listDeals order).
  groups.done.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const error = one(sp.error);

  return (
    <>
      <PageHeader
        crumb={<Link href={`/clients/${CREATOR_WORKSPACE_ID}`}>Nora’s workspace</Link>}
        title="Collab deals"
        subtitle="Agreed collabs: visits, deliverables and getting paid."
      />

      {error && <p role="alert" className="notice mb-6"><span className="status is-danger">{error}</span></p>}

      <p className="g-owed">
        <span className="text-muted">Owed</span>
        <span className="value">{formatMoney(owed.owedCents) || "$0"}</span>
        <span className="meta">
          {owed.count === 0 ? "all paid up" : `${owed.count} deal${owed.count === 1 ? "" : "s"}`}
          {owed.unpricedCount > 0 && ` · ${owed.unpricedCount} with no amount set`}
        </span>
        {owed.overdueCount > 0 && (
          <span className="status is-danger">{owed.overdueCount} overdue · {formatMoney(owed.overdueCents)}</span>
        )}
      </p>

      {SECTIONS.map((s) => {
        const rows = groups[s.key];
        const body = rows.length === 0 ? (
          <EmptyState title="None">{s.empty}</EmptyState>
        ) : (
          <ul className="list">
            {rows.map((d) => <DealRow key={d.id} deal={d} today={t} showVisit={s.key === "upcoming"} />)}
          </ul>
        );
        if (s.key === "done") {
          return (
            <details key={s.key} className="sec g-fold" open={rows.length > 0 && rows.length <= 3}>
              <summary className="sec-head">
                <span className="title">{s.title}{rows.length > 0 && <span className="meta num">{rows.length}</span>}</span>
                <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </summary>
              {body}
            </details>
          );
        }
        return (
          <Card key={s.key} title={<>{s.title}{rows.length > 0 && <span className="meta num">{rows.length}</span>}</>} padded={false}>
            {body}
          </Card>
        );
      })}

      <Card title="Add a deal">
        <form action={createDealAction} className="flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="new-deal-name">Business name</label>
            <input id="new-deal-name" name="businessName" required maxLength={160} className="input" placeholder="e.g. Lucia’s Trattoria" autoComplete="off" />
          </div>
          <SubmitButton pendingLabel="Creating…">Create deal</SubmitButton>
        </form>
        <p className="hint">For collabs that came in by DM or email. Requests from the collab form get a “Create deal” button once accepted.</p>
      </Card>
    </>
  );
}

function DealRow({ deal: d, today, showVisit }: { deal: DealWithDeliverables; today: string; showVisit: boolean }) {
  const posted = d.deliverables.filter((x) => x.postedAt).length;
  const when = d.visitAt ? formatVisit(d.visitAt) : d.status === "planning" ? "No visit date yet" : "";
  return (
    <li className="g-row">
      <div className="head">
        <Link href={`/deals/${d.id}`} className={cx(d.status === "cancelled" && "text-muted line-through")}>{d.businessName}</Link>
        {d.status !== "planning" && d.status !== "scheduled" && <DealStatusBadge status={d.status} />}
      </div>
      {showVisit && d.visitAt && (
        <span className="end">
          <Link href={`/deals/${d.id}/visit`} className={buttonClass("secondary", "sm")}>Visit</Link>
        </span>
      )}
      <p className="more g-dots">
        {when && <span>{when}</span>}
        <span>{compText(d)}</span>
        <DeliverablesProgress posted={posted} total={d.deliverables.length} />
        <PaymentChip deal={d} today={today} />
      </p>
    </li>
  );
}
