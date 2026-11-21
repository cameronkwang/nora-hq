import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, getTableColumns, ilike, inArray, isNull, like, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { cleanBlock, cleanLine } from "./ops-collab";
import { decryptJson, encryptJson } from "./crypto";
import { today as todayNY } from "./dates";
import { looksLikeSecret, secretRefusal } from "./credential-guard";
import { readPublicInfo } from "./business-facts";
import { readContractFields, fieldsFromDeal, type ContractFields } from "./contract";
import { invoiceCopy } from "./invoice-copy";
import { buildInvoiceMessages, mailtoHref } from "./payment-request";
import { expireCheckoutSession, stripeConfigured } from "./stripe";
import { renderInvoicePdf } from "./invoice-pdf";
import { importedLine, parseImport } from "./invoice-import";
import {
  DEFAULTABLE_PAY_WAYS,
  DEFAULT_PAY_WAYS,
  FIRST_INVOICE_NUMBER,
  INVOICE_NUMBER_DIGITS,
  INVOICE_NUMBER_SEQUENCE,
  MANUAL_PAYMENT_METHODS,
  MAX_INVOICE_CENTS,
  MAX_INVOICE_ITEMS,
  MAX_INVOICE_NUMBER,
  MAX_SAVED_ITEMS,
  MAX_TERMS_DAYS,
  MONTHLY_SERVICE_LINE,
  OWN_BANK_ENC_KEY,
  PAYMENT_METHOD_LABEL,
  PAY_WAYS,
  PAY_WAY_LABEL,
  PDF_LETTERS,
  RETAINER_MAX_DAY,
  addDaysYmd,
  availablePayWays,
  balanceCents,
  bankDetailsProblem,
  bankDigits,
  bankLabelHoldsNumber,
  checkPayWays,
  contractFieldsFromInvoice,
  contractNextSteps,
  contractPaymentDays,
  csvAmount,
  customerNameKey,
  daysBetween,
  daysOverdue,
  defaultPayWays,
  formatCents,
  formatInvoiceNumber,
  hasOnlineWay,
  invoiceDisplayStatus,
  invoiceDocument,
  invoiceFileName,
  invoiceFromContractFields,
  invoiceLabel,
  invoiceLines,
  invoiceNextSteps,
  invoicePdfPath,
  invoiceSetupMissing,
  invoiceTotals,
  isBankAccountNumber,
  isOpenStatus,
  isQuantity,
  isRoutingNumber,
  isYmd,
  looksLikeCardOrBankNumber,
  mainLineCents,
  maskedBankDetails,
  overpaidCents,
  payOptions,
  paymentMessageLines,
  pdfPrintsEmpty,
  readInvoiceSettings,
  retainerDue,
  retainerFromContractFields,
  retainerItemDescription,
  sameAsLastTime,
  shortDate,
  sortPayWays,
  toCsv,
  type BankDetails,
  type BillToOption,
  type ContractInvoiceRef,
  type ContractPart,
  type ContractRef,
  type CreatorEdit,
  type CreatorLine,
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
  type InvoiceRow,
  type InvoiceSettings,
  type InvoiceSource,
  type InvoiceStatus,
  type LastInvoice,
  type PayWay,
  type PayWayAvailability,
  type PaymentMethod,
  type ProcessingPayment,
  type PublicInvoice,
  type PublicInvoiceState,
  type RunRetainersResult,
  type SavedItem,
  type StripePaymentRecord,
} from "./invoices-types";

/**
 * Invoicing ops: customers, invoices (the fast creator first), payments, retainers, reports, settings, numbers,
 * saved lines, the contract links, the customer link and the Skynova import. Same conventions as lib/ops:
 * zod-validated input, `actor` is a user email (or display name), "claude", "system" or "public", every write logs
 * activity. The design is docs/invoicing.md; shared shapes and pure helpers are lib/invoices-types.
 *
 * Who can do what (enforced HERE, not only in the UI):
 * - People (Nora and Cameron, both): everything below. Invoicing is Nora's money and both of them use it.
 * - Claude: reads (listInvoices, getInvoice, listCustomers, getCustomer) and createInvoiceDraft / createInvoiceFromDeal
 *   with source "claude" when a person asked (customerForClient / customerForDeal may make the customer row; payWays
 *   only when a person said so). Claude NEVER finalizes (Make PDF), records or deletes a payment, marks paid, voids,
 *   deletes, edits a sent invoice, makes or copies a link, imports, sets the next number, edits saved lines or changes
 *   payment settings, and never reads or links contracts (contracts are people only).
 * - "system": runRetainers (drafts only), recordStripePayment (from the verified Stripe webhook), syncDealFromInvoices.
 * - "public": getInvoiceByToken / markInvoiceViewed (the /i/<token> page).
 *
 * Neon over HTTP has no interactive transactions: anything that must be atomic is ONE statement (docs/invoicing.md
 * "Atomic statements": the number taken in the finalize UPDATE or the create-and-finalize INSERT, the sequence moves,
 * payment recompute, retainer claim). Reads run in parallel. Nothing here is ever on Nora's schedule, no password,
 * Stripe key, card number or CUSTOMER bank detail is stored, the activity log never holds an amount, a link, a Zelle
 * number or a bank number, and no way to pay ever adds a fee or surcharge.
 *
 * The one bank account kept is Nora's OWN receiving account, for the "ach" way ("Bank transfer (ACH)": she prints it
 * on her invoices). A person types it in Settings; it is stored encrypted (lib/crypto, TOKEN_ENC_KEY) under the
 * settings row's ownBankEnc key and decrypted only here (`paySetup`). The real numbers go to exactly two places: the
 * PDF (invoicePdf, the done state's PDF) and the customer's pay page (getInvoiceByToken). Every team page, message,
 * log line, error, CSV row and Claude tool gets the account masked ("••••6789") or nothing at all.
 */

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
 * How this invoice asks to be paid: unique, at least one; order doesn't matter (the pickers list Zelle first, the PDF
 * prints her bank account first). Availability (Zelle number set, her bank account saved, Stripe set up, card turned
 * on) is checked in the op with invoices-types checkPayWays.
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
  /** Default: the ways ticked in Settings, else Zelle and check (defaultPayWays). Claude passes these only when Nora or Cameron said how this invoice should be paid. */
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
 * (saveQuickDraft) take the same input. Dates default to today and due the same day; payWays to the ways ticked in Settings (none ticked: Zelle and check).
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
  /**
   * One per open form (the creator makes it): the invoice's id is derived from it, so pressing Make PDF again after a
   * lost response returns the invoice the first press made instead of making a second one.
   */
  requestId: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/).nullish(),
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
  /** Bank transfer (ACH) to her own account: the free-text label printed above the numbers ("Sample Bank Checking"). */
  ownBankLabel: line(80),
  /**
   * Her own account and routing numbers, typed together (digits; spaces and dashes are dropped). Checked by
   * invoices-types bankDetailsProblem, stored encrypted, never echoed. Empty or left out = keep what is saved:
   * replacing them means typing both again.
   */
  ownBankAccount: z.string().max(60, "That account number is too long.").nullish(),
  ownBankRouting: z.string().max(60, "That routing number is too long.").nullish(),
  /** Remove the saved bank details (and untick the way that needs them). */
  ownBankRemove: z.boolean(),
  achEnabled: z.boolean(),
  cardEnabled: z.boolean(),
  /** The ways ticked for new invoices. Each must have its details filled in; none ticked = the built-in default, Zelle and check. */
  payDefaults: z.array(z.enum(PAY_WAYS)).max(PAY_WAYS.length),
  termsDays: z.number().int().min(0).max(MAX_TERMS_DAYS),
  footer: block(500),
  savedItems: SavedItemsInput,
}).partial();
export type InvoiceSettingsInputT = z.input<typeof InvoiceSettingsInput>;


/* ───────────────────────── Who, links, small helpers ───────────────────────── */

const MACHINE = new Set(["claude", "public", "system"]);
const isPerson = (actor: string) => !!actor?.trim() && !MACHINE.has(actor.trim().toLowerCase());
const isClaude = (actor: string) => actor?.trim().toLowerCase() === "claude";
function people(actor: string, what: string) {
  if (!isPerson(actor)) throw new OpsError(`Only Nora or Cameron can ${what}.`);
}
function peopleOrClaude(actor: string, what: string) {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError(`Only Nora, Cameron or Claude can ${what}.`);
}

/** Rows from db.execute: Neon HTTP and PGlite both return { rows }. */
function rowsOf<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) ?? [];
}

const CARD_REFUSAL = "Not saved: that looks like a card or bank account number. Nora HQ never stores a customer's card or bank details (Stripe's own page takes them), and your own account number goes only in Settings, under Bank transfer (ACH).";
/**
 * Refuses card or bank numbers (and passwords, where `secrets`) in free text a person typed: notes, references,
 * customers, lines, the custom pay line and every text setting. The one place a bank account number is allowed is
 * saveInvoiceSettings' ownBankAccount / ownBankRouting, which never come through here.
 */
function guardText(fields: Array<[string, string | null | undefined]>, opts: { secrets?: boolean } = {}) {
  for (const [label, v] of fields) {
    if (!v) continue;
    if (looksLikeCardOrBankNumber(v)) throw new OpsError(CARD_REFUSAL);
    if (opts.secrets) {
      const m = looksLikeSecret(v);
      if (m.length) throw new OpsError(secretRefusal(label, m));
    }
  }
}

/** An invoice's lines, for guardText: a line's description is free text like any other. */
const lineTexts = (items: readonly { description: string }[] | undefined): Array<[string, string]> => (items ?? []).map((i) => ["a line", i.description]);

/** The customer link's token: 32 random bytes; only its sha256 is stored for lookup, plus an encrypted copy. */
const linkHash = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
const looksLikeToken = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(raw);
type LinkToken = { token: string; hash: string; enc: string };
function makeLinkToken(): LinkToken | null {
  const token = randomBytes(32).toString("base64url");
  try {
    return { token, hash: linkHash(token), enc: encryptJson({ t: token }) };
  } catch (e) {
    console.error("[invoices] link encrypt failed", e instanceof Error ? e.message : e);
    return null; // TOKEN_ENC_KEY missing: the invoice works without a customer link
  }
}
/** APP_URL if set, else the origin the caller saw, else a relative path (same rule as the other private links). */
function baseUrl(origin?: string | null): string {
  return process.env.APP_URL?.trim().replace(/\/+$/, "") || origin?.replace(/\/+$/, "") || "";
}
const payPageUrl = (token: string, origin?: string | null) => `${baseUrl(origin)}/i/${token}`;
function urlFromEnc(enc: string | null | undefined, origin?: string | null): string | null {
  if (!enc) return null;
  try {
    const { t } = decryptJson<{ t: string }>(enc);
    return looksLikeToken(t) ? payPageUrl(t, origin) : null;
  } catch {
    return null;
  }
}

/** An invoice row without its link secrets (what pages and tools get). */
function rowOut(inv: schema.Invoice): InvoiceRow {
  const { tokenHash: _h, tokenEnc: _e, ...rest } = inv;
  return { ...rest, payWays: sortPayWays(inv.payWays) };
}

function listRow(inv: schema.Invoice, customerName: string, today: string): InvoiceListRow {
  return {
    id: inv.id,
    number: inv.number,
    customerId: inv.customerId,
    customerName,
    status: inv.status,
    display: invoiceDisplayStatus(inv, today),
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    balanceCents: balanceCents(inv),
    daysOverdue: isOpenStatus(inv.status) ? daysOverdue(inv.dueDate, today) : 0,
    dealId: inv.dealId,
    contractId: inv.contractId,
    payWays: sortPayWays(inv.payWays),
    source: inv.source,
    sentAt: inv.sentAt,
    viewedAt: inv.viewedAt,
    paidAt: inv.paidAt,
    createdAt: inv.createdAt,
  };
}

/** "Yummy Red Bowl (Richmond)": a managed business's name as customers and the Bill to list show it. */
const clientDisplayName = (c: { name: string; location: string | null }) => (c.location ? `${c.name} (${c.location})` : c.name);
const clientAddress = (publicInfo: unknown) => readPublicInfo(publicInfo).address?.trim() || null;

/** A unique-number race (another statement wrote this number between our check and our write): retried once. */
function isNumberClash(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { code?: string; constraint?: string; message?: string };
    if (o.code === "23505" && /number/.test(`${o.constraint ?? ""} ${o.message ?? ""}`)) return true;
    if (/invoices_number_unique/.test(o.message ?? "")) return true;
  }
  return false;
}
function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { code?: string; message?: string };
    if (o.code === "23505" || /duplicate key|unique constraint/i.test(o.message ?? "")) return true;
  }
  return false;
}

/* ───────────────────────── Numbers (the SQL in docs/invoicing.md "Atomic statements") ───────────────────────── */

const SEQ = INVOICE_NUMBER_SEQUENCE;
const D = INVOICE_NUMBER_DIGITS;
/** The next free number, inside the finalize statements: nextval, skipping (and burning) any number already used. */
const TAKE = sql.raw(
  `(select n from (select lpad(v::text, greatest(${D}, length(v::text)), '0') as n from (select nextval('${SEQ}') as v from generate_series(1, 1000)) q) s ` +
    `where not exists (select 1 from invoices x where x.number = s.n) limit 1)`,
);
const NEXT = `(select case when is_called then last_value + 1 else last_value end from ${SEQ})`;
const MAX_USED = `(select coalesce(max(number::bigint), 0) + 1 from invoices where number ~ '^[0-9]{1,18}$')`;

/** Moves the sequence past every all-digit number used (after an import). Never backwards. ONE setval. */
async function bumpSequence(): Promise<void> {
  const db = await getDb();
  await db.execute(sql.raw(`select setval('${SEQ}', greatest(${NEXT}, ${MAX_USED}, ${FIRST_INVOICE_NUMBER}), false)`));
}

export async function nextInvoiceNumber(): Promise<string> {
  const db = await getDb();
  const r = await db.execute(sql.raw(
    `select min(g)::text as next from generate_series(${NEXT}, ${NEXT} + 1000) g ` +
      `where not exists (select 1 from invoices x where x.number = lpad(g::text, greatest(${D}, length(g::text)), '0'))`,
  ));
  const v = rowsOf<{ next: string | null }>(r)[0]?.next;
  return formatInvoiceNumber(v ? Number(v) : FIRST_INVOICE_NUMBER);
}

export async function setNextInvoiceNumber(n: number, actor: string): Promise<string> {
  people(actor, "set the next invoice number");
  const want = NextNumberInput.parse(n);
  const db = await getDb();
  await db.execute(sql.raw(`select setval('${SEQ}', greatest(${Math.trunc(want)}::bigint, ${MAX_USED}), false)`));
  const next = await nextInvoiceNumber();
  await logActivity({ actor, action: "invoice.next_number", entityType: "app_setting", entityId: SEQ, summary: `Set the next invoice number to ${next}` });
  return next;
}

/* ───────────────────────── Settings and saved lines ───────────────────────── */

async function settingsValue(): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, schema.NORA_PAYMENT_KEY));
  return row?.value ?? null;
}

/**
 * The settings, plus Nora's own bank details DECRYPTED. `bank` is for the PDF and the customer's pay page only; a team
 * page, a message or a tool uses `settings` (which holds the account's last digits, never the number) and
 * maskedBankDetails(settings).
 */
type PaySetup = { settings: InvoiceSettings; bank: BankDetails | null };

/** Her account and routing numbers out of the stored row. null when none are saved or they can't be read. Never logs. */
function readBank(value: Record<string, unknown> | null | undefined): BankDetails | null {
  const enc = value?.[OWN_BANK_ENC_KEY];
  if (typeof enc !== "string" || !enc) return null;
  try {
    const { a, r } = decryptJson<{ a?: unknown; r?: unknown }>(enc);
    return typeof a === "string" && isBankAccountNumber(a) && typeof r === "string" && isRoutingNumber(r) ? { account: a, routing: r } : null;
  } catch {
    return null; // TOKEN_ENC_KEY missing or changed: Settings says "type them again" (settings.ownBankUnreadable)
  }
}

function paySetupOf(value: Record<string, unknown> | null | undefined): PaySetup {
  const bank = readBank(value);
  return { settings: readInvoiceSettings(value, bank), bank };
}

async function paySetup(): Promise<PaySetup> {
  return paySetupOf(await settingsValue());
}

/** The settings as every page may see them: the bank account masked to its last digits, never the number. */
export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  return (await paySetup()).settings;
}

/** ONE statement: value = coalesce(value, '{}') || patch. Returns the merged settings. */
async function mergeSettings(patch: Record<string, unknown>, actor: string): Promise<PaySetup> {
  const db = await getDb();
  const now = new Date();
  const [row] = await db.insert(schema.appSettings).values({ key: schema.NORA_PAYMENT_KEY, value: patch, updatedBy: actor, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: sql`coalesce(${schema.appSettings.value}, '{}'::jsonb) || excluded.value`, updatedBy: actor, updatedAt: now },
    })
    .returning({ value: schema.appSettings.value });
  return paySetupOf(row?.value);
}

