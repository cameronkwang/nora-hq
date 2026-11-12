import "server-only";
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ClientReport, ContentPost, Creator, Draft, DraftKind, DraftStatus, Lead, Outreach, Review } from "@/lib/schema";
import { MANUAL_SEND_KINDS } from "@/components/draft-checks";

export const REVIEW_TABS = [
  { key: "needs_review", label: "Needs review", status: "needs_review" as DraftStatus },
  { key: "approved", label: "Approved — send manually", status: "approved" as DraftStatus },
  { key: "sent", label: "Sent", status: "sent" as DraftStatus },
  { key: "rejected", label: "Sent back", status: "rejected" as DraftStatus },
  { key: "failed", label: "Failed", status: "failed" as DraftStatus },
] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number]["key"];

export type OutreachContext = Outreach & {
  creator: Creator;
  history: Array<{ id: string; title: string; kind: string; sentAt: Date | null }>;
  otherClients: Array<{ clientId: string; stage: string }>;
};

export type ReportContext = Pick<ClientReport, "id" | "month" | "audience" | "status" | "sentAt" | "sentTo"> & { ownerEmail: string | null };

export type DraftContext = {
  review?: Review | null;
  outreach?: OutreachContext | null;
  post?: ContentPost | null;
  lead?: Pick<Lead, "id" | "name" | "contactName" | "city"> | null;
  /** kind "report": the client_reports row (meta.reportId) and the business owner's email, if saved. */
  report?: ReportContext | null;
};

function baseFilters(f: { client?: string; kind?: string }) {
  const where: SQL[] = [];
  if (f.client) where.push(eq(schema.drafts.clientId, f.client));
  if (f.kind && (schema.DRAFT_KINDS as readonly string[]).includes(f.kind)) where.push(eq(schema.drafts.kind, f.kind as DraftKind));
  return where;
}

function tabFilter(tab: ReviewTab): SQL[] {
  if (tab === "approved") return [eq(schema.drafts.status, "approved"), inArray(schema.drafts.kind, [...MANUAL_SEND_KINDS])];
  return [eq(schema.drafts.status, tab)];
}

export async function tabCounts(f: { client?: string; kind?: string }) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.drafts.status, kind: schema.drafts.kind, n: sql<number>`count(*)::int` })
    .from(schema.drafts)
    .where(and(...baseFilters(f)))
    .groupBy(schema.drafts.status, schema.drafts.kind);
  const counts: Record<ReviewTab, number> = { needs_review: 0, approved: 0, sent: 0, rejected: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === "approved") {
      if ((MANUAL_SEND_KINDS as readonly string[]).includes(r.kind)) counts.approved += r.n;
    } else counts[r.status] += r.n;
  }
  return counts;
}

export async function listDrafts(tab: ReviewTab, f: { client?: string; kind?: string }, limit = 100) {
  const db = await getDb();
  const order = tab === "needs_review" ? [asc(schema.drafts.createdAt)] : [desc(schema.drafts.updatedAt)];
  return db
    .select()
    .from(schema.drafts)
    .where(and(...baseFilters(f), ...tabFilter(tab)))
    .orderBy(...order)
    .limit(limit);
}

export async function getDraft(id: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, id));
  return d ?? null;
}

