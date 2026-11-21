import { getUser } from "@/lib/auth";
import { invoicePdf } from "@/lib/ops-invoices";

export const dynamic = "force-dynamic";

/** The file name in Content-Disposition: an ASCII fallback plus the UTF-8 name (RFC 6266 / 5987). */
function disposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").replace(/\s+/g, " ").trim() || "Invoice.pdf";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * The signed-in PDF (docs/invoicing.md "The PDF"): inline, or an attachment with ?download=1 (the list's one-tap
 * download and the done state's Download PDF). Made fresh from the invoice on every GET (pdf-lib on the server), so
 * an edit shows at once. A draft prints "DRAFT". Never cached.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return new Response("Sign in first.", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  const download = new URL(req.url).searchParams.get("download") === "1";
  const origin = new URL(req.url).origin;
  const pdf = await invoicePdf(id, { origin }).catch((e) => {
    console.error("[invoices] pdf failed", e instanceof Error ? e.message : e);
    return "error" as const;
  });
  if (pdf === "error") return new Response("Couldn't make the PDF.", { status: 500, headers: { "Cache-Control": "no-store" } });
  if (!pdf) return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(pdf.bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.bytes.byteLength),
      "Content-Disposition": disposition(download ? "attachment" : "inline", pdf.filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
