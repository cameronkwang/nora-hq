/**
 * Invoicing: the shared types and pure helpers (no server imports, no database, no env). Used by lib/ops-invoices
 * (server), the signed-in invoice pages, the public pay page (/i/<token>), the PDF, the Stripe routes, Claude's tools
 * and the unit tests. The design is docs/invoicing.md.
 *
 * Conventions:
 *  - Money is integer cents, USD, everywhere (no floats stored, no other currency). Format with formatCents.
 *  - Dates are "YYYY-MM-DD" strings in the app timezone (America/New_York); timestamps are Date.
 *  - Stored invoice status is draft · sent · partially_paid · paid · void. "overdue" is never stored: it is derived
 *    from the due date (invoiceDisplayStatus).
 *  - Invoice numbers are INV-YYYY-NNNN, from the Postgres SEQUENCE invoice_number_seq, given the first time an
 *    invoice is sent (drafts have none, so a deleted draft never burns a number). YYYY is the issue date's year;
 *    NNNN keeps counting across years and is never reused.
 */
import type { Customer, Invoice, InvoicePayment, IntakeLang, Retainer } from "./schema";
import type { PaymentText } from "./payment-request";

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

/** Where an invoice came from. "claude" = a draft Claude made because a person asked. */
export const INVOICE_SOURCES = ["manual", "deal", "retainer", "import", "claude"] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

/** Where a customer row came from. "client" = made from a managed business (clients row). */
export const CUSTOMER_SOURCES = ["manual", "client", "deal", "import"] as const;
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
/** Net 14 unless the invoice or the settings say otherwise. */
export const DEFAULT_TERMS_DAYS = 14;
export const MAX_TERMS_DAYS = 120;
export const MAX_INVOICE_ITEMS = 50;
/** $1,000,000: the largest line, discount, total or payment the app accepts. */
export const MAX_INVOICE_CENTS = 100_000_000;
export const MAX_QUANTITY = 10_000;
/** Retainer day of month: 1 to 28, so it falls in every month. */
export const RETAINER_MAX_DAY = 28;
export const INVOICE_NUMBER_RE = /^INV-(\d{4})-(\d{4,})$/;
/** Name of the Postgres SEQUENCE that numbers invoices (schema.invoiceNumberSeq). */
export const INVOICE_NUMBER_SEQUENCE = "invoice_number_seq";

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

/** (2026, 7) → "INV-2026-0007". */
export function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}

/** "INV-2026-0007" → { year: 2026, seq: 7 }; anything else (an imported Skynova number) → null. */
export function parseInvoiceNumber(n: string | null | undefined): { year: number; seq: number } | null {
  const m = INVOICE_NUMBER_RE.exec((n ?? "").trim());
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : null;
}

/** What to call an invoice in a list or a message: its number, or "Draft" before it is sent. */
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
 * What Stripe keeps, as an estimate shown to the team (never charged to the customer): bank transfer (ACH)
 * 0.8% capped at $5; card 2.9% + 30c. Stripe's real fee is recorded on the payment when the webhook knows it.
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

/**
 * A draft may leave its dates empty: no issue date = "the day it is sent", no due date = issue date + termsDays.
 * sendInvoice stores what this returns; a sent invoice always has both.
 */
export function resolveInvoiceDates(inv: { issueDate: string | null; dueDate: string | null; termsDays: number }, today: string): { issueDate: string; dueDate: string } {
  const issueDate = inv.issueDate ?? today;
  return { issueDate, dueDate: inv.dueDate ?? addDaysYmd(issueDate, inv.termsDays) };
}

/* ───────────────────────── Customers ───────────────────────── */

/** "Crab O' Clock, LLC" → "crab o clock llc": matches a customer across imports and deals. Keeps CJK letters. */
export function customerNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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

/** ("Social media management", "2026-11") → "Social media management (November 2026)". */
export function retainerItemDescription(description: string, month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `${description.trim()} (${label})`;
}

/* ───────────────────────── Payment settings ───────────────────────── */

/**
 * How Nora gets paid and what every invoice prints. Stored in the existing app_settings row schema.NORA_PAYMENT_KEY
 * next to its `line` (the deal "Request payment" text). People only; never a password, card or bank account number.
 * Stripe keys are NOT here: they live only in the STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET env vars.
 */
