/**
 * The Skynova import's parser (docs/invoicing.md "Import from Skynova"). Pure: no server imports, no database. Skynova
 * has no real export, so a person copies the table from Skynova's Customers or Invoices page (tab separated when
 * pasted from a browser) or types a CSV (comma or semicolon separated). This reads it into rows and says, per row,
 * what is wrong with it; lib/ops-invoices previewSkynovaImport adds what already exists (a customer with the same
 * name key, an invoice with the same number) and saveSkynovaImport re-parses the same text on the server.
 *
 * Everything pasted is untrusted text: control characters are stripped, lengths are capped, and a row holding a card
 * or bank account number is refused (Nora HQ never stores those).
 */
import {
  MAX_INVOICE_CENTS,
  isYmd,
  looksLikeCardOrBankNumber,
  normalizeImportedNumber,
  type ImportCustomerRow,
  type ImportInvoiceRow,
  type ImportKind,
  type ImportPreview,
} from "./invoices-types";

/** The most rows one paste may hold (Skynova's whole history is a few hundred). */
export const IMPORT_MAX_ROWS = 1000;
/** The most text one paste may hold. */
export const IMPORT_MAX_CHARS = 400_000;

/* ───────────────────────── Cleaning ───────────────────────── */

const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** One cell as one clean line (no control characters, single spaces), capped. */
export function cleanCell(v: string | null | undefined, max = 300): string {
  return (v ?? "").replace(INVISIBLE, "").replace(/[\r\n\t\u0085\u2028\u2029]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

/* ───────────────────────── Splitting ───────────────────────── */

export type Delimiter = "\t" | "," | ";";

/**
 * Tab when the paste has tabs (copied from a browser table), else whichever of ; or , the first lines use more.
 * Looks at the first ten non-empty lines, so a title line above the table ("Invoices") doesn't decide it.
 */
export function detectDelimiter(text: string): Delimiter {
  const head = text.split(/\r\n?|\n/).filter((l) => l.trim()).slice(0, 10);
  if (head.some((l) => l.includes("\t"))) return "\t";
  let commas = 0;
  let semis = 0;
  for (const l of head) {
    let quoted = false;
    for (const ch of l) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === ",") commas++;
      else if (!quoted && ch === ";") semis++;
    }
  }
  return semis > commas ? ";" : ",";
}

/**
 * Text → records of cells, honouring double quotes ("a, b" is one cell; "" is a quote; a quoted cell may span lines).
 * Each record keeps the 1-based line it started on.
 */
export function splitRecords(text: string, delim: Delimiter): Array<{ line: number; cells: string[] }> {
  const out: Array<{ line: number; cells: string[] }> = [];
  const s = text.replace(/\r\n?/g, "\n");
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let atCellStart = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
      continue;
    }
    if (ch === delim) {
      cells.push(cell);
      cell = "";
      atCellStart = true;
      continue;
    }
    if (ch === "\n") {
      cells.push(cell);
      out.push({ line: start, cells });
      cells = [];
      cell = "";
      line++;
      start = line;
      atCellStart = true;
      continue;
    }
    if (atCellStart && (ch === " " || ch === " ") && delim !== "\t") continue; // "a, b": the space after a comma
    cell += ch;
    atCellStart = false;
  }
  if (cell || cells.length) {
    cells.push(cell);
    out.push({ line: start, cells });
  }
  return out;
}

/* ───────────────────────── Headers ───────────────────────── */

