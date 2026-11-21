/**
 * The customer's invoice (/i/[token]): every word a customer sees, in English, 简体中文 and 繁體中文, plus the
 * ready-to-text message the team sends with the link (lib/ops-invoices getInvoiceMessages uses `share`).
 *
 * No server imports: shared by the public page, its routes, the team's invoice page and the browser. The Chinese
 * dictionaries are typed against the English shape, so a missing key is a type error (the same pattern as
 * lib/drop-copy and lib/intake-copy). Chinese is written for restaurant owners, not translated word for word;
 * payment names stay as people say them (Zelle, Venmo, PayPal, Stripe).
 *
 * `share` is the link text and the text sent WITH THE PDF (the fast creator's done state copies it; lib/ops-invoices
 * builds the messages from it). `page` is the customer's page: title, labels, status lines, the invoice's ways to pay
 * (her bank account for a transfer, Zelle with the memo line, checks), Pay online, the PDF, the paid and void notices
 * and the Pay online errors. The message sent with the PDF names the ways chosen but never repeats the bank account
 * or routing number: the PDF carries them.
 * Never a surcharge or fee for any way to pay, in any language: Pay online says "No extra fee" instead.
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
  /** Bank transfer (ACH) to her own account is one of the invoice's ways. Never the numbers: the PDF carries them. */
  ach: boolean;
  /** The Zelle number or email, when Zelle is one of the invoice's ways. */
  zelle: string | null;
  /** Who checks are made out to, when check is one of the invoice's ways. */
  checkPayee: string | null;
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

