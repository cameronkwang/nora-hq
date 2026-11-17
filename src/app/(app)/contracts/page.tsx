import { requireUser } from "@/lib/auth";
import { APP_TZ, today } from "@/lib/dates";
import { fieldsFromDeal } from "@/lib/contract";
import { getDeal } from "@/lib/ops-deals";
import { listContracts } from "@/lib/ops-contracts";
import { isCreatorClient, listClients } from "@/lib/data";
import { LinkButton, PageHeader } from "@/components/ui";
import { ContractBuilder } from "@/components/contract-builder";

export const dynamic = "force-dynamic";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const dealId = typeof sp.deal === "string" ? sp.deal : "";
  // "Make contract" on a deal opens this page pre-filled from it.
  const deal = dealId ? await getDeal(dealId) : null;
  const [clients, past] = await Promise.all([listClients({ includeArchived: false }), listContracts()]);
  const history = past.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
  // Suggestions for the business-name box. Two locations of one brand share a name, so de-duplicate.
  const businesses = [...new Set(clients.filter((c) => !isCreatorClient(c)).map((c) => c.name))];
  return (
    <>
      <PageHeader
        title="Contracts"
        subtitle="Fill in a few details and download a ready-to-sign PDF. Each download is kept under Past contracts."
        actions={history.length > 0 ? <LinkButton href="#past-contracts" size="sm">Past contracts ({history.length})</LinkButton> : undefined}
      />
      <ContractBuilder
        key={deal?.id ?? "new"} today={today()} businesses={businesses} initial={deal ? fieldsFromDeal(deal, APP_TZ) : undefined}
        dealId={deal?.id ?? null}
        history={history}
      />
    </>
  );
}
