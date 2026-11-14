import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { currentMonth, formatDate, today } from "./dates";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { LAUNCH_TAG, isDay, launchInfo, openingLine, type LaunchInfo } from "./launch";
import { PROFILE_COPY_LABEL, PROFILE_COPY_WHERE, checkProfileCopy, overLimitLine, profileCopySurface } from "./profile-copy";
import { PROFILE_COPY_LIMITS, PROFILE_COPY_SURFACES, type ProfileCopySurface } from "./schema";

/**
 * Launch kit for a business that isn't open yet ("Pre-launch" in its Settings, with an opening day).
 *
 * - setLaunch (people only): switches Pre-launch on/off and saves the opening day. Switching it on adds the short
 *   launch checklist (tasks tagged "launch": verify the Google profile, bios, Google description, 3 coming-soon
 *   posts, opening-day creator shortlist) and clears this month's untouched monthly-plan slots, which come back when
 *   the checklist is created on or after opening day.
 * - planHold: generateMonthTasks (lib/ops) asks this first — no monthly-plan tasks are created until opening day.
 * - launchBrief: what Claude's briefing says about pre-launch businesses (days to opening + open launch steps).
 * - assertProfileCopy: validation for drafts of kind "profile_copy" (a bio / Google description, with the
 *   platform's own length limit). Used by createDraft / reviseDraft / approveDraft.
 *
 * Same conventions as lib/ops: zod-validated input, `actor` is a user email or "claude", one activity entry per call.
 */

const NON_PEOPLE = new Set(["claude", "public", "system"]);
const isPerson = (actor: string) => !!actor.trim() && !NON_PEOPLE.has(actor.trim().toLowerCase());

/* ───────────────────────── Launch checklist ───────────────────────── */

type Step = { title: string; assignee: schema.Assignee; platform: schema.Platform; details: string };

const limit = (s: ProfileCopySurface) => PROFILE_COPY_LIMITS[s];

/**
 * The launch checklist, trimmed to the platforms on the business's monthly plan (everything when it has no plan yet).
 * Each profile text is its own step, so approving and pasting that draft ticks exactly that step.
 */
export function launchSteps(platforms: ReadonlySet<schema.Platform>): Step[] {
  const has = (p: schema.Platform) => platforms.size === 0 || platforms.has(p);
  const postPlatform: schema.Platform = has("instagram") ? "instagram" : has("tiktok") ? "tiktok" : has("facebook") ? "facebook" : "other";
  const steps: Array<Step | null> = [
    {
      title: "Verify the Google Business Profile",
      assignee: "nora",
      platform: "google",
      details: "Claim or verify the listing with the owner and set the opening date on it. Then link it in Settings → Google locations, so reviews sync from day one.",
    },
    has("instagram")
      ? { title: "Instagram bio", assignee: "claude", platform: "instagram", details: `Claude drafts it for review (${limit("instagram_bio")} characters max). After approving, paste it into ${PROFILE_COPY_WHERE.instagram_bio}.` }
      : null,
    has("tiktok")
      ? { title: "TikTok bio", assignee: "claude", platform: "tiktok", details: `Claude drafts it for review (${limit("tiktok_bio")} characters max). After approving, paste it into ${PROFILE_COPY_WHERE.tiktok_bio}.` }
      : null,
    {
      title: "Google Business description",
      assignee: "claude",
      platform: "google",
      details: `Claude drafts it for review (${limit("google_description")} characters max, no links). After approving, paste it into ${PROFILE_COPY_WHERE.google_description}.`,
    },
    {
      title: "3 coming-soon posts",
      assignee: "claude",
      platform: postPlatform,
      details: "Three posts for the weeks before opening: a teaser, a sneak peek, and the opening date. Claude drafts the captions; photos or a flyer from the owner make them real.",
    },
    {
      title: "Opening-day creator shortlist",
      assignee: "claude",
      platform: "other",
      details: "A shortlist of local creators to invite for opening day. No messages are drafted until the owner's offer is saved in Settings → Outreach profile.",
    },
  ];
  return steps.filter((s): s is Step => !!s);
}

