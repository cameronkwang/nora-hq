import "server-only";
import { z } from "zod";
import { schema } from "./db";
import { OpsError } from "./ops";
import { cleanBlock, cleanLine } from "./ops-collab";
import {
  MANUAL_PAYMENT_METHODS,
  MAX_INVOICE_CENTS,
  MAX_INVOICE_ITEMS,
  MAX_TERMS_DAYS,
  RETAINER_MAX_DAY,
  isQuantity,
  type CustomerDetail,
  type CustomerSummary,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
  type InvoiceDetail,
  type InvoiceItem,
  type InvoiceListFilter,
  type InvoiceListRow,
  type InvoiceMessages,
  type InvoiceReminderLines,
  type InvoiceReport,
  type InvoiceSettings,
  type InvoiceSource,
  type PublicInvoiceState,
  type RunRetainersResult,
  type StripePaymentRecord,
} from "./invoices-types";

/**
 * Invoicing ops: customers, invoices, payments, retainers, reports, settings, the customer link and the Skynova
 * import. Same conventions as lib/ops: zod-validated input, `actor` is a user email, "claude", "system" or
 * "public", every write logs activity. The design is docs/invoicing.md; shared shapes are lib/invoices-types.
 *
 * Who can do what (enforced HERE, not only in the UI):
 * - People (Nora and Cameron, both): everything below. Invoicing is Nora's money and both of them use it.
 * - Claude: reads (listInvoices, getInvoice, listCustomers, getCustomer) and createInvoiceDraft with source "claude"
 *   when a person asked (customerForClient may make the customer row for a managed business). Claude NEVER sends,
 *   records or deletes a payment, marks paid, voids, deletes, edits a sent invoice, makes or copies a link, imports,
 *   or changes payment settings.
 * - "system": runRetainers (drafts only), recordStripePayment (from the verified Stripe webhook).
 * - "public": getInvoiceByToken / markInvoiceViewed (the /i/<token> page).
 *
 * Neon over HTTP has no interactive transactions: anything that must be atomic is ONE statement (see the SQL in
 * docs/invoicing.md "Atomic statements": send, payment recompute, retainer claim, Stripe event claim).
 * Nothing here is ever on Nora's schedule, and no card or bank number, password or Stripe key is stored.
 *
 * STATUS: interface only (design and schema step). Every function below has its final signature and throws
 * "not implemented" until the core builder fills it in.
 */

const notImplemented = (fn: string): never => {
  throw new OpsError(`Invoicing is not built yet (${fn}).`);
};

/* ───────────────────────── Input ───────────────────────── */

const line = (max: number) => z.preprocess((v) => (v == null ? v : cleanLine(v) || null), z.string().max(max).nullish());
const block = (max: number) => z.preprocess((v) => (v == null ? v : cleanBlock(v) || null), z.string().max(max).nullish());
const ymd = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20.").nullish());
const ymdRequired = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20.");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");
const email = z.preprocess((v) => (v == null ? v : cleanLine(v).toLowerCase() || null), z.email("That email doesn't look right.").max(200).nullish());
const cents = (msg: string) => z.number().int(msg).min(0, msg).max(MAX_INVOICE_CENTS, "That amount is too large.");
const id = z.string().min(1).max(80);

export const CustomerInput = z.object({
  name: z.preprocess(cleanLine, z.string().min(1, "Add the customer's name.").max(160)),
  contactName: line(120),
  email,
  phone: line(40),
  billingAddress: block(500),
  notes: block(3000),
  clientId: id.nullish(),
  lang: z.enum(schema.INTAKE_LANGS).nullish(),
});
export type CustomerInputT = z.input<typeof CustomerInput>;
export const CustomerPatch = CustomerInput.partial();

export const InvoiceItemInput = z.object({
  description: z.preprocess(cleanLine, z.string().min(1, "Describe the line.").max(300)),
  quantity: z.number().refine(isQuantity, "Quantity: more than 0, up to 2 decimals."),
  unitCents: cents("Price: use dollars, like 600 or 1250.50."),
}) satisfies z.ZodType<InvoiceItem>;

