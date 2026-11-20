import { assigneeFor, requireUser, seesDrafts } from "@/lib/auth";
import { isCreatorClient, listClients, navCounts } from "@/lib/data";
import { Sidebar } from "@/components/sidebar";
import { SectionTabs } from "@/components/section-tabs";
import { LiveRefresh } from "@/components/live-refresh";
import { reelsToPostCount } from "@/lib/ops-schedule";
import { unseenDeliveries } from "@/lib/ops-deliveries";
import { personKey } from "@/components/ask-route";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [everyone, baseCounts, reelsOwed, delivered] = await Promise.all([
    listClients({ includeArchived: true }),
    navCounts({ assignee: assigneeFor(user) }),
    reelsToPostCount(),
    unseenDeliveries(personKey(assigneeFor(user))),
  ]);
  const drafts = seesDrafts(user);
  // Nora never sees the review queue, so her Inbox badge counts asks (and anything newly delivered to her) only.
  const counts = { ...baseCounts, needsReview: drafts ? baseCounts.needsReview : 0, reelsOwed, delivered };
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
        phoneTab={assigneeFor(user) === "cameron" ? "tasks" : "calendar"}
      />
      {/* .shell-main pads the page (44 / 56 / 64px on desktop; on phones 16px sides and room for the fixed tab bar,
          via --tabbar-h). Content is left-aligned and at most 1080px wide (.shell-page). */}
      <main className="shell-main">
        <div className="shell-page">
          {/* Inbox / Outreach / Insights tabs on their member pages (renders nothing elsewhere). */}
          <SectionTabs counts={{ newAsks: counts.newAsks, needsReview: counts.needsReview, delivered: counts.delivered }} hideReview={!drafts} />
          {children}
        </div>
      </main>
      <LiveRefresh />
    </div>
  );
}
