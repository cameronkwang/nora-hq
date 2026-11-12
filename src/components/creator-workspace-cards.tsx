import Link from "next/link";
import type { ReactNode } from "react";
import type { CollabRequest, Client, Lead } from "@/lib/schema";
import type { PlatformSummary } from "@/lib/ops-creator";
import type { DealsCardData } from "@/lib/ops-deals";
import { formatMoney, formatVisit } from "./deal-bits";
import { DELIVERABLE_LABEL } from "@/lib/ops-deals";
import { formatDate, relativeTime } from "@/lib/dates";
import { STAGE_LABEL } from "@/app/(app)/leads/shared";
import { NextStep } from "./lead-bits";
import { Badge, Card, EmptyState, LinkButton, cx, formatNumber, humanize } from "./ui";

/**
 * Pieces of Nora's own section (/clients/noraeatsgood). Server components, no hooks.
 * The plan, tasks and content cards are shared with the business page; these are creator-only.
 */

/* ------------------------------------------------------------------ header */

export function CreatorHeader({ client }: { client: Client }) {
  const ig = client.instagramHandle;
  const tt = client.tiktokHandle;
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">
          {client.name} <span className="font-normal text-muted">· @{ig ?? tt ?? "noraeatsgood"}</span>
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted">Your own content &amp; collabs</span>
          {ig && (
            <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-ig hover:underline md:min-h-0">
              Instagram
            </a>
          )}
          {tt && (
            <a href={`https://www.tiktok.com/@${tt}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-tt hover:underline md:min-h-0">
              TikTok
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 self-start sm:self-auto">
        <LinkButton href="/kit-settings" size="sm">Media kit</LinkButton>
        <LinkButton href={`/clients/${client.id}/settings`} size="sm">
          Voice &amp; plan
        </LinkButton>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- collab requests */

export function CollabRequestsCard({ newCount, reviewingCount, latest }: { newCount: number; reviewingCount: number; latest: CollabRequest[] }) {
  const open = newCount + reviewingCount;
  return (
    <Card
      title={
        <>
          Collab requests
          {open > 0 && (
            <span className="font-normal text-muted">
              {" "}· {newCount > 0 ? `${newCount} new` : ""}
              {newCount > 0 && reviewingCount > 0 ? ", " : ""}
              {reviewingCount > 0 ? `${reviewingCount} reviewing` : ""}
            </span>
          )}
        </>
      }
      actions={<Link href="/collabs" className="-my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline md:min-h-0">See all</Link>}
      padded={false}
    >
      {latest.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No open requests">
            When a business fills in the collab form, it lands here (and in Asks for Nora).
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {latest.map((r) => (
            <li key={r.id}>
              <Link href={`/collabs/${r.id}`} className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.businessName}</span>
                    {r.status === "new" && <Badge tone="accent">New</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {[r.collabType && humanize(r.collabType), r.compensation && humanize(r.compensation), r.city].filter(Boolean).join(" · ") || "No details"}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted" title={formatDate(r.createdAt, true)}>
                  {relativeTime(r.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- stats */

export function CreatorStatsCard({ platforms }: { platforms: PlatformSummary[] }) {
  const empty = platforms.every((p) => p.followers == null && p.views28 == null);
  return (
    <Card title="Stats" actions={<Link href="/stats" className="-my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline md:min-h-0">Open my stats</Link>}>
      {empty ? (
        <EmptyState title="No numbers yet">
          <Link href="/stats" className="text-accent hover:underline">Connect Instagram and TikTok</Link>, or log follower counts by hand.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {platforms.map((p) => (
            <div key={p.platform} className="min-w-0 rounded-lg bg-surface-2 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <span aria-hidden className={cx("inline-block size-2 rounded-full", p.platform === "instagram" ? "bg-ig" : "bg-tt")} />
                {p.platform === "instagram" ? "Instagram" : "TikTok"}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums" title={p.followers != null ? `${p.followers.toLocaleString("en-US")} followers` : undefined}>
                {formatNumber(p.followers)}
              </p>
              <p className="text-xs text-muted">
                followers
                {p.change30 != null && p.change30 !== 0 && (
                  <span className={cx("ml-1 font-semibold tabular-nums", p.change30 > 0 ? "text-ok" : "text-danger")}>
                    {p.change30 > 0 ? "+" : "−"}{formatNumber(Math.abs(p.change30))}
                  </span>
                )}
              </p>
              <p className="mt-2 text-sm">
                <span className="font-semibold tabular-nums">{formatNumber(p.views28)}</span> <span className="text-xs text-muted">views · 28 days</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ collab leads */

export function CollabLeadsCard({ rows, total, today }: { rows: Lead[]; total: number; today: string }) {
  return (
    <Card
      title={<>Collab leads{total > 0 && <span className="font-normal text-muted"> · {total} in play</span>}</>}
      actions={<Link href="/leads?opp=collab" className="-my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline md:min-h-0">All collab leads</Link>}
      padded={false}
    >
      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No collab leads in play">
            Restaurants you&apos;d like to work with show up here once they&apos;re qualified. <Link href="/leads?opp=collab" className="text-accent hover:underline">Browse leads</Link>.
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((l) => (
            <li key={l.id}>
              <Link href={`/leads/${l.id}`} className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    {l.city && <span className="truncate">{l.city}</span>}
                    <NextStep date={l.nextStepAt} today={today} />
                  </span>
                </span>
                <Badge tone={l.stage === "proposal" || l.stage === "talking" ? "accent" : "neutral"}>{STAGE_LABEL[l.stage]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- deals */

/**
 * Collab deals at a glance: the next visit, deliverables due in the next 7 days and what Nora is owed.
 * Data: dealsCardData() from lib/ops-deals. Links to /deals (not a nav item — this card is the way in).
 */
export function DealsCard({ data }: { data: DealsCardData }) {
  const { nextVisit, dueThisWeek, owed } = data;
  return (
    <Card
      title="Deals"
      actions={<Link href="/deals" className="-my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline md:min-h-0">All deals</Link>}
      padded={false}
    >
      <Link href="/deals" className="flex min-h-11 flex-wrap items-baseline gap-x-2 border-b border-border px-4 py-3 hover:bg-surface-2">
        <span className="text-sm text-muted">Owed</span>
        <span className="text-xl font-semibold tabular-nums">{formatMoney(owed.owedCents) || "$0"}</span>
        {owed.overdueCount > 0 ? (
          <span className="text-sm font-semibold text-danger">({owed.overdueCount} overdue)</span>
        ) : owed.count > 0 ? (
          <span className="text-xs text-muted">{owed.count} deal{owed.count === 1 ? "" : "s"}</span>
        ) : null}
      </Link>
      {nextVisit ? (
        <Link href={`/deals/${nextVisit.id}/visit`} className="flex min-h-11 items-center gap-3 border-b border-border px-4 py-3 hover:bg-surface-2">
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted">Next visit</span>
            <span className="block truncate text-sm font-medium">{nextVisit.businessName}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted">{formatVisit(nextVisit.visitAt)}</span>
        </Link>
      ) : (
        <p className="border-b border-border px-4 py-3 text-sm text-muted">No visits scheduled.</p>
      )}
      {dueThisWeek.length > 0 ? (
        <ul className="divide-y divide-border">
          {dueThisWeek.map((d, i) => (
            <li key={`${d.dealId}-${i}`}>
              <Link href={`/deals/${d.dealId}`} className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {DELIVERABLE_LABEL[d.kind]} <span className="text-muted">· {d.businessName}</span>
                </span>
                <span className={cx("shrink-0 text-xs tabular-nums", d.overdue ? "font-semibold text-danger" : "text-muted")}>
                  {d.overdue ? "late · " : "due "}{formatDate(d.dueDate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">Nothing due to post this week.</p>
      )}
    </Card>
  );
}

/** Two cards side by side on wide screens, stacked on phones. */
export function CreatorRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">{children}</div>;
}
