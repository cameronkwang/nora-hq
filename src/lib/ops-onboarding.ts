import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { currentMonth } from "./dates";
import { logActivity } from "./activity";
import { createClient, OpsError } from "./ops";
import { createRoutedAsk } from "./ops-asks";

/**
 * Adding a business we manage ("land a client → set up in seconds"): creates the client, sets a monthly plan that
 * matches the services we sell them (or copies another business's), drops a short "Getting started" checklist
 * (tasks tagged "onboarding") on its page, and hands the research to Claude as one routed ask.
 * Same conventions as lib/ops: zod-validated input, `actor` is a user email. People only — Claude never
 * decides who becomes a client.
 */

export const ONBOARDING_TAG = "onboarding";

export const SERVICES = ["social", "google", "collab"] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  social: "Social media",
  google: "Google reviews",
  collab: "Creator collab",
};

export const OnboardInput = z.object({
  name: z.string().trim().min(1, "Give the business a name.").max(200),
  location: z.string().max(200).nullish(),
  instagramHandle: z.string().max(200).nullish(),
  tiktokHandle: z.string().max(200).nullish(),
  website: z.string().max(500).nullish(),
  services: z.array(z.enum(SERVICES)).min(1, "Pick at least one service."),
  notes: z.string().max(5000).nullish(),
  leadId: z.string().nullish(),
  googleMapsUrl: z.string().max(1000).nullish(),
  copyPlanFrom: z.string().max(200).nullish(),
});

type PlanItem = Pick<schema.Deliverable, "title" | "platform" | "targetPerMonth">;

const PLAN: Record<Service, PlanItem[]> = {
  social: [
    { title: "Instagram feed posts / reels", platform: "instagram", targetPerMonth: 8 },
    { title: "Instagram stories", platform: "instagram", targetPerMonth: 12 },
    { title: "TikTok videos", platform: "tiktok", targetPerMonth: 4 },
    { title: "Creator outreach", platform: "other", targetPerMonth: 5 },
  ],
  google: [{ title: "Reply to Google reviews", platform: "google", targetPerMonth: 0 }],
  collab: [{ title: "Collab content with Nora", platform: "instagram", targetPerMonth: 1 }],
};

type Step = { title: string; assignee: schema.Assignee; platform?: schema.Platform; details?: string };

/**
 * Getting started, trimmed to what actually blocks the work (6 steps for social + Google reviews).
 * Research and the brand-voice draft are Claude's job — handed off as an ask, not a checklist item.
 * Order: first → service steps → last.
 */
const STEPS: { first: Step[]; last: Step[] } & Record<Service, Step[]> = {
  first: [
    {
      title: "Kickoff call: goals, offers, signature dishes, what to avoid",
      assignee: "nora",
      details: "Jot notes as you go and drop them in Claude's onboarding ask — they sharpen the brand voice.",
    },
  ],
  social: [
    {
      title: "Get Instagram & TikTok access",
      assignee: "cameron",
      platform: "instagram",
      details: "Owner adds us in Meta Business Suite (and TikTok), or logins go in the password manager. Never paste passwords into Nora HQ. Make sure Instagram is a Business/Creator account.",
    },
    { title: "Collect logo, brand photos & videos", assignee: "nora" },
  ],
  google: [
    { title: "Owner adds Nora as Manager on the Google Business Profile", assignee: "nora", platform: "google" },
    { title: "Link Google location in Settings", assignee: "cameron", platform: "google", details: "Settings & plan → Google location, once Nora has Manager access." },
  ],
  collab: [
    { title: "Agree collab terms (gifted/paid, deliverables, dates) & FTC disclosure", assignee: "nora" },
    { title: "Schedule visit / shoot", assignee: "nora" },
  ],
  last: [
    {
      title: "Approve brand voice & first-month plan",
      assignee: "nora",
      details: "Claude is researching them and drafting both in Asks. Tweak, then save the voice on Settings & plan.",
    },
  ],
};

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const isPerson = (actor: string) => {
  const a = actor.trim().toLowerCase();
  return !!a && a !== "claude" && a !== "system";
};

