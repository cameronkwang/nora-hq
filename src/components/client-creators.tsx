import Link from "next/link";
import type { ClientMonth } from "@/lib/reports";
import { formatDate, relativeTime } from "@/lib/dates";
import { EmptyState, PlatformTag, Status, StatusBadge } from "./ui";

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

/** Filter chips as links (no client JS). `href` builds the URL for a given filter. The current one is filled with ink. */
export function CreatorFilterChips({ current, counts, href }: { current: CreatorFilter; counts: Record<CreatorFilter, number>; href: (f: CreatorFilter) => string }) {
  const items: Array<[CreatorFilter, string]> = [["all", "All"], ["month", "Contacted this month"], ["active", "Active"], ["posted", "Posted"]];
  return (
    <nav aria-label="Filter creators" className="chips pb-1 pt-1">
      {items.map(([f, label]) => (
        <Link key={f} href={href(f)} scroll={false} aria-current={current === f ? "true" : undefined} className="chip">
          <span>
            {label} <i>{counts[f]}</i>
          </span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The creators for one business as a small ledger. Each creator is two lines: the name and where they stand,
 * then one muted line of facts (what they get, their handle, when we wrote). In a wide column the channel, the
 * next follow-up and the stage line up under a caps header.
 */
export function CreatorList({ rows, emptyHint, now = new Date() }: { rows: Row[]; emptyHint: React.ReactNode; now?: Date }) {
  if (rows.length === 0) return <EmptyState title="No creators here">{emptyHint}</EmptyState>;
  return (
    <>
      <div className="row creator-row creator-head eyebrow" aria-hidden>
        <span>Creator</span>
        <span>Channel</span>
        <span>Follow up</span>
        <span>Stage</span>
      </div>
      <ul className="list is-ruled border-b-0">
        {rows.map((r) => {
          const overdue = !!r.nextFollowUpAt && r.nextFollowUpAt < now && !CLOSED_STAGES.has(r.stage);
          const c = r.creator;
          return (
            <li key={r.id} className="row creator-row">
              <div className="who">
                <Link href={`/creators/${c.id}`} className="row-title">
                  {c.name}
                </Link>
                {c.doNotContact && <Status tone="danger" small>Do not contact</Status>}
                {r.priorPostUrl && <Status tone="danger" small>Already featured</Status>}
              </div>

              <span className="stage"><StatusBadge status={r.stage} /></span>

              <div className="rest">
                {r.channel && <span className="ch"><PlatformTag platform={r.channel} inherit /></span>}
                {r.nextFollowUpAt && (
                  <span className="fu num">
                    <span className="k">Follow up </span>
                    {overdue ? <span className="is-over">Overdue · {formatDate(r.nextFollowUpAt)}</span> : formatDate(r.nextFollowUpAt)}
                  </span>
                )}
                <span className="more">
                  <span>{COMP_LABEL[r.compType] ?? r.compType}</span>
                  {c.instagramHandle && <span>IG @{c.instagramHandle}</span>}
                  {c.tiktokHandle && <span>TT @{c.tiktokHandle}</span>}
                  {!c.instagramHandle && !c.tiktokHandle && c.email && <span>{c.email}</span>}
                  <span>{r.contactedAt ? `Contacted ${formatDate(r.contactedAt)}` : "Not contacted yet"}</span>
                  {r.lastActivityAt && <span>Last activity {relativeTime(r.lastActivityAt, now)}</span>}
                  {r.postUrl ? (
                    <>
                      <span>
                        <a href={r.postUrl} target="_blank" rel="noopener noreferrer" className="link">
                          View post ↗
                        </a>
                      </span>
                      <span>
                        {r.disclosureOk === true && <Status tone="ok">Disclosed</Status>}
                        {r.disclosureOk === false && <Status tone="danger" className="text-text">No #ad disclosure</Status>}
                        {r.disclosureOk == null && <Status tone="warn" className="text-text">Check disclosure</Status>}
                      </span>
                    </>
                  ) : r.stage === "posted" ? (
                    <span>Add the post link</span>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
