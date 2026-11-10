import Link from "next/link";
import { listClients } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, ProgressBar, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { createClientAction } from "./actions";
import { clientSummaries } from "./queries";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const month = currentMonth();
  const all = await listClients({ includeArchived: true });
  const archivedCount = all.filter((c) => c.archived).length;
  const clients = showArchived ? all : all.filter((c) => !c.archived);
  const summaries = await clientSummaries(clients.map((c) => c.id), month);

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle={`${clients.filter((c) => !c.archived).length} active · progress for ${monthLabel(month)}`}
        actions={
          archivedCount > 0 ? (
            <Link href={showArchived ? "/clients" : "/clients?archived=1"} className="text-sm text-muted underline-offset-2 hover:text-text hover:underline">
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {clients.length === 0 ? (
            <EmptyState title="No businesses yet">Add your first one with the form on this page.</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
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
                        {c.archived && <Badge>Archived</Badge>}
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

        <Card title="Add business">
          <ActionForm action={createClientAction} className="flex flex-col gap-3" ariaLabel="Add business">
            <div>
              <label className="label" htmlFor="new-name">Name</label>
              <input id="new-name" name="name" required className="input" placeholder="e.g. Poke Bros" autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="new-location">Location</label>
              <input id="new-location" name="location" className="input" placeholder="e.g. Richmond" autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="new-brand">Brand group <span className="font-normal">(optional)</span></label>
              <input id="new-brand" name="brand" className="input" placeholder="Same name for every location" autoComplete="off" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="new-ig">Instagram</label>
                <input id="new-ig" name="instagramHandle" className="input" placeholder="@handle" autoComplete="off" autoCapitalize="none" />
              </div>
              <div>
                <label className="label" htmlFor="new-tt">TikTok</label>
                <input id="new-tt" name="tiktokHandle" className="input" placeholder="@handle" autoComplete="off" autoCapitalize="none" />
              </div>
            </div>
            <p className="text-xs text-muted">Starts with a default monthly plan you can edit on its settings page.</p>
            <SubmitButton pendingLabel="Adding…">Add business</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
