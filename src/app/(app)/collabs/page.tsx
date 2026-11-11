import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { collabCounts, listCollabRequests } from "@/lib/ops-collab";
import type { CollabRequestStatus } from "@/lib/schema";
import { COLLAB_STATUS_LABEL, CollabComp, CollabShareCard, CollabTypeChips } from "@/components/collab-bits";
import { EmptyState, PageHeader, cx } from "@/components/ui";
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <nav aria-label="Collab request lists" className="relative -mx-4 mb-4 overflow-x-auto px-4">
            <div className="flex min-w-max gap-1 rounded-lg bg-surface-2 p-1 text-sm">
              {tabs.map((t) => (
                <Link
                  key={t.key}
                  href={t.key === "new" ? "/collabs" : `/collabs?tab=${t.key}`}
                  aria-current={t.key === tab.key ? "page" : undefined}
                  className={cx(
                    "inline-flex items-center rounded-md px-3 py-1.5 font-medium pointer-coarse:min-h-11",
                    t.key === tab.key ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
                  )}
                >
                  {COLLAB_STATUS_LABEL[t.key]}
                  {counts[t.key] > 0 && <span className="ml-1.5 text-xs tabular-nums text-muted">{counts[t.key]}</span>}
                </Link>
              ))}
            </div>
          </nav>

          {rows.length === 0 ? (
            <EmptyState title={tab.empty} />
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/collabs/${r.id}`}
                    className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate font-semibold">
                        {r.businessName}
                        {r.city && <span className="font-normal text-muted"> · {r.city}</span>}
                      </p>
                      <time dateTime={r.createdAt.toISOString()} className="shrink-0 text-xs text-muted">{relativeTime(r.createdAt, now)}</time>
                    </div>
                    <CollabTypeChips types={r.collabType} className="mt-2" />
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <CollabComp compensation={r.compensation} budget={r.budget} />
                      {r.timeline && r.timeline !== "Not given" && <span className="text-sm text-muted">{r.timeline}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="space-y-4">
          <CollabShareCard url={url} />
        </aside>
      </div>
    </>
  );
}
