import { getUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { today } from "@/lib/dates";
import { listCreatorRows } from "../queries";

export const dynamic = "force-dynamic";

/** CSV of every creator × business relationship (creators with no outreach get one row). ?client= narrows to one business. */
export async function GET(req: Request) {
  // Middleware already requires a session; check again so this never leaks if the matcher changes.
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const clientFilter = new URL(req.url).searchParams.get("client") ?? "";
  const [rows, clients] = await Promise.all([listCreatorRows(), listClients({ includeArchived: true })]);
  const brand = new Map(clients.map((c) => [c.id, c]));

  const header = [
    "creator_id", "name", "instagram", "tiktok", "email", "city", "niche",
    "instagram_followers", "tiktok_followers", "engagement_rate_pct", "stats_updated", "do_not_contact", "source", "creator_notes",
    "business", "business_location", "channel", "stage", "comp_type", "contacted_at", "last_activity_at", "next_follow_up",
    "post_url", "disclosure_ok", "outreach_notes",
  ];
  const lines = [header.map(cell).join(",")];
  const iso = (d: Date | null) => (d ? d.toISOString() : "");

  for (const c of rows) {
    const base = [
      c.id, c.name, c.instagramHandle, c.tiktokHandle, c.email, c.city, c.niche,
      c.instagramFollowers, c.tiktokFollowers, c.engagementRate, iso(c.statsUpdatedAt), c.doNotContact ? "yes" : "no", c.source, c.notes,
    ];
    const outreach = clientFilter ? c.outreach.filter((o) => o.clientId === clientFilter) : c.outreach;
    if (outreach.length === 0) {
      if (!clientFilter) lines.push([...base, "", "", "", "", "", "", "", "", "", "", ""].map(cell).join(","));
      continue;
    }
    for (const o of outreach) {
      const cl = brand.get(o.clientId);
      lines.push(
        [
          ...base,
          cl?.name ?? o.client.name, cl?.location ?? o.client.location, o.channel, o.stage, o.compType,
          iso(o.contactedAt), iso(o.lastActivityAt), iso(o.nextFollowUpAt), o.postUrl,
          o.disclosureOk == null ? "" : o.disclosureOk ? "yes" : "no", o.notes,
        ].map(cell).join(","),
      );
    }
  }

  const suffix = clientFilter && brand.has(clientFilter) ? `-${clientFilter}` : "";
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="creators${suffix}-${today()}.csv"`,
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
