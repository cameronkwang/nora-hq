import { assigneeFor, requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { blobEnabled } from "@/lib/uploads";
import { AskForm } from "@/components/ask-form";
import { personKey, routesFor } from "@/components/ask-route";
import { PageHeader, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewAskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const clients = await listClients();
  const pre = typeof sp.client === "string" && clients.some((c) => c.id === sp.client) ? sp.client : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New ask" subtitle="Anything at all — a request, an idea, an FYI. Type it like a text; Claude sorts it out." />
      <AskForm
        clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))}
        defaultClientId={pre}
        directUpload={blobEnabled()}
        routes={routesFor(personKey(assigneeFor(user)))}
      />
    </div>
  );
}
