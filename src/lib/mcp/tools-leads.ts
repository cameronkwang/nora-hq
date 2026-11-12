import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb, schema } from "@/lib/db";
import { OpsError, createDraft } from "@/lib/ops";
import { findClientMatch, getLead, leadDrafts, listLeads, updateLead, upsertLead } from "@/lib/ops-leads";
import { CLAUDE_STAGES, NO_CONTACT_STAGES, leadSignals } from "@/app/(app)/leads/shared";

/**
 * Leads tools for the Nora HQ connector: Claude researches and triages potential new clients and drafts
 * pitches. Every write goes through lib/ops(-leads) with actor "claude". Claude can't contact, close or
 * convert a lead — a person approves and sends every pitch from the review queue.
 */

const ACTOR = "claude";

/** Extends OpsError so the shared tool runner in tools.ts also reports it as a plain message. */
class ToolError extends OpsError {}

function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof ToolError || e instanceof OpsError) return e.message;
  console.error("[mcp] leads tool error", e);
  return `Something went wrong in Nora HQ: ${e instanceof Error ? e.message : String(e)}`;
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: compactJson(await fn()) }] };
  } catch (e) {
    return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function shapeLead(l: schema.Lead) {
  const s = leadSignals(l);
  return {
    id: l.id,
    name: l.name,
    city: l.city,
    category: l.category,
    stage: l.stage,
    opportunities: l.opportunities,
    score: l.score,
    signals: [s.google, s.social].filter(Boolean).join(" | ") || undefined,
    why: l.why,
    website: l.website,
    instagramHandle: l.instagramHandle,
    tiktokHandle: l.tiktokHandle,
    googleMapsUrl: l.googleMapsUrl,
    googleRating: l.googleRating,
    googleReviewCount: l.googleReviewCount,
    replyRate: l.replyRate,
    instagramFollowers: l.instagramFollowers,
    lastPostAt: l.lastPostAt?.toISOString().slice(0, 10),
    contactName: l.contactName,
    contactEmail: l.contactEmail,
    contactPhone: l.contactPhone,
    nextStepAt: l.nextStepAt,
    notes: l.notes,
    source: l.source,
    convertedClientId: l.convertedClientId,
    updatedAt: l.updatedAt.toISOString(),
  };
}

/* ───────────── shared field schemas (descriptions are Claude's instructions) ───────────── */

const facts = {
  city: z.string().max(120).optional().describe("City or neighborhood, e.g. \"Richmond, VA\"."),
  category: z.string().max(120).optional().describe("Type of place / cuisine, e.g. \"Korean BBQ\", \"bakery\", \"coffee shop\"."),
  website: z.string().max(500).optional().describe("Official website URL."),
  instagram_handle: z.string().max(200).optional().describe("Instagram handle or profile URL."),
  tiktok_handle: z.string().max(200).optional().describe("TikTok handle or profile URL."),
  google_maps_url: z.string().max(1000).optional().describe("Google Maps link for the place."),
  google_rating: z.union([z.number(), z.string()]).optional().describe("Google star rating 0–5, e.g. 4.3."),
  google_review_count: z.union([z.number(), z.string()]).optional().describe("Total Google reviews, e.g. 312 or \"1.2k\"."),
  reply_rate: z.union([z.number(), z.string()]).optional().describe("Estimated % (0–100) of their ~20 most recent Google reviews that have an owner reply."),
  instagram_followers: z.union([z.number(), z.string()]).optional().describe("Instagram follower count, e.g. 2100 or \"2.1k\"."),
  last_post_at: z.string().optional().describe("Date of their most recent Instagram post, YYYY-MM-DD."),
  opportunities: z.array(z.enum(schema.LEAD_OPPORTUNITIES)).optional()
    .describe("What we could do for them: google (review management — many reviews, few owner replies, slipping rating), social (quiet/weak Instagram/TikTok), collab (good fit for a creator feature by Nora)."),
  score: z.union([z.number(), z.string()]).optional().describe("Fit 0–100: how big the gap is × how likely they'd pay (independent, busy, not a big chain)."),
  why: z.string().max(2000).optional().describe("1–3 plain sentences: the specific gap and the pitch angle, citing the facts (e.g. \"312 reviews, owner replied to ~5% of recent ones; 3 unanswered 1-star reviews this month.\")."),
  contact_name: z.string().max(200).optional().describe("Owner/manager name ONLY if publicly listed for business contact."),
  contact_email: z.string().max(200).optional().describe("Publicly listed BUSINESS email (website, Google profile, IG bio). Never personal emails, never guessed patterns."),
  contact_phone: z.string().max(60).optional().describe("Publicly listed business phone."),
  notes: z.string().max(5000).optional().describe("Anything else worth knowing, plus where you found the facts."),
};

function factInput(a: Record<string, unknown>) {
  return {
    city: a.city as string | undefined,
    category: a.category as string | undefined,
    website: a.website as string | undefined,
    instagramHandle: a.instagram_handle as string | undefined,
    tiktokHandle: a.tiktok_handle as string | undefined,
    googleMapsUrl: a.google_maps_url as string | undefined,
    googleRating: a.google_rating,
    googleReviewCount: a.google_review_count,
    replyRate: a.reply_rate,
    instagramFollowers: a.instagram_followers,
    lastPostAt: a.last_post_at,
    opportunities: a.opportunities as schema.LeadOpportunity[] | undefined,
    score: a.score,
    why: a.why as string | undefined,
    contactName: a.contact_name as string | undefined,
    contactEmail: a.contact_email as string | undefined,
    contactPhone: a.contact_phone as string | undefined,
    notes: a.notes as string | undefined,
  };
}

/** Drop keys that weren't passed so update_lead never clears a field by accident. */
const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ───────────── pitch checks ───────────── */

const GUARANTEE = /\b(guarantee[ds]?|guaranteed|100%|double your|triple your|skyrocket|go viral)\b/i;
const OPT_OUT = /(not (a fit|interested|for you)|no worries|reply ['"‘’“”]?stop|won'?t (follow up|reach out|message|email) again|ignore this)/i;

export function checkPitch(kind: "lead_email" | "lead_dm", body: string, warnings: string[]) {
  const words = body.trim().split(/\s+/).length;
  const max = kind === "lead_dm" ? 120 : 220;
  if (words > max * 1.5) throw new ToolError(`Pitch is ${words} words — keep ${kind === "lead_dm" ? "a DM under ~80" : "an email under ~150"} words. Shorten it.`);
  if (words > max) warnings.push(`Pitch is ${words} words; shorter pitches get more replies.`);
  if (GUARANTEE.test(body)) throw new ToolError("Don't promise results (guarantees, \"go viral\", \"double your…\"). Rewrite without them.");
  if (/\b(fake|buy|purchase)\b[^.!?\n]{0,30}\breviews?\b/i.test(body)) throw new ToolError("Never mention buying or generating reviews.");
  if (!OPT_OUT.test(body)) warnings.push("No easy opt-out line found — add something like \"If it's not for you, no worries — just say so and I won't follow up.\"");
}

/* ───────────── registration ───────────── */

export function registerLeadTools(server: McpServer) {
  server.registerTool("list_leads", {
    title: "List leads",
    description:
      "Potential new clients (restaurants / food businesses) for Google review management, social media management, or a creator collab with Nora. " +
      "Sorted by fit score. Use before researching (to avoid repeats) and when an ask mentions leads. stage \"open\" = found through proposal.",
    inputSchema: {
      stage: z.union([z.enum(schema.LEAD_STAGES), z.literal("open")]).optional(),
      opportunity: z.enum(schema.LEAD_OPPORTUNITIES).optional(),
      city: z.string().max(120).optional().describe("Partial, case-insensitive match."),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: READ,
  }, async (a) => run(async () => {
    const rows = await listLeads({ stage: a.stage, opportunity: a.opportunity, city: a.city, limit: a.limit });
    return { count: rows.length, leads: rows.map(shapeLead) };
  }));

  server.registerTool("get_lead", {
    title: "Get a lead",
    description: "One lead with all facts and its pitch drafts (status, review notes). Read this before drafting a pitch.",
    inputSchema: { lead_id: z.string() },
    annotations: READ,
  }, async ({ lead_id }) => run(async () => {
    const lead = await getLead(lead_id);
    if (!lead) throw new ToolError(`No lead with id "${lead_id}". Use list_leads.`);
    const drafts = await leadDrafts(lead.id);
    return {
      lead: shapeLead(lead),
      drafts: drafts.map((d) => ({ id: d.id, kind: d.kind, status: d.status, title: d.title, reviewNote: d.reviewNote, createdAt: d.createdAt.toISOString(), sentAt: d.sentAt?.toISOString() })),
    };
  }));

  server.registerTool("add_lead", {
    title: "Add (or update) a lead",
    description:
      "Saves a potential client you researched. De-duplication is automatic (same website, Instagram handle, or name + city updates the existing lead and only fills in what you pass). " +
      "Research each place with web search first:\n" +
      "• Google: star rating, total review count, and how many of the ~20 most recent reviews have an owner reply → reply_rate %.\n" +
      "• Instagram: follower count and the date of the latest post (TikTok handle if any).\n" +
      "• Website and a PUBLICLY LISTED business email / phone (website, Google profile, IG bio). Only business contact info — never personal emails or guessed addresses.\n" +
      "• Set opportunities, a 0–100 score and a 1–3 sentence `why` (the specific gap → pitch angle).\n" +
      "NEVER invent or estimate numbers you didn't see — leave unknown fields out. Note your sources in notes. " +
      "Skip businesses we already manage (the result warns you) and big chains with in-house marketing. stage: found (default) or qualified (strong fit, has a way to contact them).",
    inputSchema: {
      name: z.string().min(1).max(200).describe("Business name as on Google."),
      ...facts,
      stage: z.enum(CLAUDE_STAGES).optional(),
      next_step_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, only if there's a real reason (e.g. reopening date)."),
      ask_id: z.string().optional().describe("The ask this research is for (just for your own tracking; reply on the ask when done)."),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    const warnings: string[] = [];
    const client = await findClientMatch({ name: a.name, city: a.city, instagramHandle: a.instagram_handle, website: a.website });
    if (client) warnings.push(`This looks like ${client.name}${client.location ? ` (${client.location})` : ""}, a business we already manage (id ${client.id}). Don't pitch them as a new lead.`);
    if (!a.opportunities?.length) warnings.push("No opportunities set — add google / social / collab so it shows up in the right filter.");
    if (!a.why) warnings.push("No `why` — add 1–3 sentences on the gap so Nora can decide in seconds.");
    if (a.contact_email && /@(gmail|yahoo|hotmail|outlook|icloud|aol)\./i.test(a.contact_email))
      warnings.push("That's a personal-provider address — only save it if the business lists it publicly as their contact.");
    const res = await upsertLead({ name: a.name, ...factInput(a), stage: a.stage, nextStepAt: a.next_step_at, source: "claude research" }, ACTOR);
    return { ok: true, leadId: res.id, created: res.created, merged: !res.created, stage: res.stage, warnings: warnings.length ? warnings : undefined };
  }));

  server.registerTool("update_lead", {
    title: "Update a lead",
    description:
      "Edits a lead's facts, score, why, notes, opportunities, or stage. You may only set stage found, qualified or not_a_fit (and only while the lead is at one of those): " +
      "\"contacted\" happens automatically when a person marks your pitch as sent, and talking / proposal / won / lost are Cameron's and Nora's calls. " +
      "If a business says they're not interested, tell Nora on the ask — she sets it to Lost. Fields you leave out are unchanged; pass an empty string to clear a text field.",
    inputSchema: {
      lead_id: z.string(),
      name: z.string().min(1).max(200).optional(),
      ...facts,
      stage: z.enum(CLAUDE_STAGES).optional(),
      next_step_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("YYYY-MM-DD, or null to clear."),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    const lead = await getLead(a.lead_id);
    if (!lead) throw new ToolError(`No lead with id "${a.lead_id}". Use list_leads.`);
    const patch = defined({ name: a.name, ...factInput(a), stage: a.stage, nextStepAt: a.next_step_at });
    if (Object.keys(patch).length === 0) throw new ToolError("Nothing to change — pass at least one field.");
    const row = await updateLead(a.lead_id, patch, ACTOR);
    return { ok: true, lead: shapeLead(row) };
  }));

  server.registerTool("draft_lead_pitch", {
    title: "Draft a pitch to a lead",
    description:
      "Creates a pitch (from Nora) for a person to review and send — nothing is sent by this call. channel email → kind lead_email (needs subject; goes to the lead's saved public business email, " +
      "sent through the outreach Gmail with the CAN-SPAM footer added automatically). instagram_dm / tiktok_dm → kind lead_dm (a person copies it and sends it from the app). " +
      "Rules: short (DM < ~80 words, email < ~150), friendly and personal, written as Nora (a local food creator who helps restaurants with Google reviews, social and creator content). " +
      "Lead with their specific gap from the lead's facts (e.g. unanswered reviews, a quiet Instagram) and one concrete idea; one simple call to action (a quick chat). " +
      "No guarantees, no made-up numbers or results, no fake familiarity, never mention buying reviews. End with an easy opt-out (\"If it's not for you, no worries — just say so and I won't follow up.\"). " +
      "Read get_lead first; if a pitch is pending or was sent back, revise that one (revise_draft) instead. Pitches to leads marked lost or not_a_fit are refused.",
    inputSchema: {
      lead_id: z.string(),
      channel: z.enum(["email", "instagram_dm", "tiktok_dm"]),
      title: z.string().min(1).max(200).optional().describe("Label in the review queue; defaults to \"Pitch: <name>\"."),
      subject: z.string().min(1).max(200).optional().describe("Email subject (email only). Specific and plain, no clickbait."),
      body: z.string().min(1).max(5000).describe("The exact message."),
      ask_id: z.string().optional().describe("The ask this pitch answers."),
    },
    annotations: WRITE,
  }, async (a) => run(() => draftLeadPitch(a)));
}

export type LeadPitchArgs = { lead_id: string; channel: "email" | "instagram_dm" | "tiktok_dm"; title?: string; subject?: string; body: string; ask_id?: string };

/** Shared by draft_lead_pitch and create_draft (kind lead_email / lead_dm). */
export async function draftLeadPitch(a: LeadPitchArgs) {
  const lead = await getLead(a.lead_id);
  if (!lead) throw new ToolError(`No lead with id "${a.lead_id}". Use list_leads.`);
  if (NO_CONTACT_STAGES.includes(lead.stage)) throw new ToolError(`${lead.name} is marked ${lead.stage.replace(/_/g, " ")} — don't pitch them.`);
  if (lead.convertedClientId || lead.stage === "won") throw new ToolError(`${lead.name} is already a client — no pitch needed.`);
  const pending = (await leadDrafts(lead.id)).find((d) => ["needs_review", "rejected", "approved"].includes(d.status));
  if (pending) throw new ToolError(`${lead.name} already has a pitch that is ${pending.status.replace(/_/g, " ")} (draft ${pending.id}). Revise that one with revise_draft instead.`);
  if (a.ask_id) {
    const db = await getDb();
    const [ask] = await db.select({ id: schema.asks.id }).from(schema.asks).where(eq(schema.asks.id, a.ask_id));
    if (!ask) throw new ToolError(`No ask with id "${a.ask_id}".`);
  }
  const warnings: string[] = [];
  const kind = a.channel === "email" ? "lead_email" : "lead_dm";
  checkPitch(kind, a.body, warnings);
  const meta: Record<string, unknown> = { leadId: lead.id };
  if (kind === "lead_email") {
    if (!a.subject?.trim()) throw new ToolError("Email pitches need a subject.");
    if (!lead.contactEmail) throw new ToolError(`${lead.name} has no saved public email. Save their publicly listed business email with update_lead first, or pitch by DM.`);
    meta.subject = a.subject.trim();
  } else {
    const handle = a.channel === "instagram_dm" ? lead.instagramHandle : lead.tiktokHandle;
    if (!handle) throw new ToolError(`No ${a.channel === "instagram_dm" ? "Instagram" : "TikTok"} handle saved for ${lead.name}. Add it with update_lead first.`);
    meta.channel = a.channel;
  }
  if (lead.stage === "contacted") warnings.push("This lead was already contacted — make sure this reads as a light follow-up, not a first pitch.");
  const id = await createDraft({ clientId: lead.convertedClientId, kind, title: a.title ?? `Pitch: ${lead.name}`, body: a.body, meta, askId: a.ask_id }, ACTOR);
  return { ok: true, draftId: id, kind, status: "needs_review", warnings: warnings.length ? warnings : undefined };
}
