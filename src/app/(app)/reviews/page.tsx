import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/dates";
import { findConnection } from "@/lib/integrations/connections";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatusBadge, buttonClass, clientLabel, cx, humanize } from "@/components/ui";
import { SubmitButton } from "@/components/client-form";
import { syncReviewsAction } from "../settings/actions";
import { askClaudeToReplyAction } from "./actions";
import { PAGE_SIZE, draftsForReviews, listReviews, openAsksForReviews, reviewStats } from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Stars({ n }: { n: number | null }) {
  if (!n) return <span className="text-xs text-muted">No rating</span>;
  return (
    <span className="text-sm tracking-tight" aria-label={`${n} out of 5 stars`} title={`${n} of 5`}>
      <span aria-hidden className={n <= 2 ? "text-danger" : n === 3 ? "text-warn" : "text-ok"}>{"★".repeat(n)}</span>
      <span aria-hidden className="text-border">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function Flash({ tone, msg }: { tone: string; msg: string }) {
  const cls = tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : tone === "warn" ? "border-warn/30 bg-warn-soft text-warn" : "border-ok/30 bg-ok-soft text-ok";
  return <div role="status" className={cx("mb-4 rounded-lg border px-4 py-3 text-sm", cls)}>{msg}</div>;
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
        <Flash tone="warn" msg={`Google connection problem: ${conn.lastError ?? humanize(conn.status)} — fix it in Settings.`} />
      )}

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Need a reply" value={stats.unreplied} />
        <Stat label="Total" value={stats.total} />
        <Stat label="Average" value={stats.avg != null ? `${stats.avg}★` : "—"} />
      </div>

      <form method="get" className="mb-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Filter reviews">
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
          <button className={buttonClass("primary")}>Apply</button>
          {qs.size > 0 && <Link href="/reviews" className={buttonClass("ghost")}>Clear</Link>}
        </div>
      </form>

      {list.length === 0 ? (
        !conn ? (
          <EmptyState title="Google isn't connected yet">
            Connect Google Business Profile in <Link href="/settings" className="underline">Settings</Link>, link each business to its Google listing, then sync.
          </EmptyState>
        ) : mapped === 0 ? (
          <EmptyState title="No business is linked to a Google listing">
            Pick a Google location for each business in <Link href="/settings" className="underline">Settings</Link>, then press Sync now.
          </EmptyState>
        ) : stats.total === 0 ? (
          <EmptyState title="No reviews synced yet">Press “Sync now” to pull reviews from Google.</EmptyState>
        ) : show === "unreplied" ? (
          <EmptyState title="Every review has a reply">Nice. Switch to “All reviews” to see past ones.</EmptyState>
        ) : (
          <EmptyState title="No reviews match these filters" />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map(({ review: r, clientName, clientLocation }) => {
            const draft = drafts.get(r.id);
            const askId = asks.get(r.id);
            return (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <Stars n={r.rating} />
                        <span className="font-medium">{r.reviewer ?? "Google user"}</span>
                        <span className="text-xs text-muted">{r.createTime ? formatDate(r.createTime) : ""}</span>
                      </div>
                      <Link href={`/clients/${r.clientId}`} className="text-xs text-muted hover:underline">
                        {clientLocation ? `${clientName} · ${clientLocation}` : clientName}
                      </Link>
                    </div>

                    {r.comment ? (
                      <p className="whitespace-pre-line break-words text-sm">{r.comment}</p>
                    ) : (
                      <p className="text-sm italic text-muted">Rating only — no written review.</p>
                    )}

                    {r.replyText && (
                      <div className="rounded-lg border-l-2 border-accent bg-surface-2 px-3 py-2">
                        <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
                          Our reply
                          {r.replyState && <Badge tone={/reject|violat/i.test(r.replyState) ? "danger" : /pending/i.test(r.replyState) ? "warn" : "neutral"}>{humanize(r.replyState.toLowerCase())}</Badge>}
                        </p>
                        <p className="whitespace-pre-line break-words text-sm">{r.replyText}</p>
                      </div>
                    )}
                    {r.policyViolation && (
                      <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">Google flagged the reply: {r.policyViolation}</p>
                    )}

                    {!r.replyText && (
                      <div className="flex flex-wrap items-center gap-2">
                        {draft ? (
                          <>
                            <StatusBadge status={draft.status} />
                            <LinkButton href={`/review?draft=${draft.id}`} size="sm" variant="primary">
                              {draft.status === "needs_review" ? "Review draft reply" : "Open draft"}
                            </LinkButton>
                          </>
                        ) : askId ? (
                          <>
                            <Badge tone="info">Asked Claude</Badge>
                            <Link href={`/asks/${askId}`} className="text-xs text-muted underline">View ask</Link>
                          </>
                        ) : (
                          <form action={askClaudeToReplyAction} className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                            <input type="hidden" name="reviewId" value={r.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <label htmlFor={`note-${r.id}`} className="sr-only">Notes for Claude (optional)</label>
                            <input id={`note-${r.id}`} name="note" placeholder="Optional note for Claude (e.g. offer a free drink)" className="input sm:max-w-sm" />
                            <SubmitButton size="sm" pendingLabel="Asking…" className="shrink-0">Ask Claude to draft a reply</SubmitButton>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {more && <p className="mt-4 text-center text-xs text-muted">Showing the newest {PAGE_SIZE}. Filter by business or rating to see older ones.</p>}
    </>
  );
}
