import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { CREATOR_WORKSPACE_ID } from "@/lib/ops-collab";
import { dealGroup, dealsOwed, listDeals, type DealGroup, type DealWithDeliverables } from "@/lib/ops-deals";
import { SubmitButton } from "@/components/client-form";
import { DealStatusBadge, DeliverablesProgress, PaymentChip, compText, formatMoney, formatVisit } from "@/components/deal-bits";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
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
      <p className="mb-2 text-sm">
        <Link href={`/clients/${CREATOR_WORKSPACE_ID}`} className="text-muted hover:underline">← Nora’s workspace</Link>
      </p>
      <PageHeader title="Collab deals" subtitle="Agreed collabs: visits, deliverables and getting paid." />

      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3">
        <span className="text-sm text-muted">Owed</span>
        <span className="text-2xl font-semibold tabular-nums">{formatMoney(owed.owedCents) || "$0"}</span>
        <span className="text-sm text-muted">
          {owed.count === 0 ? "all paid up" : `${owed.count} deal${owed.count === 1 ? "" : "s"}`}
          {owed.unpricedCount > 0 && ` · ${owed.unpricedCount} with no amount set`}
        </span>
        {owed.overdueCount > 0 && (
          <span className="text-sm font-semibold text-danger">{owed.overdueCount} overdue · {formatMoney(owed.overdueCents)}</span>
        )}
      </div>

      <div className="grid gap-6">
        {SECTIONS.map((s) => {
          const rows = groups[s.key];
          const body = rows.length === 0 ? (
            <div className="p-4"><EmptyState title="None">{s.empty}</EmptyState></div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((d) => <DealRow key={d.id} deal={d} today={t} showVisit={s.key === "upcoming"} />)}
            </ul>
          );
          if (s.key === "done") {
            return (
              <details key={s.key} className="group rounded-xl border border-border bg-surface" open={rows.length > 0 && rows.length <= 3}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
                  <span>{s.title}{rows.length > 0 && <span className="font-normal text-muted"> · {rows.length}</span>}</span>
                  <span aria-hidden className="text-muted transition group-open:rotate-180">▾</span>
                </summary>
                <div className="border-t border-border">{body}</div>
              </details>
            );
          }
          return (
            <Card key={s.key} title={<>{s.title}{rows.length > 0 && <span className="font-normal text-muted"> · {rows.length}</span>}</>} padded={false}>
              {body}
            </Card>
          );
        })}

        <Card title="Add a deal">
          <form action={createDealAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="new-deal-name">Business name</label>
              <input id="new-deal-name" name="businessName" required maxLength={160} className="input" placeholder="e.g. Lucia’s Trattoria" autoComplete="off" />
            </div>
            <SubmitButton pendingLabel="Creating…">Create deal</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-muted">For collabs that came in by DM or email. Requests from the collab form get a “Create deal” button once accepted.</p>
        </Card>
      </div>
    </>
  );
}

function DealRow({ deal: d, today, showVisit }: { deal: DealWithDeliverables; today: string; showVisit: boolean }) {
  const posted = d.deliverables.filter((x) => x.postedAt).length;
  return (
    <li className="flex items-stretch">
      <Link href={`/deals/${d.id}`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3 hover:bg-surface-2">
        <span className="flex items-center gap-2">
          <span className={cx("truncate text-[15px] font-medium", d.status === "cancelled" && "text-muted line-through")}>{d.businessName}</span>
          {d.status !== "planning" && d.status !== "scheduled" && <DealStatusBadge status={d.status} />}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className={cx(!d.visitAt && d.status === "planning" && "italic")}>{d.visitAt ? formatVisit(d.visitAt) : d.status === "planning" ? "No visit date yet" : ""}</span>
          <span>{compText(d)}</span>
          <DeliverablesProgress posted={posted} total={d.deliverables.length} />
          <PaymentChip deal={d} today={today} />
        </span>
      </Link>
      {showVisit && d.visitAt && (
        <Link href={`/deals/${d.id}/visit`} className="flex shrink-0 items-center border-l border-border px-4 text-sm font-medium text-accent hover:bg-surface-2">
          Visit
        </Link>
      )}
    </li>
  );
}