export const InvoiceDraftInput = z.object({
  customerId: id,
  /** Empty on a draft = "the day it is sent". */
  issueDate: ymd,
  /** Empty on a draft = issue date + termsDays. */
  dueDate: ymd,
  termsDays: z.number().int().min(0).max(MAX_TERMS_DAYS).optional(), // no zod default: .partial() would re-apply it
  items: z.array(InvoiceItemInput).min(1, "Add at least one line.").max(MAX_INVOICE_ITEMS),
  discountCents: cents("Discount: use dollars.").optional(),
  discountLabel: line(80),
  notes: block(2000),
  privateNotes: block(2000),
  dealId: id.nullish(),
  lang: z.enum(schema.INTAKE_LANGS).nullish(),
});
export type InvoiceDraftInputT = z.input<typeof InvoiceDraftInput>;
/** Editing: a draft may change anything (customer included); a sent, unpaid invoice everything but the customer. */
export const InvoicePatch = InvoiceDraftInput.partial();
export type InvoicePatchT = z.input<typeof InvoicePatch>;

export const PaymentInput = z.object({
  amountCents: z.number().int().min(1, "Enter the amount received.").max(MAX_INVOICE_CENTS),
  paidOn: ymdRequired,
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: line(120), // a check number or confirmation code; never a card or bank number
  note: line(300),
});
export type PaymentInputT = z.input<typeof PaymentInput>;

export const RetainerInput = z.object({
  customerId: id,
  description: z.preprocess(cleanLine, z.string().min(1, "Say what the retainer is for.").max(200)),
  amountCents: z.number().int().min(1, "Enter the monthly amount.").max(MAX_INVOICE_CENTS),
  dayOfMonth: z.number().int().min(1).max(RETAINER_MAX_DAY, `Pick a day from 1 to ${RETAINER_MAX_DAY}.`),
  startMonth: month.nullish(),
  active: z.boolean().optional(),
});
export type RetainerInputT = z.input<typeof RetainerInput>;
export const RetainerPatch = RetainerInput.omit({ customerId: true }).partial();

/** Every key optional: saveInvoiceSettings merges what it is given into the stored row. */
export const InvoiceSettingsInput = z.object({
  line: line(200),
  fromName: line(120),
  fromEmail: email,
  fromPhone: line(40),
  fromAddress: block(300),
  zelle: line(120),
  zelleName: line(120),
  checkPayee: line(120),
  checkAddress: block(300),
  venmo: line(80),
  paypal: line(200),
  achEnabled: z.boolean(),
  cardEnabled: z.boolean(),
  termsDays: z.number().int().min(0).max(MAX_TERMS_DAYS),
  footer: block(500),
}).partial();
export type InvoiceSettingsInputT = z.input<typeof InvoiceSettingsInput>;

/* ───────────────────────── Customers ───────────────────────── */

/** People only. nameKey is derived; a clientId must be a managed business (never Nora's creator workspace). */
export async function createCustomer(input: CustomerInputT, actor: string): Promise<schema.Customer> {
  void input; void actor;
  return notImplemented("createCustomer");
}

export async function updateCustomer(id: string, patch: z.input<typeof CustomerPatch>, actor: string): Promise<schema.Customer> {
  void id; void patch; void actor;
  return notImplemented("updateCustomer");
}

/** Hide (or bring back) a customer in lists. Their invoices stay. People only. */
export async function setCustomerArchived(id: string, archived: boolean, actor: string): Promise<schema.Customer> {
  void id; void archived; void actor;
  return notImplemented("setCustomerArchived");
}

/** People only; refuses a customer who has any invoice (archive instead). Their retainers go with them. */
export async function deleteCustomer(id: string, actor: string): Promise<void> {
  void id; void actor;
  return notImplemented("deleteCustomer");
}

/**
 * The customer row for a managed business, made from its clients row the first time (source "client",
 * name, ownerEmail as email). People or Claude. One customer per client (customers_client_uq).
 */
export async function customerForClient(clientId: string, actor: string): Promise<schema.Customer> {
  void clientId; void actor;
  return notImplemented("customerForClient");
}

