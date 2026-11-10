import { getUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { today } from "@/lib/dates";
import { listMetricRows, rangeMonths, resolveEnd } from "../queries";

export const dynamic = "force-dynamic";

/** CSV of the months shown on /numbers (?end=YYYY-MM): one line per business × platform × month that has numbers. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const end = resolveEnd(new URL(req.url).searchParams.get("end"));
  const months = rangeMonths(end);
  const [clients, rows] = await Promise.all([listClients({ includeArchived: true }), listMetricRows(months)]);
  const order = new Map(clients.map((c, i) => [c.id, i]));
  const byId = new Map(clients.map((c) => [c.id, c]));
  rows.sort(
    (a, b) =>
      (order.get(a.clientId) ?? 1e9) - (order.get(b.clientId) ?? 1e9) || a.platform.localeCompare(b.platform) || a.month.localeCompare(b.month),
  );

  const lines = [["business", "location", "platform", "month", "views", "reach", "followers", "engagements", "source"].join(",")];
  for (const r of rows) {
    const c = byId.get(r.clientId);
    lines.push([c?.name ?? r.clientId, c?.location, r.platform, r.month, r.views, r.reach, r.followers, r.engagements, r.source].map(cell).join(","));
  }

  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="numbers-${months[0]}-to-${end}-${today()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** RFC 4180 quoting, plus a guard so spreadsheet apps don't execute cells starting with = + - @. */
function cell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