/** Loads everything the cards need to show context, in a handful of queries. */
export async function loadContexts(drafts: Draft[]): Promise<Map<string, DraftContext>> {
  const db = await getDb();
  const metaIds = (key: string, kinds: string[]) =>
    [...new Set(drafts.filter((d) => kinds.includes(d.kind) && d.meta[key]).map((d) => String(d.meta[key])))];

  const reviewIds = metaIds("reviewId", ["review_reply"]);
  const outreachIds = metaIds("outreachId", ["outreach_email", "outreach_dm"]);
  const postIds = metaIds("postId", ["instagram_post", "tiktok_post"]);
  const leadIds = metaIds("leadId", ["lead_email", "lead_dm"]);
  const reportIds = metaIds("reportId", ["report"]);

  const [reviews, outreachRows, posts, history, leadRows, reportRows] = await Promise.all([
    reviewIds.length ? db.select().from(schema.reviews).where(inArray(schema.reviews.id, reviewIds)) : Promise.resolve([] as Review[]),
    outreachIds.length
      ? db.select({ o: schema.outreach, c: schema.creators }).from(schema.outreach)
          .innerJoin(schema.creators, eq(schema.outreach.creatorId, schema.creators.id))
          .where(inArray(schema.outreach.id, outreachIds))
      : Promise.resolve([] as Array<{ o: Outreach; c: Creator }>),
    postIds.length ? db.select().from(schema.contentPosts).where(inArray(schema.contentPosts.id, postIds)) : Promise.resolve([] as ContentPost[]),
    outreachIds.length
      ? db.select({ id: schema.drafts.id, title: schema.drafts.title, kind: schema.drafts.kind, sentAt: schema.drafts.sentAt, outreachId: sql<string>`${schema.drafts.meta}->>'outreachId'` })
          .from(schema.drafts)
          .where(and(eq(schema.drafts.status, "sent"), inArray(sql`${schema.drafts.meta}->>'outreachId'`, outreachIds)))
          .orderBy(desc(schema.drafts.sentAt))
      : Promise.resolve([] as Array<{ id: string; title: string; kind: DraftKind; sentAt: Date | null; outreachId: string }>),
    leadIds.length
      ? db.select({ id: schema.leads.id, name: schema.leads.name, contactName: schema.leads.contactName, city: schema.leads.city })
          .from(schema.leads).where(inArray(schema.leads.id, leadIds))
      : Promise.resolve([] as Array<Pick<Lead, "id" | "name" | "contactName" | "city">>),
    reportIds.length
      ? db.select({
          id: schema.clientReports.id, month: schema.clientReports.month, audience: schema.clientReports.audience, status: schema.clientReports.status,
          sentAt: schema.clientReports.sentAt, sentTo: schema.clientReports.sentTo, ownerEmail: schema.clients.ownerEmail,
        })
          .from(schema.clientReports)
          .innerJoin(schema.clients, eq(schema.clients.id, schema.clientReports.clientId))
          .where(inArray(schema.clientReports.id, reportIds))
      : Promise.resolve([] as ReportContext[]),
  ]);

  const creatorIds = [...new Set(outreachRows.map((r) => r.c.id))];
  const others = creatorIds.length
    ? await db.select({ id: schema.outreach.id, creatorId: schema.outreach.creatorId, clientId: schema.outreach.clientId, stage: schema.outreach.stage })
        .from(schema.outreach)
        .where(inArray(schema.outreach.creatorId, creatorIds))
    : [];

  const outreachById = new Map<string, OutreachContext>(
    outreachRows.map(({ o, c }) => [
      o.id,
      {
        ...o,
        creator: c,
        history: history.filter((h) => h.outreachId === o.id).map(({ id, title, kind, sentAt }) => ({ id, title, kind, sentAt })),
        otherClients: others.filter((x) => x.creatorId === c.id && x.id !== o.id).map((x) => ({ clientId: x.clientId, stage: x.stage })),
      },
    ]),
  );

  const out = new Map<string, DraftContext>();
  for (const d of drafts) {
    const ctx: DraftContext = {};
    if (d.kind === "review_reply") ctx.review = reviews.find((r) => r.id === String(d.meta.reviewId)) ?? null;
    if (d.kind === "outreach_email" || d.kind === "outreach_dm") {
      const o = outreachById.get(String(d.meta.outreachId));
      ctx.outreach = o ? { ...o, history: o.history.filter((h) => h.id !== d.id) } : null;
    }
    if (d.kind === "instagram_post" || d.kind === "tiktok_post") ctx.post = posts.find((p) => p.id === String(d.meta.postId)) ?? null;
    if (d.kind === "lead_email" || d.kind === "lead_dm") ctx.lead = leadRows.find((l) => l.id === String(d.meta.leadId)) ?? null;
    if (d.kind === "report") ctx.report = reportRows.find((r) => r.id === String(d.meta.reportId)) ?? null;
    out.set(d.id, ctx);
  }
  return out;
}

async function providerConnected(provider: "gmail" | "google") {
  const db = await getDb();
  const [row] = await db.select({ id: schema.connections.id }).from(schema.connections)
    .where(and(eq(schema.connections.provider, provider), ne(schema.connections.status, "error"), ne(schema.connections.status, "expired")))
    .limit(1);
  return !!row;
}

/** Whether a Gmail connection is live (decides whether we show a mailto: fallback). */
export async function gmailConnected() {
  return providerConnected("gmail");
}

/** Whether Google Business Profile is connected (approving a review reply then posts it publicly). */
export async function googleConnected() {
  return providerConnected("google");
}