function savedItemsOut(items: z.output<typeof SavedItemsInput>): SavedItem[] {
  const used = new Set<string>();
  return items.map((i) => {
    let id = (i.id ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    if (!id || used.has(id)) id = newId("item_").slice(0, 40);
    used.add(id);
    return { id, description: i.description, unitCents: i.unitCents };
  });
}

const SETTINGS_TEXT_KEYS = ["line", "fromName", "fromEmail", "fromPhone", "fromAddress", "zelle", "zelleName", "checkPayee", "checkAddress", "venmo", "paypal", "ownBankLabel", "footer"] as const;

const NO_ENC_KEY =
  "Not saved: bank details are stored encrypted, and this server has no encryption key yet (TOKEN_ENC_KEY). Add the key, then type them again. " +
  "Everything else still works: clear the account and routing boxes to save the rest.";
const BANK_LABEL_REFUSAL = "Not saved: the bank label is a name, like “Sample Bank Checking”. The account and routing numbers go in their own boxes.";

export async function saveInvoiceSettings(input: InvoiceSettingsInputT, actor: string): Promise<InvoiceSettings> {
  people(actor, "change how Nora gets paid");
  const v = InvoiceSettingsInput.parse(input);
  const patch: Record<string, unknown> = {};
  for (const k of SETTINGS_TEXT_KEYS) {
    if (v[k] === undefined) continue;
    patch[k] = v[k] ?? null;
  }
  // Every text setting still refuses a card or bank number: the account number has ONE home, its own box (below).
  guardText(SETTINGS_TEXT_KEYS.map((k) => [`the ${k} setting`, (patch[k] as string | null | undefined) ?? null]), { secrets: true });
  if (bankLabelHoldsNumber(patch.ownBankLabel as string | null | undefined)) throw new OpsError(BANK_LABEL_REFUSAL);
  if (v.achEnabled !== undefined) patch.achEnabled = v.achEnabled;
  if (v.cardEnabled !== undefined) patch.cardEnabled = v.cardEnabled;
  if (v.termsDays !== undefined) patch.termsDays = v.termsDays;
  if (v.savedItems !== undefined) {
    patch.savedItems = savedItemsOut(v.savedItems);
    guardText((patch.savedItems as SavedItem[]).map((i) => ["a saved line", i.description]));
  }

  /* Her own bank account: typed as a pair, checked without ever repeating it, stored encrypted. */
  const typedAccount = (v.ownBankAccount ?? "").trim();
  const typedRouting = (v.ownBankRouting ?? "").trim();
  let typed: BankDetails | null = null;
  if (typedAccount || typedRouting) {
    const problem = bankDetailsProblem(typedAccount, typedRouting);
    if (problem) throw new OpsError(`Not saved: ${problem}`);
    typed = { account: bankDigits(typedAccount)!, routing: bankDigits(typedRouting)! };
  }
  const touchesBank = !!typed || v.ownBankRemove === true;
  const current = touchesBank || v.payDefaults !== undefined ? await settingsValue() : null;
  const had = typeof current?.[OWN_BANK_ENC_KEY] === "string" && !!current[OWN_BANK_ENC_KEY];
  const before = touchesBank || v.payDefaults !== undefined ? readBank(current) : null;
  let bankChange: "added" | "changed" | "removed" | null = null;
  let after = before; // her bank details once this save lands
  if (typed) {
    if (!before || before.account !== typed.account || before.routing !== typed.routing) {
      try {
        patch[OWN_BANK_ENC_KEY] = encryptJson({ a: typed.account, r: typed.routing });
      } catch {
        throw new OpsError(NO_ENC_KEY); // never the cause: it could carry what was typed
      }
      bankChange = had ? "changed" : "added";
      after = typed;
    }
  } else if (v.ownBankRemove === true && had) {
    patch[OWN_BANK_ENC_KEY] = null;
    bankChange = "removed";
    after = null;
  }

  /* The ways ticked for new invoices: each needs its details filled in, as they will be once this save lands. */
  if (v.payDefaults !== undefined) {
    const ways = DEFAULTABLE_PAY_WAYS.filter((w) => v.payDefaults!.includes(w));
    const next = readInvoiceSettings({ ...(current ?? {}), ...patch }, after);
    const avail = availablePayWays(next, stripeConfigured());
    for (const w of ways) if (!avail[w].ok) throw new OpsError(`Not saved: ${PAY_WAY_LABEL[w]} is ticked for new invoices but isn't ready. ${avail[w].why} Or untick it.`);
    patch.payDefaults = ways;
  } else if (bankChange === "removed") {
    const ticked = readInvoiceSettings(current).payDefaults;
    if (ticked.includes("ach")) patch.payDefaults = ticked.filter((w) => w !== "ach");
  }

  if (!Object.keys(patch).length) return getInvoiceSettings();
  const out = await mergeSettings(patch, actor);
  // Never the values: the settings hold a phone number, an address and (encrypted) her bank account. The log says
  // only THAT the bank details were added, changed or removed.
  const others = Object.keys(patch).filter((k) => k !== OWN_BANK_ENC_KEY).length;
  await Promise.all([
    others ? logActivity({ actor, action: "invoice_settings.saved", entityType: "app_setting", entityId: schema.NORA_PAYMENT_KEY, summary: `Updated the invoice settings (${others} ${others === 1 ? "field" : "fields"})` }) : null,
    bankChange ? logActivity({ actor, action: `invoice_settings.bank_${bankChange}`, entityType: "app_setting", entityId: schema.NORA_PAYMENT_KEY, summary: `${bankChange === "added" ? "Added" : bankChange === "changed" ? "Changed" : "Removed"} the bank details for bank transfer (ACH)` }) : null,
  ]);
  return out.settings;
}

export async function getSavedItems(): Promise<SavedItem[]> {
  return (await getInvoiceSettings()).savedItems;
}

export async function saveSavedItems(items: SavedItemInputT[], actor: string): Promise<SavedItem[]> {
  people(actor, "change the saved lines");
  const list = savedItemsOut(SavedItemsInput.parse(items));
  guardText(list.map((i) => ["a saved line", i.description]));
  const out = await mergeSettings({ savedItems: list }, actor);
  await logActivity({ actor, action: "invoice_settings.saved_items", entityType: "app_setting", entityId: schema.NORA_PAYMENT_KEY, summary: `Updated the saved invoice lines (${list.length})` });
  return out.settings.savedItems;
}

/** The creator's one-time ask (From and Zelle) → a settings patch, or null when nothing was typed. */
function setupPatch(setup: z.output<typeof QuickInvoiceInput>["setup"]): Record<string, unknown> | null {
  if (!setup) return null;
  const patch: Record<string, unknown> = {};
  if (setup.fromName) patch.fromName = setup.fromName;
  if (setup.fromAddress) patch.fromAddress = setup.fromAddress;
  if (setup.zelle) patch.zelle = setup.zelle;
  if (!Object.keys(patch).length) return null;
  guardText(Object.entries(patch).map(([k, v]) => [`your ${k}`, v as string]), { secrets: true });
  return patch;
}

/* ───────────────────────── Customers ───────────────────────── */

async function customerRow(id: string): Promise<schema.Customer | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
  return row ?? null;
}

async function checkClientForCustomer(clientId: string, exceptCustomerId?: string) {
  const db = await getDb();
  const [[client], [taken]] = await Promise.all([
    db.select({ id: schema.clients.id, kind: schema.clients.kind }).from(schema.clients).where(eq(schema.clients.id, clientId)),
    db.select({ id: schema.customers.id, name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.clientId, clientId)),
  ]);
  if (!client) throw new OpsError(`No business with id "${clientId}".`);
  if (client.kind === "creator") throw new OpsError("That's Nora's own workspace, not a business to bill.");
  if (taken && taken.id !== exceptCustomerId) throw new OpsError(`That business is already the customer "${taken.name}".`);
}

export async function createCustomer(input: CustomerInputT, actor: string): Promise<schema.Customer> {
  people(actor, "add a customer");
  const v = CustomerInput.parse(input);
  guardText([["the notes", v.notes], ["the address", v.billingAddress]]);
  if (v.clientId) await checkClientForCustomer(v.clientId);
  const db = await getDb();
  const [row] = await db.insert(schema.customers).values({
    id: newId("cus_"),
    name: v.name,
    nameKey: customerNameKey(v.name),
    contactName: v.contactName ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    billingAddress: v.billingAddress ?? null,
    notes: v.notes ?? null,
    clientId: v.clientId ?? null,
    lang: v.lang ?? null,
    source: v.clientId ? "client" : "manual",
    createdBy: actor,
  }).returning();
  await logActivity({ actor, action: "customer.created", entityType: "customer", entityId: row.id, clientId: row.clientId, summary: `Added the customer ${row.name}` });
  return row;
}

export async function updateCustomer(id: string, patch: z.input<typeof CustomerPatch>, actor: string): Promise<schema.Customer> {
  people(actor, "edit a customer");
  const v = CustomerPatch.parse(patch);
  guardText([["the notes", v.notes], ["the address", v.billingAddress]]);
  if (v.clientId) await checkClientForCustomer(v.clientId, id);
  const set: Partial<typeof schema.customers.$inferInsert> = { updatedAt: new Date() };
  if (v.name !== undefined) {
    set.name = v.name;
    set.nameKey = customerNameKey(v.name);
  }
  for (const k of ["contactName", "email", "phone", "billingAddress", "notes", "clientId", "lang"] as const) {
    if (v[k] !== undefined) (set as Record<string, unknown>)[k] = v[k] ?? null;
  }
  const db = await getDb();
  const [row] = await db.update(schema.customers).set(set).where(eq(schema.customers.id, id)).returning();
  if (!row) throw new OpsError("That customer is gone.");
  await logActivity({ actor, action: "customer.updated", entityType: "customer", entityId: id, clientId: row.clientId, summary: `Updated the customer ${row.name}` });
  return row;
}

export async function setCustomerArchived(id: string, archived: boolean, actor: string): Promise<schema.Customer> {
  people(actor, archived ? "archive a customer" : "bring back a customer");
  const db = await getDb();
  const [row] = await db.update(schema.customers).set({ archived, updatedAt: new Date() }).where(eq(schema.customers.id, id)).returning();
  if (!row) throw new OpsError("That customer is gone.");
  await logActivity({ actor, action: archived ? "customer.archived" : "customer.restored", entityType: "customer", entityId: id, clientId: row.clientId, summary: `${archived ? "Archived" : "Brought back"} the customer ${row.name}` });
  return row;
}

export async function deleteCustomer(id: string, actor: string): Promise<void> {
  people(actor, "delete a customer");
  const db = await getDb();
  // ONE statement: deleted only when no invoice points at them (archive instead).
  const [row] = await db.delete(schema.customers)
    .where(and(eq(schema.customers.id, id), sql`not exists (select 1 from invoices i where i.customer_id = ${schema.customers.id})`))
    .returning({ name: schema.customers.name, clientId: schema.customers.clientId });
  if (!row) {
    if (await customerRow(id)) throw new OpsError("This customer has invoices, so they can't be deleted. Archive them instead.");
    return;
  }
  await logActivity({ actor, action: "customer.deleted", entityType: "customer", entityId: id, clientId: row.clientId, summary: `Deleted the customer ${row.name}` });
}

export async function customerForClient(clientId: string, actor: string): Promise<schema.Customer> {
  peopleOrClaude(actor, "add a customer");
  const db = await getDb();
  const [[existing], [client]] = await Promise.all([
    db.select().from(schema.customers).where(eq(schema.customers.clientId, clientId)),
    db.select().from(schema.clients).where(eq(schema.clients.id, clientId)),
  ]);
  if (existing) return existing;
  if (!client) throw new OpsError(`No business with id "${clientId}".`);
  if (client.kind === "creator") throw new OpsError("That's Nora's own workspace, not a business to bill.");
  const name = clientDisplayName(client);
  const keys = [...new Set([customerNameKey(name), customerNameKey(client.name)])];
  try {
    // A customer with the same name and no business yet (an import, or typed in the creator) becomes this business's.
    const [same] = await db.update(schema.customers).set({ clientId, updatedAt: new Date() })
      .where(sql`${schema.customers.id} = (select c.id from customers c where c.client_id is null and not c.archived and c.name_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) order by c.created_at limit 1)`)
      .returning();
    if (same) {
      await logActivity({ actor, action: "customer.linked", entityType: "customer", entityId: same.id, clientId, summary: `Linked the customer ${same.name} to the business ${name}` });
      return same;
    }
    const [row] = await db.insert(schema.customers).values({
      id: newId("cus_"),
      name,
      nameKey: customerNameKey(name),
      email: client.ownerEmail?.trim().toLowerCase() || null,
      billingAddress: clientAddress(client.publicInfo),
      clientId,
      source: "client",
      createdBy: actor,
    }).onConflictDoNothing({ target: schema.customers.clientId }).returning();
    if (row) {
      await logActivity({ actor, action: "customer.created", entityType: "customer", entityId: row.id, clientId, summary: `Added ${name} as a customer` });
      return row;
    }
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  const [winner] = await db.select().from(schema.customers).where(eq(schema.customers.clientId, clientId));
  if (!winner) throw new OpsError("Couldn't make the customer for that business. Try again.");
  return winner;
}

export async function customerForDeal(dealId: string, actor: string): Promise<schema.Customer> {
  peopleOrClaude(actor, "add a customer");
  const db = await getDb();
  const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) throw new OpsError(`No deal with id "${dealId}".`);
  if (deal.clientId) return customerForClient(deal.clientId, actor);
  const key = customerNameKey(deal.businessName);
  const email = deal.contactEmail?.trim().toLowerCase() || null;
  const same = await db.select().from(schema.customers).where(and(eq(schema.customers.nameKey, key), eq(schema.customers.archived, false))).orderBy(asc(schema.customers.createdAt));
  const match = same.find((c) => !!email && c.email?.toLowerCase() === email) ?? same.find((c) => !c.email || !email);
  if (match) return match;
  const [row] = await db.insert(schema.customers).values({
    id: newId("cus_"),
    name: cleanLine(deal.businessName).slice(0, 160) || "Customer",
    nameKey: key,
    contactName: deal.contactName,
    email,
    phone: deal.contactPhone,
    billingAddress: deal.address,
    source: "deal",
    createdBy: actor,
  }).returning();
  await logActivity({ actor, action: "customer.created", entityType: "customer", entityId: row.id, summary: `Added ${row.name} as a customer (from their deal)` });
  return row;
}

/** Per-customer figures from their invoices and payments (one grouped read each). */
async function customerFigures(today: string, ids?: string[]) {
  const db = await getDb();
  const y = today.slice(0, 4);
  const inv = schema.invoices;
  const open = sql`${inv.status} in ('sent', 'partially_paid')`;
  const owed = sql`greatest(${inv.totalCents} - ${inv.paidCents}, 0)`;
  const [figs, paid, rets] = await Promise.all([
    db.select({
      customerId: inv.customerId,
      invoiceCount: sql`count(*) filter (where ${inv.status} <> 'void')`.mapWith(Number),
      openCount: sql`count(*) filter (where ${open})`.mapWith(Number),
      outstanding: sql`coalesce(sum(${owed}) filter (where ${open}), 0)`.mapWith(Number),
      overdue: sql`coalesce(sum(${owed}) filter (where ${open} and ${inv.dueDate} < ${today}), 0)`.mapWith(Number),
      invoicedAll: sql`coalesce(sum(${inv.totalCents}) filter (where ${inv.status} in ('sent', 'partially_paid', 'paid')), 0)`.mapWith(Number),
      lastAt: sql<string | Date | null>`max(coalesce(${inv.sentAt}, ${inv.createdAt})) filter (where ${inv.status} <> 'void')`,
    }).from(inv).where(ids ? inArray(inv.customerId, ids) : undefined).groupBy(inv.customerId),
    db.select({
      customerId: inv.customerId,
      paidYear: sql`coalesce(sum(${schema.invoicePayments.amountCents}) filter (where ${schema.invoicePayments.paidOn} like ${`${y}-%`}), 0)`.mapWith(Number),
      paidAll: sql`coalesce(sum(${schema.invoicePayments.amountCents}), 0)`.mapWith(Number),
    }).from(schema.invoicePayments).innerJoin(inv, eq(inv.id, schema.invoicePayments.invoiceId))
      .where(ids ? inArray(inv.customerId, ids) : undefined).groupBy(inv.customerId),
    db.select({ customerId: schema.retainers.customerId, active: sql`count(*) filter (where ${schema.retainers.active})`.mapWith(Number) })
      .from(schema.retainers).where(ids ? inArray(schema.retainers.customerId, ids) : undefined).groupBy(schema.retainers.customerId),
  ]);
  return {
    figs: new Map(figs.map((f) => [f.customerId, f])),
    paid: new Map(paid.map((p) => [p.customerId, p])),
    rets: new Map(rets.map((r) => [r.customerId, r.active])),
  };
}

function summaryOf(c: schema.Customer, f: Awaited<ReturnType<typeof customerFigures>>, clients: Map<string, { id: string; name: string }>): CustomerSummary {
  const fig = f.figs.get(c.id);
  const lastAt = fig?.lastAt ? new Date(fig.lastAt as string) : null;
  return {
    ...c,
    invoiceCount: fig?.invoiceCount ?? 0,
    openCount: fig?.openCount ?? 0,
    outstandingCents: fig?.outstanding ?? 0,
    overdueCents: fig?.overdue ?? 0,
    paidThisYearCents: f.paid.get(c.id)?.paidYear ?? 0,
    lastInvoiceAt: lastAt && !Number.isNaN(lastAt.getTime()) ? lastAt : null,
    activeRetainers: f.rets.get(c.id) ?? 0,
    client: c.clientId ? clients.get(c.clientId) ?? null : null,
  };
}

async function clientNamesFor(ids: (string | null)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map<string, { id: string; name: string }>();
  const db = await getDb();
  const rows = await db.select({ id: schema.clients.id, name: schema.clients.name, location: schema.clients.location }).from(schema.clients).where(inArray(schema.clients.id, want));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: clientDisplayName(r) }]));
}

const likeText = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export async function listCustomers(opts: { includeArchived?: boolean; q?: string; today?: string } = {}): Promise<CustomerSummary[]> {
  const t = opts.today ?? todayNY();
  const db = await getDb();
  const q = cleanLine(opts.q ?? "").slice(0, 80);
  const where = and(
    opts.includeArchived ? undefined : eq(schema.customers.archived, false),
    q ? or(ilike(schema.customers.name, likeText(q)), ilike(schema.customers.contactName, likeText(q))) : undefined,
  );
  const [rows, figs] = await Promise.all([
    db.select().from(schema.customers).where(where).orderBy(asc(schema.customers.name)).limit(1000),
    customerFigures(t),
  ]);
  const clients = await clientNamesFor(rows.map((r) => r.clientId));
  return rows.map((c) => summaryOf(c, figs, clients));
}

export async function getCustomer(id: string, opts: { today?: string } = {}): Promise<CustomerDetail | null> {
  const t = opts.today ?? todayNY();
  const db = await getDb();
  const [c, figs, invoices, payments, retainers, contracts, savedItems] = await Promise.all([
    customerRow(id),
    customerFigures(t, [id]),
    listInvoices({ customerId: id, status: "everything", today: t, limit: 1000 }),
    db.select({ p: schema.invoicePayments, invoiceNumber: schema.invoices.number }).from(schema.invoicePayments)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoicePayments.invoiceId))
      .where(eq(schema.invoices.customerId, id)).orderBy(desc(schema.invoicePayments.paidOn), desc(schema.invoicePayments.createdAt)),
    listRetainers(id),
    contractsForCustomer(id),
    getSavedItems(),
  ]);
  if (!c) return null;
  const clients = await clientNamesFor([c.clientId]);
  const byContract = contracts.length ? await invoicesForContracts(contracts.map((k) => k.id), { today: t }) : {};
  const retainerMonth = new Map(retainers.filter((r) => r.contractId).map((r) => [r.contractId!, r.lastRunMonth]));
  const summary = summaryOf(c, figs, clients);
  return {
    ...summary,
    invoices,
    payments: payments.map((r) => ({ ...r.p, invoiceNumber: r.invoiceNumber })),
    retainers,
    contracts: contracts.map((k) => {
      const invs = byContract[k.id] ?? [];
      return { ...k, invoices: invs, nextSteps: contractNextSteps(k, invs, { hasRetainer: retainerMonth.has(k.id), retainerMonth: retainerMonth.get(k.id) ?? null, savedItems, today: t }) };
    }),
    paidAllTimeCents: figs.paid.get(id)?.paidAll ?? 0,
    invoicedAllTimeCents: figs.figs.get(id)?.invoicedAll ?? 0,
  };
}

