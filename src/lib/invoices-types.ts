/**
 * Invoicing: the shared types and pure helpers (no server imports, no database, no env). Used by lib/ops-invoices
 * (server), lib/invoice-pdf, the signed-in invoice pages (the fast creator /invoices/new first), the public pay page
 * (/i/<token>), the Stripe routes, Claude's tools and the unit tests. The design is docs/invoicing.md.
 *
 * Conventions:
 *  - Money is integer cents, USD, everywhere (no floats stored, no other currency). Format with formatCents.
 *  - Dates are "YYYY-MM-DD" strings in the app timezone (America/New_York); timestamps are Date.
 *  - Stored invoice status is draft · sent · partially_paid · paid · void. "overdue" is never stored: it is derived
 *    from the due date (invoiceDisplayStatus). "sent" = finalized ("Make PDF"): it has a number and a PDF.
 *  - Invoice numbers continue Nora's Skynova sequence: 7 digits, zero padded, no prefix ("0000170"). They come from
 *    the Postgres SEQUENCE invoice_number_seq, taken when an invoice is finalized (drafts have none, so a deleted
 *    draft never burns a number), skipping any number already on an invoice. Never repeated or reused.
 *  - Defaults (docs/invoicing.md "Defaults"): invoice date today, due the same day ("Due on receipt"), paid by Zelle,
 *    one-tap saved lines ("Standard Content Creation Package" $550.00, "Food Stipend" typed each time), quantity 1.
 *  - Never a surcharge or fee for any payment method: the total is the same however the customer pays.
 */
import type { Customer, Invoice, InvoicePayment, IntakeLang, Retainer } from "./schema";
import type { PaymentText } from "./payment-request";
import { CREATOR_LEGAL_NAME, type ContractFields, type ContractKind } from "./contract";

/* ───────────────────────── Enums (schema.ts reads these) ───────────────────────── */

export const INVOICE_STATUSES = ["draft", "sent", "partially_paid", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** What a person sees: the stored status, with sent / partially_paid past the due date shown as "overdue". */
export const INVOICE_DISPLAY_STATUSES = ["draft", "sent", "partially_paid", "overdue", "paid", "void"] as const;
export type InvoiceDisplayStatus = (typeof INVOICE_DISPLAY_STATUSES)[number];

export const PAYMENT_METHODS = ["zelle", "ach", "check", "cash", "stripe_ach", "stripe_card", "paypal", "venmo", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Stripe payments are recorded by the Stripe webhook only. */
export const STRIPE_PAYMENT_METHODS = ["stripe_ach", "stripe_card"] as const satisfies readonly PaymentMethod[];
export type StripePaymentMethod = (typeof STRIPE_PAYMENT_METHODS)[number];
/** What a person can pick in "Record payment". */
export const MANUAL_PAYMENT_METHODS = ["zelle", "ach", "check", "cash", "paypal", "venmo", "other"] as const satisfies readonly PaymentMethod[];
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

/** Where an invoice came from. "claude" = a draft Claude made because a person asked. "contract" = made from one. */
export const INVOICE_SOURCES = ["manual", "deal", "retainer", "import", "claude", "contract"] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

/** Where a customer row came from. "client" = made from a managed business (clients row). */
export const CUSTOMER_SOURCES = ["manual", "client", "deal", "import", "contract"] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

/**
 * One Stripe Checkout Session (invoice_checkouts.status). "processing" = a bank (ACH) payment was started and is
 * clearing (up to about 4 business days); "paid" = the money was recorded as a payment; "failed" = the bank payment
 * bounced; "expired" = the customer never finished.
 */
export const CHECKOUT_STATUSES = ["open", "processing", "paid", "failed", "expired"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/* ───────────────────────── Limits and defaults ───────────────────────── */

export const INVOICE_CURRENCY = "usd";
/** 0 = due on receipt: the due date is the invoice date (Nora's Skynova invoices). */
export const DEFAULT_TERMS_DAYS = 0;
export const MAX_TERMS_DAYS = 120;
export const MAX_INVOICE_ITEMS = 50;
/** $1,000,000: the largest line, discount, total or payment the app accepts. */
export const MAX_INVOICE_CENTS = 100_000_000;
export const MAX_QUANTITY = 10_000;
/** Retainer day of month: 1 to 28, so it falls in every month. */
export const RETAINER_MAX_DAY = 28;

/* ───────────────────────── Line items and totals ───────────────────────── */

/** One line on an invoice (invoices.items, in order). quantity may have up to 2 decimals (1.5 hours). */
export type InvoiceItem = { description: string; quantity: number; unitCents: number };
export type InvoiceLine = InvoiceItem & { lineCents: number };
export type InvoiceTotals = { subtotalCents: number; discountCents: number; totalCents: number };

/** True when q has at most two decimals (1, 1.5, 2.25). */
export function isQuantity(q: number): boolean {
  return Number.isFinite(q) && q > 0 && q <= MAX_QUANTITY && Math.abs(q * 100 - Math.round(q * 100)) < 1e-6;
}

/** quantity x unit price, rounded to the cent (quantity is taken to 2 decimals first, so 1.15 x $100 is $115.00). */
export function lineCents(item: Pick<InvoiceItem, "quantity" | "unitCents">): number {
  return Math.round((Math.round(item.quantity * 100) * item.unitCents) / 100);
}

export function invoiceLines(items: readonly InvoiceItem[]): InvoiceLine[] {
  return items.map((i) => ({ ...i, lineCents: lineCents(i) }));
}

/** Subtotal of the lines, the discount (never below 0 or above the subtotal) and the total. */
export function invoiceTotals(items: readonly InvoiceItem[], discountCents = 0): InvoiceTotals {
  const subtotalCents = items.reduce((s, i) => s + lineCents(i), 0);
  const discount = Math.min(Math.max(0, Math.round(discountCents || 0)), subtotalCents);
  return { subtotalCents, discountCents: discount, totalCents: subtotalCents - discount };
}

/** What is still owed (never negative). */
export function balanceCents(inv: { totalCents: number; paidCents: number }): number {
  return Math.max(0, inv.totalCents - inv.paidCents);
}

/** How much more than the total was received (0 unless two payments crossed). */
export function overpaidCents(inv: { totalCents: number; paidCents: number }): number {
  return Math.max(0, inv.paidCents - inv.totalCents);
}

/** The main line: the first one (the package). "Make contract" takes its amount as the fee. */
export function mainLineCents(items: readonly InvoiceItem[]): number {
  return items.length ? lineCents(items[0]) : 0;
}

/* ───────────────────────── Status ───────────────────────── */

/**
 * The stored status after the payments changed. Draft and void never change here; otherwise paid in full → paid,
 * something paid → partially_paid, nothing → sent. The database does the same in ONE UPDATE (ops-invoices
 * recomputeInvoice); this is the pure mirror for tests and the UI.
 */
export function settledStatus(current: InvoiceStatus, totalCents: number, paidCents: number): InvoiceStatus {
  if (current === "draft" || current === "void") return current;
  if (totalCents > 0 && paidCents >= totalCents) return "paid";
  if (paidCents > 0) return "partially_paid";
  return "sent";
}

/** Sent or partially paid: money is still expected. */
export function isOpenStatus(status: InvoiceStatus): boolean {
  return status === "sent" || status === "partially_paid";
}

/** The status a person sees: an open invoice whose due date has passed (in the app timezone) is "overdue". */
export function invoiceDisplayStatus(inv: { status: InvoiceStatus; dueDate: string | null }, today: string): InvoiceDisplayStatus {
  if (isOpenStatus(inv.status) && !!inv.dueDate && inv.dueDate < today) return "overdue";
  return inv.status;
}

/** Whole days past the due date (0 when not overdue). */
export function daysOverdue(dueDate: string | null, today: string): number {
  if (!dueDate || dueDate >= today) return 0;
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) / 86_400_000);
}

export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partly paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

/** The status dot (docs/design.md: status = dot + words). Overdue is the only danger; nothing uses the accent. */
export type StatusTone = "ok" | "warn" | "danger" | "info" | "idle" | "ink";
export const INVOICE_STATUS_TONE: Record<InvoiceDisplayStatus, StatusTone> = {
  draft: "idle",
  sent: "info",
  partially_paid: "warn",
  overdue: "danger",
  paid: "ok",
  void: "idle",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  zelle: "Zelle",
  ach: "Bank transfer (ACH)",
  check: "Check",
  cash: "Cash",
  stripe_ach: "Bank transfer (Stripe)",
  stripe_card: "Card (Stripe)",
  paypal: "PayPal",
  venmo: "Venmo",
  other: "Other",
};

/* ───────────────────────── Numbers ───────────────────────── */

/** "0000170": 7 digits, zero padded, no prefix (Nora's Skynova numbers). Longer numbers are never cut. */
export const INVOICE_NUMBER_DIGITS = 7;
/** The first Nora HQ number on a fresh database (her last Skynova invoice was 0000169). */
export const FIRST_INVOICE_NUMBER = 170;
/** The largest "Next invoice number" a person can set. */
export const MAX_INVOICE_NUMBER = 999_999_999_999;
/** Name of the Postgres SEQUENCE that numbers invoices (schema.invoiceNumberSeq). */
export const INVOICE_NUMBER_SEQUENCE = "invoice_number_seq";
/** An all-digit number (ours, or an imported Skynova one): the SQL in ops-invoices matches '^[0-9]{1,18}$'. */
export const INVOICE_NUMBER_RE = /^\d{1,18}$/;

/** 170 → "0000170"; 12345678 → "12345678". */
export function formatInvoiceNumber(seq: number): string {
  return String(Math.trunc(seq)).padStart(INVOICE_NUMBER_DIGITS, "0");
}

/** "0000170" → 170, "169" → 169; anything else (a legacy "INV-2026-0007", "SKY-12", empty) → null. */
export function parseInvoiceNumber(n: string | null | undefined): number | null {
  const s = (n ?? "").trim();
  return INVOICE_NUMBER_RE.test(s) ? Number(s) : null;
}

/**
 * An imported invoice keeps its number, padded the same way so "169" and "0000169" are one number:
 * "169" → "0000169"; "SKY-12" stays "SKY-12" (trimmed); empty → null.
 */
export function normalizeImportedNumber(n: string | null | undefined): string | null {
  const s = (n ?? "").trim().replace(/^#\s*/, "");
  if (!s) return null;
  const seq = parseInvoiceNumber(s);
  return seq == null ? s : formatInvoiceNumber(seq);
}

/** What to call an invoice in a list or a message: its number, or "Draft" before it is finalized. */
export function invoiceLabel(inv: { number: string | null }): string {
  return inv.number ?? "Draft";
}

/* ───────────────────────── Money ───────────────────────── */

/**
 * 60000 → "$600.00" (decimals "always", the invoice style) or "$600" ("auto", the app's lists and pushes).
 * 125050 → "$1,250.50" either way.
 */
export function formatCents(cents: number, opts: { decimals?: "always" | "auto" } = {}): string {
  const whole = cents % 100 === 0;
  const min = opts.decimals === "auto" && whole ? 0 : 2;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: min, maximumFractionDigits: 2 });
}

