import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { isCreatorClient, listClients } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { ContractBuilder } from "@/components/contract-builder";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  await requireUser();
  const clients = await listClients({ includeArchived: false });
  // Suggestions for the business-name box. Two locations of one brand share a name, so de-duplicate.
  const businesses = [...new Set(clients.filter((c) => !isCreatorClient(c)).map((c) => c.name))];
  return (
    <>
      <PageHeader
        title="Contracts"
        subtitle="Fill in a few details and download a ready-to-sign PDF. Nothing here is saved; the contract only exists in the file you download."
      />
      <ContractBuilder today={today()} businesses={businesses} />
    </>
  );
}