/* ───────────────────────── Bill to (the creator's typeahead) ───────────────────────── */

function customerOption(c: schema.Customer, o: { hasPast: boolean; hasLast?: boolean; last?: LastInvoice | null; clientAddress?: string | null }): BillToOption {
  return {
    key: `customer:${c.id}`,
    kind: "customer",
    id: c.id,
    name: c.name,
    nameKey: c.nameKey,
    address: c.billingAddress?.trim() || o.clientAddress || null,
    contactName: c.contactName,
    email: c.email,
    lang: c.lang,
    customerId: c.id,
    clientId: c.clientId,
    hasPastInvoices: o.hasPast,
    hasLast: o.hasLast ?? false,
    ...(o.last !== undefined ? { last: o.last } : {}),
  };
}

/**
 * An invoice she MADE: sent (paid or not), and not an import. "Same as last time" repeats the newest of these, never
 * an unsent draft and never a Skynova import's placeholder line.
 */
const MADE = sql`${schema.invoices.status} in ('sent', 'partially_paid', 'paid') and ${schema.invoices.source} <> 'import'`;
const MADE_AT = sql`coalesce(${schema.invoices.sentAt}, ${schema.invoices.createdAt})`;
/** How many of the most recently billed customers come with their last lines in the page (the rest are fetched on pick). */
const LAST_WITH_PAGE = 40;

export async function billToOptions(opts: { limit?: number; settings?: Promise<InvoiceSettings> } = {}): Promise<BillToOption[]> {
  const limit = Math.min(Math.max(opts.limit ?? 400, 1), 2000);
  const db = await getDb();
  const inv = schema.invoices;
  const [customers, counts, lasts, clients, deals, settings] = await Promise.all([
    db.select().from(schema.customers).where(eq(schema.customers.archived, false)),
    db.select({
      customerId: inv.customerId,
      n: sql`count(*) filter (where ${inv.status} <> 'void')`.mapWith(Number),
      made: sql`count(*) filter (where ${MADE})`.mapWith(Number),
      last: sql<string | Date | null>`max(${inv.createdAt})`,
    }).from(inv).groupBy(inv.customerId),
    // The last invoice she made for each of the most recently billed customers, in ONE read: "Same as last time" is
    // then ready the moment one of them is picked.
    db.selectDistinctOn([inv.customerId]).from(inv)
      .where(and(MADE, inArray(inv.customerId, db.select({ id: inv.customerId }).from(inv).groupBy(inv.customerId).orderBy(desc(sql`max(${inv.createdAt})`)).limit(LAST_WITH_PAGE))))
      .orderBy(inv.customerId, desc(MADE_AT), desc(inv.createdAt)),
    db.select({ id: schema.clients.id, name: schema.clients.name, location: schema.clients.location, ownerEmail: schema.clients.ownerEmail, publicInfo: schema.clients.publicInfo })
      .from(schema.clients).where(and(eq(schema.clients.archived, false), ne(schema.clients.kind, "creator"))).orderBy(asc(schema.clients.sortOrder), asc(schema.clients.name)),
    db.select({ id: schema.deals.id, businessName: schema.deals.businessName, clientId: schema.deals.clientId, contactName: schema.deals.contactName, contactEmail: schema.deals.contactEmail, address: schema.deals.address })
      .from(schema.deals).where(ne(schema.deals.status, "cancelled")).orderBy(desc(schema.deals.createdAt)).limit(300),
    opts.settings ?? getInvoiceSettings(),
  ]);
  const stats = new Map(counts.map((c) => [c.customerId, c]));
  const lastOfCustomer = new Map(lasts.map((row) => [row.customerId, lastInvoiceOf(row, settings.savedItems)]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const out: BillToOption[] = [];
  const keys = new Set<string>();
  const lastOf = (id: string) => {
    const v = stats.get(id)?.last;
    return v ? new Date(v as string).getTime() || 0 : 0;
  };
  // Customers first, the most recently billed first (the list's top before anything is typed).
  const sorted = [...customers].sort((a, b) => lastOf(b.id) - lastOf(a.id) || a.name.localeCompare(b.name));
  const coveredClients = new Set<string>();
  for (const c of sorted) {
    const cl = c.clientId ? clientById.get(c.clientId) : undefined;
    if (c.clientId) coveredClients.add(c.clientId);
    const hasLast = (stats.get(c.id)?.made ?? 0) > 0;
    // Their last lines when the page has them; null when there is nothing to repeat; undefined = fetched when picked.
    const last = lastOfCustomer.get(c.id) ?? (hasLast ? undefined : null);
    out.push(customerOption(c, { hasPast: (stats.get(c.id)?.n ?? 0) > 0, hasLast, last, clientAddress: cl ? clientAddress(cl.publicInfo) : null }));
    keys.add(c.nameKey);
  }
  for (const cl of clients) {
    if (coveredClients.has(cl.id)) continue;
    const name = clientDisplayName(cl);
    const nameKey = customerNameKey(name);
    if (keys.has(nameKey)) continue;
    keys.add(nameKey);
    out.push({ key: `client:${cl.id}`, kind: "client", id: cl.id, name, nameKey, address: clientAddress(cl.publicInfo), contactName: null, email: cl.ownerEmail?.trim().toLowerCase() || null, lang: null, customerId: null, clientId: cl.id, hasPastInvoices: false, hasLast: false, last: null });
  }
  for (const d of deals) {
    if (d.clientId && (coveredClients.has(d.clientId) || clientById.has(d.clientId))) continue;
    const nameKey = customerNameKey(d.businessName);
    if (!nameKey || keys.has(nameKey)) continue;
    keys.add(nameKey);
    out.push({ key: `deal:${d.id}`, kind: "deal", id: d.id, name: d.businessName, nameKey, address: d.address?.trim() || null, contactName: d.contactName, email: d.contactEmail?.trim().toLowerCase() || null, lang: null, customerId: null, clientId: null, hasPastInvoices: false, hasLast: false, last: null });
  }
  return out.slice(0, limit);
}

export async function lastInvoiceForCustomer(customerId: string): Promise<LastInvoice | null> {
  const db = await getDb();
  const [[row], settings] = await Promise.all([
    db.select().from(schema.invoices).where(and(eq(schema.invoices.customerId, customerId), MADE))
      .orderBy(desc(MADE_AT), desc(schema.invoices.createdAt)).limit(1),
    getInvoiceSettings(),
  ]);
  return row ? lastInvoiceOf(row, settings.savedItems) : null;
}

function lastInvoiceOf(row: schema.Invoice, saved: readonly SavedItem[]): LastInvoice {
  return {
    id: row.id,
    number: row.number,
    issueDate: row.issueDate,
    lines: sameAsLastTime(row.items, saved),
    payWays: sortPayWays(row.payWays),
    payNote: row.payNote,
    notes: row.notes,
    lang: row.lang,
    discountCents: row.discountCents,
    discountLabel: row.discountLabel,
  };
}

/* ───────────────────────── The creator's context and prefills ───────────────────────── */

const DEAL_LABEL: Record<string, string> = { ig_reel: "Instagram Reel", ig_post: "Instagram post", ig_story: "Instagram Stories", tiktok: "TikTok", photos: "Photos", other: "Other content" };
/** "Collab: Instagram Reel, TikTok" from a deal's deliverables (each kind once, in order). */
function dealLine(kinds: readonly string[]): string {
  const labels = [...new Set(kinds)].map((k) => DEAL_LABEL[k] ?? k);
  return labels.length ? `Collab: ${labels.join(", ")}` : "Collab";
}

/**
 * What a new invoice starts with in the creator: the ways ticked in Settings (none ticked: Zelle and check) that are
 * available right now. The very first time, the creator asks for her name, address and Zelle number on the invoice
 * itself (invoiceSetupMissing): a way that only waits for one of those counts as there, so her first invoice starts
 * like every later one. Make PDF still checks the ways against what is really saved.
 */
function newInvoiceWays(settings: InvoiceSettings): PayWay[] {
  const avail = availablePayWays(settings, stripeConfigured());
  const missing = invoiceSetupMissing(settings);
  const yes = { ok: true, why: null };
  return defaultPayWays(settings, { ...avail, ...(missing.includes("zelle") ? { zelle: yes } : {}), ...(missing.includes("fromName") ? { check: yes } : {}) });
}

function blankPrefill(settings: InvoiceSettings, today: string): InvoicePrefill {
  return {
    billTo: null,
    newCustomer: null,
    lines: [],
    issueDate: today,
    dueDate: addDaysYmd(today, settings.termsDays),
    payWays: newInvoiceWays(settings),
    payNote: null,
    notes: settings.footer,
    lang: null,
    dealId: null,
    contractId: null,
    contractPart: null,
    draftId: null,
    source: "blank",
    note: null,
  };
}

const creatorLineOf = (i: InvoiceItem, saved: readonly SavedItem[]): CreatorLine => ({
  description: i.description,
  quantity: i.quantity,
  unitCents: i.unitCents,
  savedItemId: saved.find((s) => s.description.trim().toLowerCase() === i.description.trim().toLowerCase())?.id ?? null,
});

type PrefillDeps = { today: string; settings: Promise<InvoiceSettings>; options: Promise<BillToOption[]> };

/** The Bill to option for a customer, a business or a deal, from the list (or null when it isn't in it). */
function findOption(options: BillToOption[], want: { customerId?: string | null; clientId?: string | null; dealId?: string | null; nameKey?: string | null }): BillToOption | null {
  if (want.customerId) {
    const o = options.find((x) => x.customerId === want.customerId);
    if (o) return o;
  }
  if (want.clientId) {
    // The managed business itself, or (once it has one) its customer: a deal made from Nora's schedule carries the
    // business but keeps the schedule's name, so the name alone would open it as a new customer.
    const o = options.find((x) => x.clientId === want.clientId);
    if (o) return o;
  }
  if (want.dealId) {
    const o = options.find((x) => x.key === `deal:${want.dealId}`);
    if (o) return o;
  }
  if (want.nameKey) return options.find((x) => x.nameKey === want.nameKey) ?? null;
  return null;
}

async function withLast(prefill: InvoicePrefill, saved: readonly SavedItem[]): Promise<InvoicePrefill> {
  const cid = prefill.billTo?.customerId;
  if (!cid || !prefill.billTo?.hasLast || prefill.source === "draft") return { ...prefill, last: null };
  if (prefill.billTo.last !== undefined) return { ...prefill, last: prefill.billTo.last }; // it came with the Bill to list
  const db = await getDb();
  const [row] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.customerId, cid), MADE)).orderBy(desc(MADE_AT), desc(schema.invoices.createdAt)).limit(1);
  return { ...prefill, last: row ? lastInvoiceOf(row, saved) : null };
}

async function prefillFromDraft(draftId: string, d: PrefillDeps): Promise<InvoicePrefill | null> {
  const db = await getDb();
  const [[inv], settings, options] = await Promise.all([db.select().from(schema.invoices).where(eq(schema.invoices.id, draftId)), d.settings, d.options]);
  if (!inv || inv.status !== "draft") return null;
  let billTo = findOption(options, { customerId: inv.customerId });
  if (!billTo) {
    const c = await customerRow(inv.customerId);
    if (c) billTo = customerOption(c, { hasPast: true, last: null });
  }
  const issueDate = inv.issueDate ?? d.today;
  return {
    billTo,
    newCustomer: null,
    lines: inv.items.map((i) => creatorLineOf(i, settings.savedItems)),
    issueDate,
    dueDate: inv.dueDate ?? addDaysYmd(issueDate, inv.termsDays),
    payWays: sortPayWays(inv.payWays),
    payNote: inv.payNote,
    notes: inv.notes,
    lang: inv.lang,
    dealId: inv.dealId,
    contractId: inv.contractId,
    contractPart: null,
    draftId: inv.id,
    source: "draft",
    note: inv.source === "claude" ? "A draft Claude made. Check it, then make the PDF." : inv.source === "retainer" ? "This month's retainer draft." : "Editing a draft.",
    discountCents: inv.discountCents,
    discountLabel: inv.discountLabel,
    privateNotes: inv.privateNotes,
    last: null,
  };
}

async function prefillFromDeal(dealId: string, d: PrefillDeps): Promise<InvoicePrefill | null> {
  const db = await getDb();
  const [[deal], kinds, [draft], settings, options] = await Promise.all([
    db.select().from(schema.deals).where(eq(schema.deals.id, dealId)),
    db.select({ kind: schema.dealDeliverables.kind }).from(schema.dealDeliverables).where(eq(schema.dealDeliverables.dealId, dealId)).orderBy(asc(schema.dealDeliverables.sortOrder)),
    db.select({ id: schema.invoices.id }).from(schema.invoices).where(and(eq(schema.invoices.dealId, dealId), eq(schema.invoices.status, "draft"))).orderBy(desc(schema.invoices.createdAt)).limit(1),
    d.settings,
    d.options,
  ]);
  if (!deal) return null;
  if (draft) return prefillFromDraft(draft.id, d); // a deal that already has a draft opens that draft
  const nameKey = customerNameKey(deal.businessName);
  const billTo = findOption(options, { clientId: deal.clientId, nameKey }) ?? findOption(options, { dealId });
  const due = deal.paymentDueDate && deal.paymentDueDate >= d.today ? deal.paymentDueDate : addDaysYmd(d.today, settings.termsDays);
  return withLast({
    ...blankPrefill(settings, d.today),
    billTo,
    newCustomer: billTo ? null : { name: deal.businessName, contactName: deal.contactName, email: deal.contactEmail, billingAddress: deal.address, lang: null },
    lines: [{ description: dealLine(kinds.map((k) => k.kind)), quantity: 1, unitCents: deal.amountCents && deal.amountCents > 0 ? deal.amountCents : null, savedItemId: null }],
    dueDate: due,
    lang: billTo?.lang ?? null,
    dealId,
    source: "deal",
    note: `From the ${deal.businessName} deal`,
  }, settings.savedItems);
}

async function prefillFromContract(contractId: string, part: ContractPart | null, d: PrefillDeps): Promise<InvoicePrefill | null> {
  const db = await getDb();
  const [[c], billed, settings, options] = await Promise.all([
    db.select().from(schema.contracts).where(eq(schema.contracts.id, contractId)),
    db.select({ items: schema.invoices.items }).from(schema.invoices).where(and(eq(schema.invoices.contractId, contractId), ne(schema.invoices.status, "void"))),
    d.settings,
    d.options,
  ]);
  if (!c) return null;
  const fields = readContractFields(c.fields);
  const invoicedCents = billed.reduce((s, i) => s + mainLineCents(i.items), 0);
  const plan =
    part === "full" && invoicedCents === 0
      ? invoiceFromContractFields({ ...fields, depositPercent: "0" }, { savedItems: settings.savedItems, today: d.today })
      : invoiceFromContractFields(fields, { savedItems: settings.savedItems, today: d.today, invoicedCents });
  if (!plan) return null;
  const nameKey = customerNameKey(fields.clientBusiness || c.clientBusiness);
  const billTo = findOption(options, { customerId: c.customerId, nameKey }) ?? (c.dealId ? findOption(options, { dealId: c.dealId }) : null);
  const when = shortDate(c.agreementDate && isYmd(c.agreementDate) ? c.agreementDate : c.createdAt.toISOString().slice(0, 10));
  const what = plan.part === "deposit" ? "The deposit for" : plan.part === "rest" ? "The rest of" : "From";
  return withLast({
    ...blankPrefill(settings, d.today),
    billTo,
    newCustomer: billTo ? null : { name: c.clientBusiness, contactName: c.clientContact ?? (fields.clientContact || null), email: fields.clientEmail.trim().toLowerCase() || null, billingAddress: null, lang: null },
    lines: plan.lines,
    issueDate: plan.issueDate,
    dueDate: plan.dueDate,
    lang: billTo?.lang ?? null,
    dealId: c.dealId,
    contractId: c.id,
    contractPart: plan.part,
    source: "contract",
    note: `${what} the ${c.clientBusiness} contract (${when})`,
  }, settings.savedItems);
}

async function prefillForBillTo(want: { customerId?: string | null; clientId?: string | null }, d: PrefillDeps): Promise<InvoicePrefill | null> {
  const [settings, options] = await Promise.all([d.settings, d.options]);
  let billTo = findOption(options, want);
  if (!billTo && want.customerId) {
    const c = await customerRow(want.customerId);
    if (c && !c.archived) billTo = customerOption(c, { hasPast: false, last: null });
  }
  if (!billTo) return null;
  return withLast({ ...blankPrefill(settings, d.today), billTo, lang: billTo.lang, source: "customer" }, settings.savedItems);
}

export async function getInvoiceCreatorContext(opts: {
  today?: string;
  draftId?: string | null;
  contractId?: string | null;
  contractPart?: ContractPart | null;
  dealId?: string | null;
  customerId?: string | null;
  clientId?: string | null;
} = {}): Promise<InvoiceCreatorContext> {
  const today = opts.today ?? todayNY();
  const settingsP = getInvoiceSettings();
  const optionsP = billToOptions({ settings: settingsP });
  const deps: PrefillDeps = { today, settings: settingsP, options: optionsP };
  const prefillP: Promise<InvoicePrefill | null> = opts.draftId
    ? prefillFromDraft(opts.draftId, deps)
    : opts.contractId
      ? prefillFromContract(opts.contractId, opts.contractPart ?? null, deps)
      : opts.dealId
        ? prefillFromDeal(opts.dealId, deps)
        : opts.customerId || opts.clientId
          ? prefillForBillTo({ customerId: opts.customerId, clientId: opts.clientId }, deps)
          : Promise.resolve(null);
  const [settings, billTo, nextNumber, prefill] = await Promise.all([settingsP, optionsP, nextInvoiceNumber(), prefillP]);
  const stripeReady = stripeConfigured();
  return {
    today,
    nextNumber,
    settings: {
      fromName: settings.fromName,
      fromAddress: settings.fromAddress,
      zelle: settings.zelle,
      zelleName: settings.zelleName,
      termsDays: settings.termsDays,
      footer: settings.footer,
      achEnabled: settings.achEnabled,
      cardEnabled: settings.cardEnabled,
    },
    setupMissing: invoiceSetupMissing(settings),
    savedItems: settings.savedItems,
    payWays: availablePayWays(settings, stripeReady),
    defaultPayWays: newInvoiceWays(settings),
    stripeReady,
    billTo,
    prefill: prefill ?? { ...blankPrefill(settings, today), last: null },
  };
}

