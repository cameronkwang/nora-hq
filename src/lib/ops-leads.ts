import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { createRoutedAsk } from "./ops-asks";
import { onboardClient } from "./ops-onboarding";
import {
  CLAUDE_STAGES,
  NO_CONTACT_STAGES,
  OPP_LABEL,
  STAGE_LABEL,
  nameCityKey,
  normalizeHandle,
  parseCount,
  parseDateish,
  parseOpportunities,
  parsePercent,
  parseRating,
  parseScore,
  parseStage,
  websiteHost,
  type RawLeadRow,
} from "@/app/(app)/leads/shared";

/**
 * Leads: businesses that could become clients (Google review management, social media management,
 * or a creator collab with Nora). Same conventions as lib/ops: zod-validated input, `actor` is a user
 * email or "claude", every write is logged. Claude may research and triage (found / qualified /
 * not a fit); contacting, closing and converting are for people.
 */

const isClaude = (actor: string) => actor.toLowerCase() === "claude";
const d = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/* ───────────────────────── Input ───────────────────────── */

const optText = (max: number) => z.string().max(max).nullish();
const num = <T extends z.ZodType>(parse: (v: unknown) => number | null, inner: T) =>
  z.preprocess((v) => (v === undefined ? undefined : parse(v)), inner);

export const LeadInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Give the business a name.").max(200),
  city: optText(120),
  category: optText(120),
  website: optText(500),
  instagramHandle: optText(200),
  tiktokHandle: optText(200),
  googleMapsUrl: optText(1000),
  googleRating: num(parseRating, z.number({ error: "Google rating should be a number from 0 to 5, like 4.3." }).nullish()),
  googleReviewCount: num(parseCount, z.number({ error: "Google review count should be a number, like 312 or 1.2k." }).int().nullish()),
  replyRate: num(parsePercent, z.number({ error: "Reply rate should be a percent from 0 to 100." }).int().nullish()),
  instagramFollowers: num(parseCount, z.number({ error: "Instagram followers should be a number, like 2100 or 2.1k." }).int().nullish()),
  lastPostAt: z.preprocess((v) => (v === undefined ? undefined : parseDateish(v)), z.date({ error: "Last post date should look like 2026-08-01." }).nullish()),
  opportunities: z.preprocess((v) => (v === undefined || v === null ? undefined : parseOpportunities(v)), z.array(z.enum(schema.LEAD_OPPORTUNITIES)).optional()),
  score: num(parseScore, z.number({ error: "Score should be a number from 0 to 100." }).int().nullish()),
  why: optText(2000),
  stage: z.enum(schema.LEAD_STAGES).optional(),
  contactName: optText(200),
  contactEmail: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() || null : v), z.email("That email doesn't look right.").nullish()),
  contactPhone: optText(60),
  nextStepAt: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Next step date should be YYYY-MM-DD.").nullish()),
  notes: optText(5000),
  source: optText(200),
});
export type LeadInputT = z.input<typeof LeadInput>;
type LeadValues = z.output<typeof LeadInput>;

/* ───────────────────────── Lookup / de-dupe ───────────────────────── */

type Key = Pick<schema.Lead, "id" | "name" | "city" | "website" | "instagramHandle" | "stage">;

/** Index of existing leads by website host, IG handle and name+city. Tiny table: one query, matched in memory. */
async function leadIndex() {
  const db = await getDb();
  const all: Key[] = await db
    .select({ id: schema.leads.id, name: schema.leads.name, city: schema.leads.city, website: schema.leads.website, instagramHandle: schema.leads.instagramHandle, stage: schema.leads.stage })
    .from(schema.leads);
  const host = new Map<string, Key>(), ig = new Map<string, Key>(), nc = new Map<string, Key>(), byName = new Map<string, Key[]>();
  for (const l of all) {
    const n = nameCityKey(l.name, "");
    if (n) byName.set(n, [...(byName.get(n) ?? []), l]);
    const h = websiteHost(l.website);
    if (h && !host.has(h)) host.set(h, l);
    const i = normalizeHandle(l.instagramHandle);
    if (i && !ig.has(i)) ig.set(i, l);
    const k = nameCityKey(l.name, l.city);
    if (k && !nc.has(k)) nc.set(k, l);
  }
  return (v: { website?: string | null; instagramHandle?: string | null; name?: string | null; city?: string | null }) => {
    const h = websiteHost(v.website);
    const i = normalizeHandle(v.instagramHandle);
    const k = nameCityKey(v.name, v.city);
    const exact = (h && host.get(h)) || (i && ig.get(i)) || (k && nc.get(k));
    if (exact) return exact;
    // Same name where one side has no city yet: the same place, as long as it's unambiguous.
    const n = nameCityKey(v.name, "");
    const hasCity = !!(v.city ?? "").trim();
    const cands = (n && byName.get(n)?.filter((l) => !hasCity || !(l.city ?? "").trim())) || [];
    return cands.length === 1 ? cands[0] : undefined;
  };
}

