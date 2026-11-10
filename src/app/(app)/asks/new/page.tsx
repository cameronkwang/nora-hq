import { listClients } from "@/lib/data";
import { blobEnabled } from "@/lib/uploads";
import { AskForm } from "@/components/ask-form";
import { PageHeader, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewAskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const clients = await listClients();
  const pre = typeof sp.client === "string" && clients.some((c) => c.id === sp.client) ? sp.client : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New ask" subtitle="Type it like a text. Add photos or videos if you have them." />
      <AskForm clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))} defaultClientId={pre} directUpload={blobEnabled()} />
    </div>
  );
}