/**
 * The creator opened to EDIT a finalized invoice (/invoices/new?edit=<id>): the creator's context with the invoice as
 * its prefill, everything the form can change included (the discount and the private note too, or Save changes would
 * clear them). null when the invoice is gone; `status` tells the page where a draft, paid or void one belongs.
 */
export async function getInvoiceEditContext(id: string, opts: { today?: string } = {}): Promise<{ status: InvoiceStatus; ctx: InvoiceCreatorContext; edit: CreatorEdit } | null> {
  const [c, row] = await Promise.all([getInvoiceCreatorContext({ today: opts.today }), invoiceWithCustomer(id)]);
  if (!row) return null;
  const { inv, customer } = row;
  const issueDate = inv.issueDate ?? c.today;
  return {
    status: inv.status,
    edit: { id: inv.id, number: inv.number, customerName: customer.name, customerAddress: customer.billingAddress },
    ctx: {
      ...c,
      prefill: {
        ...c.prefill,
        billTo: null,
        newCustomer: null,
        // The exact lines (a typed-each-time line keeps its amount here: it's this invoice's).
        lines: inv.items.map((i) => creatorLineOf(i, c.savedItems)),
        issueDate,
        dueDate: inv.dueDate ?? issueDate,
        payWays: sortPayWays(inv.payWays),
        payNote: inv.payNote,
        notes: inv.notes,
        lang: inv.lang,
        dealId: inv.dealId,
        contractId: inv.contractId,
        contractPart: null,
        draftId: null,
        source: "draft",
        note: null,
        discountCents: inv.discountCents,
        discountLabel: inv.discountLabel,
        privateNotes: inv.privateNotes,
        last: null,
      },
    },
  };
}

/* ───────────────────────── Making invoices ───────────────────────── */

async function invoiceRow(id: string): Promise<schema.Invoice | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  return row ?? null;
}

async function invoiceWithCustomer(id: string): Promise<{ inv: schema.Invoice; customer: schema.Customer } | null> {
  const db = await getDb();
  const [row] = await db.select({ inv: schema.invoices, customer: schema.customers }).from(schema.invoices)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId)).where(eq(schema.invoices.id, id));
  return row ?? null;
}

/** Bill to → the customer (made inline for a business, a deal or a new name). A given address is saved on them. */
async function resolveBillTo(b: z.output<typeof BillToInput>, actor: string): Promise<{ customer: schema.Customer; dealId: string | null }> {
  const db = await getDb();
  let customer: schema.Customer;
  let dealId: string | null = null;
  if (b.kind === "customer") {
    const c = await customerRow(b.id);
    if (!c) throw new OpsError("That customer is gone. Pick them again.");
    if (c.archived) throw new OpsError(`${c.name} is archived. Bring them back on their page first.`);
    customer = c;
  } else if (b.kind === "client") {
    customer = await customerForClient(b.id, actor);
  } else if (b.kind === "deal") {
    customer = await customerForDeal(b.id, actor);
    dealId = b.id;
  } else {
    guardText([["the address", b.address]]);
    const key = customerNameKey(b.name);
    const same = await db.select().from(schema.customers).where(and(eq(schema.customers.nameKey, key), eq(schema.customers.archived, false))).orderBy(asc(schema.customers.createdAt)).limit(2);
    if (same.length === 1) {
      customer = same[0];
      // Typed as new but the name is theirs: fill in what they're missing, never overwrite.
      const fill: Partial<typeof schema.customers.$inferInsert> = {};
      if (!customer.contactName && b.contactName) fill.contactName = b.contactName;
      if (!customer.email && b.email) fill.email = b.email;
      if (!customer.phone && b.phone) fill.phone = b.phone;
      if (!customer.lang && b.lang) fill.lang = b.lang;
      if (Object.keys(fill).length) {
        const [u] = await db.update(schema.customers).set({ ...fill, updatedAt: new Date() }).where(eq(schema.customers.id, customer.id)).returning();
        customer = u ?? customer;
      }
    } else {
      const [row] = await db.insert(schema.customers).values({
        id: newId("cus_"),
        name: b.name,
        nameKey: key,
        contactName: b.contactName ?? null,
        email: b.email ?? null,
        phone: b.phone ?? null,
        billingAddress: b.address ?? null,
        lang: b.lang ?? null,
        source: "manual",
        createdBy: actor,
      }).returning();
      await logActivity({ actor, action: "customer.created", entityType: "customer", entityId: row.id, summary: `Added the customer ${row.name}` });
      return { customer: row, dealId };
    }
  }
  const address = b.address ?? null;
  if (address && address !== (customer.billingAddress ?? "")) {
    guardText([["the address", address]]);
    const [u] = await db.update(schema.customers).set({ billingAddress: address, updatedAt: new Date() }).where(eq(schema.customers.id, customer.id)).returning();
    customer = u ?? customer;
  }
  return { customer, dealId };
}

/** Ways a draft may hold: everything but the details (a Zelle number, …), which are checked when it is finalized. */
function draftAvailability(avail: PayWayAvailability): PayWayAvailability {
  const ok = { ok: true, why: null };
  return { ...avail, zelle: ok, ach: ok, check: ok, venmo: ok, paypal: ok };
}

/** Make PDF is refused when the customer's name or a line would print empty on the PDF (Chinese only): never "Customer" or a blank row. */
function checkPrintable(o: { newName?: string | null; customerName?: string | null; items?: readonly InvoiceItem[] }) {
  if (o.newName != null && pdfPrintsEmpty(o.newName)) throw new OpsError(PDF_LETTERS.name);
  if (o.customerName != null && pdfPrintsEmpty(o.customerName)) throw new OpsError(PDF_LETTERS.customer(o.customerName));
  for (const i of o.items ?? []) if (pdfPrintsEmpty(i.description)) throw new OpsError(PDF_LETTERS.line(i.description));
}

function checkDates(issueDate: string, dueDate: string) {
  if (!isYmd(issueDate) || !isYmd(dueDate)) throw new OpsError("Use dates like 2026-11-20.");
  if (dueDate < issueDate) throw new OpsError("The due date can't be before the invoice date.");
  if (daysBetween(issueDate, dueDate) > MAX_TERMS_DAYS) throw new OpsError(`Keep the due date within ${MAX_TERMS_DAYS} days of the invoice date.`);
}

/**
 * The done state ("Make PDF" landed): Share PDF, Download, Copy message, Copy pay link (only with an online way).
 * Built for a team page: the message names a bank transfer but never carries the account or routing number.
 */
function buildDone(inv: schema.Invoice, customer: schema.Customer, settings: InvoiceSettings, o: { origin?: string | null; stripeReady: boolean; token?: LinkToken | null }): InvoiceDone {
  const number = inv.number ?? "DRAFT";
  const issueDate = inv.issueDate ?? todayNY();
  const dueDate = inv.dueDate ?? issueDate;
  const ways = sortPayWays(inv.payWays);
  const options = payOptions(settings, { number: inv.number, payWays: ways, payNote: inv.payNote }, o.stripeReady, maskedBankDetails(settings));
  const online = options.some((x) => x.way === "bank" || x.way === "card");
  const payUrl = online
    ? o.token && inv.tokenHash === o.token.hash
      ? payPageUrl(o.token.token, o.origin)
      : urlFromEnc(inv.tokenEnc, o.origin)
    : null;
  const zelle = options.find((x) => x.way === "zelle");
  const check = options.find((x) => x.way === "check");
  const balance = balanceCents(inv);
  const amount = formatCents(inv.paidCents > 0 && balance > 0 ? balance : inv.totalCents, { decimals: "always" });
  const args = {
    business: customer.name,
    contactName: customer.contactName,
    number,
    amount,
    dueDate,
    dueOnReceipt: dueDate <= issueDate,
    ach: options.some((x) => x.way === "ach"),
    zelle: zelle && zelle.way === "zelle" ? zelle.to : null,
    checkPayee: check && check.way === "check" ? check.payee : null,
    url: payUrl,
  };
  const messages = {
    en: invoiceCopy("en").share.pdfMessage(args),
    "zh-Hans": invoiceCopy("zh-Hans").share.pdfMessage(args),
    "zh-Hant": invoiceCopy("zh-Hant").share.pdfMessage(args),
  };
  const lang = inv.lang ?? customer.lang ?? "en";
  return {
    id: inv.id,
    number,
    customerId: customer.id,
    customerName: customer.name,
    totalCents: inv.totalCents,
    balanceCents: balance,
    issueDate,
    dueDate,
    lang,
    pdfPath: invoicePdfPath(inv.id),
    fileName: invoiceFileName(inv.number, customer.name),
    message: messages[lang],
    messages,
    payUrl,
    payWays: ways,
    contractId: inv.contractId,
    nextSteps: invoiceNextSteps({ id: inv.id, status: inv.status, contractId: inv.contractId }),
  };
}

/** The invoice columns plus "was this statement the one that finalized it" (sent_at is set to this statement's now()). */
const RETURNING_FIRST = { ...getTableColumns(schema.invoices), first: sql<boolean>`(${schema.invoices.sentAt} = now())` };
const stripFirst = (r: schema.Invoice & { first: boolean }): schema.Invoice => {
  const { first: _f, ...inv } = r;
  return inv;
};

async function afterFinalize(inv: schema.Invoice, customer: schema.Customer, actor: string, what: string) {
  const db = await getDb();
  await Promise.all([
    logActivity({ actor, action: "invoice.finalized", entityType: "invoice", entityId: inv.id, clientId: customer.clientId, summary: `${what} ${inv.number} for ${customer.name}` }),
    inv.dealId ? syncDealFromInvoices(inv.dealId, actor) : null,
    // The contract it bills now knows its customer (and deal), for "each shows the other".
    inv.contractId
      ? db.update(schema.contracts).set({ customerId: sql`coalesce(${schema.contracts.customerId}, ${customer.id})`, dealId: sql`coalesce(${schema.contracts.dealId}, ${inv.dealId})` })
          .where(and(eq(schema.contracts.id, inv.contractId), or(isNull(schema.contracts.customerId), isNull(schema.contracts.dealId))))
      : null,
  ]);
}

type QuickPlan = {
  customer: schema.Customer;
  settings: InvoiceSettings;
  /** Her own bank details, decrypted: only for the PDF that comes back with Make PDF (donePdf). */
  bank: BankDetails | null;
  draft: schema.Invoice | null;
  requestId: string | null;
  values: {
    customerId: string;
    issueDate: string;
    dueDate: string;
    termsDays: number;
    items: InvoiceItem[];
    subtotalCents: number;
    discountCents: number;
    discountLabel: string | null;
    totalCents: number;
    notes: string | null;
    privateNotes: string | null;
    dealId: string | null;
    contractId: string | null;
    payWays: PayWay[];
    payNote: string | null;
    lang: schema.IntakeLang | null;
  };
};

/** Everything Make PDF and Save as draft share: checks, Bill to, settings (with the one-time ask), the row's values. */
async function planQuick(input: QuickInvoiceInputT, actor: string, today: string, mode: "finalize" | "draft"): Promise<QuickPlan> {
  const v = QuickInvoiceInput.parse(input);
  guardText([["the notes", v.notes], ["the private note", v.privateNotes], ["the other way to pay", v.payNote], ["the discount", v.discountLabel], ...lineTexts(v.items)]);
  // Before anything is written (a new customer included): what the PDF can't print is refused, not printed wrong.
  if (mode === "finalize") checkPrintable({ newName: v.billTo.kind === "new" ? v.billTo.name : null, items: v.items });
  const setup = setupPatch(v.setup);
  const db = await getDb();
  const [{ settings, bank }, bill, draft, dealOk, contractOk] = await Promise.all([
    setup ? mergeSettings(setup, actor) : paySetup(),
    resolveBillTo(v.billTo, actor),
    v.draftId ? invoiceRow(v.draftId) : Promise.resolve(null),
    v.dealId ? db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.id, v.dealId)).then((r) => r.length > 0) : Promise.resolve(true),
    v.contractId ? db.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.id, v.contractId)).then((r) => r.length > 0) : Promise.resolve(true),
  ]);
  if (v.draftId && !draft) throw new OpsError("That draft is gone. Start a new invoice.");
  if (!dealOk) throw new OpsError("That deal is gone.");
  if (!contractOk) throw new OpsError("That contract is gone.");
  if (mode === "finalize") checkPrintable({ customerName: bill.customer.name });
  const keep = <T>(given: T | undefined, fromDraft: T, fallback: T): T => (given !== undefined ? given : draft ? fromDraft : fallback);
  const avail = availablePayWays(settings, stripeConfigured());
  // No ways sent (the creator always sends them): a draft keeps its own, a new invoice takes the ones ticked in Settings.
  const ways = sortPayWays(keep(v.payWays, draft?.payWays ?? [...DEFAULT_PAY_WAYS], defaultPayWays(settings, avail)));
  const payNote = keep(v.payNote, draft?.payNote ?? null, null) ?? null;
  const wayError = checkPayWays(ways, payNote, mode === "finalize" ? avail : draftAvailability(avail));
  if (wayError) throw new OpsError(wayError);
  // The form is the truth for the money: no discount sent = none (the creator sends undefined when it is cleared).
  const discount = v.discountCents ?? 0;
  const totals = invoiceTotals(v.items, discount);
  if (mode === "finalize" && totals.totalCents <= 0) throw new OpsError("The total is $0. Add an amount first.");
  if (totals.totalCents > MAX_INVOICE_CENTS) throw new OpsError("That total is too large.");
  const issueDate = v.issueDate ?? (mode === "draft" && draft?.issueDate ? draft.issueDate : today);
  const dueDate = v.dueDate ?? addDaysYmd(issueDate, settings.termsDays);
  checkDates(issueDate, dueDate);
  const dealId = v.dealId ?? bill.dealId ?? (v.dealId === undefined ? draft?.dealId ?? null : null);
  return {
    customer: bill.customer,
    settings,
    bank,
    draft,
    requestId: v.draftId ? null : v.requestId ?? null,
    values: {
      customerId: bill.customer.id,
      issueDate,
      dueDate,
      termsDays: daysBetween(issueDate, dueDate),
      items: v.items,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      discountLabel: totals.discountCents > 0 ? v.discountLabel ?? null : null,
      totalCents: totals.totalCents,
      notes: keep(v.notes, draft?.notes ?? null, settings.footer) ?? null,
      privateNotes: keep(v.privateNotes, draft?.privateNotes ?? null, null) ?? null,
      dealId,
      contractId: keep(v.contractId, draft?.contractId ?? null, null) ?? null,
      payWays: ways,
      payNote: ways.includes("custom") ? payNote : null,
      lang: keep(v.lang, draft?.lang ?? null, null) ?? bill.customer.lang ?? null,
    },
  };
}

/**
 * The finished PDF as base64, for the answer to Make PDF from a phone (Share PDF is ready with no second round trip).
 * The PDF itself, so it carries her real bank details like every PDF (invoicePdf).
 */
async function donePdf(inv: schema.Invoice, customer: schema.Customer, pay: PaySetup, done: InvoiceDone, today: string): Promise<string | null> {
  try {
    const doc = invoiceDocument(inv, customer, pay.settings, { stripeReady: stripeConfigured(), payUrl: done.payUrl, today, bank: pay.bank });
    return Buffer.from(await renderInvoicePdf(doc, { title: `Invoice ${inv.number ?? "DRAFT"}` })).toString("base64");
  } catch (e) {
    console.error("[invoices] the PDF for the done state failed", e instanceof Error ? e.message : e);
    return null; // the done state fetches it instead
  }
}

export async function createAndFinalizeInvoice(input: QuickInvoiceInputT, actor: string, opts: { origin?: string | null; today?: string; withPdf?: boolean } = {}): Promise<InvoiceDone> {
  people(actor, "make an invoice");
  const today = opts.today ?? todayNY();
  const plan = await planQuick(input, actor, today, "finalize");
  const { customer, settings, bank, draft, values } = plan;
  const pay: PaySetup = { settings, bank };
  const stripeReady = stripeConfigured();
  /** The done state for a row that already exists (pressed again): nothing is written. */
  const already = async (inv: schema.Invoice, c: schema.Customer): Promise<InvoiceDone> => {
    const done = buildDone(inv, c, settings, { origin: opts.origin, stripeReady });
    return opts.withPdf ? { ...done, pdfBase64: await donePdf(inv, c, pay, done, today) } : done;
  };
  if (draft && draft.status !== "draft") {
    if (draft.status === "void") throw new OpsError("This invoice is void.");
    return already(draft, customer); // finalized meanwhile: nothing is overwritten
  }
  const token = makeLinkToken();
  if (!token && hasOnlineWay(values.payWays)) throw new OpsError("Can't make a pay link: TOKEN_ENC_KEY isn't set on the server. Untick paying online, or set it.");
  const db = await getDb();
  const source: InvoiceSource = draft ? draft.source : values.contractId ? "contract" : values.dealId ? "deal" : "manual";
  // The form's own id (requestId): a second press after a lost response conflicts on it and makes nothing.
  const newInvoiceId = plan.requestId ? `inv_${plan.requestId}` : newId("inv_");
  const write = async (): Promise<schema.Invoice | null> => {
    if (draft) {
      // ONE UPDATE: the form onto the draft, and finalized (only while it is still a draft).
      const [row] = await db.update(schema.invoices).set({
        ...values,
        number: sql`coalesce(${schema.invoices.number}, ${TAKE})`,
        status: "sent",
        ...(token ? { tokenHash: sql`coalesce(${schema.invoices.tokenHash}, ${token.hash})`, tokenEnc: sql`coalesce(${schema.invoices.tokenEnc}, ${token.enc})` } : {}),
        sentAt: sql`coalesce(${schema.invoices.sentAt}, now())`,
        sentBy: sql`coalesce(${schema.invoices.sentBy}, ${actor})`,
        updatedAt: new Date(),
      }).where(and(eq(schema.invoices.id, draft.id), eq(schema.invoices.status, "draft"))).returning();
      return row ?? null;
    }
    // ONE INSERT that is already finalized: number, dates, status sent, the link. With the form's id, a repeat takes
    // no number (the CASE skips the sequence when the row is there) and inserts nothing (ON CONFLICT DO NOTHING).
    const [row] = await db.insert(schema.invoices).values({
      id: newInvoiceId,
      ...values,
      number: plan.requestId ? sql`case when exists (select 1 from invoices y where y.id = ${newInvoiceId}) then null else ${TAKE} end` : TAKE,
      status: "sent",
      tokenHash: token?.hash ?? null,
      tokenEnc: token?.enc ?? null,
      source,
      sentAt: sql`now()`,
      sentBy: actor,
      createdBy: actor,
    }).onConflictDoNothing({ target: schema.invoices.id }).returning();
    return row ?? null;
  };
  let row: schema.Invoice | null;
  try {
    row = await write();
  } catch (e) {
    if (!isNumberClash(e)) throw e;
    row = await write(); // an import wrote the same number between the check and the write: take the next one
  }
  if (!row) {
    const now = await invoiceWithCustomer(draft ? draft.id : newInvoiceId);
    if (now && now.inv.status === "void") throw new OpsError("This invoice is void.");
    if (now && now.inv.status !== "draft") return already(now.inv, now.customer); // made by the first press (or finalized meanwhile)
    throw new OpsError("Couldn't make the invoice. Try again.");
  }
  const done = buildDone(row, customer, settings, { origin: opts.origin, stripeReady, token });
  // The log, the deal and the contract link, and (for a phone) the PDF itself, side by side.
  const [, pdfBase64] = await Promise.all([
    afterFinalize(row, customer, actor, "Made invoice"),
    opts.withPdf ? donePdf(row, customer, pay, done, today) : null,
  ]);
  return opts.withPdf ? { ...done, pdfBase64 } : done;
}