export type InvoiceSettings = {
  /** The existing one-line payment text (deals' "Request payment"). */
  line: string | null;
  /** Who the invoice is from: "Nora Chen" or her business name. */
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  /** Optional mailing address printed under From (multi-line). */
  fromAddress: string | null;
  /** Zelle: the email or US phone number customers send to, and the name Zelle shows them. */
  zelle: string | null;
  zelleName: string | null;
  /** Check: who to make it out to and where to mail it (multi-line). */
  checkPayee: string | null;
  checkAddress: string | null;
  /** Plain instructions only (a handle or a paypal.me link); nothing is connected. */
  venmo: string | null;
  paypal: string | null;
  /** Pay online (Stripe Checkout) offers bank transfer / card. Only matters when STRIPE_SECRET_KEY is set. */
  achEnabled: boolean;
  cardEnabled: boolean;
  /** Default net days for new invoices. */
  termsDays: number;
  /** Default note printed at the bottom of new invoices ("Thank you!"). */
  footer: string | null;
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
  cardEnabled: true,
  termsDays: DEFAULT_TERMS_DAYS,
  footer: null,
};

const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

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
    cardEnabled: v.cardEnabled !== false,
    termsDays: days,
    footer: textOrNull(v.footer),
  };
}

/** The ways to pay printed on an invoice, free ones first. `online` is null unless Stripe is set up and a method is on. */
export type PayOptions = {
  zelle: { to: string; name: string | null } | null;
  check: { payee: string; address: string | null } | null;
  venmo: string | null;
  paypal: string | null;
  online: { ach: boolean; card: boolean } | null;
};

export function payOptions(s: InvoiceSettings, stripeReady: boolean): PayOptions {
  const online = stripeReady && (s.achEnabled || s.cardEnabled) ? { ach: s.achEnabled, card: s.cardEnabled } : null;
  return {
    zelle: s.zelle ? { to: s.zelle, name: s.zelleName } : null,
    check: s.checkPayee ? { payee: s.checkPayee, address: s.checkAddress } : null,
    venmo: s.venmo,
    paypal: s.paypal,
    online,
  };
}

/** True when the invoice has no way to pay printed on it (Settings needs filling in). */
export function noPayOptions(o: PayOptions): boolean {
  return !o.zelle && !o.check && !o.venmo && !o.paypal && !o.online;
}

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

/** One line of an invoice list. */
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
  processing: ProcessingPayment[];
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
  /** Retainer drafts made by today's run, waiting for a person to press Send. */
  readyToSend: InvoiceListRow[];
};

/** The texts a person sends with the link (Nora HQ never sends them itself). */
export type InvoiceMessages = {
  /** The customer link, or null for a draft (no link until it is sent). */
  url: string | null;
  to: string | null;
  /** First email with the invoice. */
  email: PaymentText;
  /** A friendly reminder (built with lib/payment-request). */
  reminder: PaymentText;
  /** Short texts for SMS / WeChat with the link, in the three page languages. */
  text: Record<IntakeLang, string>;
  emailMailto: string;
  reminderMailto: string;
  /** Plain-words gaps to fill before sending ("how you get paid"). */
  missing: string[];
};

/* ───────────────────────── The public pay page (/i/<token>) ───────────────────────── */

/**
 * What the customer's page and PDF may show: this one invoice, who it's from, how to pay. Never the private note,
 * the deal, the source, other invoices or anything else about the business.
 */
export type PublicInvoice = {
  /** Server use only (checkout, PDF); the page doesn't print it. */
  id: string;
  number: string;
  display: InvoiceDisplayStatus;
  issueDate: string;
  dueDate: string;
  lang: IntakeLang;
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
 * "open": the invoice (paid ones included: they show "Paid, thank you").
 */
export type PublicInvoiceState =
  | { state: "unknown" }
  | { state: "void"; lang: IntakeLang }
  | { state: "open"; invoice: PublicInvoice; options: PayOptions };

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

/** One pasted open (or paid) invoice. Imported invoices keep Skynova's number and count as sent. */
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
  skipped: Array<{ line: number; reason: string }>;
};