/** "2026-11-20" → "Nov 20, 2026" (en) / "2026年11月20日" (zh): the page's invoice and due dates. */
export function longDate(lang: IntakeLangCode, ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  if (lang !== "en") return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
    /**
     * "Hi Sam! Here is invoice 0000170 for $625.10, due on receipt. The PDF is attached.\n\nZelle: 5550100100, with 0000170 in the memo.\n\nThank you!"
     * With more ways, one line each, in the PDF's order: "Bank transfer (ACH): the account details are on the PDF.",
     * the Zelle line, "Checks payable to Nora Chen.", "Pay online: <link>".
     */
    pdfMessage: (a: PdfShareArgs) => {
      const hi = firstName(a.contactName) ? `Hi ${firstName(a.contactName)}!` : "Hi!";
      const due = a.dueOnReceipt ? "due on receipt" : `due ${shortDue("en", a.dueDate)}`;
      return join(
        `${hi} Here is invoice ${a.number} for ${a.amount}, ${due}. The PDF is attached.`,
        [
          a.ach ? "Bank transfer (ACH): the account details are on the PDF." : null,
          a.zelle ? `Zelle: ${a.zelle}, with ${a.number} in the memo.` : null,
          a.checkPayee ? `Checks payable to ${a.checkPayee}.` : null,
          a.url ? `Pay online: ${a.url}` : null,
        ],
        "Thank you!",
      );
    },
  },
  page: {
    meta: { title: (number: string) => `Invoice ${number}`, generic: "Invoice" },
    invoice: (number: string) => `Invoice ${number}`,
    from: "From",
    billTo: "Bill to",
    invoiceDate: "Invoice date",
    dueDate: "Due date",
    status: {
      dueOnReceipt: "Due on receipt",
      /** "Due Dec 4" */
      due: (date: string) => `Due ${date}`,
      overdue: (date: string) => `Overdue since ${date}`,
      paid: "Paid, thank you",
      processing: (amount: string) => `A bank payment of ${amount} is on its way`,
      paidSoFar: (amount: string) => `${amount} paid so far`,
    },
    table: { description: "Description", unitPrice: "Unit price", quantity: "Quantity", amount: "Amount", each: (qty: string, unit: string) => `${qty} × ${unit}` },
    subtotal: "Subtotal",
    discount: "Discount",
    total: "Total",
    amountPaid: "Amount paid",
    balanceDue: "Balance due",
    notes: "Notes",
    payments: "Payments received",
    howToPay: "How to pay",
    zelle: {
      title: "Zelle",
      sendTo: "Send to",
      shownAs: (name: string) => `Zelle shows ${name}`,
      memo: (number: string) => `Put invoice ${number} in the Zelle memo`,
    },
    /** A transfer from the customer's bank straight to her account: the bank label, then the two numbers to copy. */
    ach: { title: "Bank transfer (ACH)", account: "Account number", routing: "Routing number" },
    check: { title: "Check", payable: (payee: string) => `Checks Payable to ${payee}`, mailTo: "Mail to" },
    venmo: "Venmo",
    paypal: "PayPal",
    custom: "Other",
    online: {
      title: "Pay online",
      bank: "By bank transfer from your bank account, on Stripe's secure page. No extra fee.",
      card: "By card on Stripe's secure page. No extra fee.",
      both: "By bank transfer or card on Stripe's secure page. No extra fee.",
      button: "Pay online",
      bankNote: "A bank transfer takes about 4 business days to arrive.",
    },
    pdf: "Download PDF",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Select and copy",
    /** The copy button's spoken name: "Copy 5550100100". */
    copyWhat: (what: string) => `Copy ${what}`,
    thanks: "Thank you! Card payments show here right away; bank transfers in a few days.",
    questions: (name: string) => `Questions? Contact ${name}.`,
    questionsNoName: "Questions? Contact the person who sent you this invoice.",
    void: { title: "This invoice was cancelled" },
    errors: {
      unavailable: "Paying online isn't available for this invoice right now. Please use one of the ways below.",
      paid: "This invoice is already paid. Thank you!",
      processing: "A bank payment for this invoice is already on its way. It shows here once it arrives.",
      rateLimited: "Too many tries. Please wait a little and try again.",
      failed: "The payment page couldn't open. Please try again in a minute, or use one of the ways below.",
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
        [
          a.ach ? "银行转账（ACH）：账户信息在 PDF 上。" : null,
          a.zelle ? `Zelle：${a.zelle}，备注请写 ${a.number}。` : null,
          a.checkPayee ? `支票抬头请写 ${a.checkPayee}。` : null,
          a.url ? `在线付款：${a.url}` : null,
        ],
        "谢谢！",
      ),
  },
  page: {
    meta: { title: (number) => `账单 ${number}`, generic: "账单" },
    invoice: (number) => `账单 ${number}`,
    from: "收款人",
    billTo: "付款方",
    invoiceDate: "开票日期",
    dueDate: "付款期限",
    status: {
      dueOnReceipt: "收到即付",
      due: (date) => `请在 ${date}前付款`,
      overdue: (date) => `已逾期（${date}到期）`,
      paid: "已付清，谢谢！",
      processing: (amount) => `一笔 ${amount} 的银行转账正在到账中`,
      paidSoFar: (amount) => `已付 ${amount}`,
    },
    table: { description: "项目", unitPrice: "单价", quantity: "数量", amount: "金额", each: (qty, unit) => `${qty} × ${unit}` },
    subtotal: "小计",
    discount: "折扣",
    total: "总计",
    amountPaid: "已付",
    balanceDue: "待付金额",
    notes: "备注",
    payments: "已收到的付款",
    howToPay: "付款方式",
    zelle: {
      title: "Zelle",
      sendTo: "转账到",
      shownAs: (name) => `Zelle 上显示为 ${name}`,
      memo: (number) => `Zelle 备注请写账单号 ${number}`,
    },
    ach: { title: "银行转账（ACH）", account: "账号（Account number）", routing: "路由号码（Routing number）" },
    check: { title: "支票", payable: (payee) => `抬头写 ${payee}`, mailTo: "寄到" },
    venmo: "Venmo",
    paypal: "PayPal",
    custom: "其他方式",
    online: {
      title: "在线付款",
      bank: "在 Stripe 的安全页面从银行账户转账，不收额外费用。",
      card: "在 Stripe 的安全页面用信用卡或借记卡付款，不收额外费用。",
      both: "在 Stripe 的安全页面用银行账户或银行卡付款，不收额外费用。",
      button: "在线付款",
      bankNote: "银行转账大约需要 4 个工作日到账。",
    },
    pdf: "下载 PDF",
    copy: "复制",
    copied: "已复制",
    copyFailed: "请手动选择复制",
    copyWhat: (what) => `复制 ${what}`,
    thanks: "谢谢！刷卡付款会马上显示在这里，银行转账需要几天。",
    questions: (name) => `有问题请联系 ${name}。`,
    questionsNoName: "有问题请联系给您发账单的人。",
    void: { title: "这张账单已取消" },
    errors: {
      unavailable: "这张账单现在不能在线付款，请用下面的其他方式付款。",
      paid: "这张账单已经付清了，谢谢！",
      processing: "这张账单已有一笔银行转账正在到账中，到账后会显示在这里。",
      rateLimited: "尝试次数太多，请稍等一会儿再试。",
      failed: "付款页面暂时打不开，请过一分钟再试，或用下面的其他方式付款。",
    },
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
        [
          a.ach ? "銀行轉帳（ACH）：帳戶資訊在 PDF 上。" : null,
          a.zelle ? `Zelle：${a.zelle}，備註請寫 ${a.number}。` : null,
          a.checkPayee ? `支票抬頭請寫 ${a.checkPayee}。` : null,
          a.url ? `線上付款：${a.url}` : null,
        ],
        "謝謝！",
      ),
  },
  page: {
    meta: { title: (number) => `帳單 ${number}`, generic: "帳單" },
    invoice: (number) => `帳單 ${number}`,
    from: "收款人",
    billTo: "付款方",
    invoiceDate: "開票日期",
    dueDate: "付款期限",
    status: {
      dueOnReceipt: "收到即付",
      due: (date) => `請在 ${date}前付款`,
      overdue: (date) => `已逾期（${date}到期）`,
      paid: "已付清，謝謝！",
      processing: (amount) => `一筆 ${amount} 的銀行轉帳正在入帳中`,
      paidSoFar: (amount) => `已付 ${amount}`,
    },
    table: { description: "項目", unitPrice: "單價", quantity: "數量", amount: "金額", each: (qty, unit) => `${qty} × ${unit}` },
    subtotal: "小計",
    discount: "折扣",
    total: "總計",
    amountPaid: "已付",
    balanceDue: "待付金額",
    notes: "備註",
    payments: "已收到的付款",
    howToPay: "付款方式",
    zelle: {
      title: "Zelle",
      sendTo: "轉帳到",
      shownAs: (name) => `Zelle 上顯示為 ${name}`,
      memo: (number) => `Zelle 備註請寫帳單號 ${number}`,
    },
    ach: { title: "銀行轉帳（ACH）", account: "帳號（Account number）", routing: "路由號碼（Routing number）" },
    check: { title: "支票", payable: (payee) => `抬頭寫 ${payee}`, mailTo: "寄到" },
    venmo: "Venmo",
    paypal: "PayPal",
    custom: "其他方式",
    online: {
      title: "線上付款",
      bank: "在 Stripe 的安全頁面從銀行帳戶轉帳，不收額外費用。",
      card: "在 Stripe 的安全頁面用信用卡或簽帳卡付款，不收額外費用。",
      both: "在 Stripe 的安全頁面用銀行帳戶或銀行卡付款，不收額外費用。",
      button: "線上付款",
      bankNote: "銀行轉帳大約需要 4 個工作天入帳。",
    },
    pdf: "下載 PDF",
    copy: "複製",
    copied: "已複製",
    copyFailed: "請手動選取複製",
    copyWhat: (what) => `複製 ${what}`,
    thanks: "謝謝！刷卡付款會馬上顯示在這裡，銀行轉帳需要幾天。",
    questions: (name) => `有問題請聯絡 ${name}。`,
    questionsNoName: "有問題請聯絡寄帳單給您的人。",
    void: { title: "這張帳單已取消" },
    errors: {
      unavailable: "這張帳單現在不能線上付款，請用下面的其他方式付款。",
      paid: "這張帳單已經付清了，謝謝！",
      processing: "這張帳單已有一筆銀行轉帳正在入帳中，入帳後會顯示在這裡。",
      rateLimited: "嘗試次數太多，請稍等一下再試。",
      failed: "付款頁面暫時打不開，請過一分鐘再試，或用下面的其他方式付款。",
    },
  },
};

export const INVOICE_COPY: Record<IntakeLangCode, InvoiceCopy> = { en, "zh-Hans": zhHans, "zh-Hant": zhHant };

export function invoiceCopy(lang: IntakeLangCode): InvoiceCopy {
  return INVOICE_COPY[lang] ?? en;
}
