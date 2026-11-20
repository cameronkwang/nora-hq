import "server-only";
import { z } from "zod";
import { schema } from "./db";
import { OpsError } from "./ops";
import { cleanBlock, cleanLine } from "./ops-collab";
import {
  MANUAL_PAYMENT_METHODS,
  MAX_INVOICE_CENTS,
  MAX_INVOICE_ITEMS,
  MAX_INVOICE_NUMBER,
  MAX_SAVED_ITEMS,
  MAX_TERMS_DAYS,
  PAY_WAYS,
  RETAINER_MAX_DAY,
  isQuantity,
  type BillToOption,
  type ContractInvoiceRef,
  type ContractPart,
  type ContractRef,
  type CustomerDetail,
  type CustomerSummary,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
  type InvoiceCreatorContext,
  type InvoiceDetail,
  type InvoiceDone,
  type InvoiceItem,
  type InvoiceListFilter,
  type InvoiceListRow,
  type InvoiceMessages,
  type InvoicePrefill,
  type InvoiceReminderLines,
  type InvoiceReport,
  type InvoiceSettings,
  type InvoiceSource,
  type LastInvoice,
  type PublicInvoiceState,
  type RunRetainersResult,
  type SavedItem,
  type StripePaymentRecord,
} from "./invoices-types";
import type { ContractFields } from "./contract";

/**
 * Invoicing ops: customers, invoices (the fast creator first), payments, retainers, reports, settings, numbers,
 * saved lines, the contract links, the customer link and the Skynova import. Same conventions as lib/ops:
 * zod-validated input, `actor` is a user email (or display name), "claude", "system" or "public", every write logs
 * activity. The design is docs/invoicing.md; shared shapes and pure helpers are lib/invoices-types.
 *
 * Who can do what (enforced HERE, not only in the UI):
 * - People (Nora and Cameron, both): everything below. Invoicing is Nora's money and both of them use it.
 * - Claude: reads (listInvoices, getInvoice, listCustomers, getCustomer) and createInvoiceDraft with source "claude"
 *   when a person asked (customerForClient may make the customer row for a managed business; payWays only when a
 *   person said so). Claude NEVER finalizes (Make PDF), records or deletes a payment, marks paid, voids, deletes,
 *   edits a sent invoice, makes or copies a link, imports, sets the next number, edits saved lines or changes payment
 *   settings, and never reads or links contracts (contracts are people only).
 * - "system": runRetainers (drafts only), recordStripePayment (from the verified Stripe webhook).
 * - "public": getInvoiceByToken / markInvoiceViewed (the /i/<token> page).
 *
 * Neon over HTTP has no interactive transactions: anything that must be atomic is ONE statement (see the SQL in
 * docs/invoicing.md "Atomic statements": the number taken in the finalize UPDATE or the create-and-finalize INSERT,
 * the sequence moves, payment recompute, retainer claim, Stripe event claim). Nothing here is ever on Nora's schedule,
 * and no card or bank number, password or Stripe key is stored. No way to pay ever adds a fee or surcharge.
 *
 * STATUS: interface only (design step). Every function below has its final signature and throws "not built yet"
 * until the core builder fills it in.
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

/**
 * How this invoice asks to be paid: unique, at least one; order doesn't matter (shown Zelle first). Availability
 * (Zelle number set, Stripe set up, card turned on) is checked in the op with invoices-types checkPayWays.
 */
export const PayWaysInput = z.array(z.enum(PAY_WAYS)).min(1, "Pick at least one way to pay.").max(PAY_WAYS.length)
  .refine((w) => new Set(w).size === w.length, "Pick each way once.");

