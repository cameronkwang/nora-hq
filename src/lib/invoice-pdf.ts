import "server-only";
/**
 * Draws an invoice (invoices-types InvoiceDocument: every word and number already worded) as a Letter PDF with
 * pdf-lib, on the server. Her Skynova invoice's layout, fields and wording, so clients see a familiar document, in the
 * clean Ink style: hairlines instead of boxes and a blue header bar, no "Item: Service" column, Helvetica only (the
 * standard fonts are not embedded files, so this stays fast). docs/invoicing.md "The PDF".
 *
 *   Nora Chen                                                     I N V O I C E
 *   100 Sample St / Sampleton, VA 23000
 *
 *   Sample Bistro                                        Invoice #     0000170
 *   1 Example Ave, Sampleton, VA 23000                   Invoice Date  11/20/2026
 *                                                        Due Date      11/20/2026
 *   ─────────────────────────────────────────────────────────────────────────────
 *   Description                              Unit Price     Quantity      Amount
 *   ─────────────────────────────────────────────────────────────────────────────
 *   Standard Content Creation Package            550.00         1.00      550.00
 *   NOTES: PAYMENT INFORMATION:
 *   Sample Bank Checking
 *   ACH to ACCT#:000123456789
 *   ROUTING:000000000
 *
 *   Please send payment via Zelle to 5550100100.
 *   Put invoice 0000170 in the Zelle memo
 *
 *   Checks Payable to Nora Chen
 *   ─────────────────────────────────────────────────────────────────────────────
 *                                                        Subtotal          550.00
 *                                                        Total             550.00
 *                                                        Amount Paid         0.00
 *                                                        Balance Due      $550.00
 *
 * Long tables flow onto more pages with the column header repeated; "Page 1 of 2" only when there is more than one
 * (and a check's "Mail to the address above" spells the address out when the block lands on a later page).
 * Helvetica draws WinAnsi only: curly quotes and dashes are mapped, an accent it lacks is dropped from its letter, and
 * anything else (CJK, emoji) is left out. Make PDF is refused before that could leave a name or a line empty (ops).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { MAIL_TO_ADDRESS_ABOVE, mailToLine, pdfText, type InvoiceDocument } from "./invoices-types";

const PAGE_W = 612; // 8.5in
const PAGE_H = 792; // 11in
const M = 50; // side margin
const TOP = 52;
const BOTTOM = 56;
const RIGHT = PAGE_W - M;
const WIDTH = PAGE_W - M * 2;

const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.42, 0.42, 0.45);
const TITLE = rgb(0.47, 0.47, 0.49);
const HAIR = rgb(0.8, 0.8, 0.82);

const BODY = 10;
const SMALL = 8.5;

// Columns: Description from the margin, then three right-aligned number columns.
const COL_AMOUNT = RIGHT - 4;
const COL_QTY = RIGHT - 92;
const COL_PRICE = RIGHT - 176;
const DESC_W = COL_PRICE - 62 - (M + 4);

/**
 * Keep only what Helvetica (WinAnsi) can draw. The rule is invoices-types pdfText (shared with the creator's warning
 * and the invoice page's preview); the font has the last word, so a character the rule let through by mistake is
 * dropped here instead of failing the PDF. Line breaks are kept (the callers wrap on them).
 */
