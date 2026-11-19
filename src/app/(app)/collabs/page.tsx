import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { collabCounts, listCollabRequests } from "@/lib/ops-collab";
import type { CollabRequestStatus } from "@/lib/schema";
import { COLLAB_STATUS_LABEL, CollabComp, CollabShareCard, CollabTypeChips } from "@/components/collab-bits";
import { Count, EmptyState, PageHeader } from "@/components/ui";
import { collabFormUrl } from "./url";

export const dynamic = "force-dynamic";
export const metadata = { title: "Collab requests" };

const TABS: Array<{ key: CollabRequestStatus; empty: string }> = [
  { key: "new", empty: "No new requests. Share your form and they’ll land here." },
  { key: "reviewing", empty: "Nothing in review." },
  { key: "accepted", empty: "No accepted collabs yet." },
  { key: "declined", empty: "Nothing declined." },
];
const SPAM = { key: "spam" as const, empty: "No spam. Nice." };

export default async function CollabsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const asked = typeof sp.tab === "string" ? sp.tab : "new";
  const counts = await collabCounts();
  const tabs = counts.spam > 0 || asked === "spam" ? [...TABS, SPAM] : TABS;
  const tab = tabs.find((t) => t.key === asked) ?? TABS[0];
  const [rows, url] = await Promise.all([listCollabRequests(tab.key), collabFormUrl()]);
  const now = new Date();

  return (
    <>
      <PageHeader title="Collab requests" subtitle="Businesses asking to work with Nora, from the public form." />

      <div className="cols mt-0">
        <div className="min-w-0">
          <nav aria-label="Collab request lists" className="tabs mb-1 overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={t.key === "new" ? "/collabs" : `/collabs?tab=${t.key}`}
                aria-current={t.key === tab.key ? "page" : undefined}
                className="flex-none"
              >
                {COLLAB_STATUS_LABEL[t.key]}
                {counts[t.key] > 0 && (t.key === "new" ? <Count n={counts[t.key]} /> : <span className="meta num font-normal">{counts[t.key]}</span>)}
              </Link>
            ))}
          </nav>

          {rows.length === 0 ? (
            <EmptyState title={tab.empty} />
          ) : (
            <ul className="list">
              {rows.map((r) => (
                <li key={r.id} className="g-row">
                  <Link href={`/collabs/${r.id}`} className="row-title">
                    {r.businessName}
                    {r.city && <span className="font-normal text-muted"> · {r.city}</span>}
                  </Link>
                  <time dateTime={r.createdAt.toISOString()} className="end meta">{relativeTime(r.createdAt, now)}</time>
                  <div className="more flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <CollabTypeChips types={r.collabType} />
                    <CollabComp compensation={r.compensation} budget={r.budget} />
                    {r.timeline && r.timeline !== "Not given" && <span>{r.timeline}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside>
          <CollabShareCard url={url} />
        </aside>
      </div>
    </>
  );
}