export async function saveQuickDraft(input: QuickInvoiceInputT, actor: string, opts: { today?: string } = {}): Promise<{ id: string; customerId: string; created: boolean }> {
  people(actor, "save an invoice draft");
  const today = opts.today ?? todayNY();
  const { customer, draft, values } = await planQuick(input, actor, today, "draft");
  const db = await getDb();
  if (draft) {
    if (draft.status !== "draft") throw new OpsError("This invoice is already made. Open it to edit.");
    const [row] = await db.update(schema.invoices).set({ ...values, updatedAt: new Date() })
      .where(and(eq(schema.invoices.id, draft.id), eq(schema.invoices.status, "draft"))).returning({ id: schema.invoices.id });
    if (!row) throw new OpsError("This invoice is already made. Open it to edit.");
    await logActivity({ actor, action: "invoice.draft_saved", entityType: "invoice", entityId: draft.id, clientId: customer.clientId, summary: `Saved the draft invoice for ${customer.name}` });
    return { id: draft.id, customerId: customer.id, created: false };
  }
  const id = newId("inv_");
  const source: InvoiceSource = values.contractId ? "contract" : values.dealId ? "deal" : "manual";
  await db.insert(schema.invoices).values({ id, ...values, status: "draft", source, createdBy: actor });
  await logActivity({ actor, action: "invoice.draft_created", entityType: "invoice", entityId: id, clientId: customer.clientId, summary: `Started a draft invoice for ${customer.name}` });
  return { id, customerId: customer.id, created: true };
}

export async function getInvoiceDone(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<InvoiceDone | null> {
  people(actor, "share an invoice");
  const [row, settings] = await Promise.all([invoiceWithCustomer(id), getInvoiceSettings()]);
  if (!row || row.inv.status === "draft" || row.inv.status === "void") return null;
  return buildDone(row.inv, row.customer, settings, { origin: opts.origin, stripeReady: stripeConfigured() });
}

/* ───────────────────────── Invoices ───────────────────────── */

export async function createInvoiceDraft(
  input: InvoiceDraftInputT,
  actor: string,
  opts: { source?: InvoiceSource; askId?: string | null } = {},
): Promise<schema.Invoice> {
  peopleOrClaude(actor, "draft an invoice");
  const claude = isClaude(actor);
  const v = InvoiceDraftInput.parse(input);
  if (claude && v.contractId) throw new OpsError("Contracts are people only: leave contract_id out.");
  guardText([["the notes", v.notes], ["the private note", v.privateNotes], ["the other way to pay", v.payNote], ...lineTexts(v.items)]);
  const db = await getDb();
  const [customer, settings, dealOk, contractOk] = await Promise.all([
    customerRow(v.customerId),
    getInvoiceSettings(),
    v.dealId ? db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.id, v.dealId)).then((r) => r.length > 0) : Promise.resolve(true),
    v.contractId ? db.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.id, v.contractId)).then((r) => r.length > 0) : Promise.resolve(true),
  ]);
  if (!customer) throw new OpsError(`No customer with id "${v.customerId}".`);
  if (customer.archived) throw new OpsError(`${customer.name} is archived.`);
  if (!dealOk) throw new OpsError(`No deal with id "${v.dealId}".`);
  if (!contractOk) throw new OpsError("That contract is gone.");
  // No ways given (Claude gives them only when a person said how): the ways Nora ticked in Settings, else Zelle.
  const avail = availablePayWays(settings, stripeConfigured());
  const ways = sortPayWays(v.payWays ?? defaultPayWays(settings, avail));
  const wayError = checkPayWays(ways, v.payNote, draftAvailability(avail));
  if (wayError) throw new OpsError(wayError);
  const totals = invoiceTotals(v.items, v.discountCents ?? 0);
  const termsDays = v.termsDays ?? settings.termsDays;
  if (v.issueDate && v.dueDate) checkDates(v.issueDate, v.dueDate);
  const source: InvoiceSource = claude ? "claude" : opts.source ?? (v.contractId ? "contract" : v.dealId ? "deal" : "manual");
  const [row] = await db.insert(schema.invoices).values({
    id: newId("inv_"),
    customerId: customer.id,
    status: "draft",
    issueDate: v.issueDate ?? null,
    dueDate: v.dueDate ?? null,
    termsDays: v.issueDate && v.dueDate ? daysBetween(v.issueDate, v.dueDate) : termsDays,
    items: v.items,
    ...totals,
    discountLabel: totals.discountCents > 0 ? v.discountLabel ?? null : null,
    notes: v.notes !== undefined ? v.notes ?? null : settings.footer,
    privateNotes: v.privateNotes ?? null,
    dealId: v.dealId ?? null,
    contractId: v.contractId ?? null,
    payWays: ways,
    payNote: ways.includes("custom") ? v.payNote ?? null : null,
    lang: v.lang ?? customer.lang ?? null,
    source,
    createdBy: actor,
  }).returning();
  await logActivity({
    actor, action: "invoice.draft_created", entityType: "invoice", entityId: row.id, clientId: customer.clientId,
    summary: `${claude ? "Claude drafted" : "Started"} an invoice for ${customer.name}${claude && opts.askId ? " (from an ask)" : ""}`,
  });
  return row;
}

export async function createInvoiceFromDeal(dealId: string, actor: string, opts: { source?: InvoiceSource } = {}): Promise<{ id: string; created: boolean }> {
  peopleOrClaude(actor, "draft an invoice");
  const db = await getDb();
  const [[deal], kinds, [existing]] = await Promise.all([
    db.select().from(schema.deals).where(eq(schema.deals.id, dealId)),
    db.select({ kind: schema.dealDeliverables.kind }).from(schema.dealDeliverables).where(eq(schema.dealDeliverables.dealId, dealId)).orderBy(asc(schema.dealDeliverables.sortOrder)),
    db.select({ id: schema.invoices.id }).from(schema.invoices)
      .where(and(eq(schema.invoices.dealId, dealId), inArray(schema.invoices.status, ["draft", "sent", "partially_paid"]))).orderBy(desc(schema.invoices.createdAt)).limit(1),
  ]);
  if (!deal) throw new OpsError(`No deal with id "${dealId}".`);
  if (existing) return { id: existing.id, created: false };
  if (deal.status === "cancelled") throw new OpsError("That deal is cancelled.");
  if (!deal.amountCents || deal.amountCents <= 0) throw new OpsError("This deal has no fee yet. Ask Nora or Cameron for the amount.");
  const customer = await customerForDeal(dealId, actor);
  const today = todayNY();
  const due = deal.paymentDueDate && deal.paymentDueDate >= today ? deal.paymentDueDate : null;
  const row = await createInvoiceDraft({
    customerId: customer.id,
    issueDate: due ? today : null,
    dueDate: due,
    items: [{ description: dealLine(kinds.map((k) => k.kind)), quantity: 1, unitCents: deal.amountCents }],
    dealId,
  }, actor, { source: opts.source ?? (isClaude(actor) ? "claude" : "deal") });
  return { id: row.id, created: true };
}

export async function updateInvoice(id: string, patch: InvoicePatchT, actor: string): Promise<schema.Invoice> {
  people(actor, "edit an invoice");
  const v = InvoicePatch.parse(patch);
  guardText([["the notes", v.notes], ["the private note", v.privateNotes], ["the other way to pay", v.payNote], ...lineTexts(v.items)]);
  const [cur, settings] = await Promise.all([invoiceRow(id), getInvoiceSettings()]);
  if (!cur) throw new OpsError("That invoice is gone.");
  if (cur.status === "paid") throw new OpsError("This invoice is paid. Delete a payment first to change it.");
  if (cur.status === "void") throw new OpsError("This invoice is void.");
  const finalized = cur.status !== "draft";
  if (finalized && v.customerId && v.customerId !== cur.customerId) throw new OpsError("A finalized invoice keeps its customer. Void it and make a new one.");
  const db = await getDb();
  if (v.customerId && v.customerId !== cur.customerId) {
    const c = await customerRow(v.customerId);
    if (!c || c.archived) throw new OpsError("Pick a customer who isn't archived.");
  }
  if (v.dealId) {
    const [d] = await db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.id, v.dealId));
    if (!d) throw new OpsError("That deal is gone.");
  }
  if (v.contractId) {
    const [k] = await db.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.id, v.contractId));
    if (!k) throw new OpsError("That contract is gone.");
  }
  const items = v.items ?? cur.items;
  if (finalized && v.items) checkPrintable({ items: v.items });
  const totals = invoiceTotals(items, v.discountCents ?? cur.discountCents);
  if (finalized && totals.totalCents <= 0) throw new OpsError("A finalized invoice can't total $0. Void it instead.");
  if (totals.totalCents < cur.paidCents) throw new OpsError(`The total can't go below what's already paid (${formatCents(cur.paidCents, { decimals: "always" })}).`);
  const ways = sortPayWays(v.payWays ?? cur.payWays);
  const payNote = v.payNote !== undefined ? v.payNote ?? null : cur.payNote;
  const avail = availablePayWays(settings, stripeConfigured());
  const wayError = checkPayWays(ways, payNote, finalized ? avail : draftAvailability(avail));
  if (wayError) throw new OpsError(wayError);
  let issueDate = v.issueDate !== undefined ? v.issueDate ?? null : cur.issueDate;
  let dueDate = v.dueDate !== undefined ? v.dueDate ?? null : cur.dueDate;
  if (finalized) {
    issueDate = issueDate ?? cur.issueDate;
    dueDate = dueDate ?? cur.dueDate;
  }
  if (issueDate && dueDate) checkDates(issueDate, dueDate);
  const termsDays = issueDate && dueDate ? daysBetween(issueDate, dueDate) : v.termsDays ?? cur.termsDays;
  const set: Partial<typeof schema.invoices.$inferInsert> = {
    items,
    ...totals,
    discountLabel: totals.discountCents > 0 ? (v.discountLabel !== undefined ? v.discountLabel ?? null : cur.discountLabel) : null,
    issueDate,
    dueDate,
    termsDays,
    payWays: ways,
    payNote: ways.includes("custom") ? payNote : null,
    updatedAt: new Date(),
  };
  if (v.notes !== undefined) set.notes = v.notes ?? null;
  if (v.privateNotes !== undefined) set.privateNotes = v.privateNotes ?? null;
  if (v.lang !== undefined) set.lang = v.lang ?? null;
  if (v.dealId !== undefined) set.dealId = v.dealId ?? null;
  if (v.contractId !== undefined) set.contractId = v.contractId ?? null;
  if (!finalized && v.customerId) set.customerId = v.customerId;
  // The status follows the new total in the same statement (a payment may land meanwhile: paid_cents is read there).
  const total = totals.totalCents;
  const [row] = await db.update(schema.invoices).set({
    ...set,
    status: sql`case when ${schema.invoices.status} in ('draft', 'void') then ${schema.invoices.status}
      when ${total} > 0 and ${schema.invoices.paidCents} >= ${total} then 'paid'
      when ${schema.invoices.paidCents} > 0 then 'partially_paid' else 'sent' end`,
    paidAt: sql`case when ${schema.invoices.status} not in ('draft', 'void') and ${total} > 0 and ${schema.invoices.paidCents} >= ${total} then coalesce(${schema.invoices.paidAt}, now()) else null end`,
  }).where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, cur.status), sql`${schema.invoices.paidCents} <= ${total}`)).returning();
  if (!row) throw new OpsError("This invoice changed while you were editing (a payment came in?). Reload and try again.");
  const customer = await customerRow(row.customerId);
  await Promise.all([
    logActivity({ actor, action: "invoice.updated", entityType: "invoice", entityId: id, clientId: customer?.clientId ?? null, summary: `Edited ${invoiceLabel(row) === "Draft" ? "a draft invoice" : `invoice ${row.number}`} for ${customer?.name ?? "a customer"}` }),
    finalized && row.dealId ? syncDealFromInvoices(row.dealId, actor) : null,
    finalized && cur.dealId && cur.dealId !== row.dealId ? syncDealFromInvoices(cur.dealId, actor) : null,
  ]);
  // A Stripe page opened for the old total must not take the old amount.
  if (finalized && row.totalCents !== cur.totalCents) await closeOpenCheckouts(id);
  return row;
}

export async function deleteDraftInvoice(id: string, actor: string): Promise<void> {
  people(actor, "delete a draft invoice");
  const db = await getDb();
  const [row] = await db.delete(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, "draft")))
    .returning({ customerId: schema.invoices.customerId });
  if (!row) {
    const cur = await invoiceRow(id);
    if (cur) throw new OpsError("Only a draft can be deleted. Void a finalized invoice instead.");
    return;
  }
  const c = await customerRow(row.customerId);
  await logActivity({ actor, action: "invoice.draft_deleted", entityType: "invoice", entityId: id, clientId: c?.clientId ?? null, summary: `Deleted a draft invoice for ${c?.name ?? "a customer"}` });
}

