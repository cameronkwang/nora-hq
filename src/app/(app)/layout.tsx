import { requireUser } from "@/lib/auth";
import { getCreatorClient, isCreatorClient, listClients, navCounts } from "@/lib/data";
import { Sidebar } from "@/components/sidebar";
import { LiveRefresh } from "@/components/live-refresh";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [active, counts] = await Promise.all([listClients(), navCounts()]);
  // Nora's workspace is always pinned (it's the only nav route to her stats and collab inbox), even if it was archived.
  const creator = active.some(isCreatorClient) ? null : await getCreatorClient();
  const clients = creator ? [creator, ...active] : active;
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        user={user}
        clients={clients.map((c) => ({ id: c.id, name: c.name, location: c.location }))}
        counts={counts}
      />
      {/* On phones the bottom tab bar is fixed; --tabbar-h keeps the last row of content above it. */}
      <main className="min-w-0 flex-1 pt-5 pb-[calc(var(--tabbar-h)_+_1.5rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-8 md:py-8 xl:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
      <LiveRefresh />
    </div>
  );
}