/** An existing business (client) that looks like this lead — so Claude doesn't pitch someone we already manage. */
export async function findClientMatch(v: { name: string; city?: string | null; instagramHandle?: string | null; website?: string | null }) {
  const db = await getDb();
  const clients = await db
    .select({ id: schema.clients.id, name: schema.clients.name, location: schema.clients.location, instagramHandle: schema.clients.instagramHandle, website: schema.clients.website })
    .from(schema.clients)
    .where(ne(schema.clients.kind, "creator")); // Nora's own workspace is never a lead's business
  const ig = normalizeHandle(v.instagramHandle), host = websiteHost(v.website), key = nameCityKey(v.name, v.city);
  const bare = nameCityKey(v.name, "");
  return (
    clients.find(
      (c) =>
        (ig && normalizeHandle(c.instagramHandle) === ig) ||
        (host && websiteHost(c.website) === host) ||
        (key && nameCityKey(c.name, c.location) === key) ||
        (bare && nameCityKey(c.name, "") === bare && !v.city),
    ) ?? null
  );
}

/* ───────────────────────── Create / merge ───────────────────────── */

function clean(v: LeadValues) {
  return {
    city: d(v.city),
    category: d(v.category),
    website: d(v.website),
    instagramHandle: normalizeHandle(v.instagramHandle),
    tiktokHandle: normalizeHandle(v.tiktokHandle),
    googleMapsUrl: d(v.googleMapsUrl),
    why: d(v.why),
    contactName: d(v.contactName),
    contactEmail: v.contactEmail ?? null,
    contactPhone: d(v.contactPhone),
    notes: d(v.notes),
    source: d(v.source),
  };
}

export type UpsertLeadResult = { id: string; created: boolean; name: string; stage: schema.LeadStage };

/**
 * Adds a lead, or merges into the existing one (same website host, Instagram handle, or name + city).
 * Merging only fills in / refreshes facts that were given — it never blanks out something we know.
 * Opportunities are combined; notes are appended. Stage is applied to new leads, and to existing
 * leads still in found / qualified (a merge never drags a lead back from contacted or later).
 */
