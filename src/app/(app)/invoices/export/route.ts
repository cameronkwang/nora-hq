import { getUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { paymentsCsv } from "@/lib/ops-invoices";

export const dynamic = "force-dynamic";

/**
 * Export payments (CSV) for taxes (docs/invoicing.md "Reports"): one row per payment, oldest first, by payment date.
 * ?year=2026 (default this year). Signed in only, an attachment, never cached.
 */
export async function GET(req: Request) {
  if (!(await getUser())) return new Response("Sign in first.", { status: 401, headers: { "Cache-Control": "no-store" } });
  const y = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(today().slice(0, 4));
  const out = await paymentsCsv({ year }).catch((e) => {
    console.error("[invoices] csv failed", e instanceof Error ? e.message : e);
    return null;
  });
  if (!out) return new Response("Couldn't make the CSV.", { status: 500, headers: { "Cache-Control": "no-store" } });
  const name = out.filename.replace(/[^\w. -]+/g, "") || `payments-${year}.csv`;
  return new Response(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