/** Adds the launch steps the business doesn't have yet (same tag + title), so calling it twice never duplicates. */
async function addLaunchTasks(clientId: string, actor: string): Promise<number> {
  const db = await getDb();
  const [plan, existing] = await Promise.all([
    db.select({ platform: schema.deliverables.platform }).from(schema.deliverables)
      .where(and(eq(schema.deliverables.clientId, clientId), eq(schema.deliverables.active, true))),
    db.select({ title: schema.tasks.title }).from(schema.tasks).where(and(eq(schema.tasks.clientId, clientId), eq(schema.tasks.tag, LAUNCH_TAG))),
  ]);
  // A checklist that's already there is left as it is (a person may have deleted a step on purpose).
  if (existing.length) return 0;
  const month = currentMonth();
  const base = Date.now();
  const rows = launchSteps(new Set(plan.map((p) => p.platform))).map((s, i) => ({
    id: newId("tsk_"),
    clientId,
    title: s.title,
    details: s.details,
    platform: s.platform,
    assignee: s.assignee,
    month,
    tag: LAUNCH_TAG,
    createdBy: actor,
    createdAt: new Date(base + i), // keeps checklist order (one insert shares now())
  }));
  if (rows.length) await db.insert(schema.tasks).values(rows);
  return rows.length;
}

/**
 * Monthly-plan slots nobody has touched (generated, still to do, unassigned, no date, no notes, still carrying the
 * title they were generated with, no draft or post linked), from this month on. They'd only sit there as "0 of 8"
 * before the doors open; generating the checklist on or after opening day brings them back with the same ids.
 * Anything a person renamed, assigned, dated or wrote on stays.
 */
async function clearUntouchedPlanTasks(clientId: string): Promise<number> {
  const db = await getDb();
  const t = schema.tasks;
  const rows = await db.select({ id: t.id, title: t.title, plan: schema.deliverables.title }).from(t)
    .innerJoin(schema.deliverables, eq(t.deliverableId, schema.deliverables.id))
    .where(and(
      eq(t.clientId, clientId), isNotNull(t.deliverableId), eq(t.status, "todo"), eq(t.assignee, "unassigned"),
      isNull(t.dueDate), isNull(t.details), isNull(t.askId), gte(t.month, currentMonth()), like(t.id, "tsk\\_gen\\_%"), // ids generateMonthTasks gives its slots
    ));
  // The titles generateMonthTasks writes: "<plan item> — 3 of 8" or "<plan item> (all, as they come in)".
  const generated = (r: { title: string; plan: string }) =>
    r.title === `${r.plan} (all, as they come in)` || (r.title.startsWith(`${r.plan} — `) && /^\d+ of \d+$/.test(r.title.slice(r.plan.length + 3)));
  const ids = rows.filter(generated).map((r) => r.id);
  if (!ids.length) return 0;
  const [drafts, posts] = await Promise.all([
    db.select({ taskId: schema.drafts.taskId }).from(schema.drafts).where(inArray(schema.drafts.taskId, ids)),
    db.select({ taskId: schema.contentPosts.taskId }).from(schema.contentPosts).where(inArray(schema.contentPosts.taskId, ids)),
  ]);
  const linked = new Set([...drafts, ...posts].map((r) => r.taskId));
  const drop = ids.filter((id) => !linked.has(id));
  if (!drop.length) return 0;
  const gone = await db.delete(t).where(and(inArray(t.id, drop), eq(t.status, "todo"))).returning({ id: t.id });
  return gone.length;
}

/** The launch checklist for a business (done and open), in checklist order. */
export async function getLaunchStatus(clientId: string) {
  const db = await getDb();
  const tasks = await db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.clientId, clientId), eq(schema.tasks.tag, LAUNCH_TAG)))
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id));
  const done = tasks.filter((t) => t.status === "done").length;
  return { tasks, done, total: tasks.length };
}

/* ───────────────────────── Pre-launch switch ───────────────────────── */