export async function finalizeInvoice(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<{ invoice: schema.Invoice; first: boolean; done: InvoiceDone }> {
  people(actor, "make an invoice PDF");
  const today = opts.today ?? todayNY();
  const [row, settings] = await Promise.all([invoiceWithCustomer(id), getInvoiceSettings()]);
  if (!row) throw new OpsError("That invoice is gone.");
  const { inv, customer } = row;
  const stripeReady = stripeConfigured();
  if (inv.status === "void") throw new OpsError("This invoice is void.");
  if (inv.status !== "draft") return { invoice: inv, first: false, done: buildDone(inv, customer, settings, { origin: opts.origin, stripeReady }) };
  const wayError = checkPayWays(sortPayWays(inv.payWays), inv.payNote, availablePayWays(settings, stripeReady));
  if (wayError) throw new OpsError(wayError);
  if (inv.totalCents <= 0) throw new OpsError("The total is $0. Add an amount first.");
  if (inv.issueDate && inv.dueDate) checkDates(inv.issueDate, inv.dueDate);
  checkPrintable({ customerName: customer.name, items: inv.items });
  const token = makeLinkToken();
  if (!token && hasOnlineWay(sortPayWays(inv.payWays))) throw new OpsError("Can't make a pay link: TOKEN_ENC_KEY isn't set on the server.");
  const db = await getDb();
  const issue = sql`coalesce(${schema.invoices.issueDate}, ${today})`;
  const write = async () => {
    // ONE UPDATE (docs/invoicing.md "Finalize a draft"): pressing it again changes nothing and burns no number.
    const [r] = await db.update(schema.invoices).set({
      issueDate: issue,
      dueDate: sql`coalesce(${schema.invoices.dueDate}, to_char(${issue}::date + ${schema.invoices.termsDays}, 'YYYY-MM-DD'))`,
      number: sql`coalesce(${schema.invoices.number}, ${TAKE})`,
      status: sql`case when ${schema.invoices.status} = 'draft' then 'sent' else ${schema.invoices.status} end`,
      ...(token ? { tokenHash: sql`coalesce(${schema.invoices.tokenHash}, ${token.hash})`, tokenEnc: sql`coalesce(${schema.invoices.tokenEnc}, ${token.enc})` } : {}),
      sentAt: sql`coalesce(${schema.invoices.sentAt}, now())`,
      sentBy: sql`coalesce(${schema.invoices.sentBy}, ${actor})`,
      updatedAt: new Date(),
    }).where(and(eq(schema.invoices.id, id), ne(schema.invoices.status, "void"), sql`${schema.invoices.totalCents} > 0`)).returning(RETURNING_FIRST);
    return r ?? null;
  };
  let r: Awaited<ReturnType<typeof write>>;
  try {
    r = await write();
  } catch (e) {
    if (!isNumberClash(e)) throw e;
    r = await write();
  }
  if (!r) throw new OpsError("Couldn't make the PDF: the invoice is void or totals $0.");
  const updated = stripFirst(r);
  if (r.first) await afterFinalize(updated, customer, actor, "Made the PDF for invoice");
  return { invoice: updated, first: r.first, done: buildDone(updated, customer, settings, { origin: opts.origin, stripeReady, token }) };
}

/**
 * Open Stripe pages (Checkout Sessions) for this invoice stop working: expired at Stripe, then marked expired here.
 * Called whenever the page's amount or right to be paid changed: the invoice was voided, a payment was recorded or
 * deleted, its total was edited, its link was replaced, or a bank transfer started on another page. `keepAmountCents`
 * spares pages for that amount (a second press of Pay online); `exceptSessionId` the page that is being paid.
 * Never throws: a page Stripe wouldn't close stays open for at most its hour, and a payment that still lands on a
 * void or paid invoice is recorded and pushed to Nora (lib/ops-stripe "Paid after it was cancelled" / "Paid twice").
 */
export async function closeOpenCheckouts(invoiceId: string, opts: { exceptSessionId?: string | null; keepAmountCents?: number | null } = {}): Promise<number> {
  let closed = 0;
  try {
    const db = await getDb();
    const c = schema.invoiceCheckouts;
    const open = await db.select({ sessionId: c.sessionId, amountCents: c.amountCents }).from(c)
      .where(and(eq(c.invoiceId, invoiceId), eq(c.status, "open"), like(c.sessionId, "cs_%")));
    for (const o of open) {
      if (o.sessionId === opts.exceptSessionId) continue;
      if (opts.keepAmountCents != null && o.amountCents === opts.keepAmountCents) continue;
      try {
        await expireCheckoutSession(o.sessionId);
      } catch (e) {
        console.error("[invoices] a Stripe page could not be closed:", e instanceof Error ? e.message : e); // it expires by itself within the hour
        continue;
      }
      await db.update(c).set({ status: "expired", updatedAt: new Date() }).where(and(eq(c.sessionId, o.sessionId), eq(c.status, "open")));
      closed++;
    }
  } catch (e) {
    console.error("[invoices] closing Stripe pages failed:", e instanceof Error ? e.message : e);
  }
  return closed;
}

export async function voidInvoice(id: string, actor: string, opts: { reason?: string | null } = {}): Promise<schema.Invoice> {
  people(actor, "void an invoice");
  const reason = cleanLine(opts.reason ?? "").slice(0, 300) || null;
  const db = await getDb();
  // ONE statement: only a finalized invoice with no payments (delete them first) and no bank transfer on its way
  // (the money would land on a void invoice about 4 business days later).
  const [row] = await db.update(schema.invoices).set({ status: "void", voidedAt: new Date(), voidedBy: actor, voidReason: reason, updatedAt: new Date() })
    .where(and(
      eq(schema.invoices.id, id),
      inArray(schema.invoices.status, ["sent", "partially_paid", "paid"]),
      sql`not exists (select 1 from invoice_payments p where p.invoice_id = ${schema.invoices.id})`,
      sql`not exists (select 1 from invoice_checkouts k where k.invoice_id = ${schema.invoices.id} and k.status = 'processing')`,
    )).returning();
  if (!row) {
    const cur = await invoiceRow(id);
    if (!cur) throw new OpsError("That invoice is gone.");
    if (cur.status === "void") return cur;
    if (cur.status === "draft") throw new OpsError("This is a draft: delete it instead.");
    const [clearing] = await db.select({ id: schema.invoiceCheckouts.id }).from(schema.invoiceCheckouts)
      .where(and(eq(schema.invoiceCheckouts.invoiceId, id), eq(schema.invoiceCheckouts.status, "processing"))).limit(1);
    if (clearing) throw new OpsError("A bank payment is on its way for this invoice. Wait until it arrives or fails, then void it.");
    throw new OpsError("This invoice has payments. Delete them first, then void it.");
  }
  const c = await customerRow(row.customerId);
  await Promise.all([
    logActivity({ actor, action: "invoice.voided", entityType: "invoice", entityId: id, clientId: c?.clientId ?? null, summary: `Voided invoice ${row.number} for ${c?.name ?? "a customer"}` }),
    row.dealId ? syncDealFromInvoices(row.dealId, actor) : null,
  ]);
  // A Stripe page the customer opened earlier must not take the money for a cancelled invoice.
  await closeOpenCheckouts(id);
  return row;
}

export async function getInvoiceLink(id: string, actor: string, opts: { origin?: string | null } = {}): Promise<string | null> {
  people(actor, "copy an invoice link");
  const inv = await invoiceRow(id);
  if (!inv) throw new OpsError("That invoice is gone.");
  if (inv.status === "draft") return null;
  if (inv.tokenEnc) {
    const url = urlFromEnc(inv.tokenEnc, opts.origin);
    if (url) return url;
    throw new OpsError("This link can't be re-copied here (the server's key changed). Make a new link.");
  }
  // An imported invoice gets its link the first time (ONE conditional UPDATE; a race reads the winner).
  const token = makeLinkToken();
  if (!token) throw new OpsError("Can't make links: TOKEN_ENC_KEY isn't set on the server.");
  const db = await getDb();
  const [row] = await db.update(schema.invoices).set({ tokenHash: token.hash, tokenEnc: token.enc, updatedAt: new Date() })
    .where(and(eq(schema.invoices.id, id), isNull(schema.invoices.tokenHash))).returning({ id: schema.invoices.id });
  if (row) return payPageUrl(token.token, opts.origin);
  return urlFromEnc((await invoiceRow(id))?.tokenEnc, opts.origin);
}

export async function replaceInvoiceLink(id: string, actor: string, opts: { origin?: string | null } = {}): Promise<string> {
  people(actor, "make a new invoice link");
  const token = makeLinkToken();
  if (!token) throw new OpsError("Can't make links: TOKEN_ENC_KEY isn't set on the server.");
  const db = await getDb();
  const [row] = await db.update(schema.invoices).set({ tokenHash: token.hash, tokenEnc: token.enc, updatedAt: new Date() })
    .where(and(eq(schema.invoices.id, id), inArray(schema.invoices.status, ["sent", "partially_paid", "paid"]))).returning({ number: schema.invoices.number, customerId: schema.invoices.customerId });
  if (!row) throw new OpsError("Only a finalized invoice that isn't void has a link.");
  await closeOpenCheckouts(id); // an open Stripe page's way back carries the old link
  await logActivity({ actor, action: "invoice.link_replaced", entityType: "invoice", entityId: id, summary: `Made a new customer link for invoice ${row.number} (the old one stopped working)` });
  return payPageUrl(token.token, opts.origin);
}

export async function markReminderSent(id: string, actor: string): Promise<schema.Invoice> {
  people(actor, "mark a reminder sent");
  const db = await getDb();
  const [row] = await db.update(schema.invoices).set({ lastRemindedAt: new Date(), reminderCount: sql`${schema.invoices.reminderCount} + 1`, updatedAt: new Date() })
    .where(and(eq(schema.invoices.id, id), inArray(schema.invoices.status, ["sent", "partially_paid"]))).returning();
  if (!row) throw new OpsError("Only an invoice that is still owed can be reminded about.");
  await logActivity({ actor, action: "invoice.reminded", entityType: "invoice", entityId: id, summary: `Sent a reminder for invoice ${row.number}` });
  return row;
}

export async function getInvoiceMessages(id: string, actor: string, opts: { origin?: string | null; today?: string } = {}): Promise<InvoiceMessages> {
  people(actor, "see an invoice's messages");
  const today = opts.today ?? todayNY();
  const [row, settings] = await Promise.all([invoiceWithCustomer(id), getInvoiceSettings()]);
  if (!row) throw new OpsError("That invoice is gone.");
  const { inv, customer } = row;
  const stripeReady = stripeConfigured();
  const finalized = inv.status !== "draft";
  const url = finalized ? urlFromEnc(inv.tokenEnc, opts.origin) : null;
  const options = payOptions(settings, inv, stripeReady, maskedBankDetails(settings));
  const online = options.some((o) => o.way === "bank" || o.way === "card");
  const dates = { issueDate: inv.issueDate ?? today, dueDate: inv.dueDate ?? addDaysYmd(inv.issueDate ?? today, inv.termsDays) };
  const number = inv.number ?? "DRAFT";
  const texts = buildInvoiceMessages({
    businessName: customer.name,
    contactName: customer.contactName,
    number,
    totalCents: inv.totalCents,
    balanceCents: balanceCents(inv),
    ...dates,
    today,
    fromName: settings.fromName ?? "Nora",
    // Worded like the PDF, but a bank transfer only points at the PDF: never the account or routing number.
    payLines: paymentMessageLines(options, online ? url : null),
  });
  const done = buildDone({ ...inv, ...dates }, customer, settings, { origin: opts.origin, stripeReady });
  const share = (lang: schema.IntakeLang) =>
    url
      ? invoiceCopy(lang).share.message({ business: customer.name, contactName: customer.contactName, from: settings.fromName ?? "Nora", number, amount: formatCents(balanceCents(inv) || inv.totalCents, { decimals: "always" }), dueDate: dates.dueDate, url })
      : done.messages[lang];
  const missing = [...texts.missing];
  if (!settings.fromName || !settings.fromAddress) missing.push("your name and address (Settings)");
  return {
    url,
    to: customer.email,
    email: texts.email,
    reminder: texts.reminder,
    pdfText: done.messages,
    text: { en: share("en"), "zh-Hans": share("zh-Hans"), "zh-Hant": share("zh-Hant") },
    emailMailto: mailtoHref(customer.email, texts.email),
    reminderMailto: mailtoHref(customer.email, texts.reminder),
    missing,
  };
}

export async function getInvoice(id: string, opts: { today?: string; origin?: string | null } = {}): Promise<InvoiceDetail | null> {
  const today = opts.today ?? todayNY();
  const db = await getDb();
  const [[row], payments, contract, processing, settings] = await Promise.all([
    db.select({
      inv: schema.invoices,
      customer: schema.customers,
      dealBusiness: schema.deals.businessName,
      dealStatus: schema.deals.status,
      dealPayment: schema.deals.paymentStatus,
    }).from(schema.invoices)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
      .leftJoin(schema.deals, eq(schema.deals.id, schema.invoices.dealId))
      .where(eq(schema.invoices.id, id)),
    db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, id)).orderBy(asc(schema.invoicePayments.paidOn), asc(schema.invoicePayments.createdAt)),
    contractForInvoice(id),
    db.select({ amountCents: schema.invoiceCheckouts.amountCents, startedAt: schema.invoiceCheckouts.createdAt, method: schema.invoiceCheckouts.method })
      .from(schema.invoiceCheckouts).where(and(eq(schema.invoiceCheckouts.invoiceId, id), eq(schema.invoiceCheckouts.status, "processing"))),
    getInvoiceSettings(),
  ]);
  if (!row) return null;
  const { inv, customer } = row;
  const stripeReady = stripeConfigured();
  // A team page (and what Claude's get_invoice is built from): her bank account masked, never the number.
  const bank = maskedBankDetails(settings);
  const options = payOptions(settings, inv, stripeReady, bank);
  const online = options.some((o) => o.way === "bank" || o.way === "card");
  return {
    ...rowOut(inv),
    items: inv.items,
    lines: invoiceLines(inv.items),
    display: invoiceDisplayStatus(inv, today),
    balanceCents: balanceCents(inv),
    overpaidCents: overpaidCents(inv),
    daysOverdue: isOpenStatus(inv.status) ? daysOverdue(inv.dueDate, today) : 0,
    customer,
    payments,
    deal: inv.dealId && row.dealBusiness ? { id: inv.dealId, businessName: row.dealBusiness, status: row.dealStatus ?? "", paymentStatus: row.dealPayment ?? "" } : null,
    contract,
    processing: processing as ProcessingPayment[],
    payOptions: options,
    document: invoiceDocument(inv, customer, settings, { stripeReady, payUrl: online && inv.status !== "draft" ? urlFromEnc(inv.tokenEnc, opts.origin) : null, today, bank }),
    nextSteps: invoiceNextSteps({ id: inv.id, status: inv.status, contractId: inv.contractId }),
    hasLink: !!inv.tokenHash,
  };
}

export async function listInvoices(filter: InvoiceListFilter = {}): Promise<InvoiceListRow[]> {
  const today = filter.today ?? todayNY();
  const inv = schema.invoices;
  const conds: (SQL | undefined)[] = [];
  const status = filter.status ?? "all";
  const notOverdue = sql`(${inv.dueDate} is null or ${inv.dueDate} >= ${today})`;
  if (status === "all") conds.push(ne(inv.status, "void"));
  else if (status === "open") conds.push(inArray(inv.status, ["sent", "partially_paid"]));
  else if (status === "overdue") conds.push(inArray(inv.status, ["sent", "partially_paid"]), sql`${inv.dueDate} < ${today}`);
  else if (status === "sent" || status === "partially_paid") conds.push(eq(inv.status, status), notOverdue);
  else if (status !== "everything") conds.push(eq(inv.status, status));
  if (filter.customerId) conds.push(eq(inv.customerId, filter.customerId));
  if (filter.dealId) conds.push(eq(inv.dealId, filter.dealId));
  if (filter.contractId) conds.push(eq(inv.contractId, filter.contractId));
  if (filter.year) conds.push(sql`coalesce(${inv.issueDate}, to_char(${inv.createdAt}, 'YYYY-MM-DD')) like ${`${Math.trunc(filter.year)}-%`}`);
  const q = cleanLine(filter.q ?? "").slice(0, 80);
  if (q) conds.push(or(ilike(inv.number, likeText(q)), ilike(schema.customers.name, likeText(q))));
  const db = await getDb();
  const rows = await db.select({ inv, customerName: schema.customers.name }).from(inv)
    .innerJoin(schema.customers, eq(schema.customers.id, inv.customerId))
    .where(and(...conds))
    .orderBy(sql`(${inv.status} = 'draft') desc`, sql`${inv.issueDate} desc nulls first`, desc(inv.number), desc(inv.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000));
  return rows.map((r) => listRow(r.inv, r.customerName, today));
}

export async function invoicesForDeal(dealId: string, opts: { today?: string } = {}): Promise<InvoiceListRow[]> {
  return listInvoices({ dealId, status: "all", today: opts.today });
}

/**
 * The PDF: one of the two places that print her real bank account (the other is the customer's page). Both routes
 * that serve it (/invoices/<id>/pdf for a signed-in person, /i/<token>/pdf for the customer) answer no-store.
 */
export async function invoicePdf(id: string, opts: { public?: boolean; today?: string; origin?: string | null } = {}): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const [row, { settings, bank }] = await Promise.all([invoiceWithCustomer(id), paySetup()]);
  if (!row) return null;
  const { inv, customer } = row;
  if (opts.public && (inv.status === "draft" || inv.status === "void")) return null;
  const stripeReady = stripeConfigured();
  const online = hasOnlineWay(payOptions(settings, inv, stripeReady, null).map((o) => o.way));
  const doc = invoiceDocument(inv, customer, settings, {
    stripeReady,
    payUrl: online && inv.status !== "draft" ? urlFromEnc(inv.tokenEnc, opts.origin) : null,
    today: opts.today ?? todayNY(),
    bank,
  });
  const bytes = await renderInvoicePdf(doc, { title: `Invoice ${inv.number ?? "DRAFT"}` });
  return { bytes, filename: doc.fileName };
}

/* ───────────────────────── Contracts ⇄ invoices ───────────────────────── */

function contractRef(r: schema.ContractRow): ContractRef {
  const fields = readContractFields(r.fields);
  return {
    id: r.id,
    kind: r.kind,
    clientBusiness: r.clientBusiness,
    clientContact: r.clientContact,
    agreementDate: r.agreementDate,
    feeCents: r.feeCents,
    dealId: r.dealId,
    customerId: r.customerId,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    fields,
  };
}

export async function invoicePrefillFromContract(contractId: string, opts: { today?: string; part?: ContractPart | null } = {}): Promise<InvoicePrefill | null> {
  const today = opts.today ?? todayNY();
  return prefillFromContract(contractId, opts.part ?? null, { today, settings: getInvoiceSettings(), options: billToOptions() });
}

export async function contractPrefillFromInvoice(invoiceId: string, opts: { today?: string } = {}): Promise<{ fields: Partial<ContractFields>; invoiceId: string; customerId: string; dealId: string | null; note: string } | null> {
  const today = opts.today ?? todayNY();
  const row = await invoiceWithCustomer(invoiceId);
  if (!row) return null;
  const { inv, customer } = row;
  let fromDeal: Partial<ContractFields> = {};
  if (inv.dealId) {
    const db = await getDb();
    const [[deal], dels] = await Promise.all([
      db.select().from(schema.deals).where(eq(schema.deals.id, inv.dealId)),
      db.select({ kind: schema.dealDeliverables.kind, dueDate: schema.dealDeliverables.dueDate }).from(schema.dealDeliverables).where(eq(schema.dealDeliverables.dealId, inv.dealId)).orderBy(asc(schema.dealDeliverables.sortOrder)),
    ]);
    if (deal) fromDeal = fieldsFromDeal({ ...deal, deliverables: dels }, process.env.APP_TZ ?? "America/New_York");
  }
  const fromInvoice = contractFieldsFromInvoice({ items: inv.items, retainerId: inv.retainerId }, customer, today);
  return {
    fields: { ...fromDeal, ...fromInvoice },
    invoiceId: inv.id,
    customerId: customer.id,
    dealId: inv.dealId,
    note: `From ${inv.number ? `invoice ${inv.number}` : "a draft invoice"} (${customer.name})`,
  };
}

export async function linkContractToInvoice(contractId: string, invoiceId: string, actor: string): Promise<void> {
  people(actor, "link a contract");
  const db = await getDb();
  const [inv] = await db.update(schema.invoices).set({ contractId, updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId))
    .returning({ customerId: schema.invoices.customerId, dealId: schema.invoices.dealId, number: schema.invoices.number, retainerId: schema.invoices.retainerId });
  if (!inv) throw new OpsError("The contract was saved, but that invoice is gone, so they aren't linked.");
  // A contract made from a retainer's invoice IS that retainer's contract: it already bills monthly, so the contract
  // doesn't offer "Set up monthly invoices" (which would make a second retainer and two drafts every month).
  if (inv.retainerId) {
    await db.update(schema.retainers).set({ contractId, updatedAt: new Date() })
      .where(and(eq(schema.retainers.id, inv.retainerId), isNull(schema.retainers.contractId)))
      .catch((e) => {
        if (!isUniqueViolation(e)) throw e; // the contract already has its own retainer: leave both as they are
      });
  }
  await db.update(schema.contracts).set({ customerId: sql`coalesce(${schema.contracts.customerId}, ${inv.customerId})`, dealId: sql`coalesce(${schema.contracts.dealId}, ${inv.dealId})` })
    .where(eq(schema.contracts.id, contractId));
  await logActivity({ actor, action: "invoice.contract_linked", entityType: "invoice", entityId: invoiceId, summary: `Linked a contract to ${inv.number ? `invoice ${inv.number}` : "a draft invoice"}` });
}

export async function contractForInvoice(invoiceId: string): Promise<ContractRef | null> {
  const db = await getDb();
  const [row] = await db.select({ c: schema.contracts }).from(schema.invoices)
    .innerJoin(schema.contracts, eq(schema.contracts.id, schema.invoices.contractId)).where(eq(schema.invoices.id, invoiceId));
  return row ? contractRef(row.c) : null;
}

export async function contractsForCustomer(customerId: string): Promise<ContractRef[]> {
  const db = await getDb();
  const [c] = await db.select({ nameKey: schema.customers.nameKey }).from(schema.customers).where(eq(schema.customers.id, customerId));
  if (!c) return [];
  // Linked (contracts.customerId, or one of their invoices bills it), or not linked to anyone and the same business name.
  const rows = await db.select({
    c: schema.contracts,
    viaInvoice: sql<boolean>`(${schema.contracts.id} in (select i.contract_id from invoices i where i.customer_id = ${customerId} and i.contract_id is not null))`,
  }).from(schema.contracts).where(or(
    eq(schema.contracts.customerId, customerId),
    isNull(schema.contracts.customerId),
    sql`${schema.contracts.id} in (select i.contract_id from invoices i where i.customer_id = ${customerId} and i.contract_id is not null)`,
  )).orderBy(desc(schema.contracts.createdAt)).limit(500);
  return rows
    .filter((r) => r.c.customerId === customerId || r.viaInvoice || (r.c.customerId == null && customerNameKey(r.c.clientBusiness) === c.nameKey))
    .map((r) => contractRef(r.c));
}