/** Services in a stable order, without duplicates. */
function normalize(services: readonly Service[]): Service[] {
  return SERVICES.filter((s) => services.includes(s));
}

/**
 * People only: add a business we now manage. In one call:
 *  - creates it (createClient) with the monthly plan for `services` — or a copy of another business's plan (`copyPlanFrom`);
 *  - adds the short Getting started checklist;
 *  - hands research to Claude: one ask routed to Claude (brand voice, first-month plan, what we need from the owner);
 *  - with `leadId`: marks the lead Won and links it. If that lead was already turned into a business, returns that one.
 * Returns the business id. Backward compatible with the original (name, services, …, leadId) input.
 */
export async function onboardClient(
  input: {
    name: string;
    location?: string | null;
    instagramHandle?: string | null;
    tiktokHandle?: string | null;
    website?: string | null;
    services: Array<"google" | "social" | "collab">;
    notes?: string | null;
    leadId?: string | null;
    googleMapsUrl?: string | null;
    copyPlanFrom?: string | null;
  },
  actor: string,
): Promise<string> {
  if (!isPerson(actor)) throw new OpsError("Only a person can add a business we manage");
  const v = OnboardInput.parse(input);
  const services = normalize(v.services);
  const db = await getDb();

  let lead: schema.Lead | null = null;
  if (v.leadId) {
    [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, v.leadId));
    if (!lead) throw new OpsError("lead not found");
    if (lead.convertedClientId) {
      const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, lead.convertedClientId));
      if (c) return c.id; // already set up (double tap, or converted elsewhere)
    }
  }

  let copied: PlanItem[] | null = null;
  let copiedFrom: string | null = null;
  if (v.copyPlanFrom) {
    const [src] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, v.copyPlanFrom));
    if (!src) throw new OpsError("The business to copy the plan from wasn't found");
    const items = await db.select().from(schema.deliverables)
      .where(and(eq(schema.deliverables.clientId, src.id), eq(schema.deliverables.active, true)))
      .orderBy(asc(schema.deliverables.sortOrder));
    if (items.length) {
      copied = items.map(({ title, platform, targetPerMonth }) => ({ title, platform, targetPerMonth }));
      copiedFrom = src.name;
    }
  }

  const mapsUrl = blank(v.googleMapsUrl);
  // From a lead with no notes of its own: carry over the pitch angle and the lead's notes (convertLead passes these itself).
  const leadNotes = lead && !blank(v.notes) ? [lead.why ? `Why we pitched them: ${lead.why}` : null, blank(lead.notes)] : [];
  const notes = [blank(v.notes), ...leadNotes, mapsUrl ? `Google Maps: ${mapsUrl}` : null].filter(Boolean).join("\n\n") || null;

  const clientId = await createClient(
    { name: v.name, location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website, notes },
    actor,
  );

  await setPlan(clientId, copied ?? services.flatMap((s) => PLAN[s]));
  const added = await addOnboardingTasks(clientId, services, actor);

  const what = services.map((s) => SERVICE_LABELS[s].toLowerCase()).join(", ");
  await logActivity({
    actor,
    action: "client.onboarded",
    entityType: "client",
    entityId: clientId,
    clientId,
    summary: `Started managing ${v.name.trim()} (${what})${lead ? " from a lead" : ""}${copiedFrom ? ` · plan copied from ${copiedFrom}` : ""} · ${added} getting-started step${added === 1 ? "" : "s"}`,
  });

  if (lead) {
    await db.update(schema.leads).set({ stage: "won", convertedClientId: clientId, updatedAt: new Date() }).where(eq(schema.leads.id, lead.id));
    await logActivity({ actor, action: "lead.converted", entityType: "lead", entityId: lead.id, clientId, summary: `Won: ${lead.name} is now a business we manage` });
  }

  await handOffToClaude(clientId, { name: v.name.trim(), location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website, mapsUrl, services, lead }, actor);
  return clientId;
}

