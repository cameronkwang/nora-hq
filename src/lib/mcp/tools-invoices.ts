import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpsError } from "@/lib/ops";
import {
  createInvoiceDraft,
  createInvoiceFromDeal,
  customerForClient,
  customerForDeal,
  getInvoice,
  listCustomers,
  listInvoices,
} from "@/lib/ops-invoices";
import { INVOICE_DISPLAY_STATUSES, PAY_WAYS, PAY_WAY_LABEL, PAYMENT_METHOD_LABEL, invoiceTotals, type InvoiceListRow } from "@/lib/invoices-types";

/**
 * Invoices for Claude (docs/invoicing.md "Claude (MCP)"): read invoices and customers, and make a DRAFT invoice when
 * Nora or Cameron asked for one. Never: the link or its token, Stripe ids or fees, payment settings, the next number,
 * saved lines, anything about a contract (contracts are people only), and no tool finalizes (Make PDF), records or
 * deletes a payment, marks paid, voids, deletes, imports or shares an invoice. Ways to pay are Zelle unless a person
 * said otherwise; no way to pay ever adds a fee.
 */

class ToolError extends Error {}

function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined || v === "" ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof ToolError || e instanceof OpsError) return e.message;
  console.error("[mcp] invoice tool error", e instanceof Error ? e.message : e);
  return "Something went wrong in Nora HQ while reading invoices. Try again, or ask Nora or Cameron.";
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: compactJson(await fn()) }] };
  } catch (e) {
    return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const dollars = (cents: number) => (cents / 100).toFixed(2);
/** Where an invoice came from, as Claude may see it: never that it came from a contract (contracts are people only). */
const sourceOut = (s: string) => (s === "claude" ? "drafted by Claude" : s === "contract" ? undefined : s);

const NEVER =
  "Invoices are Nora's money: you never make the PDF / finalize, send, record or delete a payment, mark paid, void or delete an invoice, " +
  "share its link, or change how Nora gets paid. Contracts are people only. Money never goes on Nora's schedule.";

function shapeRow(r: InvoiceListRow) {
  return {
    id: r.id,
    number: r.number ?? "draft",
    customer: r.customerName,
    customer_id: r.customerId,
    status: r.display,
    issue_date: r.issueDate,
    due_date: r.dueDate,
    days_overdue: r.daysOverdue || undefined,
    total: dollars(r.totalCents),
    paid: dollars(r.paidCents),
    balance: dollars(r.balanceCents),
    pay_ways: r.payWays.join(", "),
    deal_id: r.dealId,
    source: sourceOut(r.source),
  };
}

const PayWaysArg = z.array(z.enum(PAY_WAYS)).min(1).max(PAY_WAYS.length).optional()
  .describe(`How this invoice asks to be paid: ${PAY_WAYS.map((w) => `${w} (${PAY_WAY_LABEL[w]})`).join(", ")}. Leave it out (Zelle) unless Nora or Cameron said how this invoice should be paid.`);

export function registerInvoiceTools(server: McpServer) {
  server.registerTool("list_invoices", {
    title: "List invoices",
    description:
      "Nora's invoices, newest first: number (\"0000170\", or draft), customer, status (draft · sent · partially_paid · overdue · paid · void; overdue = past its due date), " +
      "issue and due dates, total, paid and balance in dollars, ways to pay and deal id. Default: everything but void. " + NEVER,
    inputSchema: {
      status: z.enum([...INVOICE_DISPLAY_STATUSES, "open", "all"]).optional().describe("open = sent or partly paid (overdue included). Omit for everything but void."),
      customer_id: z.string().max(80).optional(),
      deal_id: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    annotations: READ,
  }, async ({ status, customer_id, deal_id, limit }) => run(async () => {
    const rows = await listInvoices({ status: status ?? "all", customerId: customer_id, dealId: deal_id, limit: limit ?? 100 });
    return { invoices: rows.map(shapeRow), count: rows.length };
  }));

  server.registerTool("get_invoice", {
    title: "Get an invoice",
    description:
      "One invoice: its lines, totals, notes, ways to pay, payments received (date, amount, method), the customer's name and contact. " +
      "Never its link, Stripe details or anything about a contract. " + NEVER,
    inputSchema: { id: z.string().max(80).describe("Invoice id (starts with inv_).") },
    annotations: READ,
  }, async ({ id }) => run(async () => {
    const d = await getInvoice(id);
    if (!d) throw new ToolError(`No invoice with id "${id}". Use list_invoices.`);
    return {
      id: d.id,
      number: d.number ?? "draft",
      status: d.display,
      days_overdue: d.daysOverdue || undefined,
      customer: { id: d.customer.id, name: d.customer.name, contact: d.customer.contactName, email: d.customer.email, language: d.customer.lang },
      issue_date: d.issueDate,
      due_date: d.dueDate,
      lines: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: dollars(l.unitCents), amount: dollars(l.lineCents) })),
      subtotal: dollars(d.subtotalCents),
      discount: d.discountCents ? `${dollars(d.discountCents)}${d.discountLabel ? ` (${d.discountLabel})` : ""}` : undefined,
      total: dollars(d.totalCents),
      paid: dollars(d.paidCents),
      balance: dollars(d.balanceCents),
      pay_ways: d.payWays.map((w) => PAY_WAY_LABEL[w]).join(", "),
      pay_note: d.payNote,
      notes: d.notes,
      private_note: d.privateNotes,
      payments: d.payments.map((p) => ({ date: p.paidOn, amount: dollars(p.amountCents), method: PAYMENT_METHOD_LABEL[p.method] })),
      deal: d.deal ? { id: d.deal.id, business: d.deal.businessName } : undefined,
      source: sourceOut(d.source),
      view: `/invoices/${d.id}`,
    };
  }));

  server.registerTool("list_customers", {
    title: "List invoice customers",
    description: "Who Nora bills: name, contact, email, phone, the managed business it is (client_id), and what they owe (outstanding, overdue). " + NEVER,
    inputSchema: { q: z.string().max(80).optional().describe("Match the name or contact.") },
    annotations: READ,
  }, async ({ q }) => run(async () => {
    const rows = await listCustomers({ q });
    return {
      customers: rows.map((c) => ({
        id: c.id, name: c.name, contact: c.contactName, email: c.email, phone: c.phone, client_id: c.clientId, language: c.lang,
        invoices: c.invoiceCount, outstanding: dollars(c.outstandingCents), overdue: c.overdueCents ? dollars(c.overdueCents) : undefined,
      })),
    };
  }));

  server.registerTool("create_draft_invoice", {
    title: "Draft an invoice",
    description:
      "Make a DRAFT invoice, only when Nora or Cameron asked for one (in chat or in an ask). Who it's for: exactly one of customer_id, " +
      "client_id (a managed business: its customer is made if needed) or deal_id (a collab deal: with no lines it bills the deal's agreed fee as " +
      "\"Collab: Instagram Reel, TikTok\"; a deal that already has a draft or open invoice returns that one). Lines are what they told you: " +
      "never invent a price, a discount or a due date. Due on receipt unless they gave a due date. Ways to pay: Zelle unless they said how this " +
      "invoice should be paid (pay_ways, plus pay_note for \"custom\"); never a fee or surcharge for any way. The draft has no number until a " +
      "person reviews it and presses Make PDF. " + NEVER,
    inputSchema: {
      customer_id: z.string().max(80).optional(),
      client_id: z.string().max(80).optional().describe("A managed business id (list_clients)."),
      deal_id: z.string().max(80).optional().describe("A collab deal id (list_deals)."),
      lines: z.array(z.object({
        description: z.string().min(1).max(300),
        quantity: z.number().positive().max(10000).optional().describe("Default 1."),
        unit_cents: z.number().int().min(0).max(100_000_000).describe("Price per unit in cents ($550.00 = 55000)."),
      })).max(50).optional().describe("Required unless deal_id is given (then the deal's fee is the line)."),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only if they gave one (YYYY-MM-DD). Default: due on receipt."),
      notes: z.string().max(2000).optional().describe("Printed on the invoice under NOTES. Only what they asked for."),
      pay_ways: PayWaysArg,
      pay_note: z.string().max(200).optional().describe("The line for pay_ways \"custom\", e.g. \"Cash at the shoot is fine\"."),
      ask_id: z.string().max(80).optional().describe("The ask this answers, if any."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => run(async () => {
    const who = [a.customer_id, a.client_id, a.deal_id].filter(Boolean).length;
    if (who !== 1) throw new ToolError("Give exactly one of customer_id, client_id or deal_id.");
    if (a.deal_id && !a.lines?.length && !a.due_date && !a.notes && !a.pay_ways) {
      const r = await createInvoiceFromDeal(a.deal_id, "claude");
      const d = await getInvoice(r.id);
      return { ok: true, id: r.id, created: r.created, status: d?.display ?? "draft", customer: d?.customer.name, total: d ? dollars(d.totalCents) : undefined, view: `/invoices/${r.id}`, note: r.created ? "Draft made. A person reviews it and presses Make PDF." : "This deal already has an invoice: that one is returned, nothing new was made." };
    }
    if (!a.lines?.length) throw new ToolError("Give the lines (description and unit_cents) Nora or Cameron told you.");
    const customer = a.customer_id ? null : a.client_id ? await customerForClient(a.client_id, "claude") : await customerForDeal(a.deal_id!, "claude");
    const items = a.lines.map((l) => ({ description: l.description, quantity: l.quantity ?? 1, unitCents: l.unit_cents }));
    if (invoiceTotals(items).totalCents <= 0) throw new ToolError("The total is $0. Ask for the amounts.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TZ ?? "America/New_York" }).format(new Date());
    const row = await createInvoiceDraft({
      customerId: a.customer_id ?? customer!.id,
      issueDate: a.due_date ? today : null,
      dueDate: a.due_date ?? null,
      items,
      notes: a.notes ?? undefined,
      dealId: a.deal_id ?? null,
      payWays: a.pay_ways,
      payNote: a.pay_note ?? null,
    }, "claude", { source: "claude", askId: a.ask_id ?? null });
    return {
      ok: true, id: row.id, status: "draft", total: dollars(row.totalCents), pay_ways: row.payWays.join(", "), view: `/invoices/${row.id}`,
      note: "Draft made. A person reviews it and presses Make PDF; you can't finalize or send it. If an ask sent you here, update_ask it with this link.",
    };
  }));
}