export async function contractsForDeal(dealId: string): Promise<ContractRef[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.contracts).where(or(
    eq(schema.contracts.dealId, dealId),
    sql`${schema.contracts.id} in (select i.contract_id from invoices i where i.deal_id = ${dealId} and i.contract_id is not null)`,
  )).orderBy(desc(schema.contracts.createdAt));
  return rows.map(contractRef);
}

export async function invoicesForContracts(contractIds: string[], opts: { today?: string } = {}): Promise<Record<string, ContractInvoiceRef[]>> {
  const ids = [...new Set(contractIds.filter(Boolean))];
  if (!ids.length) return {};
  const today = opts.today ?? todayNY();
  const db = await getDb();
  const rows = await db.select().from(schema.invoices).where(inArray(schema.invoices.contractId, ids)).orderBy(asc(schema.invoices.createdAt));
  const out: Record<string, ContractInvoiceRef[]> = {};
  for (const r of rows) {
    if (!r.contractId) continue;
    (out[r.contractId] ??= []).push({
      id: r.id,
      number: r.number,
      status: r.status,
      display: invoiceDisplayStatus(r, today),
      issueDate: r.issueDate,
      totalCents: r.totalCents,
      balanceCents: balanceCents(r),
      mainLineCents: mainLineCents(r.items),
    });
  }
  return out;
}

/** The customer a contract bills: its own link, else one with the same name (and email), else its deal's, else a new one. */
async function customerForContract(c: schema.ContractRow, fields: ContractFields, actor: string): Promise<schema.Customer> {
  if (c.customerId) {
    const own = await customerRow(c.customerId);
    if (own && !own.archived) return own;
  }
  const db = await getDb();
  const key = customerNameKey(c.clientBusiness);
  const email = fields.clientEmail.trim().toLowerCase() || null;
  const same = await db.select().from(schema.customers).where(and(eq(schema.customers.nameKey, key), eq(schema.customers.archived, false))).orderBy(asc(schema.customers.createdAt));
  const match = same.find((x) => !!email && x.email?.toLowerCase() === email) ?? same.find((x) => !x.email || !email);
  if (match) return match;
  if (c.dealId) return customerForDeal(c.dealId, actor);
  const [row] = await db.insert(schema.customers).values({
    id: newId("cus_"),
    name: c.clientBusiness,
    nameKey: key,
    contactName: c.clientContact ?? (fields.clientContact.trim() || null),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    source: "contract",
    createdBy: actor,
  }).returning();
  await logActivity({ actor, action: "customer.created", entityType: "customer", entityId: row.id, summary: `Added ${row.name} as a customer (from their contract)` });
  return row;
}

export async function createRetainerFromContract(contractId: string, actor: string, opts: { today?: string } = {}): Promise<{ retainer: schema.Retainer; created: boolean }> {
  people(actor, "set up monthly invoices");
  const today = opts.today ?? todayNY();
  const db = await getDb();
  const [[c], [existing]] = await Promise.all([
    db.select().from(schema.contracts).where(eq(schema.contracts.id, contractId)),
    db.select().from(schema.retainers).where(eq(schema.retainers.contractId, contractId)),
  ]);
  if (!c) throw new OpsError("That contract is gone.");
  if (existing) return { retainer: existing, created: false };
  const fields = readContractFields(c.fields);
  const plan = retainerFromContractFields(fields, today);
  if (!plan) throw new OpsError("Only a monthly contract with a fee can bill monthly.");
  const customer = await customerForContract(c, fields, actor);
  // A month an invoice from this contract already bills is not billed again.
  const firstMonth = plan.startMonth > today.slice(0, 7) ? plan.startMonth : today.slice(0, 7);
  const billed = await db.select({ items: schema.invoices.items, retainerMonth: schema.invoices.retainerMonth }).from(schema.invoices)
    .where(and(eq(schema.invoices.contractId, contractId), ne(schema.invoices.status, "void")));
  const line = retainerItemDescription(MONTHLY_SERVICE_LINE, firstMonth).toLowerCase();
  const already = billed.some((b) => b.retainerMonth === firstMonth || b.items[0]?.description.trim().toLowerCase() === line);
  const [row] = await db.insert(schema.retainers).values({
    id: newId("ret_"),
    customerId: customer.id,
    description: plan.description,
    amountCents: plan.amountCents,
    dayOfMonth: plan.dayOfMonth,
    startMonth: plan.startMonth,
    active: true,
    lastRunMonth: already ? firstMonth : null,
    contractId,
    createdBy: actor,
  }).onConflictDoNothing({ target: schema.retainers.contractId }).returning();
  await db.update(schema.contracts).set({ customerId: sql`coalesce(${schema.contracts.customerId}, ${customer.id})` }).where(eq(schema.contracts.id, contractId));
  if (!row) {
    const [winner] = await db.select().from(schema.retainers).where(eq(schema.retainers.contractId, contractId));
    if (!winner) throw new OpsError("Couldn't set up the monthly invoices. Try again.");
    return { retainer: winner, created: false };
  }
  await logActivity({ actor, action: "retainer.created", entityType: "retainer", entityId: row.id, clientId: customer.clientId, summary: `Set up monthly invoices for ${customer.name} from their contract` });
  return { retainer: row, created: true };
}

/* ───────────────────────── Payments ───────────────────────── */

/** ONE UPDATE: paid, status and paidAt from the payments (docs/invoicing.md "Payment recompute"). */
async function recompute(id: string): Promise<schema.Invoice | null> {
  const db = await getDb();
  const inv = schema.invoices;
  const sum = sql`(select coalesce(sum(p.amount_cents), 0)::int from invoice_payments p where p.invoice_id = ${inv.id})`;
  const [row] = await db.update(inv).set({
    paidCents: sum,
    status: sql`case when ${inv.status} in ('draft', 'void') then ${inv.status}
      when ${inv.totalCents} > 0 and ${sum} >= ${inv.totalCents} then 'paid'
      when ${sum} > 0 then 'partially_paid' else 'sent' end`,
    paidAt: sql`case when ${inv.status} not in ('draft', 'void') and ${inv.totalCents} > 0 and ${sum} >= ${inv.totalCents} then coalesce(${inv.paidAt}, now()) else null end`,
    updatedAt: new Date(),
  }).where(eq(inv.id, id)).returning();
  return row ?? null;
}

export async function recordPayment(invoiceId: string, input: PaymentInputT, actor: string): Promise<{ payment: schema.InvoicePayment; invoice: schema.Invoice }> {
  people(actor, "record a payment");
  const v = PaymentInput.parse(input);
  guardText([["the reference", v.reference], ["the note", v.note]]);
  const row = await invoiceWithCustomer(invoiceId);
  if (!row) throw new OpsError("That invoice is gone.");
  const { inv, customer } = row;
  /** Why this amount can't be recorded on the invoice as it is now, in plain words. */
  const refusal = (now: schema.Invoice): OpsError => {
    if (now.status === "draft") return new OpsError("Make the PDF first: a draft can't be paid.");
    if (now.status === "void") return new OpsError("This invoice is void.");
    const owed = balanceCents(now);
    if (owed <= 0) return new OpsError("This invoice is already paid in full.");
    return new OpsError(`That's more than the ${formatCents(owed, { decimals: "always" })} still owed.`);
  };
  if (!isOpenStatus(inv.status) || v.amountCents > balanceCents(inv)) throw refusal(inv);
  const db = await getDb();
  const i = schema.invoices;
  // Hold the amount first, in ONE conditional UPDATE: only while the invoice is owed at least this much. Two people
  // recording the same payment at the same moment can't both pass (the second waits for the row, then sees the first
  // one's amount and is refused). recompute below then sets paid_cents to the true sum, whether or not the insert worked.
  const [held] = await db.update(i).set({ paidCents: sql`${i.paidCents} + ${v.amountCents}` })
    .where(and(eq(i.id, invoiceId), inArray(i.status, ["sent", "partially_paid"]), sql`${i.totalCents} - ${i.paidCents} >= ${v.amountCents}`))
    .returning({ id: i.id });
  if (!held) {
    const now = await invoiceRow(invoiceId);
    if (!now) throw new OpsError("That invoice is gone.");
    throw refusal(now);
  }
  let payment: schema.InvoicePayment;
  let invoice: schema.Invoice;
  try {
    [payment] = await db.insert(schema.invoicePayments).values({
      id: newId("pay_"),
      invoiceId,
      amountCents: v.amountCents,
      paidOn: v.paidOn,
      method: v.method,
      reference: v.reference ?? null,
      note: v.note ?? null,
      recordedBy: actor,
    }).returning();
  } finally {
    invoice = (await recompute(invoiceId)) ?? inv;
  }
  await Promise.all([
    logActivity({ actor, action: "invoice.payment_recorded", entityType: "invoice", entityId: invoiceId, clientId: customer.clientId, summary: `Recorded a ${PAYMENT_METHOD_LABEL[v.method]} payment on invoice ${inv.number} (${customer.name})${invoice.status === "paid" ? ": paid in full" : ""}` }),
    invoice.dealId ? syncDealFromInvoices(invoice.dealId, actor) : null,
  ]);
  // A Stripe page opened before this payment would still take the old balance: close it.
  await closeOpenCheckouts(invoiceId);
  return { payment, invoice };
}

export async function deletePayment(paymentId: string, actor: string): Promise<schema.Invoice> {
  people(actor, "delete a payment");
  const db = await getDb();
  const [gone] = await db.delete(schema.invoicePayments).where(eq(schema.invoicePayments.id, paymentId)).returning({ invoiceId: schema.invoicePayments.invoiceId, method: schema.invoicePayments.method });
  if (!gone) throw new OpsError("That payment is already gone.");
  const invoice = await recompute(gone.invoiceId);
  if (!invoice) throw new OpsError("That invoice is gone.");
  await Promise.all([
    logActivity({ actor, action: "invoice.payment_deleted", entityType: "invoice", entityId: invoice.id, summary: `Deleted a ${PAYMENT_METHOD_LABEL[gone.method]} payment from invoice ${invoice.number}` }),
    invoice.dealId ? syncDealFromInvoices(invoice.dealId, actor) : null,
  ]);
  await closeOpenCheckouts(invoice.id); // the balance changed: an open Stripe page has the old amount
  return invoice;
}

export async function recordStripePayment(input: StripePaymentRecord): Promise<{ recorded: boolean; invoice: schema.Invoice | null }> {
  const actor = "system";
  if (!input.invoiceId || !input.sessionId || !Number.isInteger(input.amountCents) || input.amountCents <= 0) return { recorded: false, invoice: null };
  if (input.method !== "stripe_ach" && input.method !== "stripe_card") return { recorded: false, invoice: null };
  const inv = await invoiceRow(input.invoiceId);
  if (!inv) return { recorded: false, invoice: null };
  const db = await getDb();
  const [ins] = await db.insert(schema.invoicePayments).values({
    id: newId("pay_"),
    invoiceId: inv.id,
    amountCents: Math.min(input.amountCents, MAX_INVOICE_CENTS),
    paidOn: isYmd(input.paidOn) ? input.paidOn : todayNY(),
    method: input.method,
    reference: null,
    stripeSessionId: input.sessionId,
    stripePaymentIntentId: input.paymentIntentId,
    feeCents: input.feeCents != null && Number.isInteger(input.feeCents) && input.feeCents >= 0 ? input.feeCents : null,
    recordedBy: actor,
  }).onConflictDoNothing({ target: schema.invoicePayments.stripeSessionId }).returning({ id: schema.invoicePayments.id });
  if (!ins) return { recorded: false, invoice: inv }; // a replayed event: recorded once already
  const invoice = (await recompute(inv.id)) ?? inv;
  const stripeCustomer = typeof input.stripeCustomerId === "string" && /^cus_[A-Za-z0-9]{6,64}$/.test(input.stripeCustomerId) ? input.stripeCustomerId : null;
  await Promise.all([
    logActivity({ actor, action: "invoice.stripe_payment", entityType: "invoice", entityId: inv.id, summary: `Stripe: a ${input.method === "stripe_ach" ? "bank transfer" : "card"} payment came in on invoice ${inv.number}${invoice.status === "paid" ? " (paid in full)" : ""}` }),
    invoice.dealId ? syncDealFromInvoices(invoice.dealId, actor) : null,
    stripeCustomer
      ? db.update(schema.customers).set({ stripeCustomerId: stripeCustomer, updatedAt: new Date() }).where(and(eq(schema.customers.id, inv.customerId), isNull(schema.customers.stripeCustomerId)))
      : null,
  ]);
  // Any other page still open for this invoice (a second tab, a second press) must not take the money again.
  await closeOpenCheckouts(inv.id, { exceptSessionId: input.sessionId });
  return { recorded: true, invoice };
}

export async function syncDealFromInvoices(dealId: string, actor: string): Promise<void> {
  if (isClaude(actor)) throw new OpsError("Only Nora or Cameron change a deal's payment.");
  const db = await getDb();
  const [[deal], invs] = await Promise.all([
    db.select().from(schema.deals).where(eq(schema.deals.id, dealId)),
    db.select({ status: schema.invoices.status, dueDate: schema.invoices.dueDate, paidAt: schema.invoices.paidAt }).from(schema.invoices)
      .where(and(eq(schema.invoices.dealId, dealId), inArray(schema.invoices.status, ["sent", "partially_paid", "paid"]))),
  ]);
  if (!deal) return;
  let set: Partial<typeof schema.deals.$inferInsert> | null = null;
  if (!invs.length) {
    if (deal.paymentStatus === "requested") set = { paymentStatus: "not_requested", paymentDueDate: null, paidAt: null };
  } else if (invs.every((i) => i.status === "paid")) {
    const last = invs.map((i) => i.paidAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    set = { paymentStatus: "paid", paidAt: deal.paymentStatus === "paid" && deal.paidAt ? deal.paidAt : last ? new Date(last) : new Date() };
  } else {
    const due = invs.filter((i) => i.status !== "paid").map((i) => i.dueDate).filter((d): d is string => !!d).sort()[0] ?? deal.paymentDueDate;
    set = { paymentStatus: "requested", paymentDueDate: due ?? null, paidAt: null };
  }
  if (!set) return;
  const same = set.paymentStatus === deal.paymentStatus && (set.paymentDueDate === undefined || set.paymentDueDate === deal.paymentDueDate) && (set.paymentStatus !== "paid" || !!deal.paidAt);
  if (same) return;
  await db.update(schema.deals).set({ ...set, updatedAt: new Date() }).where(eq(schema.deals.id, dealId));
  if (set.paymentStatus !== deal.paymentStatus) {
    const label = set.paymentStatus === "paid" ? "paid" : set.paymentStatus === "requested" ? "invoiced" : "not requested";
    await logActivity({ actor, action: "deal.payment", entityType: "deal", entityId: dealId, clientId: "noraeatsgood", summary: `${deal.businessName}: payment ${label} (from its invoice)` });
  }
}

/* ───────────────────────── Retainers ───────────────────────── */

export async function createRetainer(input: RetainerInputT, actor: string): Promise<schema.Retainer> {
  people(actor, "add a retainer");
  const v = RetainerInput.parse(input);
  const db = await getDb();
  const c = await customerRow(v.customerId);
  if (!c) throw new OpsError("That customer is gone.");
  if (v.contractId) {
    const [[k], [taken]] = await Promise.all([
      db.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.id, v.contractId)),
      db.select({ id: schema.retainers.id }).from(schema.retainers).where(eq(schema.retainers.contractId, v.contractId)),
    ]);
    if (!k) throw new OpsError("That contract is gone.");
    if (taken) throw new OpsError("That contract already bills monthly.");
  }
  const [row] = await db.insert(schema.retainers).values({
    id: newId("ret_"),
    customerId: v.customerId,
    description: v.description,
    amountCents: v.amountCents,
    dayOfMonth: v.dayOfMonth,
    startMonth: v.startMonth ?? null,
    active: v.active ?? true,
    contractId: v.contractId ?? null,
    createdBy: actor,
  }).returning();
  await logActivity({ actor, action: "retainer.created", entityType: "retainer", entityId: row.id, clientId: c.clientId, summary: `Set up a monthly retainer for ${c.name}` });
  return row;
}

export async function updateRetainer(id: string, patch: z.input<typeof RetainerPatch>, actor: string): Promise<schema.Retainer> {
  people(actor, "change a retainer");
  const v = RetainerPatch.parse(patch);
  const set: Partial<typeof schema.retainers.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["description", "amountCents", "dayOfMonth", "startMonth", "active", "contractId"] as const) {
    if (v[k] !== undefined) (set as Record<string, unknown>)[k] = v[k] ?? null;
  }
  const db = await getDb();
  let row: schema.Retainer | undefined;
  try {
    [row] = await db.update(schema.retainers).set(set).where(eq(schema.retainers.id, id)).returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw new OpsError("That contract already bills monthly.");
    throw e;
  }
  if (!row) throw new OpsError("That retainer is gone.");
  await logActivity({ actor, action: "retainer.updated", entityType: "retainer", entityId: id, summary: v.active === false ? "Paused a monthly retainer" : v.active === true ? "Turned a monthly retainer back on" : "Changed a monthly retainer" });
  return row;
}

export async function deleteRetainer(id: string, actor: string): Promise<void> {
  people(actor, "delete a retainer");
  const db = await getDb();
  const [row] = await db.delete(schema.retainers).where(eq(schema.retainers.id, id)).returning({ customerId: schema.retainers.customerId });
  if (row) await logActivity({ actor, action: "retainer.deleted", entityType: "retainer", entityId: id, summary: "Deleted a monthly retainer (its drafts stay)" });
}

export async function listRetainers(customerId?: string): Promise<schema.Retainer[]> {
  const db = await getDb();
  return db.select().from(schema.retainers).where(customerId ? eq(schema.retainers.customerId, customerId) : undefined).orderBy(asc(schema.retainers.createdAt));
}

