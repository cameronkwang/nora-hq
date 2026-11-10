import Link from "next/link";
import { allowedUsers, requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { DRAFT_KINDS } from "@/lib/schema";
import { DraftCard } from "@/components/draft-card";
import { DraftFilters } from "@/components/draft-filters";
import { KIND_LABELS, MANUAL_SEND_KINDS } from "@/components/draft-checks";
import { EmptyState, PageHeader, clientLabel, cx } from "@/components/ui";
import { REVIEW_TABS, getDraft, gmailConnected, listDrafts, loadContexts, tabCounts, type ReviewTab } from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const EMPTY: Record<ReviewTab, { title: string; body: string }> = {
  needs_review: { title: "Nothing to review", body: "You're all caught up. Drop an ask and Claude will draft something for you to approve here." },
  approved: { title: "Nothing waiting to be sent", body: "Approved replies, emails and DMs that need a manual send show up here." },
  sent: { title: "Nothing sent yet", body: "Approved items land here once they're sent or marked sent." },
  rejected: { title: "Nothing sent back", body: "Drafts you send back to Claude wait here until it revises them." },
  failed: { title: "No failures", body: "If an approved item fails to send, it shows up here with the error and a Retry button." },
};

function tabStatusFor(status: string, kind: string): ReviewTab | null {
  if (status === "approved") return (MANUAL_SEND_KINDS as readonly string[]).includes(kind) ? "approved" : null;
  return status as ReviewTab;
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const tabParam = one(sp.tab);
  const tab: ReviewTab = REVIEW_TABS.some((t) => t.key === tabParam) ? (tabParam as ReviewTab) : "needs_review";
  const client = one(sp.client);
  const kind = (DRAFT_KINDS as readonly string[]).includes(one(sp.kind)) ? one(sp.kind) : "";
  const focusId = one(sp.draft);
  const msg = one(sp.msg);
  const tone = one(sp.tone);
  const nextId = one(sp.next);

  const filters = { client: client || undefined, kind: kind || undefined };
  const [clients, counts, focused, gmail] = await Promise.all([
    listClients({ includeArchived: true }),
    tabCounts(filters),
    focusId ? getDraft(focusId) : Promise.resolve(null),
    gmailConnected(),
  ]);
  const drafts = focused ? [focused] : await listDrafts(tab, filters);
  const contexts = await loadContexts(drafts);

  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const clientName = (id: string | null) => (id ? (names.get(id) ?? "Archived business") : "No business");
  const people = new Map(allowedUsers().map((u) => [u.email, u.name]));
  const personName = (actor: string | null) => (!actor ? "someone" : actor === "claude" ? "Claude" : actor === "system" ? "System" : (people.get(actor) ?? actor));

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const base = { tab: tab === "needs_review" ? "" : tab, client, kind, ...over };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/review?${s}` : "/review";
  };
  const returnTo = focused ? `/review?draft=${focused.id}` : qs({});
  const focusedTab = focused ? tabStatusFor(focused.status, focused.kind) : null;

  return (
    <div>
      <PageHeader title="Review queue" subtitle="Everything Claude drafts waits here. Nothing goes out until Cameron or Nora approves it." />

      {msg && (
        <div
          role="status"
          className={cx(
            "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm",
            tone === "danger" ? "bg-danger-soft text-danger" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok",
          )}
        >
          <span>{msg}</span>
          {nextId && !focused && (
            <Link href={`/review?draft=${nextId}`} className="font-semibold underline">
              Open it to copy &amp; send
            </Link>
          )}
        </div>
      )}

      {focused ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <Link href={focusedTab ? qs({ tab: focusedTab === "needs_review" ? "" : focusedTab }) : "/review"} className="text-accent hover:underline">
            ← Back to the queue
          </Link>
        </div>
      ) : (
        <>
          <nav aria-label="Queue" className="relative -mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <ul className="flex min-w-max gap-1 border-b border-border">
              {REVIEW_TABS.map((t) => {
                const active = t.key === tab;
                const n = counts[t.key];
                return (
                  <li key={t.key}>
                    <Link
                      href={qs({ tab: t.key === "needs_review" ? "" : t.key })}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm pointer-coarse:min-h-11",
                        active ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text",
                      )}
                    >
                      {t.label}
                      {n > 0 && (
                        <span className={cx("rounded-full px-1.5 text-xs font-semibold", t.key === "failed" ? "bg-danger-soft text-danger" : t.key === "needs_review" || t.key === "approved" ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>
                          {n}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <DraftFilters
            tab={tab === "needs_review" ? "" : tab}
            client={client}
            kind={kind}
            clients={clients.filter((c) => !c.archived || c.id === client).map((c) => ({ id: c.id, label: clientLabel(c) }))}
            kinds={DRAFT_KINDS.map((k) => ({ id: k, label: KIND_LABELS[k] ?? k }))}
          />
        </>
      )}

      {focusId && !focused && <EmptyState title="That draft doesn't exist anymore">It may have been deleted. <Link href="/review" className="text-accent hover:underline">Go to the queue</Link>.</EmptyState>}

      {!focusId && drafts.length === 0 && (
        <EmptyState title={client || kind ? `${EMPTY[tab].title} for this filter` : EMPTY[tab].title}>
          {EMPTY[tab].body}
          {(client || kind) && (
            <>
              {" "}
              <Link href={qs({ client: "", kind: "" })} className="text-accent hover:underline">Clear filters</Link>
            </>
          )}
        </EmptyState>
      )}

      <div className="flex flex-col gap-4">
        {drafts.map((d) => (
          <DraftCard
            key={d.id}
            draft={d}
            ctx={contexts.get(d.id) ?? {}}
            clientName={clientName}
            personName={personName}
            returnTo={returnTo}
            gmailConnected={gmail}
            highlight={!!focused}
          />
        ))}
      </div>
      {!focused && drafts.length >= 100 && <p className="mt-4 text-center text-xs text-muted">Showing the first 100. Filter by business or type to see more.</p>}
    </div>
  );
}
