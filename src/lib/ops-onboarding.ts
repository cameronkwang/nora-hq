import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { currentMonth } from "./dates";
import { logActivity } from "./activity";
import { createClient, OpsError } from "./ops";
import { createRoutedAsk } from "./ops-asks";
import {
  ACCEPTED_SERVICES,
  SERVICE_LABELS,
  joinOutreachAreas,
  normalizeServices,
  planFor,
  type AnyService,
  type Service,
} from "./onboard-services";
import { FB_LINK, isGoogleListingUrl, type PublicInfo } from "./business-facts";

/**
 * Adding a business we manage ("land a client → set up in seconds"): creates the client, sets a monthly plan that
 * matches the services we sell them (or copies another business's), drops a short "Getting started" checklist
 * (tasks tagged "onboarding") on its page, and hands the research to Claude as one routed ask: look up the public
 * facts and save them (set_business_facts), get the onboarding form link ready for a person to send, then the
 * brand voice and first-month plan.
 * Same conventions as lib/ops: zod-validated input, `actor` is a user email or "claude".
 * Claude may set a business up only when a person asked it to (create_business, via ops-business.createBusiness,
 * which also refuses passwords and dedupes); it can't convert a lead (marking a lead Won is a person's call).
 */

export const ONBOARDING_TAG = "onboarding";

export { SERVICES, SERVICE_LABELS, DEFAULT_SERVICES, normalizeServices } from "./onboard-services";
export type { Service, AnyService } from "./onboard-services";

/** Most Getting started steps we ever add; extra steps get folded into others. */
export const MAX_ONBOARDING_STEPS = 7;

export const OnboardInput = z.object({
  name: z.string().trim().min(1, "Give the business a name.").max(200),
  location: z.string().max(200).nullish(),
  instagramHandle: z.string().max(200).nullish(),
  tiktokHandle: z.string().max(200).nullish(),
  website: z.string().max(500).nullish(),
  /** Current names (instagram, facebook, tiktok, google, creators, collab) or legacy "social" (→ Instagram + TikTok + creator outreach). */
  services: z.array(z.enum(ACCEPTED_SERVICES)).min(1, "Pick at least one service."),
  notes: z.string().max(5000).nullish(),
  leadId: z.string().nullish(),
  googleMapsUrl: z.string().max(1000).nullish(),
  copyPlanFrom: z.string().max(200).nullish(),
  /** Where to look for local creators, e.g. "Richmond, 757 / Hampton Roads". Saved to clients.outreachAreas. */
  outreachAreas: z.string().max(500).nullish(),
  /** Facebook Page link or name. Not a column: noted in the business notes. */
  facebookPage: z.string().max(500).nullish(),
});

type PlanItem = Pick<schema.Deliverable, "title" | "platform" | "targetPerMonth">;

type Step = { title: string; assignee: schema.Assignee; platform?: schema.Platform; details?: string };

const KICKOFF: Step = {
  title: "Kickoff call: goals, offers, signature dishes, what to avoid",
  assignee: "nora",
  details: "Jot notes as you go and drop them in Claude's onboarding ask — they sharpen the brand voice.",
};
const PHOTOS: Step = { title: "Collect logo, brand photos & videos", assignee: "nora" };
const APPROVE: Step = {
  title: "Approve brand voice & first-month plan",
  assignee: "nora",
  details: "Claude is researching them and drafting both in Asks. Tweak, then save the voice on Settings & plan.",
};
const GOOGLE_MANAGER: Step = { title: "Owner adds Nora as Manager on the Google Business Profile", assignee: "nora", platform: "google" };
const GOOGLE_LINK: Step = { title: "Link Google location in Settings", assignee: "cameron", platform: "google", details: "Settings & plan → Google location, once Nora has Manager access." };

/** Instagram / TikTok access, worded for whichever of the two we run. */
function accessStep(ig: boolean, tt: boolean): Step | null {
  if (!ig && !tt) return null;
  const which = ig && tt ? "Instagram & TikTok" : ig ? "Instagram" : "TikTok";
  return {
    title: `Get ${which} access`,
    assignee: "cameron",
    platform: ig ? "instagram" : "tiktok",
    details: [
      ig ? "Owner adds us in Meta Business Suite" : null,
      tt ? (ig ? "and TikTok" : "Owner shares TikTok access") : null,
      "(or logins go in the password manager). Never paste passwords into Nora HQ.",
      ig ? "Make sure Instagram is a Business/Creator account." : null,
    ].filter(Boolean).join(" "),
  };
}