export const InvoiceDraftInput = z.object({
  customerId: id,
  /** Empty on a draft = "the day it is finalized". */
  issueDate: ymd,
  /** Empty on a draft = issue date + termsDays (0 by default: due on receipt). */
  dueDate: ymd,
  termsDays: z.number().int().min(0).max(MAX_TERMS_DAYS).optional(), // no zod default: .partial() would re-apply it
  items: z.array(InvoiceItemInput).min(1, "Add at least one line.").max(MAX_INVOICE_ITEMS),
  discountCents: cents("Discount: use dollars.").optional(),
  discountLabel: line(80),
  notes: block(2000),
  privateNotes: block(2000),
  dealId: id.nullish(),
  /** The contract this invoice bills. People only (Claude never links contracts). */
  contractId: id.nullish(),
  lang: z.enum(schema.INTAKE_LANGS).nullish(),
  /** Default ["zelle"]. Claude passes these only when Nora or Cameron said how this invoice should be paid. */
  payWays: PayWaysInput.optional(),
  /** The "custom" way's line ("Cash at the shoot is fine"). Required when payWays has "custom". */
  payNote: line(200),
});
export type InvoiceDraftInputT = z.input<typeof InvoiceDraftInput>;
/** Editing: a draft may change anything (customer included); a sent, unpaid invoice everything but the customer. */
export const InvoicePatch = InvoiceDraftInput.partial();
export type InvoicePatchT = z.input<typeof InvoicePatch>;

/**
 * The creator's "Bill to": an existing customer, a managed business (customerForClient), a collab deal's business
 * (customerForDeal) or a new name typed in the box (a customer is made inline). `address`, when given, is saved as
 * the customer's billing address (so the next invoice fills it).
 */
export const BillToInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer"), id, address: block(500) }),
  z.object({ kind: z.literal("client"), id, address: block(500) }),
  z.object({ kind: z.literal("deal"), id, address: block(500) }),
  z.object({
    kind: z.literal("new"),
    name: z.preprocess(cleanLine, z.string().min(1, "Who is this invoice for?").max(160)),
    address: block(500),
    contactName: line(120),
    email,
    phone: line(40),
    lang: z.enum(schema.INTAKE_LANGS).nullish(),
  }),
]);
export type BillToInputT = z.input<typeof BillToInput>;

/**
 * The fast creator's one form (/invoices/new): "Make PDF" (createAndFinalizeInvoice) and "Save as draft"
 * (saveQuickDraft) take the same input. Dates default to today and due the same day; payWays to ["zelle"].
 */
export const QuickInvoiceInput = z.object({
  billTo: BillToInput,
  /** Default today. */
  issueDate: ymd,
  /** Default the issue date (due on receipt). Never before the issue date. */
  dueDate: ymd,
  items: z.array(InvoiceItemInput).min(1, "Add at least one line.").max(MAX_INVOICE_ITEMS),
  discountCents: cents("Discount: use dollars.").optional(),
  discountLabel: line(80),
  notes: block(2000),
  privateNotes: block(2000),
  lang: z.enum(schema.INTAKE_LANGS).nullish(),
  payWays: PayWaysInput.optional(),
  payNote: line(200),
  dealId: id.nullish(),
  contractId: id.nullish(),
  /** Update and finalize this draft instead of making a new invoice (a draft opened in the creator). */
  draftId: id.nullish(),
  /** The one-time inline ask ("From" and Zelle, when Settings has none): merged into the settings first. */
  setup: z.object({ fromName: line(120), fromAddress: block(300), zelle: line(120) }).partial().nullish(),
});
export type QuickInvoiceInputT = z.input<typeof QuickInvoiceInput>;

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
  /** The monthly contract it bills ("Set up monthly invoices"); its drafts carry it too. */
  contractId: id.nullish(),
});
export type RetainerInputT = z.input<typeof RetainerInput>;
export const RetainerPatch = RetainerInput.omit({ customerId: true }).partial();

/** One saved line (Settings → Invoices). unitCents null = typed each time (Food Stipend). id: kept, or made for a new one. */
export const SavedItemInput = z.object({
  id: z.string().max(40).nullish(),
  description: z.preprocess(cleanLine, z.string().min(1, "Name the line.").max(120)),
  unitCents: cents("Price: use dollars, like 550 or 75.10.").nullable(),
});
export type SavedItemInputT = z.input<typeof SavedItemInput>;
export const SavedItemsInput = z.array(SavedItemInput).max(MAX_SAVED_ITEMS, `Keep it to ${MAX_SAVED_ITEMS} saved lines.`);

