/**
 * "Request payment" text for a collab deal: an invoice and a friendly reminder, written from a fixed template
 * (no LLM) out of the deal's amount, deliverables, post links, due date and Nora's stored payment line.
 * Pure and dependency-free: the deal page builds it on the server; scripts/test-payment-request.ts checks it.
 * Nothing here is sent anywhere — a person copies the text or opens it in their own mail app.
 */

export type PaymentRequestDeliverable = {
  /** "Instagram Reel", "TikTok" … */
  label: string;
  postUrl?: string | null;
  /** "YYYY-MM-DD" it went up (when there's no link to show). */
  postedOn?: string | null;
  /** "YYYY-MM-DD" it's due (when it isn't posted yet). */
  dueDate?: string | null;
};

export type PaymentRequestInput = {
  businessName: string;
  contactName?: string | null;
  amountCents: number | null;
  deliverables: PaymentRequestDeliverable[];
  /** "YYYY-MM-DD" of the visit, if there was one. */
  visitDate?: string | null;
  /** "YYYY-MM-DD" the payment is due. */
  dueDate: string | null;
  /** How Nora gets paid, e.g. "Zelle: 804-555-0123". Set once in Settings. Never a password. */
  paymentLine: string | null;
  /** "Nora" */
  fromName: string;
  /** "noraeatsgood" (with or without @). */
  fromHandle?: string | null;
  /** "YYYY-MM-DD" (app timezone). */
  today: string;
};

export type PaymentText = { subject: string; body: string };
export type PaymentRequest = {
  invoice: PaymentText;
  reminder: PaymentText;
  /** Plain-words gaps a person should fill before sending ("the fee", "how you get paid"). */
  missing: string[];
};

/** Placeholders left in the text when something isn't set yet — easy to spot, easy to type over. */
export const AMOUNT_PLACEHOLDER = "[amount]";
export const PAY_PLACEHOLDER = "[how you'd like to be paid]";

/** 60000 → "$600", 125050 → "$1,250.50". */
export function formatAmount(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** "2026-11-28" → "Nov 28, 2026". Anything else comes back as it was. */
export function longDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** "Maria Lopez" → "Maria"; nothing usable → "there". */
function firstName(name: string | null | undefined): string {
  const first = oneLine(name).split(" ")[0] ?? "";
  return /^[\p{L}][\p{L}'’.-]*$/u.test(first) ? first : "there";
}

function deliverableLine(d: PaymentRequestDeliverable): string {
  const label = oneLine(d.label) || "Content";
  const url = oneLine(d.postUrl);
  if (url) return `- ${label}: ${url}`;
  if (d.postedOn) return `- ${label}: posted ${longDate(d.postedOn)}`;
  if (d.dueDate) return `- ${label}: coming by ${longDate(d.dueDate)}`;
  return `- ${label}: coming soon`;
}

const isPosted = (d: PaymentRequestDeliverable) => !!oneLine(d.postUrl) || !!d.postedOn;

/** Builds both texts. Missing pieces become visible placeholders and are listed in `missing`. */
export function buildPaymentRequest(input: PaymentRequestInput): PaymentRequest {
  const business = oneLine(input.businessName) || "your business";
  const from = oneLine(input.fromName) || "Nora";
  const handle = oneLine(input.fromHandle).replace(/^@+/, "");
  const fromFull = handle ? `${from} (@${handle})` : from;
  const hi = `Hi ${firstName(input.contactName)},`;
  const amount = input.amountCents != null && input.amountCents > 0 ? formatAmount(input.amountCents) : null;
  const pay = oneLine(input.paymentLine) || null;
  const due = input.dueDate ? longDate(input.dueDate) : null;
  const overdue = !!input.dueDate && input.dueDate < input.today;
  const lines = input.deliverables.map(deliverableLine);
  const posted = input.deliverables.filter(isPosted);
  const allPosted = input.deliverables.length > 0 && posted.length === input.deliverables.length;

  const missing: string[] = [];
  if (!amount) missing.push("the fee");
  if (!pay) missing.push("how you get paid");

  const invoiceBody = [
    hi,
    "",
    `Thank you for having me at ${business}! Here is my invoice for our collab.`,
    "",
    "INVOICE",
    `From: ${fromFull}`,
    `For: ${business}`,
    `Date: ${longDate(input.today)}`,
    input.visitDate ? `Visit: ${longDate(input.visitDate)}` : null,
    ...(lines.length ? ["", "Deliverables", ...lines] : []),
    "",
    `Amount due: ${amount ?? AMOUNT_PLACEHOLDER}`,
    due ? `Due by: ${due}` : null,
    `How to pay: ${pay ?? PAY_PLACEHOLDER}`,
    "",
    "Thank you so much!",
    from,
  ];

  const owed = amount ?? AMOUNT_PLACEHOLDER;
  const when = due ? (overdue ? `, which was due ${due}` : `, due ${due}`) : "";
  const postedLines = posted.map(deliverableLine);
  const reminderBody = [
    hi,
    "",
    `Hope you're doing well! Just a friendly reminder about my invoice for our collab at ${business}: ${owed}${when}.`,
    ...(postedLines.length ? ["", allPosted ? "Everything is posted:" : "Here's what's posted so far:", ...postedLines] : []),
    "",
    `How to pay: ${pay ?? PAY_PLACEHOLDER}`,
    "",
    "Let me know if you need anything from me. Thank you!",
    from,
  ];

  const tail = `${from} for ${business}${amount ? ` (${amount})` : ""}`;
  return {
    invoice: { subject: `Invoice from ${tail}`, body: join(invoiceBody) },
    reminder: { subject: `Friendly reminder: invoice from ${tail}`, body: join(reminderBody) },
    missing,
  };
}

const join = (lines: Array<string | null>) => lines.filter((l): l is string => l !== null).join("\n");

/**
 * mailto: link that opens the person's own mail app with the text filled in (nothing is sent by Nora HQ).
 * `to` may be empty — the mail app then opens with a blank recipient.
 */
export function mailtoHref(to: string | null | undefined, text: PaymentText): string {
  const addr = oneLine(to);
  const safe = /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(addr) ? addr : "";
  const enc = (s: string) => encodeURIComponent(s.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"));
  return `mailto:${safe.replace(/[?&#%]/g, encodeURIComponent)}?subject=${enc(oneLine(text.subject))}&body=${enc(text.body)}`;
}