export async function upsertLead(input: LeadInputT, actor: string, opts: { fillOnly?: boolean } = {}): Promise<UpsertLeadResult> {
  const v = LeadInput.parse(input);
  if (v.stage && isClaude(actor) && !(CLAUDE_STAGES as readonly string[]).includes(v.stage))
    throw new OpsError(`Claude can only set a lead to ${CLAUDE_STAGES.map((s) => STAGE_LABEL[s]).join(", ")}. A person moves it further.`);
  const db = await getDb();
  const c = clean(v);

  let existing: schema.Lead | undefined;
  if (v.id) [existing] = await db.select().from(schema.leads).where(eq(schema.leads.id, v.id));
  if (!existing) {
    const match = (await leadIndex())({ website: c.website, instagramHandle: c.instagramHandle, name: v.name, city: c.city });
    if (match) [existing] = await db.select().from(schema.leads).where(eq(schema.leads.id, match.id));
  }

  if (existing && opts.fillOnly) {
    // Untrusted input (the public collab form): never change what we know about an existing lead.
    // Only empty descriptive fields are filled, "collab" is added, and the note (which carries the submitted
    // contact details) is appended. Contact details, website, why, stats and stage are left alone, and a lead
    // past qualified only gets the note.
    const set: Partial<typeof schema.leads.$inferInsert> = {};
    const early = ["found", "qualified"].includes(existing.stage);
    if (early) {
      for (const k of ["city", "category", "instagramHandle", "tiktokHandle", "googleMapsUrl"] as const) {
        const val = c[k];
        if (val && !existing[k]) set[k] = val;
      }
      if (v.opportunities?.length) {
        const merged = schema.LEAD_OPPORTUNITIES.filter((o) => existing!.opportunities.includes(o) || v.opportunities!.includes(o));
        if (merged.length !== existing.opportunities.length) set.opportunities = merged;
      }
    }
    if (c.notes && !(existing.notes ?? "").includes(c.notes)) set.notes = existing.notes ? `${existing.notes}\n\n${c.notes}` : c.notes;
    if (Object.keys(set).length === 0) return { id: existing.id, created: false, name: existing.name, stage: existing.stage };
    set.updatedAt = new Date();
    await db.update(schema.leads).set(set).where(eq(schema.leads.id, existing.id));
    await logActivity({
      actor, action: "lead.updated", entityType: "lead", entityId: existing.id,
      summary: `Updated lead ${existing.name} (${Object.keys(set).filter((k) => k !== "updatedAt").join(", ")})`,
    });
    return { id: existing.id, created: false, name: existing.name, stage: existing.stage };
  }

  if (existing) {
    const set: Partial<typeof schema.leads.$inferInsert> = {};
    for (const k of ["city", "category", "website", "instagramHandle", "tiktokHandle", "googleMapsUrl", "why", "contactName", "contactEmail", "contactPhone"] as const) {
      const val = c[k];
      if (val && val !== existing[k]) set[k] = val;
    }
    if (c.source && !existing.source) set.source = c.source;
    for (const k of ["googleRating", "googleReviewCount", "replyRate", "instagramFollowers", "score"] as const) {
      const val = v[k];
      if (val != null && val !== existing[k]) set[k] = val;
    }
    if (v.lastPostAt && v.lastPostAt.getTime() !== existing.lastPostAt?.getTime()) set.lastPostAt = v.lastPostAt;
    if (v.nextStepAt && v.nextStepAt !== existing.nextStepAt) set.nextStepAt = v.nextStepAt;
    if (v.opportunities?.length) {
      const merged = schema.LEAD_OPPORTUNITIES.filter((o) => existing!.opportunities.includes(o) || v.opportunities!.includes(o));
      if (merged.length !== existing.opportunities.length) set.opportunities = merged;
    }
    if (c.notes && !(existing.notes ?? "").includes(c.notes)) set.notes = existing.notes ? `${existing.notes}\n\n${c.notes}` : c.notes;
    if (v.stage && v.stage !== existing.stage && ["found", "qualified"].includes(existing.stage)) set.stage = v.stage;
    if (Object.keys(set).length === 0) return { id: existing.id, created: false, name: existing.name, stage: existing.stage };
    set.updatedAt = new Date();
    await db.update(schema.leads).set(set).where(eq(schema.leads.id, existing.id));
    await logActivity({
      actor, action: "lead.updated", entityType: "lead", entityId: existing.id,
      summary: set.stage ? `Lead ${existing.name} → ${STAGE_LABEL[set.stage]}` : `Updated lead ${existing.name} (${Object.keys(set).filter((k) => k !== "updatedAt").join(", ")})`,
    });
    if (set.stage && NO_CONTACT_STAGES.includes(set.stage)) await withdrawLeadDrafts(existing.id, actor);
    return { id: existing.id, created: false, name: existing.name, stage: set.stage ?? existing.stage };
  }

  const id = newId("ld_");
  const stage = v.stage ?? "found";
  await db.insert(schema.leads).values({
    id, name: v.name.trim(), ...c,
    source: c.source ?? (isClaude(actor) ? "claude research" : "manual"),
    googleRating: v.googleRating ?? null, googleReviewCount: v.googleReviewCount ?? null, replyRate: v.replyRate ?? null,
    instagramFollowers: v.instagramFollowers ?? null, lastPostAt: v.lastPostAt ?? null,
    opportunities: v.opportunities ?? [], score: v.score ?? null, stage, nextStepAt: v.nextStepAt ?? null, createdBy: actor,
  });
  const opp = (v.opportunities ?? []).map((o) => OPP_LABEL[o]).join(", ");
  await logActivity({ actor, action: "lead.created", entityType: "lead", entityId: id, summary: `New lead: ${v.name.trim()}${c.city ? ` (${c.city})` : ""}${opp ? ` — ${opp}` : ""}` });
  return { id, created: true, name: v.name.trim(), stage };
}