/** Settings → "Next invoice number". Never onto a number already used (the op floors it past them). */
export const NextNumberInput = z.number().int("Use a whole number, like 170.").min(1, "Use a number from 1 up.").max(MAX_INVOICE_NUMBER, "That number is too large.");

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
  savedItems: SavedItemsInput,
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
 * The customer row for a managed business, made from its clients row the first time (source "client", name,
 * ownerEmail as email, billing address = clients.public_info.address). People or Claude. One customer per client
 * (customers_client_uq; a race is resolved by ON CONFLICT and reading the winner).
 */
export async function customerForClient(clientId: string, actor: string): Promise<schema.Customer> {
  void clientId; void actor;
  return notImplemented("customerForClient");
}

/**
 * The customer for a collab deal's business: the deal's client (customerForClient), else a customer with the same
 * name key (and the same email when both have one), else a new one from the deal (contact, email, phone, address;
 * source "deal"). People, or Claude via createInvoiceDraft with a deal.
 */
export async function customerForDeal(dealId: string, actor: string): Promise<schema.Customer> {
  void dealId; void actor;
  return notImplemented("customerForDeal");
}

/** Active customers (archived too with includeArchived), with balances. q matches the name or contact. */
export async function listCustomers(opts: { includeArchived?: boolean; q?: string; today?: string } = {}): Promise<CustomerSummary[]> {
  void opts;
  return notImplemented("listCustomers");
}

/** A customer with their invoices, payments, retainers and contracts (each contract with its invoices and next steps). */
export async function getCustomer(id: string, opts: { today?: string } = {}): Promise<CustomerDetail | null> {
  void id; void opts;
  return notImplemented("getCustomer");
}

/* ───────────────────────── The fast creator (/invoices/new) ───────────────────────── */

/**
 * Everything /invoices/new renders, in ONE server call (statements in parallel): settings (From, Zelle, terms),
 * what to ask once inline, saved lines, which ways to pay are available, the next number, the Bill to list and the
 * prefill. Prefill sources (at most one): draftId (open a draft), contractId (+ part: invoicePrefillFromContract),
 * dealId (the deal's business, its fee as one line "Collab: Instagram Reel, TikTok"), customerId / clientId (Bill to
 * picked). People only.
 */
export async function getInvoiceCreatorContext(opts: {
  today?: string;
  draftId?: string | null;
  contractId?: string | null;
  contractPart?: ContractPart | null;
  dealId?: string | null;
  customerId?: string | null;
  clientId?: string | null;
} = {}): Promise<InvoiceCreatorContext> {
  void opts;
  return notImplemented("getInvoiceCreatorContext");
}

/**
 * The creator's Bill to list: customers (not archived), managed businesses without a customer yet (never Nora's
 * creator workspace), and deal businesses that match no customer by name key. Each name once. Address: the
 * customer's billing address, else clients.public_info.address, else the deal's address. Filtered in the browser
 * with invoices-types filterBillTo.
 */
export async function billToOptions(opts: { limit?: number } = {}): Promise<BillToOption[]> {
  void opts;
  return notImplemented("billToOptions");
}

/** "Same as last time": the customer's newest invoice that isn't void (lines via invoices-types sameAsLastTime). Null when none. */
export async function lastInvoiceForCustomer(customerId: string): Promise<LastInvoice | null> {
  void customerId;
  return notImplemented("lastInvoiceForCustomer");
}

/**
 * "Make PDF" (people only): the main way to make an invoice. Resolves Bill to (a new customer is made inline; a given
 * address is saved on the customer), merges `setup` into the settings, checks the ways to pay (checkPayWays), then
 * in ONE INSERT makes the invoice already finalized: status sent, the number taken from invoice_number_seq (skipping
 * any number already on an invoice), dates (today, due the same day unless given), the customer link (token hash +
 * encrypted copy). With draftId: ONE UPDATE saves the form onto that draft and finalizes it the same way. Then syncs
 * the deal, if any. A unique-number race is retried once. Returns the done state (Share PDF, Download, Copy message
 * in the customer's language, Copy pay link only with an online way, next steps such as "Make contract").
 * Budget: at most 4 statements on the common path (customer exists, no deal), well under a second locally.
 */
