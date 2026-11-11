import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { currentMonth } from "./dates";
import { logActivity } from "./activity";
import { createClient, OpsError } from "./ops";

/**
 * Adding a business we manage: creates the client, sets a monthly plan that matches the services we sell them,
 * and drops a short "Getting started" checklist (tasks tagged "onboarding") on its page.
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

const STEPS: { always: Step[] } & Record<Service, Step[]> = {
  always: [
    {
      title: "Kickoff call: goals, offers, signature dishes, what to avoid",
      assignee: "nora",
      details: "Jot notes as you go — they feed the brand voice step.",
    },
    {
      title: "Write brand voice (Claude drafts from kickoff notes — paste notes into an ask)",
      assignee: "claude",
      details: "Paste the kickoff notes into a new ask for this business. Claude drafts the brand voice; check it on the business's Settings page.",
    },
    {
      title: "Set this business's monthly plan",
      assignee: "nora",
      details: "A starting plan is already filled in from the services you picked. Adjust the numbers on Settings & plan if needed.",
    },
  ],
  social: [
    {
      title: "Get Instagram access (owner adds you in Meta Business Suite, or store login in password manager — not in Nora HQ)",
      assignee: "cameron",
      platform: "instagram",
      details: "Never paste passwords into Nora HQ.",
    },
    { title: "Confirm Instagram is a Business/Creator account", assignee: "cameron", platform: "instagram" },
    { title: "Get TikTok access", assignee: "cameron", platform: "tiktok" },
    { title: "Collect brand photos/videos & logo", assignee: "nora" },
  ],
  google: [
    { title: "Owner adds Nora as Manager on the Google Business Profile", assignee: "nora", platform: "google" },
    { title: "Link Google location in Settings", assignee: "cameron", platform: "google", details: "Settings & plan → Google location, once Nora has Manager access." },
  ],
  collab: [
    { title: "Agree collab terms (gifted/paid, deliverables, dates) & FTC disclosure", assignee: "nora" },
    { title: "Schedule visit / shoot", assignee: "nora" },
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
 * People only: add a business we now manage. Creates it (createClient), replaces the default monthly plan with
 * one matching `services`, and adds the Getting started checklist. Returns the new business id.
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
  },
  actor: string,
): Promise<string> {
  if (!isPerson(actor)) throw new OpsError("Only a person can add a business we manage");
  const v = OnboardInput.parse(input);
  const services = normalize(v.services);

  const clientId = await createClient(
    { name: v.name, location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website, notes: v.notes },
    actor,
  );

  await replacePlan(clientId, services);
  const added = await addOnboardingTasks(clientId, services, actor);

  const what = services.map((s) => SERVICE_LABELS[s].toLowerCase()).join(", ");
  await logActivity({
    actor,
    action: "client.onboarded",
    entityType: "client",
    entityId: clientId,
    clientId,
    summary: `Started managing ${v.name.trim()} (${what})${v.leadId ? " from a lead" : ""} · ${added} getting-started step${added === 1 ? "" : "s"}`,
  });
  return clientId;
}

/** Swaps createClient's default plan for the one matching the services. Only used right after creation. */
async function replacePlan(clientId: string, services: Service[]) {
  const db = await getDb();
  const items = services.flatMap((s) => PLAN[s]);
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
  const steps = [...STEPS.always, ...services.flatMap((s) => STEPS[s])];
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