/* ───────────────────────── Explicit edits ───────────────────────── */

export const LeadPatch = LeadInput.omit({ id: true }).partial();

/**
 * Edits one lead. Unlike upsertLead (merge-only), a field passed as null or "" is cleared; undefined is untouched.
 * Claude may only set stage found / qualified / not a fit, and only while the lead is still at one of those.
 */
export async function updateLead(id: string, patch: z.input<typeof LeadPatch>, actor: string) {
  const v = LeadPatch.parse(patch);
  const db = await getDb();
  const [cur] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
  if (!cur) throw new OpsError("lead not found");
  if (v.stage !== undefined && v.stage !== cur.stage && isClaude(actor)) {
    if (!(CLAUDE_STAGES as readonly string[]).includes(v.stage))
      throw new OpsError(`Claude can only set a lead to ${CLAUDE_STAGES.map((s) => STAGE_LABEL[s]).join(", ")}. Contacted happens when a person marks a pitch as sent; later stages are set by Cameron or Nora.`);
    if (!(CLAUDE_STAGES as readonly string[]).includes(cur.stage) || NO_CONTACT_STAGES.includes(cur.stage))
      throw new OpsError(`${cur.name} is ${STAGE_LABEL[cur.stage]} — only Cameron or Nora can move it out of that (it may mean the business asked not to be contacted).`);
  }

  const set: Partial<typeof schema.leads.$inferInsert> = {};
  if (v.name !== undefined) set.name = v.name.trim();
  for (const k of ["city", "category", "website", "googleMapsUrl", "why", "contactName", "contactPhone", "notes", "source"] as const) if (v[k] !== undefined) set[k] = d(v[k]);
  if (v.instagramHandle !== undefined) set.instagramHandle = normalizeHandle(v.instagramHandle);
  if (v.tiktokHandle !== undefined) set.tiktokHandle = normalizeHandle(v.tiktokHandle);
  if (v.contactEmail !== undefined) set.contactEmail = v.contactEmail ?? null;
  for (const k of ["googleRating", "googleReviewCount", "replyRate", "instagramFollowers", "score"] as const) if (v[k] !== undefined) set[k] = v[k] ?? null;
  if (v.lastPostAt !== undefined) set.lastPostAt = v.lastPostAt ?? null;
  if (v.nextStepAt !== undefined) set.nextStepAt = v.nextStepAt ?? null;
  if (v.opportunities !== undefined) set.opportunities = v.opportunities;
  if (v.stage !== undefined && v.stage !== cur.stage) set.stage = v.stage;
  if (Object.keys(set).length === 0) return cur;
  set.updatedAt = new Date();

  const [row] = await db.update(schema.leads).set(set).where(eq(schema.leads.id, id)).returning();
  const name = row.name;
  await logActivity({
    actor, action: set.stage ? "lead.stage" : "lead.updated", entityType: "lead", entityId: id, clientId: row.convertedClientId,
    summary: set.stage ? `Lead ${name}: ${STAGE_LABEL[cur.stage]} → ${STAGE_LABEL[set.stage]}` : `Edited lead ${name}`,
  });
  if (set.stage && NO_CONTACT_STAGES.includes(set.stage)) await withdrawLeadDrafts(id, actor);
  return row;
}

/** People only. Unsent pitch drafts for it are withdrawn first. */
export async function deleteLead(id: string, actor: string) {
  if (isClaude(actor)) throw new OpsError("Only a person can delete a lead");
  const db = await getDb();
  await withdrawLeadDrafts(id, actor, "Lead was deleted.");
  const [row] = await db.delete(schema.leads).where(eq(schema.leads.id, id)).returning();
  if (row) await logActivity({ actor, action: "lead.deleted", entityType: "lead", entityId: id, summary: `Deleted lead ${row.name}` });
}