function printable(font: PDFFont, s: string): string {
  const t = pdfText(s);
  try {
    font.encodeText(t.replace(/\n/g, " "));
    return t;
  } catch {
    let out = "";
    for (const ch of t) {
      if (ch === "\n") {
        out += ch;
        continue;
      }
      try {
        font.encodeText(ch);
        out += ch;
      } catch {
        /* not encodable in WinAnsi: drop it */
      }
    }
    return out;
  }
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const rows: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let row = "";
    for (const w of words) {
      const next = row ? `${row} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) {
        row = next;
        continue;
      }
      if (row) rows.push(row);
      let rest = w; // a single word wider than the line (a long link): hard-break it
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        rows.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      row = rest;
    }
    rows.push(row);
  }
  while (rows.length > 1 && !rows[rows.length - 1]) rows.pop();
  return rows.length ? rows : [""];
}

export async function renderInvoicePdf(doc: InvoiceDocument, meta: { title?: string } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const number = doc.facts.find((f) => f.label === "Invoice #")?.value ?? "";
  pdf.setTitle(printable(regular, meta.title ?? `Invoice ${number}`));
  if (doc.from.name) pdf.setAuthor(printable(regular, doc.from.name));
  pdf.setCreator("Nora HQ");
  pdf.setProducer("Nora HQ");

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - TOP;
    if (doc.stamp) {
      // A faint diagonal word across the page, so a draft or a void invoice can't pass for a real one.
      const size = 120;
      const w = bold.widthOfTextAtSize(doc.stamp, size);
      page.drawText(doc.stamp, { x: PAGE_W / 2 - (w / 2) * Math.SQRT1_2 + 30, y: PAGE_H / 2 - (w / 2) * Math.SQRT1_2 - 20, size, font: bold, color: rgb(0.86, 0.86, 0.88), rotate: degrees(40), opacity: 0.45 });
    }
  };
  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? BODY;
    const t = printable(font, s).replace(/\n/g, " ");
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: o.align === "right" ? x - w : x, y: yy, size, font, color: o.color ?? INK });
    return w;
  };
  const hair = (yy: number, x1 = M, x2 = RIGHT) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: HAIR });
  const spaced = (s: string, xRight: number, yy: number, size: number, spacing: number) => {
    // pdf-lib has no letter spacing: draw letter by letter, right-aligned.
    const chars = [...printable(bold, s).replace(/\n/g, " ")];
    const total = chars.reduce((sum, ch) => sum + bold.widthOfTextAtSize(ch, size), 0) + spacing * Math.max(0, chars.length - 1);
    let x = xRight - total;
    for (const ch of chars) {
      page.drawText(ch, { x, y: yy, size, font: bold, color: TITLE });
      x += bold.widthOfTextAtSize(ch, size) + spacing;
    }
    return total;
  };

  newPage();

  /* ── From (top left) and the title (top right) ── */
  const lead = BODY * 1.32; // table and notes
  const tight = BODY * 1.2; // the address blocks, set close like hers
  let fy = y - BODY;
  const titleW = spaced(doc.title, RIGHT, y - 24, 25, 5.2);
  if (doc.stamp) spaced(doc.stamp, RIGHT, y - 44, 11, 2.6);
  // The From lines stop short of the title: a long name or address line wraps instead of running under "INVOICE".
  const fromW = WIDTH - titleW - 16;
  for (const l of [doc.from.name, ...doc.from.addressLines, doc.from.email, doc.from.phone].filter((v): v is string => !!v)) {
    for (const row of wrap(regular, BODY, printable(regular, l), fromW)) {
      text(row, M, fy);
      fy -= tight;
    }
  }

  /* ── Bill to (left) and the facts (right) ── */
  y = Math.min(fy, y - 60) - 66;
  const factLabelRight = RIGHT - 96;
  const billW = factLabelRight - 110 - M;
  let by = y;
  for (const l of wrap(regular, BODY, printable(regular, doc.billTo.name) || "Customer", billW)) {
    text(l, M, by);
    by -= tight;
  }
  if (doc.billTo.address) {
    for (const l of wrap(regular, BODY, printable(regular, doc.billTo.address), billW)) {
      text(l, M, by);
      by -= tight;
    }
  }
  const factRow = 25;
  let ry = y;
  for (const f of doc.facts) {
    text(f.label, factLabelRight, ry, { font: bold, align: "right" });
    text(f.value, RIGHT - 4, ry, { align: "right" });
    ry -= factRow;
  }
  y = Math.min(by, ry + factRow - lead) - 34;

  /* ── The table ── */
  const header = () => {
    hair(y);
    y -= 15;
    const [c0, c1, c2, c3] = doc.columns;
    text(c0, M + 4, y, { font: bold, size: 9, color: MUTED });
    text(c1, COL_PRICE, y, { font: bold, size: 9, color: MUTED, align: "right" });
    text(c2, COL_QTY, y, { font: bold, size: 9, color: MUTED, align: "right" });
    text(c3, COL_AMOUNT, y, { font: bold, size: 9, color: MUTED, align: "right" });
    y -= 8;
    hair(y);
    y -= 18;
  };
  const ensure = (h: number, withHeader: boolean) => {
    if (y - h >= BOTTOM) return;
    newPage();
    if (withHeader) header();
  };
  header();
  const tableTop = y;
  for (const r of doc.rows) {
    const lines = wrap(regular, BODY, printable(regular, r.description), DESC_W);
    const h = lines.length * lead + 8;
    ensure(h, true);
    text(r.unitPrice, COL_PRICE, y, { align: "right" });
    text(r.quantity, COL_QTY, y, { align: "right" });
    text(r.amount, COL_AMOUNT, y, { align: "right" });
    for (const l of lines) {
      text(l, M + 4, y);
      y -= lead;
    }
    y -= 8;
  }
  // Short invoices keep her invoice's room under the lines before the notes.
  if (pages.length === 1) y = Math.min(y, tableTop - 104);

  /* ── NOTES and PAYMENT INFORMATION ── */
  const notesW = WIDTH - 8;
  const notesLabel = "NOTES:";
  const drawNotesLabel = (yy: number) => {
    const w = text(notesLabel, M + 4, yy);
    page.drawLine({ start: { x: M + 4, y: yy - 1.6 }, end: { x: M + 4 + w, y: yy - 1.6 }, thickness: 0.6, color: INK });
    return w;
  };
  const hasPay = doc.paymentLines.length > 0;
  if (doc.notes || hasPay) {
    ensure(lead * 2, false);
    y -= 6;
    const labelW = regular.widthOfTextAtSize(notesLabel, BODY) + 4;
    if (doc.notes) {
      const lines = wrap(regular, BODY, printable(regular, doc.notes), notesW - labelW);
      lines.forEach((l, i) => {
        ensure(lead, false);
        if (i === 0) drawNotesLabel(y);
        text(l, M + 4 + labelW, y);
        y -= lead;
      });
      if (hasPay) {
        y -= lead * 0.6;
        ensure(lead, false);
        text(doc.paymentHeading, M + 4, y);
        y -= lead * 1.5;
      }
    } else {
      drawNotesLabel(y);
      text(doc.paymentHeading, M + 4 + labelW, y);
      y -= lead * 1.5;
    }
    for (const p of doc.paymentLines) {
      if (!p) {
        // The blank line between two ways to pay (her bank account, Zelle, checks), as she writes them.
        y -= lead;
        continue;
      }
      // "Mail to the address above" points at the From address at the top of page 1. On a later page there is no
      // address above, so the same address is spelled out, as the pay page and the messages do.
      const later = pages.length > 1 || y - lead < BOTTOM;
      const line = p === MAIL_TO_ADDRESS_ABOVE && later && doc.from.addressLines.length ? mailToLine(doc.from.addressLines.join("\n")) : p;
      for (const l of wrap(regular, BODY, printable(regular, line), notesW)) {
        ensure(lead, false);
        text(l, M + 4, y);
        y -= lead;
      }
    }
    y -= 6;
  }

  /* ── Totals (bottom right) ── */
  const totalsH = doc.totals.length * 22 + 30;
  ensure(totalsH, false);
  hair(y);
  y -= 20;
  const labelX = RIGHT - 210;
  doc.totals.forEach((t, i) => {
    const last = i === doc.totals.length - 1;
    // Hairlines where her invoice draws them: above Total (after Subtotal and any Discount) and above Balance Due.
    if (t.label === "Total" || last) {
      hair(y + 14, labelX - 8, RIGHT);
      y -= 4;
    }
    text(t.label, labelX, y, { font: bold });
    text(t.value, COL_AMOUNT, y, { font: t.strong ? bold : regular, align: "right" });
    y -= last ? 0 : 22;
  });

  /* ── Page numbers, only when there is more than one page ── */
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, { x: RIGHT - regular.widthOfTextAtSize(label, SMALL), y: BOTTOM / 2, size: SMALL, font: regular, color: MUTED });
    });
  }

  return pdf.save({ useObjectStreams: true });
}
