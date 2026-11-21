import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { APP_TZ, today } from "@/lib/dates";
import { fieldsFromDeal, type ContractFields } from "@/lib/contract";
import { getDeal } from "@/lib/ops-deals";
import { listContracts, listContractsWithInvoices } from "@/lib/ops-contracts";
import { contractPrefillFromInvoice } from "@/lib/ops-invoices";
import { isCreatorClient, listClients } from "@/lib/data";
import { LinkButton, PageHeader, Status } from "@/components/ui";
import { ContractBuilder, type PastContract } from "@/components/contract-builder";

export const dynamic = "force-dynamic";

/**
 * The contract generator. ?deal=<id> opens it pre-filled from a deal ("Make contract" on a deal); ?invoice=<id> from an
 * invoice ("Make contract" on an invoice or its done state: business, contact, email, the fee from the main line), and
 * the saved contract links back to that invoice. Past contracts rows show their invoices or the next step
 * (docs/invoicing.md "Contracts and invoices, linked both ways"). People only: no Claude tool reads contracts.
 */
export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const dealId = typeof sp.deal === "string" ? sp.deal : "";
  const invoiceId = typeof sp.invoice === "string" ? sp.invoice.slice(0, 80) : "";
  const t = today();
  // "Make contract" on a deal or an invoice opens this page pre-filled from it.
  const [deal, fromInvoice, clients, past] = await Promise.all([
    dealId ? getDeal(dealId) : null,
    invoiceId ? contractPrefillFromInvoice(invoiceId, { today: t }).catch(() => null) : null,
    listClients({ includeArchived: false }),
    // Invoicing adds each contract's invoices and next step; if that fails, the plain history still shows.
    listContractsWithInvoices(50, { today: t }).catch(() => listContracts()),
  ]);
  const history: PastContract[] = past.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    invoices: "invoices" in c ? c.invoices : [],
    nextSteps: "nextSteps" in c ? c.nextSteps : [],
  }));
  // Suggestions for the business-name box. Two locations of one brand share a name, so de-duplicate.
  const businesses = [...new Set(clients.filter((c) => !isCreatorClient(c)).map((c) => c.name))];
  const initial: Partial<ContractFields> | undefined = fromInvoice ? fromInvoice.fields : deal ? fieldsFromDeal(deal, APP_TZ) : undefined;
  return (
    <>
      <PageHeader
        title="Contracts"
        subtitle="Fill in a few details and download a ready-to-sign PDF. Each download is kept under Past contracts."
        actions={history.length > 0 ? <LinkButton href="#past-contracts" size="sm">Past contracts ({history.length})</LinkButton> : undefined}
      />
      {fromInvoice && (
        <p role="status" className="notice mb-8">
          <Status tone="ink" className="is-wrap">{fromInvoice.note}</Status>
          <Link href={`/invoices/${encodeURIComponent(fromInvoice.invoiceId)}`} className="link">Back to the invoice</Link>
        </p>
      )}
      {invoiceId && !fromInvoice && (
        <p role="status" className="notice mb-8"><Status tone="warn">That invoice wasn&apos;t found, so this starts blank.</Status></p>
      )}
      <ContractBuilder
        key={fromInvoice ? `invoice:${fromInvoice.invoiceId}` : deal?.id ?? "new"}
        today={t}
        businesses={businesses}
        initial={initial}
        dealId={fromInvoice?.dealId ?? deal?.id ?? null}
        invoiceId={fromInvoice?.invoiceId ?? null}
        history={history}
      />
    </>
  );
}