/** Active customers (archived too with includeArchived), with balances. q matches the name or contact. */
export async function listCustomers(opts: { includeArchived?: boolean; q?: string; today?: string } = {}): Promise<CustomerSummary[]> {
  void opts;
  return notImplemented("listCustomers");
}

export async function getCustomer(id: string, opts: { today?: string } = {}): Promise<CustomerDetail | null> {
  void id; void opts;
  return notImplemented("getCustomer");
}

/* ───────────────────────── Invoices ───────────────────────── */

/**
 * A new DRAFT (people, or Claude with source "claude" when a person asked; Claude's drafts say so on the page).
 * Totals come from invoices-types invoiceTotals. Defaults: termsDays and notes from the settings (termsDays 14,
 * footer), lang from the customer. Refuses a dealId that doesn't exist or a customer that is archived.
 */
export async function createInvoiceDraft(
  input: InvoiceDraftInputT,
  actor: string,
  opts: { source?: InvoiceSource; askId?: string | null } = {},
): Promise<schema.Invoice> {
  void input; void actor; void opts;
  return notImplemented("createInvoiceDraft");
}

/**
 * "Create invoice" on a deal (people): finds or makes the customer (the deal's client, else a customer with the
 * same name key and email, else a new one from the deal's contact), and a draft with one line per deal deliverable
 * plus the fee (or one line "Collab with Nora" at the deal's amount). A deal that already has a draft or an open
 * invoice returns that one (created: false).
 */
export async function createInvoiceFromDeal(dealId: string, actor: string): Promise<{ id: string; created: boolean }> {
  void dealId; void actor;
  return notImplemented("createInvoiceFromDeal");
}

/** People only. Draft: anything. Sent / partially paid: not the customer, and the total can't go below what's paid. Paid and void: refused. */
export async function updateInvoice(id: string, patch: InvoicePatchT, actor: string): Promise<schema.Invoice> {
  void id; void patch; void actor;
  return notImplemented("updateInvoice");
}

/** People only; drafts only (a sent invoice is voided, never deleted). */
export async function deleteDraftInvoice(id: string, actor: string): Promise<void> {
  void id; void actor;
  return notImplemented("deleteDraftInvoice");
}

/**
 * "Send" (people only). In ONE UPDATE: the dates are fixed (resolveInvoiceDates), the number is taken from
 * invoice_number_seq the first time, status draft → sent, the customer link is made (token hash + encrypted copy)
 * if there is none. Pressing it again on a sent invoice changes nothing and returns the same link (firstSend false).
 * Refuses a total of $0 and a void invoice. Then syncs the deal. Nora HQ sends no email itself: the page shows the
 * link and the messages (getInvoiceMessages) for the person to send.
 */