/** Lost / not a fit / deleted: pull every unsent pitch to this lead out of the review queue. */
async function withdrawLeadDrafts(leadId: string, actor: string, note = "Lead is lost / not a fit — don't send this.") {
  const db = await getDb();
  const rows = await db
    .update(schema.drafts)
    .set({ status: "rejected", reviewedBy: actor, reviewedAt: new Date(), reviewNote: note, updatedAt: new Date() })
    .where(and(
      inArray(schema.drafts.kind, ["lead_email", "lead_dm"]),
      inArray(schema.drafts.status, ["needs_review", "approved", "failed"]),
      sql`${schema.drafts.meta}->>'leadId' = ${leadId}`,
    ))
    .returning({ id: schema.drafts.id, title: schema.drafts.title });
  for (const r of rows) await logActivity({ actor, action: "draft.withdrawn", entityType: "draft", entityId: r.id, summary: `Withdrew “${r.title}” — ${note}` });
}

/* ───────────────────────── Convert to a business ───────────────────────── */

export const ConvertInput = z.object({
  services: z.array(z.enum(schema.LEAD_OPPORTUNITIES)).optional(),
  notes: z.string().max(5000).nullish(),
});

/**
 * People only: "Start managing this business". Creates the business (with its onboarding checklist)
 * via onboardClient, then marks the lead Won and links it. Converting twice returns the same business.
 */
export async function convertLead(id: string, actor: string, opts: z.input<typeof ConvertInput> = {}): Promise<string> {
  if (isClaude(actor) || actor === "system") throw new OpsError("Only a person can turn a lead into a business");
  const o = ConvertInput.parse(opts);
  const db = await getDb();
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
  if (!lead) throw new OpsError("lead not found");
  if (lead.convertedClientId) {
    const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, lead.convertedClientId));
    if (c) return c.id;
  }
  const services = o.services?.length ? o.services : lead.opportunities.length ? lead.opportunities : (["social"] as schema.LeadOpportunity[]);
  const notes = [d(o.notes), lead.why ? `Why we pitched them: ${lead.why}` : null, lead.notes].filter(Boolean).join("\n\n") || null;
  const clientId = await onboardClient(
    { name: lead.name, location: lead.city, instagramHandle: lead.instagramHandle, tiktokHandle: lead.tiktokHandle, website: lead.website, services, notes, leadId: lead.id },
    actor,
  );
  // onboardClient marks the lead won, links it and logs lead.converted itself.
  return clientId;
}

/* ───────────────────────── Hand work to Claude ───────────────────────── */

export const FindLeadsInput = z.object({
  area: z.string().trim().min(2, "Where should Claude look? Add a city or neighborhood.").max(120),
  placeType: z.string().trim().max(120).nullish(),
  opportunities: z.array(z.enum(schema.LEAD_OPPORTUNITIES)).min(1, "Pick at least one: Google reviews, Social or Collab."),
  count: z.coerce.number().int().min(1).max(50).default(10),
});

const OPP_RESEARCH: Record<schema.LeadOpportunity, string> = {
  google: "Google reviews — places with lots of reviews but few or no owner replies, or a rating that's slipping (good fit for review management).",
  social: "Social — places with a weak or quiet Instagram/TikTok: few followers for how busy they are, or no posts in the last month or two (good fit for social media management).",
  collab: "Collab — photogenic, food-forward places that would benefit from a creator visit/feature by Nora (a food creator).",
};

/** Creates the ask already routed to Claude as a request (so it skips triage). */
async function askClaude(body: string, actor: string) {
  const { id } = await createRoutedAsk({ body }, { kind: "request", forWho: "claude" }, actor);
  return id;
}