/** "Invoice #" → "invoice no", "Amount Paid" → "amount paid", "E-mail" → "e mail". */
export function headerKey(h: string): string {
  return cleanCell(h, 80).toLowerCase().replace(/#/g, " no ").replace(/\bno\./g, "no").replace(/[^a-z0-9]+/g, " ").trim();
}

const CUSTOMER_HEADERS: Record<string, readonly string[]> = {
  name: ["customer", "customer name", "client", "client name", "company", "company name", "name", "business", "business name", "bill to", "display name"],
  contactName: ["contact", "contact name", "contact person", "attention", "attn", "first name"],
  email: ["email", "e mail", "email address", "e mail address"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "cell"],
  address: ["address", "billing address", "street", "street address", "address 1", "address line 1", "address1"],
  address2: ["address 2", "address line 2", "address2", "suite", "apt"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["zip", "zip code", "zipcode", "postal code", "postcode"],
  notes: ["notes", "note", "memo", "comments"],
};

const INVOICE_HEADERS: Record<string, readonly string[]> = {
  number: ["invoice no", "invoice number", "invoice", "number", "no", "inv no", "inv", "invoice id", "invoice num"],
  customerName: ["customer", "customer name", "client", "client name", "company", "company name", "bill to", "name", "business", "business name"],
  issueDate: ["date", "invoice date", "issue date", "issued", "date issued", "created", "issued on"],
  dueDate: ["due", "due date", "date due", "due on"],
  total: ["total", "amount", "invoice total", "total amount", "grand total", "invoice amount"],
  paid: ["paid", "amount paid", "paid amount", "payments", "paid to date"],
  balance: ["balance", "balance due", "amount due", "due amount", "open balance", "outstanding", "remaining"],
  status: ["status", "state"],
  description: ["description", "item", "items", "memo", "notes", "details"],
};

function mapHeader(cells: string[], kind: ImportKind): Map<string, number> {
  const table = kind === "customers" ? CUSTOMER_HEADERS : INVOICE_HEADERS;
  const found = new Map<string, number>();
  cells.forEach((c, i) => {
    const k = headerKey(c);
    if (!k) return;
    for (const [field, names] of Object.entries(table)) {
      if (!found.has(field) && names.includes(k)) {
        found.set(field, i);
        return;
      }
    }
  });
  return found;
}

function isHeader(found: Map<string, number>, kind: ImportKind): boolean {
  if (kind === "customers") return found.has("name") && found.size >= 1;
  return found.has("number") && (found.has("customerName") || found.has("total") || found.has("balance")) && found.size >= 2;
}

/* ───────────────────────── Values ───────────────────────── */

/** "$1,250.50" → 125050; "(50.00)" and "-50" → negative; "" → null; anything else → NaN. */
export function parseImportAmount(v: string | null | undefined): number | null {
  let s = cleanCell(v, 40).replace(/usd/i, "").replace(/[$,\s]/g, "");
  if (!s || s === "-" || s === "—") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return Number.NaN;
  const cents = Math.round(Number(s) * 100);
  return neg ? -cents : cents;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ymdOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** 2026-11-20, 11/20/2026, 11/20/26, 11-20-2026, Nov 20, 2026, November 20 2026, 20 Nov 2026 → "2026-11-20"; "" → null; else NaN-ish "bad". */
export function parseImportDate(v: string | null | undefined): string | null | "bad" {
  const s = cleanCell(v, 40).replace(/\.$/, "");
  if (!s) return null;
  let out: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) out = ymdOf(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) out = ymdOf(year4(m[3]), Number(m[1]), Number(m[2]));
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mon >= 0) out = ymdOf(Number(m[3]), mon + 1, Number(m[2]));
  } else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon >= 0) out = ymdOf(Number(m[3]), mon + 1, Number(m[1]));
  }
  return out && isYmd(out) ? out : "bad";
}

const EMAIL_RE = /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/;

/* ───────────────────────── The parser ───────────────────────── */

/**
 * The pasted text → an ImportPreview (existingCustomerId / existingInvoiceId are left null: the server fills them).
 * A row with `issues` is shown and skipped on save. Lines that are not rows (a totals line, a repeated header, text
 * before the header) go to `skipped`; blank lines are ignored.
 */