export async function sendInvoice(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<{ invoice: schema.Invoice; url: string; firstSend: boolean }> {
  void id; void actor; void opts;
  return notImplemented("sendInvoice");
}

/** People only. Refuses an invoice with payments (delete them first). Keeps its number; its link then shows "cancelled". Syncs the deal. */
export async function voidInvoice(id: string, actor: string, opts: { reason?: string | null } = {}): Promise<schema.Invoice> {
  void id; void actor; void opts;
  return notImplemented("voidInvoice");
}

/** The customer link to copy (people only, via the app), or null for a draft. Imported invoices get one here the first time. */
export async function getInvoiceLink(id: string, actor: string, opts: { origin?: string | null } = {}): Promise<string | null> {
  void id; void actor; void opts;
  return notImplemented("getInvoiceLink");
}

/** A new customer link (people only): the old one stops working at once. */
export async function replaceInvoiceLink(id: string, actor: string, opts: { origin?: string | null } = {}): Promise<string> {
  void id; void actor; void opts;
  return notImplemented("replaceInvoiceLink");
}

/** "I sent the reminder" (people): stamps lastRemindedAt and counts it. */
export async function markReminderSent(id: string, actor: string): Promise<schema.Invoice> {
  void id; void actor;
  return notImplemented("markReminderSent");
}

/** The email, reminder and SMS / WeChat texts with the link (built with lib/payment-request). People only (the link is in it). */
export async function getInvoiceMessages(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<InvoiceMessages> {
  void id; void actor; void opts;
  return notImplemented("getInvoiceMessages");
}

/** One invoice with its customer, payments, deal and any bank payment still clearing. Never the link secrets. */
export async function getInvoice(id: string, opts: { today?: string } = {}): Promise<InvoiceDetail | null> {
  void id; void opts;
  return notImplemented("getInvoice");
}

/** Newest first (drafts, then by issue date). Default: everything but void. */
export async function listInvoices(filter: InvoiceListFilter = {}): Promise<InvoiceListRow[]> {
  void filter;
  return notImplemented("listInvoices");
}

/** A deal's invoices (void left out), for the deal page's "Invoice INV-2026-0003 · Sent · due Dec 4". */
export async function invoicesForDeal(dealId: string, opts: { today?: string } = {}): Promise<InvoiceListRow[]> {
  void dealId; void opts;
  return notImplemented("invoicesForDeal");
}

/**
 * The invoice as a Letter PDF (lib/invoice-pdf). Callers check access first: the team route signs in; the public
 * route resolves the token with getInvoiceByToken and passes `public: true` (a draft or void invoice → null).
 * A draft prints "DRAFT". English only: characters Helvetica can't draw are dropped (the web page shows them).
 */
export async function invoicePdf(id: string, opts: { public?: boolean; today?: string } = {}): Promise<{ bytes: Uint8Array; filename: string } | null> {
  void id; void opts;
  return notImplemented("invoicePdf");
}

/* ───────────────────────── Payments ───────────────────────── */

/**
 * "Record payment" (people only: Claude never marks anything paid). Refuses a draft or void invoice and more than
 * the balance. Inserts the payment, then recomputes paidCents / status / paidAt in ONE UPDATE from the payments,
 * then syncs the deal (paid in full → the deal's paymentStatus is paid).
 */
export async function recordPayment(invoiceId: string, input: PaymentInputT, actor: string): Promise<{ payment: schema.InvoicePayment; invoice: schema.Invoice }> {
  void invoiceId; void input; void actor;
  return notImplemented("recordPayment");
}

/** People only (a Stripe one too: a refund is done in Stripe, then the record is removed here). Recomputes and syncs the deal back. */
export async function deletePayment(paymentId: string, actor: string): Promise<schema.Invoice> {
  void paymentId; void actor;
  return notImplemented("deletePayment");
}

/**
 * The verified Stripe webhook's payment (actor "system"). Idempotent: the insert is ON CONFLICT (stripe_session_id)
 * DO NOTHING, so a replayed event records nothing (recorded: false). Recomputes and syncs the deal. Never refuses an
 * overpayment (the money arrived): the invoice shows it as overpaid.
 */
export async function recordStripePayment(input: StripePaymentRecord): Promise<{ recorded: boolean; invoice: schema.Invoice | null }> {
  void input;
  return notImplemented("recordStripePayment");
}

/**
 * The deal follows its sent invoices (void and drafts ignored): all paid → paid (paidAt = last payment), any unpaid →
 * requested with the earliest unpaid due date, none left after a void → back to not_requested if it was requested.
 * One UPDATE on the deal. Called by send, void, recordPayment, deletePayment and recordStripePayment.
 */
export async function syncDealFromInvoices(dealId: string, actor: string): Promise<void> {
  void dealId; void actor;
  return notImplemented("syncDealFromInvoices");
}

/* ───────────────────────── Retainers ───────────────────────── */

export async function createRetainer(input: RetainerInputT, actor: string): Promise<schema.Retainer> {
  void input; void actor;
  return notImplemented("createRetainer");
}

export async function updateRetainer(id: string, patch: z.input<typeof RetainerPatch>, actor: string): Promise<schema.Retainer> {
  void id; void patch; void actor;
  return notImplemented("updateRetainer");
}

/** People only. Drafts it already made stay (their retainerId becomes null). */
export async function deleteRetainer(id: string, actor: string): Promise<void> {
  void id; void actor;
  return notImplemented("deleteRetainer");
}

export async function listRetainers(customerId?: string): Promise<schema.Retainer[]> {
  void customerId;
  return notImplemented("listRetainers");
}

/**
 * Daily (from lib/ops-notify runDailyReminders, actor "system"): for each retainer that is due today (invoices-types
 * retainerDue), claim the month with ONE conditional UPDATE, then make ONE draft (unique per retainer and month).
 * Never sends. `dryRun` (the reminders preview) claims and makes nothing and returns what it would make.
 */
export async function runRetainers(now?: Date, opts: { dryRun?: boolean } = {}): Promise<RunRetainersResult> {
  void now; void opts;
  return notImplemented("runRetainers");
}

/* ───────────────────────── Reports and reminders ───────────────────────── */

/** Outstanding, overdue, paid this month / year (by payment date), by month, by method and by customer. */
export async function invoiceReport(opts: { today?: string; year?: number } = {}): Promise<InvoiceReport> {
  void opts;
  return notImplemented("invoiceReport");
}

/**
 * Payments as CSV for taxes (one row per payment, oldest first): Date, Invoice, Customer, Method, Reference,
 * Amount, Stripe fee, Net. Amounts as 1250.50. Built with invoices-types toCsv (formula-safe). People only.
 */
export async function paymentsCsv(opts: { year?: number } = {}): Promise<{ filename: string; csv: string }> {
  void opts;
  return notImplemented("paymentsCsv");
}

/** What the morning push to Nora says about invoices (topic payment_overdue). `today` is "YYYY-MM-DD". */
export async function invoiceReminders(today: string, created?: RunRetainersResult): Promise<InvoiceReminderLines> {
  void today; void created;
  return notImplemented("invoiceReminders");
}

/* ───────────────────────── Payment settings ───────────────────────── */

/** The settings stored in app_settings[NORA_PAYMENT_KEY] (invoices-types readInvoiceSettings). Anyone may read; only people see them in the UI. */
export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  return notImplemented("getInvoiceSettings");
}

/**
 * People only. MERGES into the stored row in one statement (value || patch), so the deal payment line and the
 * invoice settings never overwrite each other. Refuses passwords (credential-guard) and card or bank numbers
 * (invoices-types looksLikeCardOrBankNumber). Logs that the settings changed, never their values.
 */
export async function saveInvoiceSettings(input: InvoiceSettingsInputT, actor: string): Promise<InvoiceSettings> {
  void input; void actor;
  return notImplemented("saveInvoiceSettings");
}

/* ───────────────────────── The customer's page (/i/<token>, actor "public") ───────────────────────── */

/**
 * Looks a raw token up by hash. Never throws for a bad token. Never a link → "unknown" (404); void → "void"; else
 * the invoice as PublicInvoice (only what the customer may see) and the pay options (Pay online only when Stripe
 * is configured). Drafts never have a link.
 */
export async function getInvoiceByToken(raw: unknown, opts: { today?: string } = {}): Promise<PublicInvoiceState> {
  void raw; void opts;
  return notImplemented("getInvoiceByToken");
}

/** First view stamps viewedAt; later views update lastViewedAt at most every 10 minutes. The page skips this for a signed-in person. */
export async function markInvoiceViewed(invoiceId: string, now?: Date): Promise<void> {
  void invoiceId; void now;
  return notImplemented("markInvoiceViewed");
}

/* ───────────────────────── Import from Skynova (people only) ───────────────────────── */

/** Parses the pasted text (lib/invoice-import, pure) and marks rows that match an existing customer or invoice number. Writes nothing. */
export async function previewSkynovaImport(text: string, kind: ImportKind): Promise<ImportPreview> {
  void text; void kind;
  return notImplemented("previewSkynovaImport");
}

/**
 * Saves the same text the preview showed (re-parsed here, never trusted from the browser): customers by name key
 * (matched, not duplicated), invoices as sent with Skynova's number (source "import", importRef), one line
 * "Imported from Skynova", and an "other" payment for any amount already paid. Rows with issues are skipped.
 */
export async function saveSkynovaImport(text: string, kind: ImportKind, actor: string): Promise<ImportResult> {
  void text; void kind; void actor;
  return notImplemented("saveSkynovaImport");
}