export const LaunchInput = z.object({
  prelaunch: z.boolean(),
  /** Opening day as "YYYY-MM-DD". Empty clears it. */
  openingDate: z.string().trim().max(20).nullish(),
});

export type SetLaunchResult = { prelaunch: boolean; openingDate: string | null; changed: boolean; stepsAdded: number; planTasksCleared: number; message: string };

/**
 * People only: mark a business as not open yet (with its opening day), or as open.
 * Switching Pre-launch on adds the launch checklist; while the doors aren't open, untouched monthly-plan slots are cleared.
 */
export async function setLaunch(clientId: string, input: z.input<typeof LaunchInput>, actor: string): Promise<SetLaunchResult> {
  if (!isPerson(actor)) throw new OpsError("Only Nora or Cameron can mark a business as pre-launch or open.");
  const v = LaunchInput.parse(input);
  const openingDate = v.openingDate ? v.openingDate : null;
  if (openingDate && !isDay(openingDate)) throw new OpsError("That opening day doesn't look like a date. Pick it from the calendar.");
  const db = await getDb();
  const [cur] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!cur) throw new OpsError(`No business with id "${clientId}"`);
  if (cur.kind === "creator") throw new OpsError("Pre-launch is for businesses we manage, not Nora's own workspace.");

  const changed = cur.prelaunch !== v.prelaunch || (cur.openingDate ?? null) !== openingDate;
  if (changed) await db.update(schema.clients).set({ prelaunch: v.prelaunch, openingDate }).where(eq(schema.clients.id, clientId));

  const info = launchInfo({ prelaunch: v.prelaunch, openingDate });
  const stepsAdded = v.prelaunch ? await addLaunchTasks(clientId, actor) : 0;
  const planTasksCleared = info.planOnHold ? await clearUntouchedPlanTasks(clientId) : 0;

  const parts = [
    !v.prelaunch ? (cur.prelaunch ? "Marked as open. The monthly plan applies from now on." : "Saved.") : openingDate ? `Pre-launch · ${openingLine(info)}.` : "Pre-launch · add the opening day when you know it.",
    stepsAdded ? `Added the launch checklist (${stepsAdded} steps).` : null,
    planTasksCleared ? `Cleared ${planTasksCleared} untouched monthly checklist task${planTasksCleared === 1 ? "" : "s"}; they come back on opening day.` : null,
  ].filter(Boolean);
  if (changed || stepsAdded || planTasksCleared) {
    await logActivity({
      actor, action: "client.launch", entityType: "client", entityId: clientId, clientId,
      summary: [
        !v.prelaunch ? `${cur.name} marked as open` : `${cur.name} marked pre-launch${openingDate ? ` · opens ${formatDate(openingDate)}` : " · no opening day yet"}`,
        stepsAdded ? `launch checklist added (${stepsAdded} steps)` : null,
        planTasksCleared ? `${planTasksCleared} untouched monthly checklist task${planTasksCleared === 1 ? "" : "s"} cleared` : null,
      ].filter(Boolean).join(" · "),
    });
  }
  return { prelaunch: v.prelaunch, openingDate, changed, stepsAdded, planTasksCleared, message: parts.join(" ") };
}

/* ───────────────────────── Monthly plan gate ───────────────────────── */

/** The business's launch state, or null when it doesn't exist. generateMonthTasks skips a business whose plan is on hold. */
export async function planHold(clientId: string): Promise<(LaunchInfo & { name: string }) | null> {
  const db = await getDb();
  const [c] = await db.select({ name: schema.clients.name, prelaunch: schema.clients.prelaunch, openingDate: schema.clients.openingDate })
    .from(schema.clients).where(eq(schema.clients.id, clientId));
  return c ? { ...launchInfo(c), name: c.name } : null;
}

/* ───────────────────────── Claude's briefing ───────────────────────── */

/**
 * Briefing addition: businesses that aren't open yet, with days to opening and their open launch steps.
 * Left out when no active business is pre-launch.
 */