export function parseImport(text: string, kind: ImportKind): ImportPreview {
  const preview: ImportPreview = { kind, columns: [], mapping: {}, customers: [], invoices: [], skipped: [] };
  const raw = (text ?? "").slice(0, IMPORT_MAX_CHARS);
  if (!raw.trim()) return preview;
  const delim = detectDelimiter(raw);
  const records = splitRecords(raw, delim).filter((r) => r.cells.some((c) => cleanCell(c)));
  // The header: the first record (of the first ten) that names enough of our fields.
  let headerAt = -1;
  let fields = new Map<string, number>();
  for (let i = 0; i < Math.min(records.length, 10); i++) {
    const found = mapHeader(records[i].cells, kind);
    if (isHeader(found, kind)) {
      headerAt = i;
      fields = found;
      break;
    }
  }
  if (headerAt < 0) {
    preview.skipped.push({
      line: records[0]?.line ?? 1,
      reason: kind === "customers" ? "No header row found. Copy the table with its headings (Customer, Email, Phone, Address)." : "No header row found. Copy the table with its headings (Invoice #, Customer, Date, Total).",
    });
    return preview;
  }
  const header = records[headerAt].cells.map((c) => cleanCell(c, 80));
  preview.columns = header;
  for (const [field, i] of fields) preview.mapping[field] = header[i];
  for (const r of records.slice(0, headerAt)) preview.skipped.push({ line: r.line, reason: "Before the header row" });
  const headerJoined = header.map((h) => headerKey(h)).join("|");
  const cell = (cells: string[], field: string, max = 300) => {
    const i = fields.get(field);
    return i == null ? "" : cleanCell(cells[i], max);
  };

  let count = 0;
  for (const r of records.slice(headerAt + 1)) {
    const cells = r.cells;
    if (cells.map((c) => headerKey(c)).join("|") === headerJoined) {
      preview.skipped.push({ line: r.line, reason: "Repeated header row" });
      continue;
    }
    const firstText = cleanCell(cells.find((c) => cleanCell(c)) ?? "");
    if (/^(sub)?totals?\b|^grand total\b/i.test(firstText) && !(kind === "invoices" && normalizeImportedNumber(cell(cells, "number"))?.match(/^\d+$/))) {
      preview.skipped.push({ line: r.line, reason: "Totals row" });
      continue;
    }
    if (++count > IMPORT_MAX_ROWS) {
      preview.skipped.push({ line: r.line, reason: `More than ${IMPORT_MAX_ROWS} rows: paste the rest separately` });
      continue;
    }
    const issues: string[] = [];
    if (looksLikeCardOrBankNumber(cells.join(" "))) issues.push("card or bank number in the text");

    if (kind === "customers") {
      const name = cell(cells, "name", 160);
      if (!name) issues.push("no customer name");
      const email = cell(cells, "email", 200).toLowerCase();
      const street = [cell(cells, "address", 200), cell(cells, "address2", 120)].filter(Boolean);
      const cityState = [cell(cells, "city", 80), [cell(cells, "state", 40), cell(cells, "zip", 20)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const address = [...street, cityState].filter(Boolean).join("\n") || null;
      const row: ImportCustomerRow = {
        line: r.line,
        name,
        contactName: cell(cells, "contactName", 120) || null,
        email: EMAIL_RE.test(email) ? email : null,
        phone: cell(cells, "phone", 40) || null,
        billingAddress: address ? address.slice(0, 500) : null,
        notes: cell(cells, "notes", 1000) || null,
        existingCustomerId: null,
        issues,
      };
      preview.customers.push(row);
      continue;
    }

    const number = normalizeImportedNumber(cell(cells, "number", 40));
    if (!number) issues.push("no invoice number");
    const customerName = cell(cells, "customerName", 160);
    if (!customerName) issues.push("no customer");
    const issue = parseImportDate(cell(cells, "issueDate", 40));
    const due = parseImportDate(cell(cells, "dueDate", 40));
    if (issue === "bad") issues.push("invoice date not understood (use 11/20/2026)");
    if (due === "bad") issues.push("due date not understood (use 11/20/2026)");
    const total = parseImportAmount(cell(cells, "total", 40));
    const paidIn = parseImportAmount(cell(cells, "paid", 40));
    const balance = parseImportAmount(cell(cells, "balance", 40));
    const status = cell(cells, "status", 40).toLowerCase();
    const bad = (n: number | null) => n != null && (Number.isNaN(n) || n < 0);
    if (bad(total) || bad(paidIn) || bad(balance)) issues.push("amount not understood (use 1250.50)");
    let totalCents = total != null && !Number.isNaN(total) ? total : null;
    if (totalCents == null && paidIn != null && balance != null && !Number.isNaN(paidIn) && !Number.isNaN(balance)) totalCents = paidIn + balance;
    if (totalCents == null && balance != null && !Number.isNaN(balance) && /unpaid|open|sent|due|overdue/.test(status)) totalCents = balance;
    let paidCents = 0;
    if (paidIn != null && !Number.isNaN(paidIn)) paidCents = paidIn;
    else if (totalCents != null && balance != null && !Number.isNaN(balance)) paidCents = totalCents - balance;
    else if (totalCents != null && /^paid\b|paid in full/.test(status)) paidCents = totalCents;
    if (totalCents == null || totalCents <= 0) {
      if (!issues.some((i) => i.startsWith("amount"))) issues.push("no amount");
      totalCents = Math.max(0, totalCents ?? 0);
    }
    if (totalCents > MAX_INVOICE_CENTS) issues.push("amount too large");
    if (paidCents < 0) paidCents = 0;
    if (paidCents > totalCents && totalCents > 0) issues.push("paid is more than the total");
    if (/void|cancel/.test(status)) issues.push("void in Skynova: not imported");
    if (/draft/.test(status)) issues.push("a draft in Skynova: not imported");
    const issueDate = issue === "bad" ? null : issue;
    const dueDate = due === "bad" ? null : due;
    if (issueDate && dueDate && dueDate < issueDate) issues.push("due date before the invoice date");
    const row: ImportInvoiceRow = {
      line: r.line,
      number: number ?? "",
      customerName,
      issueDate,
      dueDate,
      totalCents,
      paidCents: Math.min(paidCents, Math.max(totalCents, 0)),
      description: cell(cells, "description", 300) || null,
      existingCustomerId: null,
      existingInvoiceId: null,
      issues,
    };
    preview.invoices.push(row);
  }
  // The same number twice in one paste: the second is skipped.
  const seen = new Set<string>();
  for (const inv of preview.invoices) {
    if (!inv.number) continue;
    if (seen.has(inv.number)) inv.issues.push("this number appears twice in the paste");
    seen.add(inv.number);
  }
  return preview;
}

/** The line an imported invoice carries: its Skynova description, else "Imported from Skynova (invoice 0000169)". */
export function importedLine(row: Pick<ImportInvoiceRow, "number" | "description">): string {
  return row.description?.trim() || `Imported from Skynova (invoice ${row.number})`;
}