/** The research brief Claude gets for every new client — so Nora doesn't have to do it. */
export function onboardingBrief(c: {
  name: string;
  location?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  website?: string | null;
  mapsUrl?: string | null;
  services: readonly Service[];
  lead?: Pick<schema.Lead, "why"> | null;
}): string {
  const at = (h: string | null | undefined) => (h ? `@${h.replace(/^@/, "")}` : null);
  const known = [
    c.location ? `- City: ${c.location}` : null,
    c.website ? `- Website: ${c.website}` : null,
    at(c.instagramHandle) ? `- Instagram: ${at(c.instagramHandle)}` : null,
    at(c.tiktokHandle) ? `- TikTok: ${at(c.tiktokHandle)}` : null,
    c.mapsUrl ? `- Google Maps: ${c.mapsUrl}` : null,
    c.lead?.why ? `- Why we pitched them: ${c.lead.why}` : null,
  ].filter(Boolean);
  return [
    `New client ${c.name}: research their public presence (website, Google rating/reviews, Instagram/TikTok), draft a brand voice for their settings, suggest a first-month content plan, and list anything we need from the owner.`,
    "",
    `We're doing: ${c.services.map((s) => SERVICE_LABELS[s]).join(", ")}.`,
    ...(known.length ? ["", "What we know so far:", ...known] : ["", "We only have the name — find their website and socials first."]),
    "",
    "Reply on this ask with:",
    "1. Snapshot — Google rating & review count (and how many recent reviews have owner replies), follower counts, last post date. Leave anything you can't verify blank; never guess numbers.",
    "2. Brand voice — a short draft for their Settings page (tone, words to use/avoid, signature dishes).",
    "3. First-month plan — content ideas that fit the monthly plan on their page.",
    "4. What we need from the owner — logins/access, photos, offers, anything missing.",
    "If you find handles or a website we don't have, list them in your reply. Research public info only — don't contact the business.",
  ].join("\n");
}

async function handOffToClaude(clientId: string, c: Parameters<typeof onboardingBrief>[0], actor: string) {
  await createRoutedAsk({ clientId, body: onboardingBrief(c) }, { kind: "request", forWho: "claude" }, actor);
}

/** Swaps createClient's default plan for the given items. Only used right after creation. */
async function setPlan(clientId: string, items: PlanItem[]) {
  const db = await getDb();
  await db.delete(schema.deliverables).where(eq(schema.deliverables.clientId, clientId));
  if (items.length) {
    await db.insert(schema.deliverables).values(items.map((x, i) => ({ id: newId("dlv_"), clientId, sortOrder: i, ...x })));
  }
}

/**
 * Adds the Getting started steps that fit the services. Skips steps the business already has
 * (same tag + title), so calling it twice never duplicates. Returns how many were added.
 */
async function addOnboardingTasks(clientId: string, services: Service[], actor: string) {
  const db = await getDb();
  const steps = [...STEPS.first, ...services.flatMap((s) => STEPS[s]), ...STEPS.last];
  const existing = await db.select({ title: schema.tasks.title }).from(schema.tasks)
    .where(and(eq(schema.tasks.clientId, clientId), eq(schema.tasks.tag, ONBOARDING_TAG)));
  const have = new Set(existing.map((t) => t.title));
  const month = currentMonth();
  const base = Date.now();
  const rows = steps
    .filter((s) => !have.has(s.title))
    .map((s, i) => ({
      id: newId("tsk_"),
      clientId,
      title: s.title,
      details: blank(s.details),
      platform: s.platform ?? null,
      assignee: s.assignee,
      month,
      tag: ONBOARDING_TAG,
      createdBy: actor,
      createdAt: new Date(base + i), // keeps checklist order (one insert shares now())
    }));
  if (rows.length) await db.insert(schema.tasks).values(rows);
  return rows.length;
}

/** All Getting started steps for a business (done and open), in checklist order. */
export async function getOnboardingTasks(clientId: string) {
  const db = await getDb();
  return db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.clientId, clientId), eq(schema.tasks.tag, ONBOARDING_TAG)))
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id));
}

/** Progress summary; `active` is false once every step is done (the card hides). */
export async function getOnboardingStatus(clientId: string) {
  const tasks = await getOnboardingTasks(clientId);
  const done = tasks.filter((t) => t.status === "done").length;
  return { tasks, done, total: tasks.length, active: tasks.length > 0 && done < tasks.length };
}
