/**
 * The customer's invoice (/i/[token]): every word a customer sees, in English, 简体中文 and 繁體中文, plus the
 * ready-to-text message the team sends with the link (lib/ops-invoices getInvoiceMessages uses `share`).
 *
 * No server imports: shared by the public page, its routes, the team's invoice page and the browser. The Chinese
 * dictionaries are typed against the English shape, so a missing key is a type error (the same pattern as
 * lib/drop-copy and lib/intake-copy). Chinese is written for restaurant owners, not translated word for word;
 * payment names stay as people say them (Zelle, Venmo, PayPal, Stripe).
 *
 * STATUS: the design step wrote `share` (the link text and the text sent WITH THE PDF, which the fast creator's done
 * state copies) and the date helpers. The public_stripe builder adds the page copy (title, labels, status lines, the
 * invoice's ways to pay with the Zelle memo line, Pay online, PDF, the void notice, errors) to all three dictionaries.
 * Never a surcharge or fee for any way to pay, in any language.
 */

import type { IntakeLangCode } from "./intake-copy";

export type ShareArgs = {
  /** The customer's business name. */
  business: string;
  /** The contact's name, if known (English uses the first name). */
  contactName: string | null;
  /** Who it's from ("Nora"). */
  from: string;
  /** "0000170" */
  number: string;
  /** Already formatted: "$600.00". */
  amount: string;
  /** "YYYY-MM-DD" */
  dueDate: string;
  url: string;
};

/** The short text a person sends WITH THE PDF (the done state's "Copy message"), in the customer's language. */
export type PdfShareArgs = {
  /** The customer's business name. */
  business: string;
  /** The contact's name, if known (English uses the first name). */
  contactName: string | null;
  /** "0000170" */
  number: string;
  /** Already formatted: "$625.10". */
  amount: string;
  /** "YYYY-MM-DD" */
  dueDate: string;
  /** Due the same day as the invoice date. */
  dueOnReceipt: boolean;
  /** The Zelle number or email, when Zelle is one of the invoice's ways. */
  zelle: string | null;
  /** The pay link, only when an online way (bank transfer, card) is on. */
  url: string | null;
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

const join = (head: string, pay: (string | null)[], tail: string) => {
  const mid = pay.filter(Boolean).join("\n");
  return mid ? `${head}\n\n${mid}\n\n${tail}` : `${head}\n\n${tail}`;
};

const en = {
  share: {
    label: "English",
    message: (a: ShareArgs) => {
      const hi = firstName(a.contactName) ? `Hi ${firstName(a.contactName)}!` : "Hi!";
      return `${hi} Here is invoice ${a.number} from ${a.from} for ${a.business}: ${a.amount}, due ${shortDue("en", a.dueDate)}. You can see it and pay here:\n\n${a.url}\n\nThank you!`;
    },
    /** "Hi Sam! Here is invoice 0000170 for $625.10, due on receipt. The PDF is attached.\n\nZelle: (555) 010-0100, with 0000170 in the memo.\n\nThank you!" */
    pdfMessage: (a: PdfShareArgs) => {
      const hi = firstName(a.contactName) ? `Hi ${firstName(a.contactName)}!` : "Hi!";
      const due = a.dueOnReceipt ? "due on receipt" : `due ${shortDue("en", a.dueDate)}`;
      return join(
        `${hi} Here is invoice ${a.number} for ${a.amount}, ${due}. The PDF is attached.`,
        [a.zelle ? `Zelle: ${a.zelle}, with ${a.number} in the memo.` : null, a.url ? `Pay online: ${a.url}` : null],
        "Thank you!",
      );
    },
  },
};

export type InvoiceCopy = typeof en;

const zhHans: InvoiceCopy = {
  share: {
    label: "简体中文",
    message: (a) =>
      `${a.business}，您好！这是 ${a.from} 的账单 ${a.number}，金额 ${a.amount}，请在 ${shortDue("zh-Hans", a.dueDate)}前付款。在这里可以查看和付款：\n\n${a.url}\n\n谢谢！`,
    pdfMessage: (a) =>
      join(
        `${a.business}，您好！附上账单 ${a.number}（PDF），金额 ${a.amount}，${a.dueOnReceipt ? "收到即付" : `请在 ${shortDue("zh-Hans", a.dueDate)}前付款`}。`,
        [a.zelle ? `Zelle：${a.zelle}，备注请写 ${a.number}。` : null, a.url ? `在线付款：${a.url}` : null],
        "谢谢！",
      ),
  },
};

const zhHant: InvoiceCopy = {
  share: {
    label: "繁體中文",
    message: (a) =>
      `${a.business}，您好！這是 ${a.from} 的帳單 ${a.number}，金額 ${a.amount}，請在 ${shortDue("zh-Hant", a.dueDate)}前付款。在這裡可以查看和付款：\n\n${a.url}\n\n謝謝！`,
    pdfMessage: (a) =>
      join(
        `${a.business}，您好！附上帳單 ${a.number}（PDF），金額 ${a.amount}，${a.dueOnReceipt ? "收到即付" : `請在 ${shortDue("zh-Hant", a.dueDate)}前付款`}。`,
        [a.zelle ? `Zelle：${a.zelle}，備註請寫 ${a.number}。` : null, a.url ? `線上付款：${a.url}` : null],
        "謝謝！",
      ),
  },
};

export const INVOICE_COPY: Record<IntakeLangCode, InvoiceCopy> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };

export function invoiceCopy(lang: IntakeLangCode): InvoiceCopy {
  return INVOICE_COPY[lang] ?? en;
}