/** The PDF's amounts, as on her Skynova invoice: 55000 → "550.00", 125050 → "1,250.50" (no dollar sign). */
export function pdfAmount(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The PDF's quantities: 1 → "1.00", 1.5 → "1.50". */
export function pdfQuantity(q: number): string {
  return q.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export class MoneyInputError extends Error {}

/**
 * "$1,250.50" / "600" / "600.5" → cents. Empty → null. Anything else (letters, 3 decimals, negative) throws a
 * MoneyInputError whose message can be shown as is.
 */
export function parseDollars(text: string | null | undefined): number | null {
  const s = (text ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new MoneyInputError("Use dollars, like 600 or 1250.50.");
  const cents = Math.round(Number(s) * 100);
  if (cents > MAX_INVOICE_CENTS) throw new MoneyInputError("That amount is too large.");
  return cents;
}

/** Cents → the text in a dollars field ("600", "1250.50"). */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * What Stripe keeps, as an estimate shown to the team (never charged to the customer: there is no surcharge for
 * any way to pay): bank transfer (ACH) 0.8% capped at $5; card 2.9% + 30c. Stripe's real fee is recorded on the
 * payment when the webhook knows it.
 */
export function stripeFeeEstimateCents(amountCents: number, method: StripePaymentMethod): number {
  if (method === "stripe_ach") return Math.min(Math.round(amountCents * 0.008), 500);
  return Math.round(amountCents * 0.029) + 30;
}

/* ───────────────────────── Dates ───────────────────────── */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v: unknown): v is string => typeof v === "string" && YMD_RE.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

/** "YYYY-MM-DD" + n days. */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b ("2026-11-20" → "2026-12-05" is 15). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/**
 * A draft may leave its dates empty: no issue date = "the day it is finalized", no due date = issue date +
 * termsDays (0 by default: due on receipt). finalizeInvoice stores what this returns; a sent invoice has both.
 */
export function resolveInvoiceDates(inv: { issueDate: string | null; dueDate: string | null; termsDays: number }, today: string): { issueDate: string; dueDate: string } {
  const issueDate = inv.issueDate ?? today;
  return { issueDate, dueDate: inv.dueDate ?? addDaysYmd(issueDate, inv.termsDays) };
}

/** The PDF's dates, as on her Skynova invoice: "2026-11-20" → "11/20/2026". */
export function usDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** "2026-12-04" → "Dec 4" (lists, the creator's quiet line). */
export function shortDate(ymd: string): string {
  if (!isYmd(ymd)) return ymd;
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The due part of the creator's quiet line: same day → "Due on receipt"; else "Due Dec 4". */
export function dueLabel(issueDate: string, dueDate: string): string {
  return !dueDate || dueDate <= issueDate ? "Due on receipt" : `Due ${shortDate(dueDate)}`;
}

/* ───────────────────────── Customers and addresses ───────────────────────── */

/** "Crab O' Clock, LLC" → "crab o clock llc": matches a customer across imports, deals and contracts. Keeps CJK letters. */
export function customerNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A multi-line address on one line, as the PDF prints the customer's: "100 Sample St\nSampleton, VA" → "100 Sample St, Sampleton, VA". */
export function oneLineAddress(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(/\r?\n/).map((l) => l.trim().replace(/,$/, "")).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** An address as lines (the PDF prints Nora's address this way, top left). */
export function addressLines(address: string | null | undefined): string[] {
  return (address ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/* ───────────────────────── Retainers ───────────────────────── */

/**
 * True when the retainer's draft for this month should be made today: active, started, not made yet this month
 * (lastRunMonth), and today is on or after its day of the month (so a missed cron day catches up).
 */
export function retainerDue(r: Pick<Retainer, "active" | "dayOfMonth" | "startMonth" | "lastRunMonth">, today: string): boolean {
  const month = today.slice(0, 7);
  if (!r.active || r.lastRunMonth === month) return false;
  if (r.startMonth && r.startMonth > month) return false;
  return Number(today.slice(8, 10)) >= Math.min(Math.max(1, r.dayOfMonth), RETAINER_MAX_DAY);
}

/** ("Social media services", "2026-11") → "Social media services (November 2026)". */
export function retainerItemDescription(description: string, month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `${description.trim()} (${label})`;
}

/* ───────────────────────── Ways to pay (per invoice) ───────────────────────── */

/**
 * How one invoice asks to be paid (invoices.payWays), in the order the pickers list them (the creator's chooser, the
 * tick boxes in Settings): Zelle first, then the other free ways, then the online ones (Stripe Checkout). Zelle unless
 * a person chose otherwise ("Claude may set them on a draft only when Nora or Cameron said so"). "custom" prints the
 * invoice's payNote as its own line.
 *
 * Two bank transfers, never to be mixed up:
 * - "ach"  = "Bank transfer (ACH)": the customer sends it from their own bank straight to NORA'S OWN account, using
 *            the account and routing numbers her invoice prints (Settings, saved encrypted). Free, nothing connected.
 * - "bank" = "Bank transfer online": the customer pays on Stripe's page (Stripe Checkout). Needs STRIPE_SECRET_KEY.
 */
export const PAY_WAYS = ["zelle", "ach", "check", "venmo", "paypal", "custom", "bank", "card"] as const;
export type PayWay = (typeof PAY_WAYS)[number];
/** The built-in default for a new invoice, until a person ticks other ways in Settings (InvoiceSettings.payDefaults). */
export const DEFAULT_PAY_WAYS: readonly PayWay[] = ["zelle"];
/**
 * The order the PDF's PAYMENT INFORMATION block, the pay page and the messages print the chosen ways in, as Nora
 * writes her invoices: her bank account first, then Zelle, then checks; then the rest as before.
 */
export const PAY_WAY_PRINT_ORDER = ["ach", "zelle", "check", "venmo", "paypal", "custom", "bank", "card"] as const satisfies readonly PayWay[];
/** Pay online through Stripe Checkout: bank transfer (ACH, the online option) and card (off unless turned on in Settings). */
export const ONLINE_PAY_WAYS = ["bank", "card"] as const satisfies readonly PayWay[];
/** The ways that can be ticked as a default for new invoices: every way but "custom" (its line is typed per invoice). */
export const DEFAULTABLE_PAY_WAYS = PAY_WAYS.filter((w): w is Exclude<PayWay, "custom"> => w !== "custom");

export const PAY_WAY_LABEL: Record<PayWay, string> = {
  zelle: "Zelle",
  ach: "Bank transfer (ACH)",
  check: "Check",
  venmo: "Venmo",
  paypal: "PayPal",
  custom: "Other",
  bank: "Bank transfer online",
  card: "Card online",
};

/** What "Record payment" offers first for an invoice paid this way. */
export const PAY_WAY_METHOD: Record<PayWay, PaymentMethod> = {
  zelle: "zelle",
  ach: "ach",
  check: "check",
  venmo: "venmo",
  paypal: "paypal",
  custom: "other",
  bank: "stripe_ach",
  card: "stripe_card",
};

export const isPayWay = (v: unknown): v is PayWay => typeof v === "string" && (PAY_WAYS as readonly string[]).includes(v);

/** Unique known ways in the pickers' order (Zelle first). Unknown values are dropped; nothing left → Zelle. */
export function sortPayWays(ways: readonly unknown[] | null | undefined): PayWay[] {
  const set = new Set((ways ?? []).filter(isPayWay));
  const out = PAY_WAYS.filter((w) => set.has(w));
  return out.length ? out : [...DEFAULT_PAY_WAYS];
}

/** The same ways in the order they are PRINTED (the PDF, the pay page, the messages): bank account, Zelle, check, … */
export function printPayWays(ways: readonly unknown[] | null | undefined): PayWay[] {
  const set = new Set(sortPayWays(ways));
  return PAY_WAY_PRINT_ORDER.filter((w) => set.has(w));
}

export function hasOnlineWay(ways: readonly PayWay[]): boolean {
  return ways.some((w) => w === "bank" || w === "card");
}

/** The same names mid-sentence (proper names keep their capitals). */
const PAY_WAY_INLINE: Record<PayWay, string> = { zelle: "Zelle", ach: "bank transfer (ACH)", check: "check", venmo: "Venmo", paypal: "PayPal", custom: "other", bank: "bank transfer online", card: "card online" };

/** The pay part of the creator's quiet line: ["zelle"] → "Zelle"; ["zelle", "ach", "check"] → "Zelle, bank transfer (ACH), check". */
export function payWaysLabel(ways: readonly PayWay[]): string {
  const text = sortPayWays(ways).map((w) => PAY_WAY_INLINE[w]).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether each way can be chosen right now, and why not (shown in the creator's picker). */
export type PayWayAvailability = Record<PayWay, { ok: boolean; why: string | null }>;

/**
 * Zelle, bank transfer (ACH), check, Venmo, PayPal need their details in Settings (for ACH: the account and routing
 * numbers); custom always works (it needs its line typed); bank transfer online needs Stripe set up
 * (STRIPE_SECRET_KEY) and bank transfer on; card needs Stripe and card turned ON in Settings (off by default). No way
 * ever adds a fee.
 */
export function availablePayWays(s: InvoiceSettings, stripeReady: boolean): PayWayAvailability {
  const need = (ok: boolean, why: string) => ({ ok, why: ok ? null : why });
  return {
    zelle: need(!!s.zelle, "Add your Zelle number in Settings."),
    ach: need(!!s.ownBankLast4 && !!s.ownBankRouting, s.ownBankUnreadable ? "Type your bank account and routing numbers again in Settings." : "Add your bank account and routing numbers in Settings."),
    check: need(!!s.checkPayee, "Add who checks are made out to in Settings."),
    venmo: need(!!s.venmo, "Add your Venmo in Settings."),
    paypal: need(!!s.paypal, "Add your PayPal in Settings."),
    custom: { ok: true, why: null },
    bank: need(stripeReady && s.achEnabled, stripeReady ? "Bank transfer is off in Settings." : "Pay online needs Stripe set up (docs/stripe-setup.md)."),
    card: need(stripeReady && s.cardEnabled, stripeReady ? "Card is off. Turn it on in Settings first." : "Pay online needs Stripe set up (docs/stripe-setup.md)."),
  };
}

/** null when these ways can be saved on an invoice; otherwise the message to show. */
export function checkPayWays(ways: readonly PayWay[], payNote: string | null | undefined, avail: PayWayAvailability): string | null {
  if (!ways.length) return "Pick at least one way to pay.";
  for (const w of ways) if (!avail[w].ok) return avail[w].why;
  if (ways.includes("custom") && !(payNote ?? "").trim()) return "Type the other way to pay.";
  return null;
}

/** The Zelle memo line on the PDF: "Put invoice 0000170 in the Zelle memo". */
export function zelleMemo(number: string | null): string {
  return number ? `Put invoice ${number} in the Zelle memo` : "Put the invoice number in the Zelle memo";
}

/**
 * Ways ticked in Settings for new invoices, as a new invoice may use them right now: the saved ticks that are still
 * available, in the pickers' order. None saved, or none left → the built-in default, Zelle only.
 */
export function defaultPayWays(s: Pick<InvoiceSettings, "payDefaults">, avail: PayWayAvailability): PayWay[] {
  const ways = DEFAULTABLE_PAY_WAYS.filter((w) => s.payDefaults.includes(w) && avail[w].ok);
  return ways.length ? ways : [...DEFAULT_PAY_WAYS];
}

/**
 * Nora's OWN receiving account for the "ach" way: the two numbers her invoice prints so a customer can send a bank
 * transfer. SERVER ONLY, and only where a customer needs them: ops-invoices decrypts them for the PDF and the
 * customer's pay page. Everything else (the team's pages, the messages, Claude) gets `maskedBankDetails`, or nothing.
 * Never logged, never in the activity log, an error message, the CSV or MCP output.
 */
export type BankDetails = { account: string; routing: string };

/** One way to pay as the PDF and the pay page show it (only the invoice's chosen ways, in print order). */
export type PayOption =
  | { way: "zelle"; to: string; name: string | null; memo: string }
  /** `account` is the full number only on the PDF and the customer's page; everywhere else it is masked ("••••6789"). */
  | { way: "ach"; label: string | null; account: string; routing: string }
  | { way: "check"; payee: string; address: string | null }
  | { way: "venmo"; handle: string }
  | { way: "paypal"; handle: string }
  | { way: "custom"; text: string }
  | { way: "bank" }
  | { way: "card" };

/**
 * The invoice's chosen ways with their details, in print order (her bank account, Zelle, check, …). A way whose
 * details are gone from Settings (or bank / card while Stripe isn't set up or that way is off) is left out, so the
 * page and PDF never print an empty way. `bank` is her own account for the "ach" way: the real numbers for the PDF
 * and the customer's page, `maskedBankDetails(s)` for anything a team page or a message shows, null to leave it out.
 */
export function payOptions(s: InvoiceSettings, inv: { number: string | null; payWays: readonly PayWay[]; payNote: string | null }, stripeReady: boolean, bank: BankDetails | null): PayOption[] {
  const out: PayOption[] = [];
  for (const w of printPayWays(inv.payWays)) {
    if (w === "zelle" && s.zelle) out.push({ way: "zelle", to: s.zelle, name: s.zelleName, memo: zelleMemo(inv.number) });
    else if (w === "ach" && bank) out.push({ way: "ach", label: s.ownBankLabel, account: bank.account, routing: bank.routing });
    else if (w === "check" && s.checkPayee) out.push({ way: "check", payee: s.checkPayee, address: s.checkAddress });
    else if (w === "venmo" && s.venmo) out.push({ way: "venmo", handle: s.venmo });
    else if (w === "paypal" && s.paypal) out.push({ way: "paypal", handle: s.paypal });
    else if (w === "custom" && inv.payNote?.trim()) out.push({ way: "custom", text: inv.payNote.trim() });
    else if (w === "bank" && stripeReady && s.achEnabled) out.push({ way: "bank" });
    else if (w === "card" && stripeReady && s.cardEnabled) out.push({ way: "card" });
  }
  return out;
}

/** True when the invoice prints no way to pay (Settings needs filling in). */
export function noPayOptions(o: readonly PayOption[]): boolean {
  return o.length === 0;
}

/**
 * Each chosen way as its own block of lines, worded the way Nora writes her invoices (fake values here):
 *
 *   Sample Bank Checking                             (the bank label, when there is one)
 *   ACH to ACCT#:000123456789                        (no space after the colons, as she writes them)
 *   ROUTING:000000000
 *
 *   Please send payment via Zelle to 5550100100.     (the Zelle value exactly as typed in Settings)
 *   Put invoice 0000170 in the Zelle memo            ("Zelle shows <name>" under it only when that name is set)
 *
 *   Checks Payable to Nora Chen
 *   Mail to 100 Sample St, Sampleton, VA 23000       (only when a mailing address is saved for checks)
 *
 * then "@nora [Venmo]", "paypal.me/nora [PayPal]", the custom line and "Pay online by bank transfer: <link>", each
 * its own block. The online line needs the customer link (payUrl); without one it is left out.
 * `ach: "pointer"` is for a message a person sends WITH the PDF: the bank transfer is named, the account and routing
 * numbers are not repeated (the PDF carries them).
 */
function paymentBlocks(options: readonly PayOption[], payUrl: string | null, ach: "numbers" | "pointer"): string[][] {
  const out: string[][] = [];
  const bank = options.some((o) => o.way === "bank");
  const card = options.some((o) => o.way === "card");
  for (const o of options) {
    if (o.way === "ach") out.push(ach === "pointer" ? ["Bank transfer (ACH): the account details are on the PDF."] : [...(o.label ? [o.label] : []), `ACH to ACCT#:${o.account}`, `ROUTING:${o.routing}`]);
    else if (o.way === "zelle") out.push([`Please send payment via Zelle to ${o.to}.`, o.memo, ...(o.name ? [`Zelle shows ${o.name}`] : [])]);
    else if (o.way === "check") out.push([`Checks Payable to ${o.payee}`, ...(o.address ? [`Mail to ${oneLineAddress(o.address)}`] : [])]);
    else if (o.way === "venmo") out.push([`${o.handle} [Venmo]`]);
    else if (o.way === "paypal") out.push([`${o.handle} [PayPal]`]);
    else if (o.way === "custom") out.push([o.text]);
  }
  if ((bank || card) && payUrl) out.push([`Pay online by ${bank && card ? "bank transfer or card" : bank ? "bank transfer" : "card"}: ${payUrl}`]);
  return out;
}

/**
 * The lines under "PAYMENT INFORMATION:" on the PDF: the blocks above with ONE blank line ("") between them. With
 * the real BankDetails in the options this holds her account number: it is for the PDF (and the team's preview, which
 * is built from masked details). Never put it in a message, a log or MCP output: use paymentMessageLines there.
 */
export function paymentInfoLines(options: readonly PayOption[], payUrl: string | null): string[] {
  return paymentBlocks(options, payUrl, "numbers").flatMap((block, i) => (i ? ["", ...block] : block));
}

/**
 * The same ways for a message a person sends with the PDF (the email, the reminder): worded like the PDF, one line
 * after the other, but a bank transfer only points at the PDF. Never an account or routing number.
 */
export function paymentMessageLines(options: readonly PayOption[], payUrl: string | null): string[] {
  return paymentBlocks(options, payUrl, "pointer").flat();
}

/* ───────────────────────── Saved line items (one-tap chips) ───────────────────────── */

/** A one-tap line in the creator. unitCents null = the amount is typed each time (Food Stipend). Edited in Settings. */
export type SavedItem = { id: string; description: string; unitCents: number | null };
export const MAX_SAVED_ITEMS = 20;
/** Used until a person edits the list in Settings (the key is missing from the stored settings). */
export const DEFAULT_SAVED_ITEMS: readonly SavedItem[] = [
  { id: "package", description: "Standard Content Creation Package", unitCents: 55_000 },
  { id: "food-stipend", description: "Food Stipend", unitCents: null },
];

/** A line being typed in the creator: unitCents null until the amount is typed. */
export type CreatorLine = { description: string; quantity: number; unitCents: number | null; savedItemId: string | null };

export function lineFromSavedItem(item: SavedItem): CreatorLine {
  return { description: item.description, quantity: 1, unitCents: item.unitCents, savedItemId: item.id };
}

/** The package: the first saved item with a price (the contract's main line takes its name). */
export function packageItem(saved: readonly SavedItem[]): SavedItem {
  return saved.find((i) => i.unitCents != null) ?? saved[0] ?? DEFAULT_SAVED_ITEMS[0];
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * "Same as last time": the customer's last invoice's lines again. A line that is a saved item typed each time
 * (Food Stipend) comes back with its amount empty, to type.
 */
export function sameAsLastTime(items: readonly InvoiceItem[], saved: readonly SavedItem[]): CreatorLine[] {
  return items.map((i) => {
    const match = saved.find((s) => sameText(s.description, i.description));
    return { description: i.description, quantity: i.quantity, unitCents: match && match.unitCents == null ? null : i.unitCents, savedItemId: match?.id ?? null };
  });
}

/** The creator's lines → invoice items, or the message for the first line that isn't ready. Empty lines are skipped. */
export function readyItems(lines: readonly CreatorLine[]): { items: InvoiceItem[]; error: null } | { items: null; error: string } {
  const items: InvoiceItem[] = [];
  for (const l of lines) {
    const description = l.description.trim();
    if (!description && l.unitCents == null) continue;
    if (!description) return { items: null, error: "Describe each line." };
    if (l.unitCents == null) return { items: null, error: `Type the amount for ${description}.` };
    if (!isQuantity(l.quantity)) return { items: null, error: "Quantity: more than 0, up to 2 decimals." };
    items.push({ description, quantity: l.quantity, unitCents: l.unitCents });
  }
  if (!items.length) return { items: null, error: "Add at least one line." };
  if (invoiceTotals(items).totalCents <= 0) return { items: null, error: "The total is $0." };
  return { items, error: null };
}

/* ───────────────────────── Settings ───────────────────────── */

/**
 * How Nora gets paid and what every invoice prints. Stored in the existing app_settings row schema.NORA_PAYMENT_KEY
 * next to its `line` (the deal "Request payment" text). People only; never a password or a card number, and never a
 * CUSTOMER's bank details. The one bank account allowed is Nora's OWN receiving account (she prints it on her
 * invoices): a person types it in Settings, it is stored ENCRYPTED under the row's `ownBankEnc` key (lib/crypto,
 * TOKEN_ENC_KEY), and this object never holds the account number: only its last digits, for the masked display.
 * Stripe keys are NOT here: they live only in the STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET env vars. The next
 * invoice number is NOT here either: it is the SEQUENCE (ops-invoices nextInvoiceNumber / setNextInvoiceNumber).
 */
export type InvoiceSettings = {
  /** The existing one-line payment text (deals' "Request payment"). */
  line: string | null;
  /** Who the invoice is from, printed top left: "Nora Chen" (asked once in the creator, prefilled). */
  fromName: string | null;
  /** Optional: printed under the address only when set (her Skynova invoice shows name and address only). */
  fromEmail: string | null;
  fromPhone: string | null;
  /** Her mailing address, printed under her name (multi-line). Asked once in the creator. */
  fromAddress: string | null;
  /** Zelle: the phone number or email customers send to, and (optional) the name Zelle shows them. */
  zelle: string | null;
  zelleName: string | null;
  /** Check: who to make it out to and where to mail it (multi-line). */
  checkPayee: string | null;
  checkAddress: string | null;
  /** Plain instructions only (a handle or a paypal.me link); nothing is connected. */
  venmo: string | null;
  paypal: string | null;
  /**
   * Bank transfer (ACH) straight to her OWN account: the "ach" way (not the online "bank" way below, which is Stripe).
   * The label is free text printed above the numbers ("Sample Bank Checking").
   */
  ownBankLabel: string | null;
  /**
   * Filled by ops-invoices from the encrypted pair, never stored in plain text and never by the browser: the last
   * digits of the account number (the masked display, "••••6789") and the routing number (it may be shown). Both
   * null when no bank details are saved. The full account number is never in this object.
   */
  ownBankLast4: string | null;
  ownBankRouting: string | null;
  /** Bank details are stored but can't be read (TOKEN_ENC_KEY is missing or changed): Settings asks to type them again. */
  ownBankUnreadable: boolean;
  /** Pay online (Stripe Checkout). Only matters when STRIPE_SECRET_KEY is set. Bank transfer on, card OFF by default. */
  achEnabled: boolean;
  cardEnabled: boolean;
  /** The ways ticked for new invoices, in the pickers' order. Empty = the built-in default, Zelle (defaultPayWays). */
  payDefaults: PayWay[];
  /** Default days until due for new invoices: 0 = due on receipt. */
  termsDays: number;
  /** Default note printed under NOTES on new invoices (empty by default). */
  footer: string | null;
  /** The creator's one-tap lines, in order. */
  savedItems: SavedItem[];
};

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  line: null,
  fromName: null,
  fromEmail: null,
  fromPhone: null,
  fromAddress: null,
  zelle: null,
  zelleName: null,
  checkPayee: null,
  checkAddress: null,
  venmo: null,
  paypal: null,
  ownBankLabel: null,
  ownBankLast4: null,
  ownBankRouting: null,
  ownBankUnreadable: false,
  achEnabled: true,
  cardEnabled: false,
  payDefaults: [],
  termsDays: DEFAULT_TERMS_DAYS,
  footer: null,
  savedItems: DEFAULT_SAVED_ITEMS.map((i) => ({ ...i })),
};

const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function readSavedItems(v: unknown): SavedItem[] {
  if (!Array.isArray(v)) return DEFAULT_SAVED_ITEMS.map((i) => ({ ...i }));
  const out: SavedItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const description = textOrNull(r.description);
    const id = textOrNull(r.id);
    const cents = r.unitCents;
    const unitCents = typeof cents === "number" && Number.isInteger(cents) && cents >= 0 && cents <= MAX_INVOICE_CENTS ? cents : null;
    if (description && id && out.length < MAX_SAVED_ITEMS) out.push({ id, description: description.slice(0, 300), unitCents });
  }
  return out;
}

/** The app_settings key that holds her account and routing numbers, encrypted (lib/crypto encryptJson({ a, r })). */
export const OWN_BANK_ENC_KEY = "ownBankEnc";

/**
 * app_settings value (any shape, from any version) → InvoiceSettings. Never throws. `bank` is her own account as
 * ops-invoices decrypted it (server only): without it the settings read as "no bank details" and the "ach" way is
 * off. Only the last digits of the account number are copied in.
 */
export function readInvoiceSettings(value: Record<string, unknown> | null | undefined, bank: BankDetails | null = null): InvoiceSettings {
  const v = value ?? {};
  const stored = typeof v[OWN_BANK_ENC_KEY] === "string" && !!v[OWN_BANK_ENC_KEY];
  const days = typeof v.termsDays === "number" && Number.isInteger(v.termsDays) && v.termsDays >= 0 && v.termsDays <= MAX_TERMS_DAYS ? v.termsDays : DEFAULT_TERMS_DAYS;
  return {
    line: textOrNull(v.line),
    fromName: textOrNull(v.fromName),
    fromEmail: textOrNull(v.fromEmail),
    fromPhone: textOrNull(v.fromPhone),
    fromAddress: textOrNull(v.fromAddress),
    zelle: textOrNull(v.zelle),
    zelleName: textOrNull(v.zelleName),
    checkPayee: textOrNull(v.checkPayee),
    checkAddress: textOrNull(v.checkAddress),
    venmo: textOrNull(v.venmo),
    paypal: textOrNull(v.paypal),
    ownBankLabel: textOrNull(v.ownBankLabel),
    ownBankLast4: bank ? accountLastDigits(bank.account) : null,
    ownBankRouting: bank ? bank.routing : null,
    ownBankUnreadable: stored && !bank,
    achEnabled: v.achEnabled !== false,
    cardEnabled: v.cardEnabled === true,
    payDefaults: Array.isArray(v.payDefaults) ? DEFAULTABLE_PAY_WAYS.filter((w) => (v.payDefaults as unknown[]).includes(w)) : [],
    termsDays: days,
    footer: textOrNull(v.footer),
    savedItems: readSavedItems(v.savedItems),
  };
}

/** What the creator asks once, inline, the first time an invoice is made and these are empty. */
export type InvoiceSetupField = "fromName" | "fromAddress" | "zelle";
export function invoiceSetupMissing(s: InvoiceSettings): InvoiceSetupField[] {
  const out: InvoiceSetupField[] = [];
  if (!s.fromName) out.push("fromName");
  if (!s.fromAddress) out.push("fromAddress");
  if (!s.zelle) out.push("zelle");
  return out;
}
/** The inline ask's prefill: her legal name, already the contracts' default (lib/contract CREATOR_LEGAL_NAME). */
export const SETUP_PREFILL = { fromName: CREATOR_LEGAL_NAME } as const;

/* ───────────────────────── Her own bank account (the "ach" way) ───────────────────────── */

/** Digits only, or null when the text holds anything but digits, spaces and dashes (how people type these numbers). */
export function bankDigits(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  return /^[\d -]+$/.test(t) ? t.replace(/\D/g, "") : null;
}

/** A US routing number: 9 digits whose ABA check digit holds (3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ends in 0). */
export function isRoutingNumber(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

/** A US bank account number: 4 to 17 digits. */
export function isBankAccountNumber(digits: string): boolean {
  return /^\d{4,17}$/.test(digits);
}

/** A card number typed where an account number belongs: card length, a card network's first digits, and the Luhn check. */
export function looksLikeCardNumber(digits: string): boolean {
  return /^\d{13,19}$/.test(digits) && /^(4|5[1-5]|2[2-7]|3[0-9]|6(011|5|4[4-9]|2))/.test(digits) && luhn(digits);
}

/**
 * Why the account and routing numbers a person typed can't be saved, in plain words, or null when they can. The
 * messages NEVER repeat what was typed (they are shown on the page and may end up in a screenshot).
 */
export function bankDetailsProblem(account: string | null | undefined, routing: string | null | undefined): string | null {
  const a = bankDigits(account);
  const r = bankDigits(routing);
  if (!(account ?? "").trim() || !(routing ?? "").trim()) return "Type both the account number and the routing number.";
  if (a == null || !isBankAccountNumber(a)) return "That account number doesn't look right: it should be 4 to 17 digits, with no letters.";
  if (looksLikeCardNumber(a)) return "That looks like a card number, not a bank account number. Nora HQ never stores card numbers.";
  if (r == null || !/^\d{9}$/.test(r)) return "A routing number has exactly 9 digits. Check it and type it again.";
  if (!isRoutingNumber(r)) return "That routing number doesn't pass the bank check (its last digit doesn't match the others). Check it against a check or your bank's app and type it again.";
  if (a === r) return "The account number and the routing number are the same. Check which is which.";
  return null;
}

/** The end of an account number for the masked display: its last 4 digits (its last 2 when it is shorter than 8). */
export function accountLastDigits(account: string): string {
  const d = account.replace(/\D/g, "");
  return d.slice(d.length >= 8 ? -4 : -2);
}

/** "••••6789": how every team page shows the account number. The full number is only on the PDF and the customer's page. */
export function maskAccountNumber(lastDigits: string): string {
  return `••••${lastDigits}`;
}

/** Her bank details as a team page or a message may show them: the account masked, the routing number as it is. */
export function maskedBankDetails(s: Pick<InvoiceSettings, "ownBankLast4" | "ownBankRouting">): BankDetails | null {
  return s.ownBankLast4 && s.ownBankRouting ? { account: maskAccountNumber(s.ownBankLast4), routing: s.ownBankRouting } : null;
}

/** A bank label is a name ("Sample Bank Checking"), never where a number goes. */
export function bankLabelHoldsNumber(label: string | null | undefined): boolean {
  return /\d[\d -]{3,}\d/.test(label ?? "");
}

/* ───────────────────────── Card / bank number guard ───────────────────────── */

/**
 * A card number (13 to 19 digits passing the Luhn check) or a bank routing / account number written next to the
 * word routing, account, acct or ABA. Used to refuse these in every free-text field (notes, references, customers,
 * lines, imports, the custom pay line and the other settings): Nora HQ never stores a customer's card or bank
 * details, and Nora's own account number goes in ONE place only, its own boxes in Settings (bankDetailsProblem),
 * never in free text. A phone number, a check number or an amount does not match.
 */
export function looksLikeCardOrBankNumber(text: string | null | undefined): boolean {
  const s = text ?? "";
  for (const m of s.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return /\b(routing|account|acct|aba)\b[^\d\n]{0,20}\d[\d -]{5,}/i.test(s);
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/* ───────────────────────── The PDF (and the invoice page's preview) ───────────────────────── */

/**
 * The PDF is drawn in Helvetica, which holds the Western European letters only (the "WinAnsi" set: ASCII, the accented
 * Latin-1 letters and a few signs). These helpers are the ONE rule for what it can print, shared by lib/invoice-pdf
 * (what is drawn), the creator (the warning before Make PDF), the invoice page's preview and the ops (Make PDF is
 * refused when a name or a line would print empty). scripts/test-invoice-review.ts checks the rule against the real
 * font for every character.
 */
const WINANSI_EXTRA = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e,
  0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);
const inWinAnsi = (cp: number) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp);
/** Typographic characters drawn as their plain form (as the PDF always has), and two letters with no accent to strip. */
const PDF_REPLACE: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"', // curly quotes
  "–": "-", "—": "-", "…": "...", " ": " ", // en and em dash, ellipsis, no-break space
  "đ": "d", "Đ": "D", // d with stroke (Vietnamese)
};

/** One character as the PDF draws it: itself, its plain form, its letter without an accent Helvetica lacks ("ở" → "o"), or null. */
function pdfChar(ch: string): string | null {
  const mapped = PDF_REPLACE[ch];
  if (mapped != null) return mapped;
  if (inWinAnsi(ch.codePointAt(0)!)) return ch;
  const parts = [...ch.normalize("NFD")];
  if (parts.length > 1 && inWinAnsi(parts[0].codePointAt(0)!) && parts.slice(1).every((m) => /\p{M}/u.test(m))) return parts[0];
  return null;
}

/**
 * Text as the PDF prints it: what Helvetica can't draw (Chinese, emoji) is left out, curly quotes and dashes become
 * plain ones, runs of spaces become one. Line breaks are kept. "SAMPLE Bakery 小点心" → "SAMPLE Bakery".
 */
export function pdfText(text: string | null | undefined): string {
  let out = "";
  for (const ch of (text ?? "").normalize("NFC")) {
    if (ch === "\n") out += "\n";
    else if (/\s/u.test(ch)) out += " ";
    else out += pdfChar(ch) ?? "";
  }
  return out.replace(/ {2,}/g, " ").replace(/ *\n */g, "\n").trim();
}

/** The characters the PDF will leave out, each once, in order ("小点心"); "" when everything prints. */
export function pdfUnprintable(text: string | null | undefined): string {
  let out = "";
  for (const ch of (text ?? "").normalize("NFC")) {
    if (/[\s\p{C}\p{M}]/u.test(ch) || pdfChar(ch) != null || out.includes(ch)) continue;
    out += ch;
  }
  return out;
}

/** True when a name or a line has text but none of it would print (Chinese only): Make PDF asks for the English first. */
export function pdfPrintsEmpty(text: string | null | undefined): boolean {
  return /[\p{L}\p{N}]/u.test(text ?? "") && !/[\p{L}\p{N}]/u.test(pdfText(text));
}

/** The words shown when the PDF can't print something, in one place so the creator and the ops say the same. */
export const PDF_LETTERS = {
  /** A new customer typed in Bill to. */
  name: "The PDF prints English letters only. Add the name in English for the PDF (you can keep both).",
  /** A customer who exists: their name is changed on their page. */
  customer: (name: string) => `The PDF prints English letters only. Add ${name}'s name in English on their customer page first (you can keep both).`,
  line: (description: string) => `The PDF prints English letters only. Add English to the line "${description}" (you can keep both).`,
  leftOut: (chars: string) => `The PDF prints English letters only: ${chars} will be left out.`,
  /** On an invoice that is already made (above its preview). */
  isLeftOut: (chars: string) => `The PDF prints English letters only: ${chars} is left out of it.`,
} as const;

/**
 * Everything the PDF prints, already worded and formatted, so lib/invoice-pdf only draws and the team's invoice page
 * can show the same thing. Her Skynova layout and wording, in the clean Ink style (hairlines, no blue header bar),
 * without Skynova's "Item: Service" column:
 *
 *   Nora Chen                                         INVOICE   (large, letter-spaced, grey)
 *   100 Sample St / Sampleton, VA 23000
 *
 *   Sample Bistro                                     Invoice #     0000170
 *   1 Example Ave, Sampleton, VA 23000                Invoice Date  11/20/2026
 *                                                     Due Date      11/20/2026
 *   Description                         Unit Price   Quantity   Amount
 *   Standard Content Creation Package       550.00       1.00   550.00
 *   Food Stipend                             75.10       1.00    75.10
 *   NOTES: PAYMENT INFORMATION:
 *   Please send payment via Zelle to 5550100100.
 *   Put invoice 0000170 in the Zelle memo
 *                                                     Subtotal       625.10
 *                                                     Total          625.10
 *                                                     Amount Paid      0.00
 *                                                     Balance Due   $625.10
 */
export type InvoiceDocument = {
  /** "DRAFT" on a draft (no number yet), "VOID" on a void invoice. */
  stamp: "DRAFT" | "VOID" | null;
  title: "INVOICE";
  from: { name: string | null; addressLines: string[]; email: string | null; phone: string | null };
  billTo: { name: string; address: string | null };
  /** Right column, in order: Invoice #, Invoice Date, Due Date. */
  facts: Array<{ label: "Invoice #" | "Invoice Date" | "Due Date"; value: string }>;
  columns: ["Description", "Unit Price", "Quantity", "Amount"];
  rows: Array<{ description: string; unitPrice: string; quantity: string; amount: string }>;
  /** The invoice's own note, printed after "NOTES:" (null: "NOTES: PAYMENT INFORMATION:" on one line, as hers). */
  notes: string | null;
  paymentHeading: "PAYMENT INFORMATION:";
  /** paymentInfoLines: one block per chosen way, "" between blocks (a blank line). */
  paymentLines: string[];
  /**
   * True when the lines show her bank account masked ("ACH to ACCT#:••••6789"): the team's preview. The PDF itself is
   * always built with the real number (ops-invoices invoicePdf) and has this false.
   */
  paymentMasked: boolean;
  /** Bottom right, in order. Discount only when there is one; Balance Due is the last row and has the $. */
  totals: Array<{ label: string; value: string; strong?: boolean }>;
  fileName: string;
};

/** "Invoice 0000170 - Sample Bistro.pdf" (a draft: "Invoice DRAFT - Sample Bistro.pdf"). Safe for every OS. */
export function invoiceFileName(number: string | null, customerName: string): string {
  const who = customerName.normalize("NFKC").replace(/[^\p{L}\p{N} &'.-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Customer";
  return `Invoice ${number ?? "DRAFT"} - ${who}.pdf`;
}

export function invoiceDocument(
  inv: Pick<Invoice, "number" | "status" | "issueDate" | "dueDate" | "termsDays" | "items" | "subtotalCents" | "discountCents" | "discountLabel" | "totalCents" | "paidCents" | "notes" | "payWays" | "payNote">,
  customer: Pick<Customer, "name" | "billingAddress">,
  settings: InvoiceSettings,
  /** `bank`: her own account for the "ach" way. The real numbers for the PDF; maskedBankDetails(settings) for a team page. */
  opts: { stripeReady: boolean; payUrl: string | null; today: string; bank: BankDetails | null },
): InvoiceDocument {
  const dates = resolveInvoiceDates(inv, opts.today);
  const options = payOptions(settings, inv, opts.stripeReady, opts.bank);
  const ach = options.find((o) => o.way === "ach");
  const totals: InvoiceDocument["totals"] = [{ label: "Subtotal", value: pdfAmount(inv.subtotalCents) }];
  if (inv.discountCents > 0) totals.push({ label: inv.discountLabel ? `Discount (${inv.discountLabel})` : "Discount", value: `-${pdfAmount(inv.discountCents)}` });
  totals.push(
    { label: "Total", value: pdfAmount(inv.totalCents) },
    { label: "Amount Paid", value: pdfAmount(inv.paidCents) },
    { label: "Balance Due", value: formatCents(balanceCents(inv)), strong: true },
  );
  return {
    stamp: inv.status === "draft" ? "DRAFT" : inv.status === "void" ? "VOID" : null,
    title: "INVOICE",
    from: { name: settings.fromName, addressLines: addressLines(settings.fromAddress), email: settings.fromEmail, phone: settings.fromPhone },
    billTo: { name: customer.name, address: oneLineAddress(customer.billingAddress) },
    facts: [
      { label: "Invoice #", value: inv.number ?? "DRAFT" },
      { label: "Invoice Date", value: usDate(dates.issueDate) },
      { label: "Due Date", value: usDate(dates.dueDate) },
    ],
    columns: ["Description", "Unit Price", "Quantity", "Amount"],
    rows: invoiceLines(inv.items).map((l) => ({ description: l.description, unitPrice: pdfAmount(l.unitCents), quantity: pdfQuantity(l.quantity), amount: pdfAmount(l.lineCents) })),
    notes: inv.notes?.trim() || null,
    paymentHeading: "PAYMENT INFORMATION:",
    paymentLines: paymentInfoLines(options, opts.payUrl),
    paymentMasked: !!ach && ach.way === "ach" && ach.account.includes("•"),
    totals,
    fileName: invoiceFileName(inv.number, customer.name),
  };
}

/** The signed-in PDF route for an invoice (`download` adds ?download=1: Content-Disposition attachment). */
export function invoicePdfPath(id: string, opts: { download?: boolean } = {}): string {
  return `/invoices/${encodeURIComponent(id)}/pdf${opts.download ? "?download=1" : ""}`;
}

/* ───────────────────────── The fast creator (/invoices/new) ───────────────────────── */

/** Who "Bill to" can be: a customer, a managed business (clients row) or a collab deal's business. */
export type BillToKind = "customer" | "client" | "deal";
export type BillToOption = {
  /** "customer:cus_1", "client:crab-o-clock", "deal:deal_1": unique in the list. */
  key: string;
  kind: BillToKind;
  /** The customer, client or deal id. */
  id: string;
  name: string;
  nameKey: string;
  /** The customer's billing address, else the business's public facts address (clients.public_info.address), else the deal's address. */
  address: string | null;
  contactName: string | null;
  email: string | null;
  lang: IntakeLang | null;
  /** The customer this already is (a client or deal whose customer exists is listed once, as the customer). */
  customerId: string | null;
  /** The managed business this is (a "client" option) or belongs to (its customer); null otherwise. */
  clientId: string | null;
  /** They have an invoice that isn't void (the list says "Customer", not "Customer, no invoices yet"). */
  hasPastInvoices: boolean;
  /** Offers "Same as last time": an invoice she MADE for them (sent, not a draft, not an import). */
  hasLast: boolean;
  /**
   * That invoice's lines, sent with the page for the most recently billed customers so the button works the moment
   * she picks them. undefined = not sent (fetched when they are picked); null = none.
   */
  last?: LastInvoice | null;
};

/** The creator's typeahead: words of the query match the start of words in the name (or anywhere for CJK). */
export function filterBillTo(options: readonly BillToOption[], q: string, limit = 8): BillToOption[] {
  const key = customerNameKey(q);
  if (!key) return options.slice(0, limit);
  const words = key.split(" ");
  const scored: Array<{ o: BillToOption; score: number }> = [];
  for (const o of options) {
    const name = ` ${o.nameKey}`;
    if (!words.every((w) => name.includes(` ${w}`) || (/[^\x00-\x7f]/.test(w) && o.nameKey.includes(w)))) continue;
    scored.push({ o, score: (o.nameKey.startsWith(key) ? 0 : 1) + (o.kind === "customer" ? 0 : 0.5) });
  }
  return scored.sort((a, b) => a.score - b.score || a.o.name.localeCompare(b.o.name)).slice(0, limit).map((s) => s.o);
}

/** The creator's quiet defaults line: "Due on receipt · Zelle · #0000170", each part tappable. */
export function creatorDefaultsLine(a: { issueDate: string; dueDate: string; payWays: readonly PayWay[]; nextNumber: string | null }): { due: string; pay: string; number: string | null; text: string } {
  const due = dueLabel(a.issueDate, a.dueDate);
  const pay = payWaysLabel(a.payWays);
  const number = a.nextNumber ? `#${a.nextNumber}` : null;
  return { due, pay, number, text: [due, pay, number].filter(Boolean).join(" · ") };
}

/** Which part of a contract's fee an invoice bills: all of it, the deposit, what's left after the deposit, or one month. */
export type ContractPart = "full" | "deposit" | "rest" | "month";

/** What opens the creator pre-filled (from a contract, a deal, a customer, "Same as last time" or a draft). */
export type InvoicePrefill = {
  /** The matched Bill to; null with newCustomer set = a new customer is made on "Make PDF". */
  billTo: BillToOption | null;
  newCustomer: { name: string; contactName: string | null; email: string | null; billingAddress: string | null; lang: IntakeLang | null } | null;
  lines: CreatorLine[];
  issueDate: string;
  dueDate: string;
  payWays: PayWay[];
  payNote: string | null;
  notes: string | null;
  lang: IntakeLang | null;
  dealId: string | null;
  contractId: string | null;
  contractPart: ContractPart | null;
  /** Finalize / update this draft instead of making a new invoice. */
  draftId: string | null;
  source: "blank" | "contract" | "deal" | "customer" | "draft";
  /** One quiet line saying where the prefill came from: "From the Sample Bistro contract (Nov 20)". */
  note: string | null;
  /** A draft's "More" fields (opened with ?draft=), so Make PDF keeps them. Absent on other prefills. */
  discountCents?: number;
  discountLabel?: string | null;
  privateNotes?: string | null;
  /** The prefilled customer's last invoice ("Same as last time" without another round trip); null when none. */
  last?: LastInvoice | null;
};

/** The customer's last invoice, for "Same as last time" (lines through sameAsLastTime: Food Stipend left empty). */
export type LastInvoice = {
  id: string;
  number: string | null;
  issueDate: string | null;
  lines: CreatorLine[];
  payWays: PayWay[];
  payNote: string | null;
  notes: string | null;
  lang: IntakeLang | null;
  discountCents: number;
  discountLabel: string | null;
};

/** Everything /invoices/new needs, in one server call (ops-invoices getInvoiceCreatorContext). */
export type InvoiceCreatorContext = {
  today: string;
  /** What "Make PDF" will most likely take ("0000170"); the real number is taken atomically on Make PDF. */
  nextNumber: string;
  settings: Pick<InvoiceSettings, "fromName" | "fromAddress" | "zelle" | "zelleName" | "termsDays" | "footer" | "achEnabled" | "cardEnabled">;
  /** Ask these once, inline, before the first PDF (prefill SETUP_PREFILL). */
  setupMissing: InvoiceSetupField[];
  savedItems: SavedItem[];
  payWays: PayWayAvailability;
  /** What a new, blank invoice starts with: the ways ticked in Settings that are available (defaultPayWays), else Zelle. */
  defaultPayWays: PayWay[];
  stripeReady: boolean;
  billTo: BillToOption[];
  prefill: InvoicePrefill;
};

/* ───────────────────────── Done state and next steps ───────────────────────── */

/**
 * The next step, one tap away, from an invoice or a contract. href = a page to open; "monthly_invoices" is an action
 * (ops-invoices createRetainerFromContract) with no page.
 */
export type NextStep =
  | { kind: "make_contract"; label: "Make contract"; href: string }
  | { kind: "make_invoice"; label: "Make invoice" | "Make deposit invoice" | "Invoice the rest" | "Invoice this month"; href: string }
  | { kind: "monthly_invoices"; label: "Set up monthly invoices"; contractId: string }
  | { kind: "record_payment"; label: "Record payment"; href: string }
  | { kind: "remind"; label: "Remind"; href: string };

/** "Make PDF" landed: what the done state shows. */
export type InvoiceDone = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  totalCents: number;
  balanceCents: number;
  issueDate: string;
  dueDate: string;
  /** The customer's language: the message below is in it. */
  lang: IntakeLang;
  /** invoicePdfPath(id): Share PDF fetches it first (iOS needs share() inside a fresh tap), Download links to ?download=1. */
  pdfPath: string;
  fileName: string;
  /** The short text to send with the PDF, in the customer's language (lib/invoice-copy share.pdfMessage). */
  message: string;
  messages: Record<IntakeLang, string>;
  /** The customer link, only when an online way is on (Copy pay link); otherwise null. */
  payUrl: string | null;
  payWays: PayWay[];
  contractId: string | null;
  nextSteps: NextStep[];
  /**
   * The PDF itself (base64), only on the answer to "Make PDF" from a phone that can share files: Share PDF is then
   * ready at once, with no second round trip. Absent on a reload of the done state (the PDF is fetched instead).
   */
  pdfBase64?: string | null;
};

/** What the creator shows of the invoice being edited (/invoices/new?edit=<id>: a finalized, unpaid invoice). */
export type CreatorEdit = { id: string; number: string | null; customerName: string; customerAddress: string | null };

/** The done state's buttons, in order. Share needs Web Share with files (phones); Copy pay link needs an online way. */
export type DoneAction = "share_pdf" | "download_pdf" | "copy_message" | "copy_pay_link";
export function doneActions(done: Pick<InvoiceDone, "payUrl">, env: { canShareFiles: boolean }): DoneAction[] {
  const out: DoneAction[] = [];
  if (env.canShareFiles) out.push("share_pdf");
  out.push("download_pdf", "copy_message");
  if (done.payUrl) out.push("copy_pay_link");
  return out;
}

/** An invoice's one-tap next steps (the invoice page and the done state). Make PDF on a draft is the focal button, not a step. */
export function invoiceNextSteps(inv: { id: string; status: InvoiceStatus; contractId: string | null }): NextStep[] {
  const out: NextStep[] = [];
  const page = `/invoices/${encodeURIComponent(inv.id)}`;
  if (isOpenStatus(inv.status)) out.push({ kind: "record_payment", label: "Record payment", href: `${page}#record-payment` }, { kind: "remind", label: "Remind", href: `${page}#remind` });
  if (!inv.contractId && inv.status !== "void") out.push({ kind: "make_contract", label: "Make contract", href: `/contracts?invoice=${encodeURIComponent(inv.id)}` });
  return out;
}

/* ───────────────────────── Contracts ⇄ invoices ───────────────────────── */

/** A contract as invoicing shows it (people only: no Claude tool reads contracts). fields re-download it in the browser. */
export type ContractRef = {
  id: string;
  kind: ContractKind;
  clientBusiness: string;
  clientContact: string | null;
  agreementDate: string | null;
  feeCents: number | null;
  dealId: string | null;
  customerId: string | null;
  createdBy: string;
  /** ISO time (crosses the server / client line). */
  createdAt: string;
  fields: ContractFields;
};

/** "Contract Nov 20" (agreement date, else the day it was made). */
export function contractRefLabel(c: Pick<ContractRef, "agreementDate" | "createdAt">): string {
  const day = c.agreementDate && isYmd(c.agreementDate) ? c.agreementDate : c.createdAt.slice(0, 10);
  return isYmd(day) ? `Contract ${shortDate(day)}` : "Contract";
}

/** An invoice as a contract row shows it ("0000170 · Paid"). */
export type ContractInvoiceRef = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  display: InvoiceDisplayStatus;
  issueDate: string | null;
  totalCents: number;
  balanceCents: number;
  /** The first line's amount: what this invoice billed of the contract's fee (a deposit, the rest, one month). */
  mainLineCents: number;
};

export function invoiceRefLabel(r: Pick<ContractInvoiceRef, "number" | "display">): string {
  return `${r.number ?? "Draft"} · ${INVOICE_STATUS_LABEL[r.display]}`;
}

/** The contract's fee field ("450", "$1,250.50", "") → cents (0 = no fee, a gifted collab). Same reading as ops-contracts. */
export function contractFeeCents(fee: string | null | undefined): number {
  const n = Number(String(fee ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100), MAX_INVOICE_CENTS) : 0;
}

const intField = (s: string | null | undefined, fallback: number) => {
  const n = Math.round(Number(String(s ?? "").replace(/[$,\s%]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** "Pay within (days)" on a contract (15 when empty), as its invoices' terms. */
export function contractPaymentDays(f: Pick<ContractFields, "paymentDays">): number {
  return Math.min(intField(f.paymentDays, 15), MAX_TERMS_DAYS);
}

/** The monthly line ("Social media services (December 2026)") and the retainer's description. */
export const MONTHLY_SERVICE_LINE = "Social media services";

/**
 * The invoice a contract asks for next, matching what the contract says (lib/contract buildContract):
 *  - collab, no deposit: the package at the fee, due in paymentDays ("due within N days after the content is posted").
 *  - collab with a deposit (1 to 99%): first "Deposit (N%)" at that share, due on receipt ("due when this agreement is
 *    signed"); once a deposit is invoiced, the rest ("<package>, remaining 70%"), due in paymentDays.
 *  - collab with 100%: the package at the fee, due on receipt ("the full fee is due when this agreement is signed").
 *  - monthly: one month, "Social media services (December 2026)" at the fee, due in paymentDays.
 * invoicedCents = the main lines already billed for this contract (void invoices left out). null = nothing to invoice
 * (no fee, or the fee is fully invoiced).
 */
export function invoiceFromContractFields(
  f: ContractFields,
  opts: { savedItems: readonly SavedItem[]; today: string; invoicedCents?: number },
): { part: ContractPart; lines: CreatorLine[]; issueDate: string; dueDate: string } | null {
  const fee = contractFeeCents(f.fee);
  if (fee <= 0) return null;
  const today = opts.today;
  const payDays = intField(f.paymentDays, 15);
  const pkg = packageItem(opts.savedItems);
  const line = (description: string, unitCents: number): CreatorLine => ({ description, quantity: 1, unitCents, savedItemId: null });
  if (f.kind === "monthly") {
    const start = isYmd(f.startDate) && f.startDate > today ? f.startDate : today;
    return { part: "month", lines: [line(retainerItemDescription(MONTHLY_SERVICE_LINE, start.slice(0, 7)), fee)], issueDate: today, dueDate: addDaysYmd(today, payDays) };
  }
  const invoiced = Math.max(0, opts.invoicedCents ?? 0);
  if (invoiced >= fee) return null;
  const pct = Math.min(100, Math.round(Number(String(f.depositPercent ?? "").replace(/[%\s]/g, "")) || 0));
  if (invoiced > 0) {
    const rest = fee - invoiced;
    const label = pct > 0 && pct < 100 ? `${pkg.description}, remaining ${100 - pct}%` : `${pkg.description}, remaining`;
    return { part: "rest", lines: [line(label, rest)], issueDate: today, dueDate: addDaysYmd(today, payDays) };
  }
  if (pct > 0 && pct < 100) {
    return { part: "deposit", lines: [line(`Deposit (${pct}%)`, Math.round((fee * pct) / 100))], issueDate: today, dueDate: today };
  }
  return { part: "full", lines: [{ ...line(pkg.description, fee), savedItemId: pkg.id }], issueDate: today, dueDate: pct >= 100 ? today : addDaysYmd(today, payDays) };
}

/**
 * "Set up monthly invoices" from a monthly contract: the retainer's fields. Day of month = the start date's day
 * (1 to 28), first month = the start date's month (or this month). The contract's term is a minimum and then it
 * continues month to month, so the retainer has no end: a person pauses it when the contract ends.
 */
export function retainerFromContractFields(f: ContractFields, today: string): { description: string; amountCents: number; dayOfMonth: number; startMonth: string; termMonths: number } | null {
  const fee = contractFeeCents(f.fee);
  if (f.kind !== "monthly" || fee <= 0) return null;
  const start = isYmd(f.startDate) ? f.startDate : today;
  return {
    description: MONTHLY_SERVICE_LINE,
    amountCents: fee,
    dayOfMonth: Math.min(Math.max(1, Number(start.slice(8, 10))), RETAINER_MAX_DAY),
    startMonth: start.slice(0, 7),
    termMonths: intField(f.termMonths, 3),
  };
}

/**
 * "Make contract" from an invoice: the business, contact, email and the fee from the main line. An invoice from a
 * retainer opens a monthly contract (fee = the month's amount); anything else a one-time collab.
 */
export function contractFieldsFromInvoice(
  inv: { items: readonly InvoiceItem[]; retainerId: string | null },
  customer: { name: string; contactName: string | null; email: string | null },
  today: string,
): Partial<ContractFields> {
  const fee = mainLineCents(inv.items);
  const monthly = !!inv.retainerId;
  return {
    kind: monthly ? "monthly" : "collab",
    clientBusiness: customer.name,
    clientContact: customer.contactName ?? "",
    clientEmail: customer.email ?? "",
    agreementDate: today,
    ...(monthly ? { startDate: today } : {}),
    fee: fee > 0 ? centsToDollarsInput(fee) : "",
  };
}

/**
 * A contract's one-tap next steps (Past contracts rows, the customer and deal pages): "Make invoice" (or "Make
 * deposit invoice") when nothing is invoiced, "Invoice the rest" after a deposit, "Invoice this month" and "Set up
 * monthly invoices" for a monthly contract without a retainer. Nothing for a gifted (no fee) contract, and no
 * "Invoice this month" once the contract's monthly invoices already took this month.
 */
export function contractNextSteps(
  c: { id: string; kind: ContractKind; fields: ContractFields },
  invoices: readonly ContractInvoiceRef[],
  opts: { hasRetainer: boolean; savedItems?: readonly SavedItem[]; today: string; retainerMonth?: string | null },
): NextStep[] {
  const href = (part?: string) => `/invoices/new?contract=${encodeURIComponent(c.id)}${part ? `&part=${part}` : ""}`;
  const live = invoices.filter((i) => i.status !== "void");
  if (c.kind === "monthly") {
    if (contractFeeCents(c.fields.fee) <= 0) return [];
    const out: NextStep[] = [];
    if (!opts.hasRetainer) out.push({ kind: "monthly_invoices", label: "Set up monthly invoices", contractId: c.id });
    // Once its monthly invoices took this month (retainerMonth = the retainer's lastRunMonth), this month is not offered again.
    const monthTaken = opts.hasRetainer && !!opts.retainerMonth && opts.retainerMonth >= opts.today.slice(0, 7);
    if (!live.length && !monthTaken) out.push({ kind: "make_invoice", label: "Invoice this month", href: href() });
    return out;
  }
  const invoicedCents = live.reduce((s, i) => s + i.mainLineCents, 0);
  const next = invoiceFromContractFields(c.fields, { savedItems: opts.savedItems ?? DEFAULT_SAVED_ITEMS, today: opts.today, invoicedCents });
  if (!next) return [];
  if (next.part === "deposit") return [{ kind: "make_invoice", label: "Make deposit invoice", href: href() }];
  if (next.part === "rest") return [{ kind: "make_invoice", label: "Invoice the rest", href: href("rest") }];
  return [{ kind: "make_invoice", label: "Make invoice", href: href() }];
}

/* ───────────────────────── CSV ───────────────────────── */

/**
 * Rows → CSV text (RFC 4180 quoting, CRLF). A text cell that starts with = + - @ (and isn't a number) gets a
 * leading ' so a spreadsheet never runs it as a formula: customer names come from imports.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return "";
    let s = typeof v === "number" ? String(v) : v;
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** 125050 → "1250.50" (a CSV amount column: no $ and no thousands separator). */
export const csvAmount = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));

/* ───────────────────────── Read shapes (returned by lib/ops-invoices) ───────────────────────── */

/** An invoice row without its link secrets: what pages and tools get. tokenHash / tokenEnc never leave ops-invoices. */
export type InvoiceRow = Omit<Invoice, "tokenHash" | "tokenEnc">;

/** One line of an invoice list. Every row has a one-tap PDF download (invoicePdfPath(id, { download: true })). */
export type InvoiceListRow = {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  status: InvoiceStatus;
  display: InvoiceDisplayStatus;
  issueDate: string | null;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  daysOverdue: number;
  dealId: string | null;
  contractId: string | null;
  payWays: PayWay[];
  source: InvoiceSource;
  sentAt: Date | null;
  viewedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

export type InvoiceListFilter = {
  /** "open" = sent + partially paid (overdue included); "all" = everything but void. Default "all". */
  status?: InvoiceDisplayStatus | "open" | "all" | "everything";
  customerId?: string;
  dealId?: string;
  contractId?: string;
  /** Issue year (sent invoices) or created year (drafts). */
  year?: number;
  /** Matches the number or the customer's name. */
  q?: string;
  limit?: number;
  /** "YYYY-MM-DD" app timezone; defaults to today. */
  today?: string;
};

/** A Stripe bank payment that was started and is still clearing. */
export type ProcessingPayment = { amountCents: number; startedAt: Date; method: StripePaymentMethod | null };

/** Everything the invoice page shows (people only). */
export type InvoiceDetail = InvoiceRow & {
  items: InvoiceItem[];
  lines: InvoiceLine[];
  display: InvoiceDisplayStatus;
  balanceCents: number;
  overpaidCents: number;
  daysOverdue: number;
  customer: Customer;
  payments: InvoicePayment[];
  deal: { id: string; businessName: string; status: string; paymentStatus: string } | null;
  /** The contract it bills ("Contract Nov 20 · Download again"), or null ("Make contract"). */
  contract: ContractRef | null;
  processing: ProcessingPayment[];
  /** The invoice's chosen ways with their details (what the PDF and the pay page print). */
  payOptions: PayOption[];
  /** The PDF, worded (the page can show it as is). */
  document: InvoiceDocument;
  nextSteps: NextStep[];
  /** A private customer link exists (getInvoiceLink returns it). */
  hasLink: boolean;
};

export type CustomerSummary = Customer & {
  invoiceCount: number;
  openCount: number;
  outstandingCents: number;
  overdueCents: number;
  paidThisYearCents: number;
  lastInvoiceAt: Date | null;
  activeRetainers: number;
  client: { id: string; name: string } | null;
};

export type CustomerDetail = CustomerSummary & {
  invoices: InvoiceListRow[];
  payments: Array<InvoicePayment & { invoiceNumber: string | null }>;
  retainers: Retainer[];
  /** Contracts for this customer (linked, or the same business name), newest first, each with its invoices. */
  contracts: Array<ContractRef & { invoices: ContractInvoiceRef[]; nextSteps: NextStep[] }>;
  paidAllTimeCents: number;
  invoicedAllTimeCents: number;
};

export type InvoiceReport = {
  today: string;
  year: number;
  /** "YYYY-MM" */
  month: string;
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  /** Open invoices due in the next 7 days (not overdue yet). */
  dueSoon: InvoiceListRow[];
  draftCount: number;
  /** Cash basis: payments by their paid-on date. */
  paidThisMonthCents: number;
  paidThisYearCents: number;
  /** Stripe fees recorded this year (known ones only). */
  feesThisYearCents: number;
  /** 12 entries, January first, for `year`. */
  paidByMonth: Array<{ month: string; cents: number }>;
  byMethodThisYear: Array<{ method: PaymentMethod; cents: number }>;
  byCustomer: Array<{
    customerId: string;
    name: string;
    outstandingCents: number;
    overdueCents: number;
    invoicedThisYearCents: number;
    paidThisYearCents: number;
  }>;
};

/** What the morning reminder (lib/ops-notify runDailyReminders) says about invoices. */
export type InvoiceReminderLines = {
  dueTomorrow: InvoiceListRow[];
  overdue: InvoiceListRow[];
  /** Retainer drafts made by today's run, waiting for a person to press Make PDF. */
  readyToSend: InvoiceListRow[];
};

/** The texts a person sends with the PDF or the link (Nora HQ never sends them itself). */
export type InvoiceMessages = {
  /** The customer link, or null for a draft (no link until it is finalized). */
  url: string | null;
  to: string | null;
  /** First email with the invoice. */
  email: PaymentText;
  /** A friendly reminder (built with lib/payment-request). */
  reminder: PaymentText;
  /** The short text to send WITH THE PDF (the done state's Copy message), in the three languages. */
  pdfText: Record<IntakeLang, string>;
  /** Short texts for SMS / WeChat with the link, in the three page languages. */
  text: Record<IntakeLang, string>;
  emailMailto: string;
  reminderMailto: string;
  /** Plain-words gaps to fill before finalizing ("how you get paid"). */
  missing: string[];
};

/* ───────────────────────── The public pay page (/i/<token>) ───────────────────────── */

/**
 * What the customer's page and PDF may show: this one invoice, who it's from, how to pay. Never the private note,
 * the deal, the contract, the source, other invoices or anything else about the business.
 */
export type PublicInvoice = {
  /** Server use only (checkout, PDF); the page doesn't print it. */
  id: string;
  number: string;
  display: InvoiceDisplayStatus;
  issueDate: string;
  dueDate: string;
  /** The invoice's language, else its customer's; null when neither is set (the page then reads Accept-Language). */
  lang: IntakeLang | null;
  from: { name: string | null; email: string | null; phone: string | null; address: string | null };
  billTo: { name: string; contactName: string | null; address: string | null };
  lines: InvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  discountLabel: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** Payments received: date and amount only. */
  payments: Array<{ paidOn: string; amountCents: number }>;
  processing: ProcessingPayment[];
  notes: string | null;
  paidAt: Date | null;
};

/**
 * "unknown": never a link (the page answers 404). "void": the invoice was cancelled (a short notice, no amounts).
 * "open": the invoice (paid ones included: they show "Paid, thank you") and exactly its chosen ways in print order
 * (her bank account, Zelle, check, …). This is the one page that gets the real account number, next to the PDF.
 */
export type PublicInvoiceState =
  | { state: "unknown" }
  | { state: "void"; lang: IntakeLang | null }
  | { state: "open"; invoice: PublicInvoice; options: PayOption[] };

/* ───────────────────────── Stripe → payment ───────────────────────── */

/** What the Stripe webhook hands lib/ops-invoices recordStripePayment (idempotent on sessionId). */
export type StripePaymentRecord = {
  invoiceId: string;
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number;
  method: StripePaymentMethod;
  /** "YYYY-MM-DD" app timezone of the success event. */
  paidOn: string;
  feeCents?: number | null;
  /** Stripe's Customer id from the session, kept only if bank reuse works (docs/invoicing.md "Stripe bank reuse"). */
  stripeCustomerId?: string | null;
};

/* ───────────────────────── Retainer run ───────────────────────── */

export type RunRetainersResult = {
  /** Drafts made by this run. */
  created: Array<{ invoiceId: string; retainerId: string; customerName: string; amountCents: number; month: string }>;
  /** Retainers whose draft failed (the month is released again, so the next run retries). */
  failed: number;
};

/* ───────────────────────── Import from Skynova ───────────────────────── */

export type ImportKind = "customers" | "invoices";

/** One pasted customer, after parsing. `issues` empty = it will be saved. */
export type ImportCustomerRow = {
  line: number;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  notes: string | null;
  /** Filled by the server preview: an existing customer with the same name key (it is matched, not duplicated). */
  existingCustomerId: string | null;
  issues: string[];
};

/** One pasted open (or paid) invoice. Imported invoices keep Skynova's number (normalizeImportedNumber) and count as sent. */
export type ImportInvoiceRow = {
  line: number;
  number: string;
  customerName: string;
  issueDate: string | null;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
  description: string | null;
  existingCustomerId: string | null;
  /** Filled by the server preview: an invoice with this number already exists (skipped on save). */
  existingInvoiceId: string | null;
  issues: string[];
};

export type ImportPreview = {
  kind: ImportKind;
  /** The header cells found, in order. */
  columns: string[];
  /** Our field → the column it was read from ("name" → "Customer Name"). */
  mapping: Record<string, string>;
  customers: ImportCustomerRow[];
  invoices: ImportInvoiceRow[];
  /** Lines that were not rows (blank, totals, repeated headers). */
  skipped: Array<{ line: number; reason: string }>;
};

export type ImportResult = {
  customersCreated: number;
  customersMatched: number;
  invoicesCreated: number;
  paymentsCreated: number;
  /** The next invoice number after the import (the sequence moved past every imported number). */
  nextNumber: string;
  skipped: Array<{ line: number; reason: string }>;
};
