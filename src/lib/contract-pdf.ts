/**
 * Renders a ContractDoc (lib/contract) to a Letter-size PDF in the browser with pdf-lib.
 * Standard Helvetica only covers WinAnsi, so curly quotes, dashes and the like are mapped to
 * plain equivalents and anything else unprintable (emoji, CJK) is dropped rather than crashing.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ContractDoc } from "./contract";

const PAGE_W = 612; // 8.5in
const PAGE_H = 792; // 11in
const MARGIN = 64;
const WIDTH = PAGE_W - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);

const REPLACE: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ", "•": "•",
};

/** Keep only what Helvetica (WinAnsi) can draw. */
function printable(font: PDFFont, s: string): string {
  let out = "";
  for (const ch of s) {
    const c = REPLACE[ch] ?? ch;
    try {
      font.encodeText(c);
      out += c;
    } catch {
      /* not encodable in WinAnsi: drop it */
    }
  }
  return out;
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let row = "";
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) {
      row = next;
      continue;
    }
    if (row) rows.push(row);
    // A single word wider than the line (a long email): hard-break it.
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
      rows.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    row = rest;
  }
  if (row) rows.push(row);
  return rows.length ? rows : [""];
}

export async function contractPdf(doc: ContractDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator("Nora HQ");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensure = (h: number) => {
    if (y - h < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const para = (text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; after?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    const indent = opts.indent ?? 0;
    const lead = size * 1.45;
    const bullet = text.startsWith("•  ");
    const body = printable(font, bullet ? text.slice(3) : text);
    const hang = bullet ? 14 : 0;
    const rows = wrap(font, size, body, WIDTH - indent - hang);
    rows.forEach((r, i) => {
      ensure(lead);
      if (bullet && i === 0) page.drawText("•", { x: MARGIN + indent + 2, y: y - size, size, font, color: opts.color ?? INK });
      page.drawText(r, { x: MARGIN + indent + hang, y: y - size, size, font, color: opts.color ?? INK });
      y -= lead;
    });
    y -= opts.after ?? 5;
  };

  // Title + intro
  para(doc.title, { font: bold, size: 18, after: 10 });
  para(doc.intro, { after: 12 });

  doc.sections.forEach((s, i) => {
    ensure(40); // keep a heading with at least its first lines
    para(`${i + 1}. ${s.heading}`, { font: bold, size: 12, after: 4 });
    s.paragraphs.forEach((p) => para(p, { indent: 0, after: p.startsWith("•  ") ? 1 : 5 }));
    y -= 6;
  });

  // Signatures: keep the whole block on one page.
  ensure(40 + doc.signers.length * 78);
  y -= 8;
  para("Signatures", { font: bold, size: 12, after: 10 });
  for (const s of doc.signers) {
    ensure(78);
    y -= 26;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 260, y }, thickness: 0.8, color: INK });
    page.drawLine({ start: { x: MARGIN + 290, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.8, color: INK });
    y -= 13;
    const who = [s.role, s.name, s.business].filter(Boolean).join(" - ");
    page.drawText(printable(regular, who), { x: MARGIN, y, size: 9.5, font: regular, color: MUTED });
    page.drawText("Date", { x: MARGIN + 290, y, size: 9.5, font: regular, color: MUTED });
    y -= 30;
  }

  // Page numbers
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 8.5), y: MARGIN / 2, size: 8.5, font: regular, color: MUTED });
  });

  return pdf.save();
}