export async function launchBrief(activeClients: schema.Client[], names: Map<string, string>, day = today()) {
  const pre = activeClients.filter((c) => c.kind === "business" && c.prelaunch);
  if (!pre.length) return {};
  const db = await getDb();
  const tasks = await db.select({ id: schema.tasks.id, clientId: schema.tasks.clientId, title: schema.tasks.title, status: schema.tasks.status, assignee: schema.tasks.assignee })
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.clientId, pre.map((c) => c.id)), eq(schema.tasks.tag, LAUNCH_TAG)))
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id));
  return {
    prelaunchBusinesses: {
      instruction:
        "These businesses aren't open yet. Work their launch checklist (the open steps below) instead of the monthly plan — no monthly-plan tasks are created until opening day. " +
        "Yours: the Instagram bio, TikTok bio and Google Business description (create_draft kind profile_copy with meta.surface and the step's task_id), three coming-soon posts, and the opening-day creator shortlist. " +
        "Verifying the Google Business Profile is a person's step. Never write as if the business is already open, and mention how many days are left in your summary.",
      businesses: pre.map((c) => {
        const info = launchInfo(c, day);
        const mine = tasks.filter((t) => t.clientId === c.id);
        return {
          businessId: c.id,
          business: names.get(c.id) ?? c.name,
          openingDate: info.openingDate,
          daysToOpening: info.daysToOpening,
          opening: openingLine(info),
          ...(info.opened
            ? { note: "Opening day is here or has passed: the monthly plan applies again (generate_month_tasks). Suggest that Nora or Cameron switch Pre-launch off in the business's Settings." }
            : !info.openingDate
              ? { note: "No opening day is saved yet. Ask Nora or Cameron for it in an ask thread; a person saves it in the business's Settings." }
              : {}),
          launchChecklist: {
            done: mine.filter((t) => t.status === "done").length,
            total: mine.length,
            open: mine.filter((t) => t.status !== "done").map((t) => ({ taskId: t.id, title: t.title, for: t.assignee, status: t.status })),
          },
        };
      }),
    },
  };
}

/* ───────────────────────── Profile text drafts (kind "profile_copy") ───────────────────────── */

/**
 * A profile_copy draft needs meta.surface (instagram_bio · tiktok_bio · google_description) and text within that
 * platform's limit. Returns the surface and the tidied text. `length: false` only checks the surface (a person may
 * save a longer work in progress; approving it is what's refused).
 */
export function assertProfileCopy(meta: Record<string, unknown>, body: string, opts: { length?: boolean } = {}): { surface: ProfileCopySurface; body: string } {
  const surface = profileCopySurface(meta);
  if (!surface) throw new OpsError(`profile_copy drafts need meta.surface: ${PROFILE_COPY_SURFACES.join(", ")}`);
  const text = body.trim();
  if (!text) throw new OpsError(`The ${PROFILE_COPY_LABEL[surface]} is empty.`);
  const check = checkProfileCopy(surface, text);
  if (opts.length !== false && check.over > 0) throw new OpsError(overLimitLine(check));
  return { surface, body: text };
}

/** What Approve says for a profile text: where to paste it. */
export function profileCopyApprovedMessage(meta: Record<string, unknown>): string {
  const surface = profileCopySurface(meta);
  return surface ? `Approved. Copy it, paste it into ${PROFILE_COPY_WHERE[surface]}, then tap “Mark done”.` : "Approved. Copy it into the profile, then tap “Mark done”.";
}

/** A profile text for this business and surface that's still waiting (in review, sent back, or approved but not pasted yet). */
export async function pendingProfileCopy(clientId: string, surface: ProfileCopySurface) {
  const db = await getDb();
  const [row] = await db.select({ id: schema.drafts.id, status: schema.drafts.status, title: schema.drafts.title }).from(schema.drafts)
    .where(and(
      eq(schema.drafts.clientId, clientId), eq(schema.drafts.kind, "profile_copy"),
      inArray(schema.drafts.status, ["needs_review", "rejected", "approved"]),
      sql`${schema.drafts.meta}->>'surface' = ${surface}`,
    ))
    .limit(1);
  return row ?? null;
}
