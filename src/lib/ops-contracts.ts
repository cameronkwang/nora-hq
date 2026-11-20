import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { defaultFields, type ContractFields } from "./contract";
import { linkContractToInvoice } from "./ops-invoices";

/**
 * Contract history: every contract Nora downloads is kept here so she can see who got what and re-download it.
 * People only — there is deliberately no Claude (MCP) tool for these, since they hold fees.
 * Linked to invoicing both ways (docs/invoicing.md "Contracts"): a contract made from an invoice ("Make contract",
 * /contracts?invoice=<id>) is saved with invoiceId and links back (lib/ops-invoices linkContractToInvoice); an invoice
 * made from a contract carries contractId. Past contracts rows read their invoices with invoicesForContracts.
 */

const FIELD_KEYS = Object.keys(defaultFields("2000-01-01")) as (keyof ContractFields)[];

const Fields = z
  .record(z.string(), z.unknown())
  .transform((raw) => {
    const out = {} as Record<keyof ContractFields, string>;
    for (const k of FIELD_KEYS) {
      const v = raw[k];
      out[k] = typeof v === "string" ? v.slice(0, 5000) : "";
    }
    if (out.kind !== "monthly") out.kind = "collab";
    return out as ContractFields;
  });

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

export type ContractListItem = Pick<schema.ContractRow, "id" | "kind" | "clientBusiness" | "clientContact" | "agreementDate" | "feeCents" | "dealId" | "createdBy" | "createdAt"> & {
  fields: ContractFields;
};

export async function listContracts(limit = 50): Promise<ContractListItem[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.contracts).orderBy(desc(schema.contracts.createdAt)).limit(limit);
  return rows.map((r) => ({ ...r, fields: Fields.parse(r.fields) }));
}

export async function deleteContract(id: string, actor: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.delete(schema.contracts).where(eq(schema.contracts.id, id)).returning({ business: schema.contracts.clientBusiness });
  if (row) await logActivity({ actor, action: "contract.deleted", entityType: "contract", entityId: id, summary: `Removed a contract for ${row.business} from history` });
}