/**
 * Getting started, trimmed to what actually blocks the work (≤ 7 steps).
 * Research and the brand-voice draft are Claude's job — handed off as an ask, not a checklist item.
 * Order: kickoff → access → content → reviews → creators → collab → approve.
 * When more than 7 would apply: photos fold into the kickoff, then the two Google steps become one.
 */
export function onboardingSteps(services: readonly Service[]): Step[] {
  const has = (s: Service) => services.includes(s);
  let photosFolded = false;
  let googleMerged = false;
  const build = (): Step[] => {
    const steps: Array<Step | null> = [
      photosFolded ? { ...KICKOFF, title: KICKOFF.title, details: `${KICKOFF.details} Ask for their logo, brand photos & videos too.` } : KICKOFF,
      accessStep(has("instagram"), has("tiktok")),
      has("facebook")
        ? {
            title: "Get Facebook Page access (owner adds Nora in Meta Business Suite)",
            assignee: "cameron",
            platform: "facebook",
            details: "The onboarding form walks the owner through adding Nora as a person in Meta Business Suite (Settings → Users/People → Invite). If they get stuck, do it together on the kickoff call. Save the Page link in the business notes.",
          }
        : null,
      !photosFolded && (has("instagram") || has("facebook") || has("tiktok")) ? PHOTOS : null,
      ...(has("google")
        ? googleMerged
          ? [{ ...GOOGLE_MANAGER, title: "Get Google Business Profile access & link it in Settings", details: "Owner adds Nora as Manager, then link the location in Settings & plan → Google location." }]
          : [GOOGLE_MANAGER, GOOGLE_LINK]
        : []),
      has("creators")
        ? { title: "Confirm what creators can be offered (meal, budget) and visit times", assignee: "nora", details: "Free meal? Paid? How many guests? Best days and times to visit, and anything off-limits." }
        : null,
      has("collab") ? { title: "Agree collab terms (gifted/paid, deliverables, dates) & schedule the visit", assignee: "nora", details: "Include the FTC disclosure (#ad / paid partnership)." } : null,
      APPROVE,
    ];
    return steps.filter((x): x is Step => !!x);
  };
  let steps = build();
  if (steps.length > MAX_ONBOARDING_STEPS && steps.includes(PHOTOS)) {
    photosFolded = true;
    steps = build();
  }
  if (steps.length > MAX_ONBOARDING_STEPS && has("google")) {
    googleMerged = true;
    steps = build();
  }
  return steps;
}

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const isPerson = (actor: string) => {
  const a = actor.trim().toLowerCase();
  return !!a && a !== "claude" && a !== "system" && a !== "public";
};
const isClaude = (actor: string) => actor.trim().toLowerCase() === "claude";

