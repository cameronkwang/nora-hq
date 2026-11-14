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
    <div className="shell">
      <Sidebar
        user={user}
        creator={creator ? toNav(creator) : null}
        businesses={active.map(toNav)}
        inactiveCount={inactiveCount}
        counts={counts}
      />
      {/* .shell-main pads the page (44 / 56 / 64px on desktop; on phones 16px sides and room for the fixed tab bar,
          via --tabbar-h). Content is left-aligned and at most 1080px wide (.shell-page). */}
      <main className="shell-main">
        <div className="shell-page">
          {/* Inbox / Outreach / Insights tabs on their member pages (renders nothing elsewhere). */}
          <SectionTabs counts={{ newAsks: counts.newAsks, needsReview: counts.needsReview }} />
          {children}
        </div>
      </main>
      <LiveRefresh />
    </div>
  );
}
