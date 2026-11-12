import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { listBusinesses } from "@/lib/data";
import { getLead } from "@/lib/ops-leads";
import { Card, PageHeader } from "@/components/ui";
import { OnboardForm, type OnboardPrefill, type PlanSource } from "@/components/onboard-form";

export const dynamic = "force-dynamic";

/** Businesses with an active plan, for "Copy monthly plan from…". Nora's own creator workspace is left out. */
async function planSources(): Promise<PlanSource[]> {
  const clients = await listBusinesses();
  if (!clients.length) return [];
  const db = await getDb();
  const rows = await db
    .select({ clientId: schema.deliverables.clientId, n: sql<number>`count(*)::int` })
    .from(schema.deliverables)
    .where(eq(schema.deliverables.active, true))
    .groupBy(schema.deliverables.clientId);
  const count = new Map(rows.map((r) => [r.clientId, r.n]));
  return clients.filter((c) => (count.get(c.id) ?? 0) > 0).map((c) => ({ id: c.id, name: c.name, items: count.get(c.id)! }));
}

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const lead = sp.lead ? await getLead(sp.lead) : null;
  if (lead?.convertedClientId) {
    const db = await getDb();
    const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, lead.convertedClientId));
    if (c) redirect(`/clients/${c.id}`);
  }

  const prefill: OnboardPrefill = lead
    ? {
        leadId: lead.id,
        name: lead.name,
        location: lead.city,
        instagramHandle: lead.instagramHandle,
        tiktokHandle: lead.tiktokHandle,
        website: lead.website,
        googleMapsUrl: lead.googleMapsUrl,
        services: lead.opportunities,
      }
    : {};

  return (
    <div className="mx-auto w-full max-w-xl">
      <p className="mb-2 text-sm">
        <Link href={lead ? `/leads/${lead.id}` : "/clients"} className="text-muted hover:underline">← {lead ? lead.name : "Businesses"}</Link>
      </p>
      <PageHeader
        title={lead ? `Start managing ${lead.name}` : "New client"}
        subtitle={lead ? "Check the details, tap once. The lead is marked Won." : "Name or link, tap once. Claude does the homework."}
      />
      <Card>
        <OnboardForm prefill={prefill} planSources={await planSources()} />
      </Card>
    </div>
  );
}
