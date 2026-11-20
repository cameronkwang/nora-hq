import { getInvoiceByToken, invoicePdf } from "@/lib/ops-invoices";

/**
 * GET /i/<token>/pdf: PUBLIC (the private link token is the only key). The customer's copy of the invoice as a PDF,
 * made fresh from the invoice (lib/ops-invoices invoicePdf with public: true, so a draft or void one is never
 * printed). An unknown, draft or cancelled link is a plain 404 that says nothing about whether an invoice exists.
 * Always a download (attachment), never cached, no referrer.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

/** `attachment; filename="…"` with a plain ASCII name for old clients and the full name (CJK too) in filename*. */
function contentDisposition(filename: string): string {
  const ascii = filename.normalize("NFKD").replace(/[^\x20-\x7e]+/g, "").replace(/["\\%]/g, "").replace(/\s+/g, " ").replace(/ (?=\.pdf$)/i, "").trim() || "Invoice.pdf";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getInvoiceByToken(token);
  if (found.state !== "open") return notFound();
  // origin: the PDF's "Pay online" line prints this page's full link (APP_URL wins when it is set).
  const pdf = await invoicePdf(found.invoice.id, { public: true, origin: new URL(req.url).origin });
  if (!pdf) return notFound();
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(pdf.filename),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
