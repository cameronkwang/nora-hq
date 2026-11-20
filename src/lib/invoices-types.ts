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

export const PAYMENT_METHODS = ["zelle", "check", "cash", "stripe_ach", "stripe_card", "paypal", "venmo", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Stripe payments are recorded by the Stripe webhook only. */
export const STRIPE_PAYMENT_METHODS = ["stripe_ach", "stripe_card"] as const satisfies readonly PaymentMethod[];
export type StripePaymentMethod = (typeof STRIPE_PAYMENT_METHODS)[number];
/** What a person can pick in "Record payment". */
export const MANUAL_PAYMENT_METHODS = ["zelle", "check", "cash", "paypal", "venmo", "other"] as const satisfies readonly PaymentMethod[];
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
 * How one invoice asks to be paid (invoices.payWays). Display order: Zelle first, then the other free ways, then the
 * online ones (Stripe Checkout). Zelle unless a person chose otherwise ("Claude may set them on a draft only when
 * Nora or Cameron said so"). "custom" prints the invoice's payNote as its own line.
 */
export const PAY_WAYS = ["zelle", "check", "venmo", "paypal", "custom", "bank", "card"] as const;
export type PayWay = (typeof PAY_WAYS)[number];
export const DEFAULT_PAY_WAYS: readonly PayWay[] = ["zelle"];
/** Pay online through Stripe Checkout: bank transfer (ACH, the online option) and card (off unless turned on in Settings). */
export const ONLINE_PAY_WAYS = ["bank", "card"] as const satisfies readonly PayWay[];

export const PAY_WAY_LABEL: Record<PayWay, string> = {
  zelle: "Zelle",
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
  check: "check",
  venmo: "venmo",
  paypal: "paypal",
  custom: "other",
  bank: "stripe_ach",
  card: "stripe_card",
};

export const isPayWay = (v: unknown): v is PayWay => typeof v === "string" && (PAY_WAYS as readonly string[]).includes(v);

/** Unique known ways in display order (Zelle first). Unknown values are dropped; nothing left → Zelle. */
export function sortPayWays(ways: readonly unknown[] | null | undefined): PayWay[] {
  const set = new Set((ways ?? []).filter(isPayWay));
  const out = PAY_WAYS.filter((w) => set.has(w));
  return out.length ? out : [...DEFAULT_PAY_WAYS];
}

export function hasOnlineWay(ways: readonly PayWay[]): boolean {
  return ways.some((w) => w === "bank" || w === "card");
}

/** The same names mid-sentence (proper names keep their capitals). */
const PAY_WAY_INLINE: Record<PayWay, string> = { zelle: "Zelle", check: "check", venmo: "Venmo", paypal: "PayPal", custom: "other", bank: "bank transfer online", card: "card online" };

/** The pay part of the creator's quiet line: ["zelle"] → "Zelle"; ["zelle", "check", "bank"] → "Zelle, check, bank transfer online". */
export function payWaysLabel(ways: readonly PayWay[]): string {
  const text = sortPayWays(ways).map((w) => PAY_WAY_INLINE[w]).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether each way can be chosen right now, and why not (shown in the creator's picker). */
export type PayWayAvailability = Record<PayWay, { ok: boolean; why: string | null }>;

/**
 * Zelle, check, Venmo, PayPal need their details in Settings; custom always works (it needs its line typed);
 * bank transfer needs Stripe set up (STRIPE_SECRET_KEY) and bank transfer on; card needs Stripe and card turned ON
 * in Settings (off by default). No way ever adds a fee.
 */
export function availablePayWays(s: InvoiceSettings, stripeReady: boolean): PayWayAvailability {
  const need = (ok: boolean, why: string) => ({ ok, why: ok ? null : why });
  return {
    zelle: need(!!s.zelle, "Add your Zelle number in Settings."),
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

/** One way to pay as the PDF and the pay page show it (only the invoice's chosen ways, in display order). */
export type PayOption =
  | { way: "zelle"; to: string; name: string | null; memo: string }
  | { way: "check"; payee: string; address: string | null }
  | { way: "venmo"; handle: string }
  | { way: "paypal"; handle: string }
  | { way: "custom"; text: string }
  | { way: "bank" }
  | { way: "card" };

/**
 * The invoice's chosen ways with their details, Zelle first. A way whose details are gone from Settings (or bank /
 * card while Stripe isn't set up or that way is off) is left out, so the page and PDF never print an empty way.
 */
export function payOptions(s: InvoiceSettings, inv: { number: string | null; payWays: readonly PayWay[]; payNote: string | null }, stripeReady: boolean): PayOption[] {
  const out: PayOption[] = [];
  for (const w of sortPayWays(inv.payWays)) {
    if (w === "zelle" && s.zelle) out.push({ way: "zelle", to: s.zelle, name: s.zelleName, memo: zelleMemo(inv.number) });
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
 * The lines under "PAYMENT INFORMATION:" on the PDF, in her Skynova wording:
 *   "(555) 010-0100 [Zelle]", "Put invoice 0000170 in the Zelle memo", "Check payable to Nora Chen, mail to …",
 *   "@nora [Venmo]", "paypal.me/nora [PayPal]", the custom line, "Pay online by bank transfer: <link>".
 * The online line needs the customer link (payUrl); without one it is left out.
 */
export function paymentInfoLines(options: readonly PayOption[], payUrl: string | null): string[] {
  const out: string[] = [];
  const bank = options.some((o) => o.way === "bank");
  const card = options.some((o) => o.way === "card");
  for (const o of options) {
    if (o.way === "zelle") out.push(`${o.to} [Zelle${o.name ? `: ${o.name}` : ""}]`, o.memo);
    else if (o.way === "check") out.push(`Check payable to ${o.payee}${o.address ? `, mail to ${oneLineAddress(o.address)}` : ""}`);
    else if (o.way === "venmo") out.push(`${o.handle} [Venmo]`);
    else if (o.way === "paypal") out.push(`${o.handle} [PayPal]`);
    else if (o.way === "custom") out.push(o.text);
  }
  if ((bank || card) && payUrl) out.push(`Pay online by ${bank && card ? "bank transfer or card" : bank ? "bank transfer" : "card"}: ${payUrl}`);
  return out;
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
 * next to its `line` (the deal "Request payment" text). People only; never a password, card or bank account number.
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
  /** Pay online (Stripe Checkout). Only matters when STRIPE_SECRET_KEY is set. Bank transfer on, card OFF by default. */
  achEnabled: boolean;
  cardEnabled: boolean;
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
  achEnabled: true,
  cardEnabled: false,
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

/** app_settings value (any shape, from any version) → InvoiceSettings. Never throws. */
export function readInvoiceSettings(value: Record<string, unknown> | null | undefined): InvoiceSettings {
  const v = value ?? {};
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
    achEnabled: v.achEnabled !== false,
    cardEnabled: v.cardEnabled === true,
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

/* ───────────────────────── Card / bank number guard ───────────────────────── */

/**
 * A card number (13 to 19 digits passing the Luhn check) or a bank routing / account number written next to the
 * word routing, account, acct or ABA. Used to refuse these in payment settings, notes and imports: Nora HQ never
 * stores card or bank details. A phone number, a check number or an amount does not match.
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
 *   (555) 010-0100 [Zelle]
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
  paymentLines: string[];
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
  opts: { stripeReady: boolean; payUrl: string | null; today: string },
): InvoiceDocument {
  const dates = resolveInvoiceDates(inv, opts.today);
  const options = payOptions(settings, inv, opts.stripeReady);
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
  /** Offers "Same as last time". */
  hasPastInvoices: boolean;
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
};

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
 * monthly invoices" for a monthly contract without a retainer. Nothing for a gifted (no fee) contract.
 */
export function contractNextSteps(
  c: { id: string; kind: ContractKind; fields: ContractFields },
  invoices: readonly ContractInvoiceRef[],
  opts: { hasRetainer: boolean; savedItems?: readonly SavedItem[]; today: string },
): NextStep[] {
  const href = (part?: string) => `/invoices/new?contract=${encodeURIComponent(c.id)}${part ? `&part=${part}` : ""}`;
  const live = invoices.filter((i) => i.status !== "void");
  if (c.kind === "monthly") {
    if (contractFeeCents(c.fields.fee) <= 0) return [];
    const out: NextStep[] = [];
    if (!opts.hasRetainer) out.push({ kind: "monthly_invoices", label: "Set up monthly invoices", contractId: c.id });
    if (!live.length) out.push({ kind: "make_invoice", label: "Invoice this month", href: href() });
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
 * "open": the invoice (paid ones included: they show "Paid, thank you") and exactly its chosen ways, Zelle first.
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
