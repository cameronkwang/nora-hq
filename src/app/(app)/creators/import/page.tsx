import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { CreatorImport } from "@/components/creator-import";
import { PageHeader, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ImportCreatorsPage() {
  await requireUser();
  const clients = await listClients();
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/creators" className="text-muted hover:underline">← Creators</Link>
      </p>
      <PageHeader title="Import creators" subtitle="Bring in a list from Google Sheets or a CSV. You’ll see exactly what changes before anything is saved." />
      <CreatorImport clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))} />
    </>
  );
}
