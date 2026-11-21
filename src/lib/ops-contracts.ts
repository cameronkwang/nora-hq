import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { readContractFields, type ContractFields } from "./contract";
import { getSavedItems, invoicesForContracts, linkContractToInvoice } from "./ops-invoices";
import { contractNextSteps, type ContractInvoiceRef, type NextStep } from "./invoices-types";
import { today as todayNY } from "./dates";

/**
 * Contract history: every contract Nora downloads is kept here so she can see who got what and re-download it.
 * People only — there is deliberately no Claude (MCP) tool for these, since they hold fees.
 * Linked to invoicing both ways (docs/invoicing.md "Contracts"): a contract made from an invoice ("Make contract",
 * /contracts?invoice=<id>) is saved with invoiceId and links back (lib/ops-invoices linkContractToInvoice); an invoice
 * made from a contract carries contractId. Past contracts rows read their invoices and next step with
 * listContractsWithInvoices (or invoicesForContracts + invoices-types contractNextSteps).
 */

const Fields = z.record(z.string(), z.unknown()).transform((raw) => readContractFields(raw));

function feeCents(fee: string): number | null {
  const n = Number(String(fee).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export async function saveContract(input: { fields: unknown; dealId?: string | null; invoiceId?: string | null }, actor: string): Promise<string> {
  const fields = Fields.parse(input.fields);
  const db = await getDb();
  let dealId: string | null = null;
  if (input.dealId) {
    const [d] = await db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.id, input.dealId));
    dealId = d?.id ?? null;
  }
  const id = newId("ctr_");
  const business = fields.clientBusiness.trim() || "Unnamed client";
  await db.insert(schema.contracts).values({
    id,
    kind: fields.kind,
    clientBusiness: business,
    clientContact: fields.clientContact.trim() || null,
    agreementDate: /^\d{4}-\d{2}-\d{2}$/.test(fields.agreementDate) ? fields.agreementDate : null,
    feeCents: feeCents(fields.fee),
    dealId,
    fields,
    createdBy: actor,
  });
  // No amount in the activity log: it's visible to everyone and to Claude's briefing.
  await logActivity({ actor, action: "contract.downloaded", entityType: "contract", entityId: id, summary: `Made a contract for ${business}` });
  // Made from an invoice: the invoice now shows this contract, and the contract the invoice's customer.
  if (input.invoiceId) await linkContractToInvoice(id, input.invoiceId, actor);
  return id;
}

export type ContractListItem = Pick<schema.ContractRow, "id" | "kind" | "clientBusiness" | "clientContact" | "agreementDate" | "feeCents" | "dealId" | "customerId" | "createdBy" | "createdAt"> & {
  fields: ContractFields;
};

export async function listContracts(limit = 50): Promise<ContractListItem[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.contracts).orderBy(desc(schema.contracts.createdAt)).limit(limit);
  return rows.map((r) => ({ ...r, fields: Fields.parse(r.fields) }));
}

/**
 * Past contracts rows with what invoicing knows about each: its invoices ("0000170 · Paid", oldest first), whether it
 * already bills monthly (a retainer), and its one-tap next step ("Make invoice", "Make deposit invoice", "Invoice the
 * rest", "Invoice this month", "Set up monthly invoices"). Three reads, in parallel after the first.
 */
export async function listContractsWithInvoices(limit = 50, opts: { today?: string } = {}): Promise<Array<ContractListItem & { invoices: ContractInvoiceRef[]; hasRetainer: boolean; nextSteps: NextStep[] }>> {
  const t = opts.today ?? todayNY();
  const list = await listContracts(limit);
  if (!list.length) return [];
  const ids = list.map((c) => c.id);
  const db = await getDb();
  const [byContract, retainers, savedItems] = await Promise.all([
    invoicesForContracts(ids, { today: t }),
    db.select({ contractId: schema.retainers.contractId, lastRunMonth: schema.retainers.lastRunMonth }).from(schema.retainers).where(inArray(schema.retainers.contractId, ids)),
    getSavedItems(),
  ]);
  const retainerMonth = new Map(retainers.map((r) => [r.contractId, r.lastRunMonth]));
  return list.map((c) => {
    const invoices = byContract[c.id] ?? [];
    const hasRetainer = retainerMonth.has(c.id);
    return { ...c, invoices, hasRetainer, nextSteps: contractNextSteps({ id: c.id, kind: c.kind, fields: c.fields }, invoices, { hasRetainer, retainerMonth: retainerMonth.get(c.id) ?? null, savedItems, today: t }) };
  });
}

export async function deleteContract(id: string, actor: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.delete(schema.contracts).where(eq(schema.contracts.id, id)).returning({ business: schema.contracts.clientBusiness });
  if (row) await logActivity({ actor, action: "contract.deleted", entityType: "contract", entityId: id, summary: `Removed a contract for ${row.business} from history` });
}
