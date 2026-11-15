import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/dates";
import { findConnection } from "@/lib/integrations/connections";
import { EmptyState, LinkButton, PageHeader, Stat, Status, StatusBadge, buttonClass, clientLabel, humanize } from "@/components/ui";
import { SubmitButton } from "@/components/client-form";
import { syncReviewsAction } from "../settings/actions";
import { askClaudeToReplyAction } from "./actions";
import { PAGE_SIZE, draftsForReviews, listReviews, openAsksForReviews, reviewStats } from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Stars in ink, the empty ones in the hairline colour (no traffic-light colours). */
function Stars({ n }: { n: number | null }) {
  if (!n) return <span className="meta">No rating</span>;
  return (
    <span className="tracking-tight" aria-label={`${n} out of 5 stars`} title={`${n} of 5`}>
      <span aria-hidden className="text-text">{"★".repeat(n)}</span>
      <span aria-hidden className="text-border-strong opacity-50">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/** A message after an action: one line between hairlines, the colour in its dot. */
function Flash({ tone, msg }: { tone: string; msg: string }) {
  const cls = tone === "danger" ? "is-danger" : tone === "warn" ? "is-warn" : "is-ok";
  return <p role="status" className="notice mb-4"><span className={`status ${cls}`}>{msg}</span></p>;
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const clients = await listClients();
  const client = clients.some((c) => c.id === one(sp.client)) ? one(sp.client) : "";
  const show = one(sp.show) === "all" ? "all" : "unreplied";
  const ratingN = Number(one(sp.rating));
  const rating = Number.isInteger(ratingN) && ratingN >= 1 && ratingN <= 5 ? ratingN : undefined;

  const [rows, stats, conn] = await Promise.all([
    listReviews({ client: client || undefined, show, rating }),
    reviewStats(client || undefined),
    findConnection("google", null),
  ]);
  const more = rows.length > PAGE_SIZE;
  const list = rows.slice(0, PAGE_SIZE);
  const ids = list.map((r) => r.review.id);
  const [drafts, asks] = await Promise.all([draftsForReviews(ids), openAsksForReviews(ids)]);
  const mapped = clients.filter((c) => c.googleLocation).length;

  const qs = new URLSearchParams();
  if (client) qs.set("client", client);
  if (show === "all") qs.set("show", "all");
  if (rating) qs.set("rating", String(rating));
  const returnTo = `/reviews${qs.size ? `?${qs}` : ""}`;
  const msg = one(sp.msg);

  return (
    <>
      <PageHeader
        title="Google reviews"
        subtitle={stats.lastSync ? `Last synced ${relativeTime(stats.lastSync)}` : "Not synced yet"}
        actions={conn ? (
          <form action={syncReviewsAction}>
            <input type="hidden" name="returnTo" value="/reviews" />
            <SubmitButton variant="secondary" pendingLabel="Syncing…">Sync now</SubmitButton>
          </form>
        ) : (
          <LinkButton href="/settings" variant="primary">Connect Google</LinkButton>
        )}
      />

      {msg && <Flash tone={one(sp.tone)} msg={msg} />}
      {conn && conn.status !== "ok" && (
        <Flash tone="warn" msg={`Google connection problem: ${conn.lastError ?? humanize(conn.status)}. Fix it in Settings.`} />
      )}

      <div className="figures mb-8">
        <Stat label="Need a reply" value={<span className={stats.unreplied > 0 ? "text-accent" : undefined}>{stats.unreplied}</span>} />
        <Stat label="Total" value={stats.total} />
        <Stat label="Average" value={stats.avg != null ? `${stats.avg}★` : "—"} />
      </div>

      <form method="get" className="mb-2 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Filter reviews">
        <div className="col-span-2 sm:w-64">
          <label className="label" htmlFor="f-client">Business</label>
          <select id="f-client" name="client" defaultValue={client} className="input">
            <option value="">All businesses</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
          </select>
        </div>
        <div className="sm:w-40">
          <label className="label" htmlFor="f-show">Show</label>
          <select id="f-show" name="show" defaultValue={show} className="input">
            <option value="unreplied">Needs reply</option>
            <option value="all">All reviews</option>
          </select>
        </div>
        <div className="sm:w-36">
          <label className="label" htmlFor="f-rating">Rating</label>
          <select id="f-rating" name="rating" defaultValue={rating ? String(rating) : ""} className="input">
            <option value="">Any</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex gap-2">
          <button className={buttonClass("secondary")}>Apply</button>
          {qs.size > 0 && <Link href="/reviews" className={buttonClass("ghost")}>Clear</Link>}
        </div>
      </form>

      {list.length === 0 ? (
        !conn ? (
          <EmptyState title="Google isn't connected yet">
            Connect Google Business Profile in <Link href="/settings" className="link">Settings</Link>, link each business to its Google listing, then sync.
          </EmptyState>
        ) : mapped === 0 ? (
          <EmptyState title="No business is linked to a Google listing">
            Pick a Google location for each business in <Link href="/settings" className="link">Settings</Link>, then press Sync now.
          </EmptyState>
        ) : stats.total === 0 ? (
          <EmptyState title="No reviews synced yet">Press “Sync now” to pull reviews from Google.</EmptyState>
        ) : show === "unreplied" ? (
          <EmptyState title="Every review has a reply">Nice. Switch to “All reviews” to see past ones.</EmptyState>
        ) : (
          <EmptyState title="No reviews match these filters" />
        )
      ) : (
        <ul className="list is-ruled mt-8">
          {list.map(({ review: r, clientName, clientLocation }) => {
            const draft = drafts.get(r.id);
            const askId = asks.get(r.id);
            return (
              <li key={r.id} className="flex flex-col gap-3 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Stars n={r.rating} />
                    <span className="font-medium">{r.reviewer ?? "Google user"}</span>
                    <span className="meta">{r.createTime ? formatDate(r.createTime) : ""}</span>
                  </div>
                  <Link href={`/clients/${r.clientId}`} className="link-quiet">
                    {clientLocation ? `${clientName} · ${clientLocation}` : clientName}
                  </Link>
                </div>

                {r.comment ? (
                  <p className="max-w-3xl whitespace-pre-line break-words">{r.comment}</p>
                ) : (
                  <p className="meta italic">Rating only, no written review.</p>
                )}

                {r.replyText && (
                  <div className="g-quote max-w-3xl">
                    <p className="mb-1 flex flex-wrap items-baseline gap-x-3">
                      <span className="eyebrow">Our reply</span>
                      {r.replyState && <Status tone={/reject|violat/i.test(r.replyState) ? "danger" : /pending/i.test(r.replyState) ? "warn" : "neutral"} small>{humanize(r.replyState.toLowerCase())}</Status>}
                    </p>
                    <p className="whitespace-pre-line break-words text-muted">{r.replyText}</p>
                  </div>
                )}
                {r.policyViolation && (
                  <p className="status is-danger is-small whitespace-normal">Google flagged the reply: {r.policyViolation}</p>
                )}

                {!r.replyText && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {draft ? (
                      <>
                        <StatusBadge status={draft.status} />
                        <LinkButton href={`/review?draft=${draft.id}`} size="sm">
                          {draft.status === "needs_review" ? "Review draft reply" : "Open draft"}
                        </LinkButton>
                      </>
                    ) : askId ? (
                      <>
                        <Status tone="info" small>Asked Claude</Status>
                        <Link href={`/asks/${askId}`} className="link text-sm">View ask</Link>
                      </>
                    ) : (
                      <form action={askClaudeToReplyAction} className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                        <input type="hidden" name="reviewId" value={r.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <label htmlFor={`note-${r.id}`} className="sr-only">Notes for Claude (optional)</label>
                        <input id={`note-${r.id}`} name="note" placeholder="Optional note for Claude (e.g. offer a free drink)" className="input sm:max-w-sm" />
                        <SubmitButton size="sm" variant="secondary" pendingLabel="Asking…" className="shrink-0">Ask Claude to draft a reply</SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {more && <p className="meta mt-4 border-t border-border pt-3">Showing the newest {PAGE_SIZE}. Filter by business or rating to see older ones.</p>}
    </>
  );
}
