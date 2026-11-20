/**
 * The customer's invoice (/i/[token]): every word a customer sees, in English, 简体中文 and 繁體中文, plus the
 * ready-to-text message the team sends with the link (lib/ops-invoices getInvoiceMessages uses `share`).
 *
 * No server imports: shared by the public page, its routes, the team's invoice page and the browser. The Chinese
 * dictionaries are typed against the English shape, so a missing key is a type error (the same pattern as
 * lib/drop-copy and lib/intake-copy). Chinese is written for restaurant owners, not translated word for word;
 * payment names stay as people say them (Zelle, Venmo, PayPal, Stripe).
 *
 * STATUS: the design step wrote `share` and the date helpers. The public_stripe builder adds the page copy (title,
 * labels, status lines, pay options, Pay online, PDF, the void notice, errors) to all three dictionaries.
 */

import type { IntakeLangCode } from "./intake-copy";

export type ShareArgs = {
  /** The customer's business name. */
  business: string;
  /** The contact's name, if known (English uses the first name). */
  contactName: string | null;
  /** Who it's from ("Nora"). */
  from: string;
  /** "INV-2026-0007" */
  number: string;
  /** Already formatted: "$600.00". */
  amount: string;
  /** "YYYY-MM-DD" */
  dueDate: string;
  url: string;
};

const firstName = (name: string | null) => {
  const first = (name ?? "").replace(/\s+/g, " ").trim().split(" ")[0] ?? "";
  return /^[\p{L}][\p{L}'’.-]*$/u.test(first) ? first : "";
};

/** "2026-12-04" → "Dec 4" (en) / "12月4日" (zh). */
export function shortDue(lang: IntakeLangCode, ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  if (lang !== "en") return `${Number(m[2])}月${Number(m[3])}日`;
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const en = {
  share: {
    label: "English",
    message: (a: ShareArgs) => {
      const hi = firstName(a.contactName) ? `Hi ${firstName(a.contactName)}!` : "Hi!";
      return `${hi} Here is invoice ${a.number} from ${a.from} for ${a.business}: ${a.amount}, due ${shortDue("en", a.dueDate)}. You can see it and pay here:\n\n${a.url}\n\nThank you!`;
    },
  },
};

export type InvoiceCopy = typeof en;

const zhHans: InvoiceCopy = {
  share: {
    label: "简体中文",
    message: (a) =>
      `${a.business}，您好！这是 ${a.from} 的账单 ${a.number}，金额 ${a.amount}，请在 ${shortDue("zh-Hans", a.dueDate)}前付款。在这里可以查看和付款：\n\n${a.url}\n\n谢谢！`,
  },
};

const zhHant: InvoiceCopy = {
  share: {
    label: "繁體中文",
    message: (a) =>
      `${a.business}，您好！這是 ${a.from} 的帳單 ${a.number}，金額 ${a.amount}，請在 ${shortDue("zh-Hant", a.dueDate)}前付款。在這裡可以查看和付款：\n\n${a.url}\n\n謝謝！`,
  },
};

export const INVOICE_COPY: Record<IntakeLangCode, InvoiceCopy> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };

export function invoiceCopy(lang: IntakeLangCode): InvoiceCopy {
  return INVOICE_COPY[lang] ?? en;
}