/**
 * People (or Claude, when a person asked it to): add a business we now manage. In one call:
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
    /** instagram | facebook | tiktok | google | creators | collab — or legacy "social" (= Instagram + TikTok + creator outreach). */
    services: AnyService[];
    notes?: string | null;
    leadId?: string | null;
    googleMapsUrl?: string | null;
    copyPlanFrom?: string | null;
    outreachAreas?: string | null;
    facebookPage?: string | null;
  },
  actor: string,
): Promise<string> {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError("Only Nora, Cameron or Claude (when asked) can add a business we manage");
  const v = OnboardInput.parse(input);
  if (isClaude(actor) && v.leadId) throw new OpsError("Turning a lead into a client marks it Won — that's for Nora or Cameron. Create the business without lead_id, or ask them to use Convert on the lead.");
  const services = normalizeServices(v.services);
  if (services.length === 0) throw new OpsError("Pick at least one service.");
  const outreachAreas = joinOutreachAreas(v.outreachAreas);
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
  const fbPage = blank(v.facebookPage);
  const notes = [blank(v.notes), ...leadNotes, mapsUrl ? `Google Maps: ${mapsUrl}` : null, fbPage ? `Facebook Page: ${fbPage}` : null].filter(Boolean).join("\n\n") || null;

  const clientId = await createClient(
    { name: v.name, location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website, notes },
    actor,
  );

  if (outreachAreas) await db.update(schema.clients).set({ outreachAreas }).where(eq(schema.clients.id, clientId));
  // Public facts we already hold (typed on the New client form, or on the lead's page): one less thing for Claude
  // to look up, and for the owner to confirm.
  const known: PublicInfo = {};
  if (fbPage && fbPage.length <= 300 && FB_LINK.test(fbPage)) known.facebook = fbPage;
  const listing = mapsUrl ?? blank(lead?.googleMapsUrl);
  if (listing && listing.length <= 600 && isGoogleListingUrl(listing)) known.googleListing = listing;
  const sells = blank(lead?.category)?.replace(/\s+/g, " ");
  if (sells && sells.length <= 300) known.sells = sells;
  if (Object.keys(known).length) await db.update(schema.clients).set({ publicInfo: known }).where(eq(schema.clients.id, clientId));
  await setPlan(clientId, copied ?? planFor(services));
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

  await handOffToClaude(clientId, { name: v.name.trim(), location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website, mapsUrl, facebookPage: fbPage, outreachAreas, services, lead }, actor);
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
  facebookPage?: string | null;
  outreachAreas?: string | null;
  services: readonly Service[];
  lead?: Pick<schema.Lead, "why"> | null;
}): string {
  const at = (h: string | null | undefined) => (h ? `@${h.replace(/^@/, "")}` : null);
  const known = [
    c.location ? `- City: ${c.location}` : null,
    c.website ? `- Website: ${c.website}` : null,
    at(c.instagramHandle) ? `- Instagram: ${at(c.instagramHandle)}` : null,
    at(c.tiktokHandle) ? `- TikTok: ${at(c.tiktokHandle)}` : null,
    c.facebookPage ? `- Facebook Page: ${c.facebookPage}` : null,
    c.mapsUrl ? `- Google Maps: ${c.mapsUrl}` : null,
    c.lead?.why ? `- Why we pitched them: ${c.lead.why}` : null,
  ].filter(Boolean);
  return [
    `New client ${c.name}: look up their public facts and save them, get the onboarding form ready for a person to send, then draft a brand voice for their settings, suggest a first-month content plan, and list anything we need from the owner.`,
    "",
    `We're doing: ${c.services.map((s) => SERVICE_LABELS[s]).join(", ")}.`,
    ...(known.length ? ["", "What we know so far:", ...known] : ["", "We only have the name — find their website and socials first."]),
    "",
    "Do these two first. The owner is busy: the onboarding form shows them what we found and only asks them to confirm it.",
    "A. Public facts — find their address, phone, opening hours, website, Instagram, TikTok, Facebook Page, Google listing link, what they sell and price range (Google Maps, their own website, their social profiles). Save each one with set_business_facts: the value plus the web address you found it at. Mark what you can't find as not_found. Never guess.",
    "B. Onboarding form — then call send_onboarding_form and paste the link and the ready-to-text messages into your reply here, for Nora or Cameron to text the owner. You never send it yourself.",
    "",
    "Then reply on this ask with:",
    "1. Snapshot — Google rating & review count (and how many recent reviews have owner replies), follower counts, last post date. Leave anything you can't verify blank; never guess numbers.",
    "2. Brand voice — a short draft for their Settings page (tone, words to use/avoid, signature dishes).",
    "3. First-month plan — content ideas that fit the monthly plan on their page.",
    "4. What we need from the owner — access, photos, offers, anything missing. (Never passwords.)",
    ...(c.services.includes("creators")
      ? [`5. Local creators — a shortlist of food creators near ${c.outreachAreas || c.location || "the business"} who'd fit (handle, follower count, why). Search those areas only; draft nothing until we confirm what we can offer them.`]
      : []),
    "Research public info only — don't contact the business.",
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
  const steps = onboardingSteps(services);
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

export const OutreachAreasInput = z.object({
  clientId: z.string().min(1),
  /** Chip picks and/or free text; joined into one comma-separated string. Empty clears it. */
  areas: z.union([z.string().max(1000), z.array(z.string().max(200)).max(20)]).nullish(),
});

/**
 * Where Claude/Nora should look for local creators for this business ("Richmond, 757 / Hampton Roads").
 * People and Claude may both set it (it's a search hint, not an outbound action). Returns the saved value.
 */
export async function setOutreachAreas(input: z.input<typeof OutreachAreasInput>, actor: string): Promise<string | null> {
  const v = OutreachAreasInput.parse(input);
  const value = joinOutreachAreas(v.areas ?? null);
  const db = await getDb();
  const [cur] = await db.select({ id: schema.clients.id, outreachAreas: schema.clients.outreachAreas }).from(schema.clients).where(eq(schema.clients.id, v.clientId));
  if (!cur) throw new OpsError("client not found");
  if ((cur.outreachAreas ?? null) === value) return value;
  await db.update(schema.clients).set({ outreachAreas: value }).where(eq(schema.clients.id, v.clientId));
  await logActivity({
    actor,
    action: "client.updated",
    entityType: "client",
    entityId: v.clientId,
    clientId: v.clientId,
    summary: value ? `Creator search areas: ${value}` : "Cleared creator search areas",
  });
  return value;
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