export async function createAndFinalizeInvoice(input: QuickInvoiceInputT, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<InvoiceDone> {
  void input; void actor; void opts;
  return notImplemented("createAndFinalizeInvoice");
}

/** "Save as draft" from the creator (people only): the same input, no number, no link. With draftId it updates that draft. */
export async function saveQuickDraft(input: QuickInvoiceInputT, actor: string, opts: { today?: string } = {}): Promise<{ id: string; customerId: string; created: boolean }> {
  void input; void actor; void opts;
  return notImplemented("saveQuickDraft");
}

/** The done state for an invoice that is already finalized (the invoice page's Share PDF / Copy message). People only (it holds the link). */
export async function getInvoiceDone(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<InvoiceDone | null> {
  void id; void actor; void opts;
  return notImplemented("getInvoiceDone");
}

/* ───────────────────────── Numbers ───────────────────────── */

/**
 * The number the next finalize will most likely take ("0000170"): the sequence's next value, skipping numbers
 * already on an invoice. Shown in the creator's quiet line and Settings; never reserved.
 */
export async function nextInvoiceNumber(): Promise<string> {
  return notImplemented("nextInvoiceNumber");
}

/**
 * Settings → "Next invoice number" (people only). ONE setval: the next number becomes max(n, highest all-digit
 * number already used + 1), so a number is never repeated. Returns the formatted next number actually set and logs it.
 */
export async function setNextInvoiceNumber(n: number, actor: string): Promise<string> {
  void n; void actor;
  return notImplemented("setNextInvoiceNumber");
}

/* ───────────────────────── Saved lines ───────────────────────── */

/** The creator's one-tap lines (settings.savedItems; the two defaults until a person edits them). */
export async function getSavedItems(): Promise<SavedItem[]> {
  return notImplemented("getSavedItems");
}

/** Settings → saved lines (people only): replaces the list in one merge statement; new ones get an id. */
export async function saveSavedItems(items: SavedItemInputT[], actor: string): Promise<SavedItem[]> {
  void items; void actor;
  return notImplemented("saveSavedItems");
}

/* ───────────────────────── Invoices ───────────────────────── */

/**
 * A new DRAFT (people, or Claude with source "claude" when a person asked; Claude's drafts say so on the page).
 * Totals come from invoices-types invoiceTotals. Defaults: termsDays 0 (due on receipt) and notes from the settings,
 * lang from the customer, payWays ["zelle"]. Refuses a dealId that doesn't exist, an archived customer, a way to pay
 * that isn't available, and a contractId from Claude.
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
 * A draft from a deal (Claude's create_draft_invoice with deal_id; people use the creator's ?deal= prefill): the
 * customer via customerForDeal, one line "Collab: Instagram Reel, TikTok" at the deal's amount, dealId set. A deal
 * that already has a draft or an open invoice returns that one (created: false).
 */
export async function createInvoiceFromDeal(dealId: string, actor: string, opts: { source?: InvoiceSource } = {}): Promise<{ id: string; created: boolean }> {
  void dealId; void actor; void opts;
  return notImplemented("createInvoiceFromDeal");
}

/** People only. Draft: anything. Sent / partially paid: not the customer, and the total can't go below what's paid. Paid and void: refused. */
export async function updateInvoice(id: string, patch: InvoicePatchT, actor: string): Promise<schema.Invoice> {
  void id; void patch; void actor;
  return notImplemented("updateInvoice");
}

/** People only; drafts only (a finalized invoice is voided, never deleted). */
export async function deleteDraftInvoice(id: string, actor: string): Promise<void> {
  void id; void actor;
  return notImplemented("deleteDraftInvoice");
}

/**
 * "Make PDF" on a draft that already exists (the invoice page; people only). In ONE UPDATE: the dates are fixed
 * (resolveInvoiceDates), the number is taken the first time (skipping used numbers), status draft → sent, the
 * customer link is made if there is none. Pressing it again changes nothing and burns no number (first: false).
 * Refuses a total of $0, a void invoice and ways to pay that aren't available. Then syncs the deal. Nora HQ sends
 * nothing itself: the done state shows Share PDF, Download, Copy message.
 */
export async function finalizeInvoice(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<{ invoice: schema.Invoice; first: boolean; done: InvoiceDone }> {
  void id; void actor; void opts;
  return notImplemented("finalizeInvoice");
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

/** The PDF text, the email, the reminder and the SMS / WeChat texts (built with lib/payment-request and lib/invoice-copy). People only (the link is in it). */
export async function getInvoiceMessages(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<InvoiceMessages> {
  void id; void actor; void opts;
  return notImplemented("getInvoiceMessages");
}

/** One invoice with its customer, payments, deal, contract, pay options, the worded PDF and next steps. Never the link secrets. */
export async function getInvoice(id: string, opts: { today?: string } = {}): Promise<InvoiceDetail | null> {
  void id; void opts;
  return notImplemented("getInvoice");
}

/** Newest first (drafts, then by issue date, then number). Default: everything but void. */
export async function listInvoices(filter: InvoiceListFilter = {}): Promise<InvoiceListRow[]> {
  void filter;
  return notImplemented("listInvoices");
}

/** A deal's invoices (void left out), for the deal page's "0000170 · Sent · due Dec 4". */
export async function invoicesForDeal(dealId: string, opts: { today?: string } = {}): Promise<InvoiceListRow[]> {
  void dealId; void opts;
  return notImplemented("invoicesForDeal");
}

/**
 * The invoice as a Letter PDF (lib/invoice-pdf drawing invoices-types invoiceDocument). Callers check access first:
 * the team route signs in; the public route resolves the token with getInvoiceByToken and passes `public: true`
 * (a draft or void invoice → null). A draft prints "DRAFT". English only: characters Helvetica can't draw are dropped.
 */
export async function invoicePdf(id: string, opts: { public?: boolean; today?: string; origin?: string | null } = {}): Promise<{ bytes: Uint8Array; filename: string } | null> {
  void id; void opts;
  return notImplemented("invoicePdf");
}

/* ───────────────────────── Contracts ⇄ invoices (people only; no Claude tool reads contracts) ───────────────────────── */

/**
 * "Make the invoice" after a contract downloads (/invoices/new?contract=<id>[&part=rest]): the creator's prefill.
 * Customer: the contract's customerId, else a customer whose name key matches clientBusiness, else a new one from the
 * contract's business, contact and email. Lines and due date: invoices-types invoiceFromContractFields (the package
 * at the fee; "Deposit (N%)" first when the contract has a deposit; the rest after it; one month for a monthly one).
 * contractId set. Null when the contract doesn't exist or has nothing left to invoice.
 */
export async function invoicePrefillFromContract(contractId: string, opts: { today?: string; part?: ContractPart | null } = {}): Promise<InvoicePrefill | null> {
  void contractId; void opts;
  return notImplemented("invoicePrefillFromContract");
}

/**
 * "Make contract" from an invoice (/contracts?invoice=<id>): the contract fields (invoices-types
 * contractFieldsFromInvoice: business, contact, email, fee from the main line; monthly for a retainer invoice), plus
 * the invoice's deal and customer so the saved contract links back. Null for an unknown invoice.
 */
export async function contractPrefillFromInvoice(invoiceId: string, opts: { today?: string } = {}): Promise<{ fields: Partial<ContractFields>; invoiceId: string; customerId: string; dealId: string | null; note: string } | null> {
  void invoiceId; void opts;
  return notImplemented("contractPrefillFromInvoice");
}

/**
 * The saved contract links back to the invoice it was made from (lib/ops-contracts saveContract calls this when given
 * invoiceId): invoices.contractId = contractId (a newer contract replaces an older link) and contracts.customerId =
 * the invoice's customer, two single-row UPDATEs. People only. Logged without amounts.
 */
export async function linkContractToInvoice(contractId: string, invoiceId: string, actor: string): Promise<void> {
  void contractId; void invoiceId; void actor;
  return notImplemented("linkContractToInvoice");
}

/** The invoice page's "Contract Nov 20 · Download again" (or null: "Make contract"). */
export async function contractForInvoice(invoiceId: string): Promise<ContractRef | null> {
  void invoiceId;
  return notImplemented("contractForInvoice");
}

/** A customer's contracts: linked (contracts.customerId or one of their invoices' contractId) or the same business name key. Newest first. */
export async function contractsForCustomer(customerId: string): Promise<ContractRef[]> {
  void customerId;
  return notImplemented("contractsForCustomer");
}

/** A deal's contracts (contracts.dealId), newest first, for the deal page next to its invoices. */
export async function contractsForDeal(dealId: string): Promise<ContractRef[]> {
  void dealId;
  return notImplemented("contractsForDeal");
}

/** Past contracts rows: each contract's invoices ("0000170 · Paid"), by contract id (missing id = none). */
export async function invoicesForContracts(contractIds: string[], opts: { today?: string } = {}): Promise<Record<string, ContractInvoiceRef[]>> {
  void contractIds; void opts;
  return notImplemented("invoicesForContracts");
}

/**
 * "Set up monthly invoices" on a monthly contract (people only): a retainer from invoices-types
 * retainerFromContractFields (fee, start month, day of the start date), customer resolved like
 * invoicePrefillFromContract, contractId set. If an invoice for this contract already bills the start month, that
 * month counts as made (lastRunMonth), so it is never billed twice. A contract that already has a retainer returns it
 * (created: false).
 */
export async function createRetainerFromContract(contractId: string, actor: string, opts: { today?: string } = {}): Promise<{ retainer: schema.Retainer; created: boolean }> {
  void contractId; void actor; void opts;
  return notImplemented("createRetainerFromContract");
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
 * overpayment (the money arrived): the invoice shows it as overpaid. Stores input.stripeCustomerId on the customer
 * only if it is set (bank reuse) and the customer has none yet.
 */
export async function recordStripePayment(input: StripePaymentRecord): Promise<{ recorded: boolean; invoice: schema.Invoice | null }> {
  void input;
  return notImplemented("recordStripePayment");
}

/**
 * The deal follows its finalized invoices (void and drafts ignored): all paid → paid (paidAt = last payment), any
 * unpaid → requested with the earliest unpaid due date, none left after a void → back to not_requested if it was
 * requested. One UPDATE on the deal. Called by finalize, void, recordPayment, deletePayment and recordStripePayment.
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
 * retainerDue), claim the month with ONE conditional UPDATE, then make ONE draft (unique per retainer and month;
 * payWays ["zelle"], due on receipt, contractId from the retainer). Never finalizes. `dryRun` (the reminders
 * preview) claims and makes nothing and returns what it would make.
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

/** The settings stored in app_settings[NORA_PAYMENT_KEY] (invoices-types readInvoiceSettings). People see them in the UI; Claude never reads them. */
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
 * the invoice as PublicInvoice (only what the customer may see) and exactly its chosen ways (invoices-types
 * payOptions: Zelle first; bank / card only while Stripe is configured and that way is on). Drafts never have a link.
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
 * (matched, not duplicated), invoices as sent with Skynova's number (normalizeImportedNumber: "169" → "0000169",
 * source "import", importRef), one line "Imported from Skynova", and an "other" payment for any amount already paid.
 * Then ONE setval moves the sequence past every all-digit number used, so the next Nora HQ number never repeats one.
 * Rows with issues are skipped.
 */
export async function saveSkynovaImport(text: string, kind: ImportKind, actor: string): Promise<ImportResult> {
  void text; void kind; void actor;
  return notImplemented("saveSkynovaImport");
}