export async function runRetainers(now = new Date(), opts: { dryRun?: boolean } = {}): Promise<RunRetainersResult> {
  const today = todayNY(now);
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const db = await getDb();
  const [rows, settings] = await Promise.all([
    db.select({ r: schema.retainers, name: schema.customers.name, lang: schema.customers.lang, archived: schema.customers.archived, clientId: schema.customers.clientId, contractFields: schema.contracts.fields })
      .from(schema.retainers).innerJoin(schema.customers, eq(schema.customers.id, schema.retainers.customerId))
      .leftJoin(schema.contracts, eq(schema.contracts.id, schema.retainers.contractId))
      .where(eq(schema.retainers.active, true)),
    getInvoiceSettings(),
  ]);
  const result: RunRetainersResult = { created: [], failed: 0 };
  for (const { r, name, lang, archived, clientId, contractFields } of rows) {
    if (archived || !retainerDue(r, today)) continue;
    if (r.contractId) {
      // A month an invoice from its contract already bills ("Make the invoice" on the contract, made by hand) is not
      // billed again: the month is marked taken and no draft is made. The same test as createRetainerFromContract.
      const billed = await db.select({ items: schema.invoices.items, retainerMonth: schema.invoices.retainerMonth }).from(schema.invoices)
        .where(and(eq(schema.invoices.contractId, r.contractId), ne(schema.invoices.status, "void")));
      const lines = [retainerItemDescription(r.description, month).toLowerCase(), retainerItemDescription(MONTHLY_SERVICE_LINE, month).toLowerCase()];
      if (billed.some((b) => b.retainerMonth === month || lines.includes(b.items[0]?.description.trim().toLowerCase() ?? ""))) {
        if (!opts.dryRun) {
          await db.update(schema.retainers).set({ lastRunMonth: month, updatedAt: new Date() })
            .where(and(eq(schema.retainers.id, r.id), sql`${schema.retainers.lastRunMonth} is distinct from ${month}`));
        }
        continue;
      }
    }
    if (opts.dryRun) {
      result.created.push({ invoiceId: "", retainerId: r.id, customerName: name, amountCents: r.amountCents, month });
      continue;
    }
    // Claim the month: ONE conditional UPDATE, so two runs can't both make it (and a deleted draft isn't made again).
    const [claimed] = await db.update(schema.retainers).set({ lastRunMonth: month, updatedAt: new Date() }).where(and(
      eq(schema.retainers.id, r.id),
      eq(schema.retainers.active, true),
      sql`${schema.retainers.dayOfMonth} <= ${day}`,
      sql`(${schema.retainers.startMonth} is null or ${schema.retainers.startMonth} <= ${month})`,
      sql`${schema.retainers.lastRunMonth} is distinct from ${month}`,
    )).returning({ id: schema.retainers.id });
    if (!claimed) continue;
    try {
      const items: InvoiceItem[] = [{ description: retainerItemDescription(r.description, month), quantity: 1, unitCents: r.amountCents }];
      const totals = invoiceTotals(items);
      const [inv] = await db.insert(schema.invoices).values({
        id: newId("inv_"),
        customerId: r.customerId,
        status: "draft",
        // Dated the day a person makes the PDF. Due on receipt, or in its contract's "pay within" days.
        termsDays: contractFields ? contractPaymentDays(readContractFields(contractFields)) : 0,
        items,
        ...totals,
        notes: settings.footer,
        payWays: newInvoiceWays(settings), // the ways ticked in Settings for new invoices, else Zelle
        retainerId: r.id,
        retainerMonth: month,
        contractId: r.contractId,
        lang: lang ?? null,
        source: "retainer",
        createdBy: "system",
      }).onConflictDoNothing().returning({ id: schema.invoices.id });
      if (!inv) continue; // already made for this month
      result.created.push({ invoiceId: inv.id, retainerId: r.id, customerName: name, amountCents: r.amountCents, month });
      await logActivity({ actor: "system", action: "invoice.retainer_draft", entityType: "invoice", entityId: inv.id, clientId, summary: `Made this month's retainer draft for ${name}` });
    } catch (e) {
      console.error("[invoices] retainer draft failed", r.id, e instanceof Error ? e.message : e);
      result.failed++;
      // Release the month so the next run retries.
      await db.update(schema.retainers).set({ lastRunMonth: r.lastRunMonth, updatedAt: new Date() })
        .where(and(eq(schema.retainers.id, r.id), eq(schema.retainers.lastRunMonth, month))).catch(() => null);
    }
  }
  return result;
}

/* ───────────────────────── Reports and reminders ───────────────────────── */

export async function invoiceReport(opts: { today?: string; year?: number } = {}): Promise<InvoiceReport> {
  const today = opts.today ?? todayNY();
  const year = opts.year ?? Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const db = await getDb();
  const [open, [drafts], payments, issued] = await Promise.all([
    listInvoices({ status: "open", today, limit: 2000 }),
    db.select({ n: sql`count(*)`.mapWith(Number) }).from(schema.invoices).where(eq(schema.invoices.status, "draft")),
    db.select({ amount: schema.invoicePayments.amountCents, paidOn: schema.invoicePayments.paidOn, method: schema.invoicePayments.method, fee: schema.invoicePayments.feeCents, customerId: schema.invoices.customerId, name: schema.customers.name })
      .from(schema.invoicePayments)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoicePayments.invoiceId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
      .where(or(sql`${schema.invoicePayments.paidOn} like ${`${year}-%`}`, sql`${schema.invoicePayments.paidOn} like ${`${month}-%`}`)),
    db.select({ customerId: schema.invoices.customerId, name: schema.customers.name, total: schema.invoices.totalCents }).from(schema.invoices)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
      .where(and(inArray(schema.invoices.status, ["sent", "partially_paid", "paid"]), sql`${schema.invoices.issueDate} like ${`${year}-%`}`)),
  ]);
  const inYear = payments.filter((p) => p.paidOn.startsWith(`${year}-`));
  const soon = addDaysYmd(today, 7);
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, cents: 0 }));
  const byMethod = new Map<PaymentMethod, number>();
  for (const p of inYear) {
    byMonth[Number(p.paidOn.slice(5, 7)) - 1].cents += p.amount;
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  }
  type Row = InvoiceReport["byCustomer"][number];
  const byCustomer = new Map<string, Row>();
  const cust = (id: string, name: string) => {
    let r = byCustomer.get(id);
    if (!r) byCustomer.set(id, (r = { customerId: id, name, outstandingCents: 0, overdueCents: 0, invoicedThisYearCents: 0, paidThisYearCents: 0 }));
    return r;
  };
  for (const i of open) {
    const r = cust(i.customerId, i.customerName);
    r.outstandingCents += i.balanceCents;
    if (i.display === "overdue") r.overdueCents += i.balanceCents;
  }
  for (const i of issued) cust(i.customerId, i.name).invoicedThisYearCents += i.total;
  for (const p of inYear) cust(p.customerId, p.name).paidThisYearCents += p.amount;
  const overdue = open.filter((i) => i.display === "overdue");
  return {
    today,
    year,
    month,
    outstandingCents: open.reduce((s, i) => s + i.balanceCents, 0),
    outstandingCount: open.length,
    overdueCents: overdue.reduce((s, i) => s + i.balanceCents, 0),
    overdueCount: overdue.length,
    dueSoon: open.filter((i) => i.display !== "overdue" && !!i.dueDate && i.dueDate >= today && i.dueDate <= soon).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    draftCount: drafts?.n ?? 0,
    paidThisMonthCents: payments.filter((p) => p.paidOn.startsWith(`${month}-`)).reduce((s, p) => s + p.amount, 0),
    paidThisYearCents: inYear.reduce((s, p) => s + p.amount, 0),
    feesThisYearCents: inYear.reduce((s, p) => s + (p.fee ?? 0), 0),
    paidByMonth: byMonth,
    byMethodThisYear: [...byMethod].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents),
    byCustomer: [...byCustomer.values()].sort((a, b) => b.outstandingCents - a.outstandingCents || b.paidThisYearCents - a.paidThisYearCents || a.name.localeCompare(b.name)),
  };
}

export async function paymentsCsv(opts: { year?: number } = {}): Promise<{ filename: string; csv: string }> {
  const db = await getDb();
  const rows = await db.select({
    paidOn: schema.invoicePayments.paidOn,
    number: schema.invoices.number,
    customer: schema.customers.name,
    method: schema.invoicePayments.method,
    reference: schema.invoicePayments.reference,
    amount: schema.invoicePayments.amountCents,
    fee: schema.invoicePayments.feeCents,
  }).from(schema.invoicePayments)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoicePayments.invoiceId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
    .where(opts.year ? sql`${schema.invoicePayments.paidOn} like ${`${Math.trunc(opts.year)}-%`}` : undefined)
    .orderBy(asc(schema.invoicePayments.paidOn), asc(schema.invoicePayments.createdAt));
  const csv = toCsv([
    ["Date", "Invoice", "Customer", "Method", "Reference", "Amount", "Stripe fee", "Net"],
    ...rows.map((r) => [r.paidOn, r.number ?? "", r.customer, PAYMENT_METHOD_LABEL[r.method] ?? r.method, r.reference ?? "", csvAmount(r.amount), r.fee == null ? "" : csvAmount(r.fee), csvAmount(r.amount - (r.fee ?? 0))]),
  ]);
  return { filename: opts.year ? `nora-hq-payments-${Math.trunc(opts.year)}.csv` : "nora-hq-payments.csv", csv };
}

export async function invoiceReminders(today: string, created?: RunRetainersResult): Promise<InvoiceReminderLines> {
  const tomorrow = addDaysYmd(today, 1);
  const ids = (created?.created ?? []).map((c) => c.invoiceId).filter(Boolean);
  const db = await getDb();
  const [open, ready] = await Promise.all([
    listInvoices({ status: "open", today, limit: 2000 }),
    ids.length
      ? db.select({ inv: schema.invoices, name: schema.customers.name }).from(schema.invoices)
          .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId)).where(inArray(schema.invoices.id, ids))
      : Promise.resolve([]),
  ]);
  return {
    dueTomorrow: open.filter((i) => i.dueDate === tomorrow && (i.issueDate ?? "") < tomorrow),
    overdue: open.filter((i) => i.display === "overdue").sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    readyToSend: ready.filter((r) => r.inv.status === "draft").map((r) => listRow(r.inv, r.name, today)),
  };
}

/* ───────────────────────── The customer's page (/i/<token>) ───────────────────────── */

export async function getInvoiceByToken(raw: unknown, opts: { today?: string } = {}): Promise<PublicInvoiceState> {
  if (!looksLikeToken(raw)) return { state: "unknown" };
  const today = opts.today ?? todayNY();
  const db = await getDb();
  const [row] = await db.select({ inv: schema.invoices, customer: schema.customers }).from(schema.invoices)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
    .where(eq(schema.invoices.tokenHash, linkHash(raw)));
  if (!row || row.inv.status === "draft") return { state: "unknown" };
  const { inv, customer } = row;
  const lang = inv.lang ?? customer.lang ?? null;
  if (inv.status === "void") return { state: "void", lang }; // before anything about how she gets paid is read
  const [payments, processing, { settings, bank }] = await Promise.all([
    db.select({ paidOn: schema.invoicePayments.paidOn, amountCents: schema.invoicePayments.amountCents }).from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, inv.id)).orderBy(asc(schema.invoicePayments.paidOn)),
    db.select({ amountCents: schema.invoiceCheckouts.amountCents, startedAt: schema.invoiceCheckouts.createdAt, method: schema.invoiceCheckouts.method })
      .from(schema.invoiceCheckouts).where(and(eq(schema.invoiceCheckouts.invoiceId, inv.id), eq(schema.invoiceCheckouts.status, "processing"))),
    paySetup(),
  ]);
  const issueDate = inv.issueDate ?? today;
  const invoice: PublicInvoice = {
    id: inv.id,
    number: inv.number ?? "",
    display: invoiceDisplayStatus(inv, today),
    issueDate,
    dueDate: inv.dueDate ?? issueDate,
    lang,
    from: { name: settings.fromName, email: settings.fromEmail, phone: settings.fromPhone, address: settings.fromAddress },
    billTo: { name: customer.name, contactName: customer.contactName, address: customer.billingAddress },
    lines: invoiceLines(inv.items),
    subtotalCents: inv.subtotalCents,
    discountCents: inv.discountCents,
    discountLabel: inv.discountLabel,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    balanceCents: balanceCents(inv),
    payments,
    processing: processing as ProcessingPayment[],
    notes: inv.notes,
    paidAt: inv.paidAt,
  };
  // The customer's own page: the one page that shows her real bank details (only when this invoice chose that way).
  return { state: "open", invoice, options: payOptions(settings, inv, stripeConfigured(), bank) };
}

export async function markInvoiceViewed(invoiceId: string, now = new Date()): Promise<void> {
  const db = await getDb();
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000);
  await db.update(schema.invoices).set({
    viewedAt: sql`coalesce(${schema.invoices.viewedAt}, ${now})`,
    lastViewedAt: now,
  }).where(and(
    eq(schema.invoices.id, invoiceId),
    ne(schema.invoices.status, "draft"),
    sql`(${schema.invoices.lastViewedAt} is null or ${schema.invoices.lastViewedAt} < ${tenMinAgo})`,
  ));
}

/* ───────────────────────── Import from Skynova ───────────────────────── */

const IMPORT_KINDS = ["customers", "invoices"] as const;

async function markExisting(preview: ImportPreview): Promise<ImportPreview> {
  const db = await getDb();
  const numbers = [...new Set(preview.invoices.map((i) => i.number).filter(Boolean))];
  const [customers, invoices] = await Promise.all([
    db.select({ id: schema.customers.id, nameKey: schema.customers.nameKey, archived: schema.customers.archived }).from(schema.customers),
    numbers.length ? db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices).where(inArray(schema.invoices.number, numbers)) : Promise.resolve([]),
  ]);
  const byKey = new Map<string, string>();
  for (const c of [...customers].sort((a, b) => Number(a.archived) - Number(b.archived))) if (!byKey.has(c.nameKey)) byKey.set(c.nameKey, c.id);
  const byNumber = new Map(invoices.map((i) => [i.number!, i.id]));
  for (const c of preview.customers) c.existingCustomerId = byKey.get(customerNameKey(c.name)) ?? null;
  for (const i of preview.invoices) {
    i.existingCustomerId = byKey.get(customerNameKey(i.customerName)) ?? null;
    i.existingInvoiceId = byNumber.get(i.number) ?? null;
  }
  return preview;
}

export async function previewSkynovaImport(text: string, kind: ImportKind): Promise<ImportPreview> {
  if (!IMPORT_KINDS.includes(kind)) throw new OpsError("Pick Customers or Invoices.");
  return markExisting(parseImport(String(text ?? ""), kind));
}

export async function saveSkynovaImport(text: string, kind: ImportKind, actor: string): Promise<ImportResult> {
  people(actor, "import from Skynova");
  if (!IMPORT_KINDS.includes(kind)) throw new OpsError("Pick Customers or Invoices.");
  const preview = await markExisting(parseImport(String(text ?? ""), kind)); // re-parsed here: never the browser's rows
  const db = await getDb();
  const result: ImportResult = { customersCreated: 0, customersMatched: 0, invoicesCreated: 0, paymentsCreated: 0, nextNumber: "", skipped: [...preview.skipped] };
  const made = new Map<string, string>(); // name key → customer id made by this import
  const customerFor = async (name: string, extra: Partial<typeof schema.customers.$inferInsert> = {}): Promise<{ id: string; created: boolean }> => {
    const key = customerNameKey(name);
    const known = made.get(key);
    if (known) return { id: known, created: false };
    const id = newId("cus_");
    await db.insert(schema.customers).values({ id, name: cleanLine(name).slice(0, 160), nameKey: key, source: "import", createdBy: actor, ...extra });
    made.set(key, id);
    return { id, created: true };
  };

  if (kind === "customers") {
    for (const c of preview.customers) {
      if (c.issues.length) {
        result.skipped.push({ line: c.line, reason: c.issues.join("; ") });
        continue;
      }
      if (c.existingCustomerId || made.has(customerNameKey(c.name))) {
        result.customersMatched++;
        if (c.existingCustomerId) {
          // Fill in what the existing customer is missing; never overwrite.
          await db.update(schema.customers).set({
            contactName: sql`coalesce(${schema.customers.contactName}, ${c.contactName})`,
            email: sql`coalesce(${schema.customers.email}, ${c.email})`,
            phone: sql`coalesce(${schema.customers.phone}, ${c.phone})`,
            billingAddress: sql`coalesce(${schema.customers.billingAddress}, ${c.billingAddress})`,
            updatedAt: new Date(),
          }).where(eq(schema.customers.id, c.existingCustomerId));
        }
        continue;
      }
      await customerFor(c.name, { contactName: c.contactName, email: c.email, phone: c.phone, billingAddress: c.billingAddress, notes: c.notes });
      result.customersCreated++;
    }
  } else {
    const today = todayNY();
    for (const r of preview.invoices) {
      if (r.issues.length) {
        result.skipped.push({ line: r.line, reason: r.issues.join("; ") });
        continue;
      }
      if (r.existingInvoiceId) {
        result.skipped.push({ line: r.line, reason: `Invoice ${r.number} is already in Nora HQ` });
        continue;
      }
      let customerId = r.existingCustomerId;
      if (customerId) result.customersMatched++;
      else {
        const c = await customerFor(r.customerName);
        customerId = c.id;
        if (c.created) result.customersCreated++;
        else result.customersMatched++;
      }
      const issueDate = r.issueDate ?? r.dueDate ?? today;
      const dueDate = r.dueDate && r.dueDate >= issueDate ? r.dueDate : issueDate;
      const items: InvoiceItem[] = [{ description: importedLine(r).slice(0, 300), quantity: 1, unitCents: r.totalCents }];
      const id = newId("inv_");
      const [ins] = await db.insert(schema.invoices).values({
        id,
        number: r.number,
        customerId,
        status: "sent",
        issueDate,
        dueDate,
        termsDays: Math.min(daysBetween(issueDate, dueDate), MAX_TERMS_DAYS),
        items,
        subtotalCents: r.totalCents,
        totalCents: r.totalCents,
        payWays: [...DEFAULT_PAY_WAYS],
        source: "import",
        importRef: `Skynova ${r.number}`,
        sentAt: new Date(`${issueDate}T12:00:00Z`),
        sentBy: actor,
        createdBy: actor,
      }).onConflictDoNothing({ target: schema.invoices.number }).returning({ id: schema.invoices.id });
      if (!ins) {
        result.skipped.push({ line: r.line, reason: `Invoice ${r.number} is already in Nora HQ` });
        continue;
      }
      result.invoicesCreated++;
      if (r.paidCents > 0) {
        await db.insert(schema.invoicePayments).values({ id: newId("pay_"), invoiceId: id, amountCents: r.paidCents, paidOn: issueDate, method: "other", reference: "Skynova", note: "Paid before the move to Nora HQ", recordedBy: actor });
        result.paymentsCreated++;
        await recompute(id);
      }
    }
    // ONE setval: the next Nora HQ number never repeats an imported one.
    await bumpSequence();
  }
  result.nextNumber = await nextInvoiceNumber();
  await logActivity({
    actor, action: "invoice.imported", entityType: "import", entityId: kind,
    summary: kind === "customers"
      ? `Imported customers from Skynova (${result.customersCreated} new, ${result.customersMatched} already here)`
      : `Imported ${result.invoicesCreated} ${result.invoicesCreated === 1 ? "invoice" : "invoices"} from Skynova`,
  });
  return result;
}
