import Link from "next/link";
import type { CollabRequest, Client, Lead } from "@/lib/schema";
import type { PlatformSummary } from "@/lib/ops-creator";
import type { DealsCardData } from "@/lib/ops-deals";
import { formatMoney, formatVisit } from "./deal-bits";
import { DELIVERABLE_LABEL } from "@/lib/ops-deals";
import { formatDate, relativeTime } from "@/lib/dates";
import { STAGE_LABEL } from "@/app/(app)/leads/shared";
import { NextStep } from "./lead-bits";
import { reelsToPostCount } from "@/lib/ops-schedule";
import { Card, EmptyState, LinkButton, Stat, Status, cx, formatNumber, humanize } from "./ui";

/**
 * Pieces of Nora's own section (/clients/noraeatsgood). Server components, no hooks.
 * The plan, tasks and content sections are shared with the business page; these are creator-only.
 */

function Chevron({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ header */

export function CreatorHeader({ client }: { client: Client }) {
  const ig = client.instagramHandle;
  const tt = client.tiktokHandle;
  return (
    <header className="page-head">
      <div className="head-row">
        <h1 className="display">{client.name}</h1>
        <div className="head-actions">
          <LinkButton href="/kit-settings" size="sm">Media kit</LinkButton>
          <LinkButton href={`/clients/${client.id}/settings`} size="sm">
            Voice &amp; plan
          </LinkButton>
        </div>
      </div>
      <p className="sub biz-meta">
        <span>Your own content &amp; collabs</span>
        {ig && (
          <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" className="status is-ig">
            Instagram @{ig}
          </a>
        )}
        {tt && (
          <a href={`https://www.tiktok.com/@${tt}`} target="_blank" rel="noopener noreferrer" className="status is-tt">
            TikTok @{tt}
          </a>
        )}
        {!ig && !tt && <span>@noraeatsgood</span>}
        <ReelsToPostLink />
      </p>
    </header>
  );
}

/**
 * "Reels to post: N" → the schedule filtered to reels still owed (📸 not ticked). Fetches its own count
 * (async server component) so the workspace page needs no extra wiring; renders nothing at 0.
 * The number is one that needs her, so it is the cinnabar numeral; the camera is printed in grey.
 */
export async function ReelsToPostLink() {
  let n = 0;
  try {
    n = await reelsToPostCount();
  } catch {
    return null; // never break the workspace over a count
  }
  if (!n) return null;
  return (
    <Link href="/calendar?show=reels">
      <span className="emoji" aria-hidden>📸</span> Reels to post: <span className="count">{n}</span>
    </Link>
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
            <>
              {" "}
              <span className="meta">
                {newCount > 0 ? `${newCount} new` : ""}
                {newCount > 0 && reviewingCount > 0 ? ", " : ""}
                {reviewingCount > 0 ? `${reviewingCount} reviewing` : ""}
              </span>
            </>
          )}
        </>
      }
      actions={<Link href="/collabs" className="link-quiet tap-target">See all →</Link>}
      padded={false}
    >
      {latest.length === 0 ? (
        <EmptyState title="No open requests">
          When a business fills in the collab form, it lands here (and in Asks for Nora).
        </EmptyState>
      ) : (
        <ul className="list">
          {latest.map((r) => (
            <li key={r.id}>
              <Link href={`/collabs/${r.id}`} className="row ws-row">
                <span className="two">
                  <span className="row-title">
                    {r.businessName}
                    {r.status === "new" && <Status tone="info" small className="ml-2.5 font-normal">New</Status>}
                  </span>
                  <span className="meta">
                    {[r.collabType && humanize(r.collabType), r.compensation && humanize(r.compensation), r.city].filter(Boolean).join(" · ") || "No details"}
                  </span>
                </span>
                <span className="meta num" title={formatDate(r.createdAt, true)}>
                  {relativeTime(r.createdAt)}
                </span>
                <Chevron className="chev" />
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
    <Card title="Stats" actions={<Link href="/stats" className="link-quiet tap-target">Open my stats →</Link>}>
      {empty ? (
        <EmptyState title="No numbers yet">
          <Link href="/stats" className="link">Connect Instagram and TikTok</Link>, or log follower counts by hand.
        </EmptyState>
      ) : (
        <div className="figures">
          {platforms.map((p) => (
            <Stat
              key={p.platform}
              label={<span className={cx("status", p.platform === "instagram" ? "is-ig" : "is-tt")}>{p.platform === "instagram" ? "Instagram" : "TikTok"}</span>}
              value={<span title={p.followers != null ? `${p.followers.toLocaleString("en-US")} followers` : undefined}>{formatNumber(p.followers)}</span>}
              hint={
                <>
                  followers
                  {p.change30 != null && p.change30 !== 0 && (
                    <span className="num ml-1 font-semibold text-text">
                      {p.change30 > 0 ? "+" : "−"}{formatNumber(Math.abs(p.change30))}
                    </span>
                  )}
                  <br />
                  <span className="num font-semibold text-text">{formatNumber(p.views28)}</span> views · 28 days
                </>
              }
            />
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
      title={<>Collab leads{total > 0 && <> <span className="meta">{total} in play</span></>}</>}
      actions={<Link href="/leads?opp=collab" className="link-quiet tap-target">All collab leads →</Link>}
      padded={false}
    >
      {rows.length === 0 ? (
        <EmptyState title="No collab leads in play">
          Restaurants you&apos;d like to work with show up here once they&apos;re qualified. <Link href="/leads?opp=collab" className="link">Browse leads</Link>.
        </EmptyState>
      ) : (
        <ul className="list">
          {rows.map((l) => (
            <li key={l.id}>
              <Link href={`/leads/${l.id}`} className="row ws-row">
                <span className="two">
                  <span className="row-title">{l.name}</span>
                  {(l.city || l.nextStepAt) && (
                    <span className="meta">
                      {l.city}
                      {l.city && l.nextStepAt ? " · " : ""}
                      <NextStep date={l.nextStepAt} today={today} />
                    </span>
                  )}
                </span>
                <Status tone={l.stage === "proposal" || l.stage === "talking" ? "warn" : "neutral"} small>{STAGE_LABEL[l.stage]}</Status>
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
 * Collab deals at a glance: what Nora is owed, the next visit and deliverables due in the next 7 days.
 * Data: dealsCardData() from lib/ops-deals. Links to /deals (not a nav item, so this section is the way in).
 */
export function DealsCard({ data }: { data: DealsCardData }) {
  const { nextVisit, dueThisWeek, owed } = data;
  return (
    <Card title="Deals" actions={<Link href="/deals" className="link-quiet tap-target">All deals →</Link>} padded={false}>
      <Link href="/deals" className="ws-owed figure pb-3 pt-1">
        <span className="eyebrow w-full">Owed</span>
        <span className="value">{formatMoney(owed.owedCents) || "$0"}</span>
        {owed.overdueCount > 0 ? (
          <span className="meta is-over font-medium text-danger">({owed.overdueCount} overdue)</span>
        ) : owed.count > 0 ? (
          <span className="meta">{owed.count} deal{owed.count === 1 ? "" : "s"}</span>
        ) : null}
      </Link>
      <ul className="list is-ruled border-b-0">
        <li>
          {nextVisit ? (
            <Link href={`/deals/${nextVisit.id}/visit`} className="row ws-row">
              <span className="two">
                <span className="meta">Next visit</span>
                <span className="row-title">{nextVisit.businessName}</span>
              </span>
              <span className="meta num">{formatVisit(nextVisit.visitAt)}</span>
            </Link>
          ) : (
            <p className="row meta">No visits scheduled.</p>
          )}
        </li>
        {dueThisWeek.length > 0 ? (
          dueThisWeek.map((d, i) => (
            <li key={`${d.dealId}-${i}`}>
              <Link href={`/deals/${d.dealId}`} className="row ws-row">
                <span className="row-title is-plain">
                  {DELIVERABLE_LABEL[d.kind]} <span className="text-muted">· {d.businessName}</span>
                </span>
                <span className={cx("meta num", d.overdue && "is-over")}>
                  {d.overdue ? "late · " : "due "}{formatDate(d.dueDate)}
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li>
            <p className="row meta">Nothing due to post this week.</p>
          </li>
        )}
      </ul>
    </Card>
  );
}
