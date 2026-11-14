import Link from "next/link";
import { isCreatorClient, listClients } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/dates";
import { Badge, EmptyState, PageHeader, ProgressBar, cx } from "@/components/ui";
import { NewClientLink } from "@/components/onboard-link";
import { clientSummaries } from "./queries";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ inactive?: string; archived?: string }> }) {
  const sp = await searchParams;
  // ?inactive=1 (old links used ?archived=1). "Inactive" is the UI word for clients.archived.
  const showInactive = sp.inactive === "1" || sp.archived === "1";
  const month = currentMonth();
  const everyone = await listClients({ includeArchived: true });
  // Nora's own workspace isn't a business: it gets a pinned link above the grid instead of a card.
  const creator = everyone.find((c) => isCreatorClient(c)) ?? null; // pinned even if inactive
  const all = everyone.filter((c) => !isCreatorClient(c));
  const inactiveCount = all.filter((c) => c.archived).length;
  // Showing inactive: active ones first, then the inactive ones.
  const clients = showInactive ? [...all.filter((c) => !c.archived), ...all.filter((c) => c.archived)] : all.filter((c) => !c.archived);
  const summaries = await clientSummaries(clients.map((c) => c.id), month);

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle={`${all.length - inactiveCount} active${showInactive ? ` · ${inactiveCount} inactive` : ""} · progress for ${monthLabel(month)}`}
        actions={
          <div className="flex items-center gap-3">
            {inactiveCount > 0 && (
              <Link href={showInactive ? "/clients" : "/clients?inactive=1"} className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-2 hover:text-text hover:underline">
                {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
              </Link>
            )}
            <NewClientLink />
          </div>
        }
      />

      <div>
        <div className="flex flex-col gap-3">
          {creator && (
            <Link
              href={`/clients/${creator.id}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm transition hover:border-accent"
            >
              <span className="min-w-0">
                <span className="font-semibold text-accent">{creator.name}</span>{" "}
                <span className="text-muted">· {creator.location ?? "own content"}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-accent">Own content &amp; collabs →</span>
            </Link>
          )}
          {clients.length === 0 ? (
            <EmptyState title="No businesses yet">
              <Link href="/clients/new" className="text-accent hover:underline">Add your first client</Link> — a name is enough. It sets up a plan and a short checklist, and Claude does the research.
            </EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {clients.map((c) => {
                const s = summaries.get(c.id)!;
                const pct = s.target > 0 ? Math.round((s.done / s.target) * 100) : 0;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/clients/${c.id}`}
                      className={cx("block h-full rounded-xl border border-border bg-surface p-4 transition hover:border-accent", c.archived && "opacity-70")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{c.name}</p>
                          <p className="truncate text-sm text-muted">{c.location ?? "No location set"}</p>
                        </div>
                        {c.archived && <Badge>Inactive</Badge>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {c.instagramHandle ? <span className="text-ig">IG @{c.instagramHandle}</span> : <span className="text-muted">No IG handle</span>}
                        {c.tiktokHandle ? <span className="text-tt">TikTok @{c.tiktokHandle}</span> : <span className="text-muted">No TikTok handle</span>}
                      </div>
                      <div className="mt-4">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-muted">This month&apos;s plan</span>
                          <span className="font-medium tabular-nums">
                            {s.target > 0 ? `${s.done} / ${s.target} · ${pct}%` : s.items ? "As needed" : "No plan yet"}
                          </span>
                        </div>
                        <ProgressBar value={s.done} max={s.target} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                        <span>{s.open} open task{s.open === 1 ? "" : "s"}</span>
                        <span aria-hidden>·</span>
                        <span>{s.contacted} creator{s.contacted === 1 ? "" : "s"} contacted</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
