import { assigneeFor, requireUser } from "@/lib/auth";
import { isCreatorClient, listClients, navCounts } from "@/lib/data";
import { Sidebar } from "@/components/sidebar";
import { SectionTabs } from "@/components/section-tabs";
import { LiveRefresh } from "@/components/live-refresh";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [everyone, counts] = await Promise.all([listClients({ includeArchived: true }), navCounts({ assignee: assigneeFor(user) })]);
  // Nora's workspace is always pinned (even if it was archived); the business list shows active businesses only.
  const creator = everyone.find(isCreatorClient) ?? null;
  const businesses = everyone.filter((c) => !isCreatorClient(c));
  const active = businesses.filter((c) => !c.archived);
  const inactiveCount = businesses.length - active.length;
  const toNav = (c: (typeof everyone)[number]) => ({ id: c.id, name: c.name, location: c.location, kind: c.kind });
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        user={user}
        creator={creator ? toNav(creator) : null}
        businesses={active.map(toNav)}
        inactiveCount={inactiveCount}
        counts={counts}
      />
      {/* On phones the bottom tab bar is fixed; --tabbar-h keeps the last row of content above it. */}
      <main className="min-w-0 flex-1 pt-5 pb-[calc(var(--tabbar-h)_+_1.5rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-8 md:py-8 xl:px-10">
        <div className="mx-auto max-w-7xl">
          {/* Inbox / Outreach / Insights tabs on their member pages (renders nothing elsewhere). */}
          <SectionTabs counts={{ newAsks: counts.newAsks, needsReview: counts.needsReview }} />
          {children}
        </div>
      </main>
      <LiveRefresh />
    </div>
  );
}
