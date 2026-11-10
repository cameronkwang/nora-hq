import Link from "next/link";
import type { ClientMonth } from "@/lib/reports";
import { formatDate, relativeTime } from "@/lib/dates";
import { Badge, EmptyState, PlatformTag, StatusBadge, cx } from "./ui";

export type CreatorFilter = "all" | "month" | "active" | "posted";

const ACTIVE_STAGES = new Set(["contacted", "followed_up", "replied", "negotiating", "agreed", "visit_scheduled"]);
const CLOSED_STAGES = new Set(["posted", "declined", "no_response"]);
const COMP_LABEL: Record<string, string> = { gifted: "Gifted", paid: "Paid", affiliate: "Affiliate", tbd: "Comp TBD" };

type Row = ClientMonth["outreach"][number];

export function filterOutreach(rows: Row[], filter: CreatorFilter, monthStart: Date, nextStart: Date) {
  switch (filter) {
    case "month":
      return rows.filter((r) => r.contactedAt && r.contactedAt >= monthStart && r.contactedAt < nextStart);
    case "active":
      return rows.filter((r) => ACTIVE_STAGES.has(r.stage));
    case "posted":
      return rows.filter((r) => r.stage === "posted" || !!r.postUrl);
    default:
      return rows;
  }
}

/** Filter chips as links (no client JS). `href` builds the URL for a given filter. */
export function CreatorFilterChips({ current, counts, href }: { current: CreatorFilter; counts: Record<CreatorFilter, number>; href: (f: CreatorFilter) => string }) {
  const items: Array<[CreatorFilter, string]> = [["all", "All"], ["month", "Contacted this month"], ["active", "Active"], ["posted", "Posted"]];
  return (
    <nav aria-label="Filter creators" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {items.map(([f, label]) => (
        <Link
          key={f}
          href={href(f)}
          scroll={false}
          aria-current={current === f ? "true" : undefined}
          className={cx(
            "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium",
            current === f ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-surface-2",
          )}
        >
          {label} <span className="tabular-nums opacity-70">{counts[f]}</span>
        </Link>
      ))}
    </nav>
  );
}

export function CreatorList({ rows, emptyHint, now = new Date() }: { rows: Row[]; emptyHint: React.ReactNode; now?: Date }) {
  if (rows.length === 0) return <EmptyState title="No creators here">{emptyHint}</EmptyState>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const overdue = !!r.nextFollowUpAt && r.nextFollowUpAt < now && !CLOSED_STAGES.has(r.stage);
        const c = r.creator;
        return (
          <li key={r.id} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-start md:gap-4">
            <div className="min-w-0">
              <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
              {c.doNotContact && <Badge tone="danger" className="ml-2">Do not contact</Badge>}
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                {c.instagramHandle && <span>IG @{c.instagramHandle}</span>}
                {c.tiktokHandle && <span>TT @{c.tiktokHandle}</span>}
                {!c.instagramHandle && !c.tiktokHandle && c.email && <span className="truncate">{c.email}</span>}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.stage} />
              <PlatformTag platform={r.channel} />
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
              <dt className="text-muted">Contacted</dt>
              <dd>{r.contactedAt ? formatDate(r.contactedAt) : "Not yet"}</dd>
              <dt className="text-muted">Last activity</dt>
              <dd>{r.lastActivityAt ? relativeTime(r.lastActivityAt, now) : "—"}</dd>
              <dt className="text-muted">Follow up</dt>
              <dd>
                {r.nextFollowUpAt ? (
                  overdue ? (
                    <Badge tone="danger">Overdue · {formatDate(r.nextFollowUpAt)}</Badge>
                  ) : (
                    formatDate(r.nextFollowUpAt)
                  )
                ) : (
                  "—"
                )}
              </dd>
            </dl>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge>{COMP_LABEL[r.compType] ?? r.compType}</Badge>
              {r.postUrl ? (
                <>
                  <a href={r.postUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    View post ↗
                  </a>
                  {r.disclosureOk === true && <Badge tone="ok">✓ Disclosed</Badge>}
                  {r.disclosureOk === false && <Badge tone="danger">✕ No #ad disclosure</Badge>}
                  {r.disclosureOk == null && <Badge tone="warn">Check disclosure</Badge>}
                </>
              ) : r.stage === "posted" ? (
                <span className="text-muted">Add the post link</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
