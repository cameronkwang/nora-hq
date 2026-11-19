import Link from "next/link";
import { isCreatorClient, listClients } from "@/lib/data";
import { currentMonth, monthLabel } from "@/lib/dates";
import { EmptyState, PageHeader, ProgressBar, Tag, cx } from "@/components/ui";
import { NewClientLink } from "@/components/onboard-link";
import { clientSummaries } from "./queries";

export const dynamic = "force-dynamic";

function Chevron() {
  return (
    <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ inactive?: string; archived?: string }> }) {
  const sp = await searchParams;
  // ?inactive=1 (old links used ?archived=1). "Inactive" is the UI word for clients.archived.
  const showInactive = sp.inactive === "1" || sp.archived === "1";
  const month = currentMonth();
  const everyone = await listClients({ includeArchived: true });
  // Nora's own workspace isn't a business: it gets its own row above the list instead of a row in it.
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
          <>
            {inactiveCount > 0 && (
              <Link href={showInactive ? "/clients" : "/clients?inactive=1"} className="link-quiet tap-target mr-2 self-center">
                {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
              </Link>
            )}
            <NewClientLink />
          </>
        }
      />

      {/* Nora's row is pinned first; the businesses continue straight under it, so it reads as one list (no second rule). */}
      {creator && (
        <ul className={cx("list is-ruled", clients.length > 0 && "border-b-0")}>
          <li>
            <Link href={`/clients/${creator.id}`} className="row">
              <span className="row-title">
                {creator.name}
                {creator.location && <span className="meta ml-2 font-normal">{creator.location}</span>}
              </span>
              <span className="meta">Own content &amp; collabs</span>
              <Chevron />
            </Link>
          </li>
        </ul>
      )}

      {clients.length === 0 ? (
        <EmptyState title="No businesses yet">
          <Link href="/clients/new" className="link">Add your first client</Link>. A name is enough: it sets up a plan and a short checklist, and Claude does the research.
        </EmptyState>
      ) : (
        <ul className="list is-ruled">
          {clients.map((c) => {
            const s = summaries.get(c.id)!;
            return (
              <li key={c.id}>
                <Link href={`/clients/${c.id}`} className={cx("row biz-row", c.archived && "is-inactive")}>
                  <span className="row-title">
                    {c.name}
                    {c.archived && <Tag>Inactive</Tag>}
                  </span>
                  {/* This month's plan: a thin line of progress and the same thing in words. */}
                  <span className="prog num">
                    {s.target > 0 ? (
                      <>
                        <ProgressBar value={s.done} max={s.target} />
                        <span><b className="text-text">{s.done}</b> of {s.target}</span>
                      </>
                    ) : (
                      <span>{s.items ? "As needed" : "No plan yet"}</span>
                    )}
                  </span>
                  <Chevron />
                  <span className="biz-facts">
                    <span>{c.location ?? "No location set"}</span>
                    <span>{c.instagramHandle ? `IG @${c.instagramHandle}` : "No IG handle"}</span>
                    <span>{c.tiktokHandle ? `TikTok @${c.tiktokHandle}` : "No TikTok handle"}</span>
                    <span>{s.open} open task{s.open === 1 ? "" : "s"}</span>
                    <span>{s.contacted} creator{s.contacted === 1 ? "" : "s"} contacted</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
