import { getUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { listLeads } from "@/lib/ops-leads";
import { LEAD_OPPORTUNITIES, type LeadOpportunity } from "@/lib/schema";
import { csvCell } from "@/app/(app)/tasks/csv";

export const dynamic = "force-dynamic";

/** CSV of leads (formula-injection safe). ?opp= and ?city= narrow it like the list. Columns round-trip through /leads/import. */
export async function GET(req: Request) {
  // Middleware already requires a session; check again so this never leaks if the matcher changes.
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const sp = new URL(req.url).searchParams;
  const opp = (LEAD_OPPORTUNITIES as readonly string[]).includes(sp.get("opp") ?? "") ? (sp.get("opp") as LeadOpportunity) : undefined;
  const city = sp.get("city") ?? "";
  const rows = (await listLeads({ opportunity: opp })).filter((l) => !city || l.city === city);

  const header = [
    "name", "city", "category", "stage", "opportunities", "score", "why",
    "website", "instagram", "tiktok", "google_maps", "google_rating", "google_reviews", "reply_rate_pct", "instagram_followers", "last_post",
    "contact_name", "contact_email", "contact_phone", "next_step", "notes", "source", "created_at", "updated_at",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const l of rows) {
    lines.push(
      [
        l.name, l.city, l.category, l.stage, l.opportunities.join(", "), l.score, l.why,
        l.website, l.instagramHandle, l.tiktokHandle, l.googleMapsUrl, l.googleRating, l.googleReviewCount, l.replyRate, l.instagramFollowers,
        l.lastPostAt ? l.lastPostAt.toISOString().slice(0, 10) : "",
        l.contactName, l.contactEmail, l.contactPhone, l.nextStepAt, l.notes, l.source, l.createdAt.toISOString(), l.updatedAt.toISOString(),
      ].map(csvCell).join(","),
    );
  }

  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${today()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