/** "Find leads": Nora fills in 4 fields; Claude gets a clear research brief as an ask. */
export async function requestLeadResearch(input: z.input<typeof FindLeadsInput>, actor: string) {
  const v = FindLeadsInput.parse(input);
  const body = [
    `Find ${v.count} new lead${v.count === 1 ? "" : "s"} in ${v.area}${v.placeType ? ` — ${v.placeType}` : " — restaurants / food businesses"}.`,
    "",
    "Looking for:",
    ...v.opportunities.map((o) => `- ${OPP_RESEARCH[o]}`),
    "",
    "For each place, research public info (web search) and save it with add_lead:",
    "- Google rating, review count, and roughly what % of recent reviews have an owner reply",
    "- Instagram handle, follower count and date of the last post; TikTok if they have one",
    "- Website and a public business email/phone (only what the business lists publicly)",
    "- opportunities, a 0–100 fit score, and 1–3 sentences on why they're a fit (the pitch angle)",
    "Leave anything you can't verify empty — never guess numbers. Skip places we already manage and chains with in-house marketing.",
    "",
    `When done, reply on this ask with a short summary (how many added, the top 3 to look at first) and mark it done.`,
  ].join("\n");
  const askId = await askClaude(body, actor);
  await logActivity({ actor, action: "lead.research_requested", entityType: "ask", entityId: askId, summary: `Asked Claude to find ${v.count} leads in ${v.area}` });
  return askId;
}

export const PITCH_CHANNELS = ["email", "instagram_dm", "tiktok_dm"] as const;
export type PitchChannel = (typeof PITCH_CHANNELS)[number];
const CHANNEL_WORDS: Record<PitchChannel, string> = { email: "an email", instagram_dm: "an Instagram DM", tiktok_dm: "a TikTok DM" };

/** "Ask Claude to draft a pitch": an ask that points Claude at this lead and channel. */
export async function requestLeadPitch(leadId: string, channel: PitchChannel, actor: string, note?: string | null) {
  if (!(PITCH_CHANNELS as readonly string[]).includes(channel)) throw new OpsError("Pick email, Instagram DM or TikTok DM");
  const db = await getDb();
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId));
  if (!lead) throw new OpsError("lead not found");
  if (NO_CONTACT_STAGES.includes(lead.stage)) throw new OpsError(`${lead.name} is marked ${STAGE_LABEL[lead.stage]} — move it back first if that's wrong.`);
  if (channel === "email" && !lead.contactEmail) throw new OpsError("No public email saved for this lead yet. Add one, or pick a DM.");
  if (channel === "instagram_dm" && !lead.instagramHandle) throw new OpsError("No Instagram handle saved for this lead yet.");
  if (channel === "tiktok_dm" && !lead.tiktokHandle) throw new OpsError("No TikTok handle saved for this lead yet.");
  const opp = lead.opportunities.map((o) => OPP_LABEL[o]).join(", ") || "not set";
  const body = [
    `Draft ${CHANNEL_WORDS[channel]} pitch to ${lead.name}${lead.city ? ` (${lead.city})` : ""}.`,
    `Lead id: ${lead.id}`,
    `What for: ${opp}`,
    lead.why ? `Angle: ${lead.why}` : null,
    d(note) ? `Note from ${actor.split("@")[0]}: ${d(note)}` : null,
    "",
    `Use draft_lead_pitch with lead_id ${lead.id} and channel ${channel}. Short, friendly, from Nora, specific to their gap; no guarantees or made-up claims; include an easy opt-out line. Mark this ask done when the draft is in the review queue.`,
  ].filter((l) => l !== null).join("\n");
  const askId = await askClaude(body, actor);
  return askId;
}

/* ───────────────────────── Reads ───────────────────────── */

export type LeadFilter = { stage?: schema.LeadStage | "open"; opportunity?: schema.LeadOpportunity; city?: string; limit?: number };

