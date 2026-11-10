import { requireUser } from "@/lib/auth";
import { listClients, navCounts } from "@/lib/data";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [clients, counts] = await Promise.all([listClients(), navCounts()]);
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        user={user}
        clients={clients.map((c) => ({ id: c.id, name: c.name, location: c.location }))}
        counts={counts}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