/** Leads, best first (score, then most recently touched). City matches case-insensitively, partial. */
export async function listLeads(f: LeadFilter = {}) {
  const db = await getDb();
  const conds = [];
  if (f.stage === "open") conds.push(inArray(schema.leads.stage, ["found", "qualified", "contacted", "talking", "proposal"]));
  else if (f.stage) conds.push(eq(schema.leads.stage, f.stage));
  if (f.opportunity) conds.push(sql`${schema.leads.opportunities} @> ${JSON.stringify([f.opportunity])}::jsonb`);
  if (f.city?.trim()) conds.push(sql`lower(coalesce(${schema.leads.city}, '')) like ${`%${f.city.trim().toLowerCase().replace(/[%_\\]/g, "\\$&")}%`}`);
  const q = db
    .select()
    .from(schema.leads)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${schema.leads.score} desc nulls last`, desc(schema.leads.updatedAt), asc(schema.leads.name));
  return f.limit ? q.limit(f.limit) : q;
}

export async function getLead(id: string) {
  const db = await getDb();
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
  return lead ?? null;
}

/** Pitch drafts for a lead, newest first. */
export async function leadDrafts(leadId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.drafts)
    .where(and(inArray(schema.drafts.kind, ["lead_email", "lead_dm"]), sql`${schema.drafts.meta}->>'leadId' = ${leadId}`))
    .orderBy(desc(schema.drafts.createdAt));
}

/* ───────────────────────── CSV import ───────────────────────── */

export type LeadImportPreviewRow =
  | { status: "new"; name: string }
  | { status: "update"; name: string; existingName: string }
  | { status: "skip"; name: string; note: string }
  | { status: "invalid"; note: string };

const RawLead = z.record(z.string(), z.string().max(5000));
const RawLeads = z.array(RawLead).max(500, "At most 500 rows at a time");

/** One sheet row → upsertLead input. Returns an error string for rows that can't be used. */
export function leadRowToInput(r: RawLeadRow): { input: LeadInputT } | { error: string } {
  const name = r.name?.trim();
  if (!name) return { error: "Needs a name" };
  const input: LeadInputT = {
    name,
    city: r.city, category: r.category, website: r.website, instagramHandle: r.instagramHandle, tiktokHandle: r.tiktokHandle,
    googleMapsUrl: r.googleMapsUrl, googleRating: r.googleRating, googleReviewCount: r.googleReviewCount, replyRate: r.replyRate,
    instagramFollowers: r.instagramFollowers, lastPostAt: r.lastPostAt, opportunities: r.opportunities, score: r.score, why: r.why,
    stage: parseStage(r.stage), contactName: r.contactName, contactEmail: r.contactEmail, contactPhone: r.contactPhone,
    nextStepAt: r.nextStepAt, notes: r.notes, source: r.source,
  };
  const res = LeadInput.safeParse(input);
  if (!res.success) return { error: res.error.issues[0]?.message ?? "Some values couldn't be read" };
  return { input };
}

/** Read-only dry run: new vs update vs skipped for each row. */
export async function previewLeadImport(rows: RawLeadRow[]): Promise<LeadImportPreviewRow[]> {
  const parsed = RawLeads.parse(rows) as RawLeadRow[];
  const find = await leadIndex();
  const seen = new Map<string, number>();
  return parsed.map((r, i): LeadImportPreviewRow => {
    const res = leadRowToInput(r);
    if ("error" in res) return { status: "invalid", note: res.error };
    const keys = [websiteHost(r.website) && `w:${websiteHost(r.website)}`, normalizeHandle(r.instagramHandle) && `i:${normalizeHandle(r.instagramHandle)}`, `n:${nameCityKey(r.name, r.city)}`].filter(Boolean) as string[];
    const dupe = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
    if (dupe !== undefined) return { status: "skip", name: r.name!, note: `Same place as row ${dupe + 2}` };
    for (const k of keys) seen.set(k, i);
    const ex = find(r);
    return ex ? { status: "update", name: r.name!, existingName: ex.name } : { status: "new", name: r.name! };
  });
}

export type LeadImportResult = { created: number; updated: number; failed: Array<{ name: string; error: string }> };

/** Saves one chunk through upsertLead (same de-dupe and merge rules as adding by hand). */
export async function importLeads(rows: RawLeadRow[], actor: string): Promise<LeadImportResult> {
  const parsed = z.array(RawLead).min(1).max(50, "At most 50 rows per request").parse(rows) as RawLeadRow[];
  const out: LeadImportResult = { created: 0, updated: 0, failed: [] };
  for (const r of parsed) {
    const res = leadRowToInput(r);
    if ("error" in res) {
      out.failed.push({ name: r.name || "Row", error: res.error });
      continue;
    }
    try {
      const saved = await upsertLead({ ...res.input, source: res.input.source ?? "import" }, actor);
      if (saved.created) out.created++;
      else out.updated++;
    } catch (e) {
      out.failed.push({ name: r.name || "Row", error: e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid values") : e instanceof Error ? e.message : "Couldn't save" });
    }
  }
  return out;
}
