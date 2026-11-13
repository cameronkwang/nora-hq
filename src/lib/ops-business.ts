import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId, slugify } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { getOnboardingTasks, onboardClient } from "./ops-onboarding";
import { joinOutreachAreas, normalizeServices, ACCEPTED_SERVICES, SERVICE_LABELS } from "./onboard-services";
import { looksLikeSecret, secretRefusal } from "./credential-guard";

/**
 * Business details, monthly plan and Active/Inactive — for people (Settings) and for Claude (tools-business),
 * which may only act when a person asked it to. Same conventions as lib/ops: zod input, `actor` is a user email or
 * "claude", every change is logged with what changed (before → after).
 *
 * Hard rule: nothing here stores a password. Any value that looks like a credential (lib/credential-guard) is refused
 * with an explanation, for people and Claude alike.
 */

const CLAUDE = "claude";
const isClaude = (actor: string) => actor.trim().toLowerCase() === CLAUDE;
const isPerson = (actor: string) => {
  const a = actor.trim().toLowerCase();
  return !!a && a !== CLAUDE && a !== "system" && a !== "public";
};
const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Field label for messages and the activity log. */
const LABEL: Record<string, string> = {
  name: "name", location: "location", brand: "brand group", instagramHandle: "Instagram", tiktokHandle: "TikTok",
  website: "website", ownerEmail: "owner email", outreachAreas: "creator search areas", brandVoice: "brand voice",
  googleLocation: "Google location", notes: "notes",
};

/** Throws a plain-words OpsError if any value looks like a password. The secret itself is never echoed. */
export function assertNoSecrets(values: Record<string, string | null | undefined | readonly string[]>) {
  for (const [k, v] of Object.entries(values)) {
    const text = Array.isArray(v) ? v.join("\n") : (v as string | null | undefined);
    const m = looksLikeSecret(text);
    if (m.length) throw new OpsError(secretRefusal(LABEL[k] ?? k, m));
  }
}

/** "@x", "instagram.com/x/", "https://www.tiktok.com/@x?lang=en" → "x". Throws if it isn't a plain handle. */
export function normalizeHandle(v: string | null | undefined, platform: "instagram" | "tiktok"): string | null {
  const s = blank(v);
  if (!s) return null;
  const h = s
    .replace(/^(https?:\/\/)?((www|m|vm|vt)\.)?(instagram|tiktok)\.com\/?@?/i, "")
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  const ok = platform === "instagram" ? /^[a-z0-9._]{1,30}$/ : /^[a-z0-9._]{2,24}$/;
  if (!ok.test(h) || /\.(com|net|org)$/.test(h)) throw new OpsError(`That doesn't look like a ${platform === "instagram" ? "Instagram" : "TikTok"} handle: give the @handle or a link to the profile.`);
  return h;
}

function normalizeWebsite(v: string | null | undefined): string | null {
  const s = blank(v);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes(".") || /\s/.test(s) || u.username || u.password) throw new Error("bad");
    return u.toString().replace(/\/$/, "");
  } catch {
    throw new OpsError("That doesn't look like a website address (e.g. goldenwok.com).");
  }
}

const show = (v: string | null | undefined) => {
  if (!v) return "—";
  const one = v.replace(/\s+/g, " ").trim();
  return `“${one.length > 60 ? `${one.slice(0, 59)}…` : one}”`;
};
const chars = (v: string | null | undefined) => (v ? `${v.length} chars` : "empty");

async function getBusiness(clientId: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!c) throw new OpsError(`No business with id "${clientId}". Use list_clients.`);
  return c;
}

/* ───────────────────────── Details ───────────────────────── */

export const BusinessDetailsPatch = z.object({
  name: z.string().trim().min(1, "Name can't be empty.").max(200).optional(),
  location: z.string().max(200).nullish(),
  brand: z.string().max(200).nullish(),
  instagramHandle: z.string().max(300).nullish(),
  tiktokHandle: z.string().max(300).nullish(),
  website: z.string().max(500).nullish(),
  ownerEmail: z.union([z.literal(""), z.email("Owner email doesn't look like an email address.")]).nullish(),
  /** Comma-separated or a list; saved tidy ("Richmond, 757 / Hampton Roads"). Empty clears. */
  outreachAreas: z.union([z.string().max(1000), z.array(z.string().max(200)).max(20)]).nullish(),
  brandVoice: z.string().max(8000).nullish(),
  /** People only. */
  googleLocation: z.string().max(300).nullish(),
  notes: z.string().max(10000).nullish(),
  /** How `notes` is applied: "append" (default — adds a dated paragraph) or "replace" (people only). */
  notesMode: z.enum(["append", "replace"]).optional(),
});
export type BusinessDetailsPatch = z.input<typeof BusinessDetailsPatch>;

/**
 * Edit a business's details. Only the fields given change; null/"" clears (except name).
 * Refuses: any value that looks like a password; Claude touching googleLocation or replacing notes.
 * Returns the list of changes (before → after), also written to the activity log.
 */
export async function updateBusinessDetails(clientId: string, patch: BusinessDetailsPatch, actor: string): Promise<{ changed: string[] }> {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError("Only Nora, Cameron or Claude can edit a business.");
  const v = BusinessDetailsPatch.parse(patch);
  const claude = isClaude(actor);
  if (claude && v.googleLocation !== undefined) throw new OpsError("Only Nora or Cameron can link the Google location (Settings & plan → Google location).");
  const mode = v.notesMode ?? "append";
  if (claude && v.notes !== undefined && mode === "replace") throw new OpsError("Claude can only add to a business's notes (notesMode \"append\"), not replace them.");

  assertNoSecrets({
    name: v.name, location: v.location, brand: v.brand, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle,
    website: v.website, ownerEmail: v.ownerEmail, outreachAreas: v.outreachAreas as string | string[] | null | undefined,
    brandVoice: v.brandVoice, googleLocation: v.googleLocation, notes: v.notes,
  });

  const cur = await getBusiness(clientId);
  const set: Partial<typeof schema.clients.$inferInsert> = {};
  const changed: string[] = [];
  const diff = <K extends keyof schema.Client>(key: K, next: schema.Client[K], long = false) => {
    if ((cur[key] ?? null) === (next ?? null)) return;
    (set as Record<string, unknown>)[key] = next;
    const before = cur[key] as string | null;
    const after = next as string | null;
    changed.push(long ? `${LABEL[key]}: ${chars(before)} → ${chars(after)}` : `${LABEL[key]}: ${show(before)} → ${show(after)}`);
  };

  if (v.name !== undefined) diff("name", v.name.trim());
  if (v.location !== undefined) diff("location", blank(v.location));
  if (v.brand !== undefined) diff("brand", blank(v.brand));
  if (v.instagramHandle !== undefined) diff("instagramHandle", normalizeHandle(v.instagramHandle, "instagram"));
  if (v.tiktokHandle !== undefined) diff("tiktokHandle", normalizeHandle(v.tiktokHandle, "tiktok"));
  if (v.website !== undefined) diff("website", normalizeWebsite(v.website));
  if (v.ownerEmail !== undefined) {
    if (cur.kind === "creator" && blank(v.ownerEmail)) throw new OpsError("Nora's own workspace has no owner email.");
    diff("ownerEmail", blank(v.ownerEmail)?.toLowerCase() ?? null);
  }
  if (v.outreachAreas !== undefined) diff("outreachAreas", joinOutreachAreas(v.outreachAreas ?? null));
  if (v.brandVoice !== undefined) diff("brandVoice", blank(v.brandVoice), true);
  if (v.googleLocation !== undefined) diff("googleLocation", blank(v.googleLocation));
  if (v.notes !== undefined) {
    const add = blank(v.notes);
    if (mode === "append") {
      if (add) {
        const stamp = new Date().toISOString().slice(0, 10);
        const para = claude ? `— Added by Claude ${stamp} —\n${add}` : add;
        set.notes = cur.notes?.trim() ? `${cur.notes.trimEnd()}\n\n${para}` : para;
        changed.push(`notes: added ${show(add)}`);
      }
    } else {
      diff("notes", add, true);
    }
  }

  if (!changed.length) return { changed };
  const db = await getDb();
  await db.update(schema.clients).set(set).where(eq(schema.clients.id, clientId));
  await logActivity({
    actor, action: "client.updated", entityType: "client", entityId: clientId, clientId,
    summary: `${claude ? "Claude updated" : "Updated"} ${cur.name}: ${changed.join("; ")}`.slice(0, 1000),
  });
  return { changed };
}

/* ───────────────────────── Monthly plan ───────────────────────── */

export const PlanItemInput = z.object({
  deliverableId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  platform: z.enum(schema.PLATFORMS).optional(),
  /** 0 = "as needed" (e.g. reply to every review). */
  targetPerMonth: z.coerce.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
}).refine((x) => x.deliverableId || x.title, { message: "Each plan item needs a deliverableId or a title." });

export const SetPlanInput = z.array(PlanItemInput).min(1, "Give at least one plan item.").max(30);

const planLine = (d: Pick<schema.Deliverable, "title" | "platform" | "targetPerMonth" | "active">) =>
  `${d.title} (${d.platform}, ${d.targetPerMonth || "as needed"}/mo${d.active ? "" : ", off"})`;

/**
 * Create / update / turn off monthly plan items. Items are matched by deliverableId, else by title (case-insensitive).
 * Never deletes: `active: false` turns an item off (its history stays). Items not listed are left alone.
 * Returns what changed (before → after).
 */
export async function setPlan(clientId: string, items: z.input<typeof SetPlanInput>, actor: string): Promise<{ changed: string[]; plan: string[] }> {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError("Only Nora, Cameron or Claude can change a plan.");
  const list = SetPlanInput.parse(items);
  assertNoSecrets({ "plan item": list.map((i) => i.title ?? "") });
  const client = await getBusiness(clientId);
  const db = await getDb();
  const existing = await db.select().from(schema.deliverables).where(eq(schema.deliverables.clientId, clientId)).orderBy(asc(schema.deliverables.sortOrder));
  const byTitle = new Map(existing.map((d) => [d.title.trim().toLowerCase(), d]));
  const byId = new Map(existing.map((d) => [d.id, d]));
  const changed: string[] = [];
  let order = existing.length;

  for (const it of list) {
    const cur = it.deliverableId ? byId.get(it.deliverableId) : byTitle.get(it.title!.toLowerCase());
    if (it.deliverableId && !cur) throw new OpsError(`Plan item "${it.deliverableId}" isn't on ${client.name}'s plan. Use get_client_month or list_clients for ids.`);
    if (cur) {
      const next = {
        title: it.title ?? cur.title,
        platform: it.platform ?? cur.platform,
        targetPerMonth: it.targetPerMonth ?? cur.targetPerMonth,
        active: it.active ?? cur.active,
      };
      if (next.title === cur.title && next.platform === cur.platform && next.targetPerMonth === cur.targetPerMonth && next.active === cur.active) continue;
      const before = planLine(cur);
      await db.update(schema.deliverables).set(next).where(and(eq(schema.deliverables.id, cur.id), eq(schema.deliverables.clientId, clientId)));
      Object.assign(cur, next);
      changed.push(`${before} → ${planLine(cur)}`);
    } else {
      if (!it.title || !it.platform) throw new OpsError(`New plan item needs a title and a platform (${schema.PLATFORMS.join(", ")}).`);
      const row = { id: newId("dlv_"), clientId, title: it.title, platform: it.platform, targetPerMonth: it.targetPerMonth ?? 1, active: it.active ?? true, sortOrder: order++ };
      await db.insert(schema.deliverables).values(row);
      byTitle.set(row.title.toLowerCase(), row);
      byId.set(row.id, row);
      changed.push(`added ${planLine(row)}`);
    }
  }

  if (changed.length) {
    await logActivity({
      actor, action: "deliverable.updated", entityType: "client", entityId: clientId, clientId,
      summary: `${isClaude(actor) ? "Claude changed" : "Changed"} ${client.name}'s monthly plan: ${changed.join("; ")}`.slice(0, 1000),
    });
  }
  const plan = (await db.select().from(schema.deliverables).where(eq(schema.deliverables.clientId, clientId)).orderBy(asc(schema.deliverables.sortOrder))).map(planLine);
  return { changed, plan };
}

/* ───────────────────────── Active / Inactive ───────────────────────── */

/**
 * Active = shown on Home, in the sidebar and in Claude's briefing. Inactive (archived) hides it; nothing is deleted.
 * People and Claude may both switch it. Nora's own creator workspace can't be made inactive.
 */
export async function setBusinessActive(clientId: string, active: boolean, actor: string): Promise<{ active: boolean; changed: boolean }> {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError("Only Nora, Cameron or Claude can change this.");
  const cur = await getBusiness(clientId);
  if (!active && cur.kind === "creator") throw new OpsError("Nora's own workspace is always active.");
  const wasActive = !cur.archived;
  if (wasActive === active) return { active, changed: false };
  const db = await getDb();
  await db.update(schema.clients).set({ archived: !active }).where(eq(schema.clients.id, clientId));
  await logActivity({
    actor, action: "client.updated", entityType: "client", entityId: clientId, clientId,
    summary: `${cur.name}: ${wasActive ? "Active" : "Inactive"} → ${active ? "Active" : "Inactive"}`,
  });
  return { active, changed: true };
}

/* ───────────────────────── Password check ───────────────────────── */

export type CredentialNote = { id: string; name: string; active: boolean; fields: Array<"notes" | "brandVoice">; count: number };

/** Businesses whose notes (or brand voice) look like they hold a password. Ids and names only — never the text. */
export async function findCredentialNotes(): Promise<CredentialNote[]> {
  const db = await getDb();
  const rows = await db.select({
    id: schema.clients.id, name: schema.clients.name, archived: schema.clients.archived,
    notes: schema.clients.notes, brandVoice: schema.clients.brandVoice,
  }).from(schema.clients).where(sql`${schema.clients.notes} is not null or ${schema.clients.brandVoice} is not null`);
  const out: CredentialNote[] = [];
  for (const r of rows) {
    const n = looksLikeSecret(r.notes).length;
    const b = looksLikeSecret(r.brandVoice).length;
    if (n + b) out.push({ id: r.id, name: r.name, active: !r.archived, fields: [...(n ? ["notes" as const] : []), ...(b ? ["brandVoice" as const] : [])], count: n + b });
  }
  return out;
}

/* ───────────────────────── Create (Claude or people) ───────────────────────── */

const NAME_NOISE = /\b(the|restaurant|restaurants|cafe|café|kitchen|bar|grill|llc|inc|co|company|and)\b/g;
/** "The Golden Wok Restaurant, LLC" → "golden wok". */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim();
}

/** An existing business with (nearly) the same name — and, when both have one, the same location. */
export async function findSimilarBusiness(name: string, location?: string | null): Promise<schema.Client | null> {
  const key = nameKey(name);
  if (!key) return null;
  const loc = blank(location)?.toLowerCase() ?? null;
  const db = await getDb();
  const rows = await db.select().from(schema.clients).where(eq(schema.clients.kind, "business"));
  const same = rows.filter((c) => {
    const k = nameKey(c.name);
    if (!k) return false;
    const close = k === key || (Math.min(k.length, key.length) >= 5 && (k.includes(key) || key.includes(k))) || slugify(k) === slugify(key);
    if (!close) return false;
    // Two locations of one brand are two businesses.
    const cl = blank(c.location)?.toLowerCase() ?? null;
    return !(loc && cl && !cl.includes(loc) && !loc.includes(cl));
  });
  return same.sort((a, b) => Number(a.archived) - Number(b.archived))[0] ?? null;
}

export const CreateBusinessInput = z.object({
  name: z.string().trim().min(1, "Give the business a name.").max(200),
  location: z.string().max(200).nullish(),
  services: z.array(z.enum(ACCEPTED_SERVICES)).min(1, "Pick at least one service."),
  instagramHandle: z.string().max(300).nullish(),
  tiktokHandle: z.string().max(300).nullish(),
  website: z.string().max(500).nullish(),
  ownerEmail: z.union([z.literal(""), z.email("Owner email doesn't look like an email address.")]).nullish(),
  outreachAreas: z.union([z.string().max(1000), z.array(z.string().max(200)).max(20)]).nullish(),
  notes: z.string().max(5000).nullish(),
});

export type CreateBusinessResult =
  | { created: false; id: string; name: string; active: boolean; message: string }
  | { created: true; id: string; name: string; services: string[]; checklist: Array<{ title: string; for: string }>; message: string };

/**
 * Set up a business we now manage (onboardClient: plan for the services, Getting started checklist, research ask).
 * Refuses passwords. If a business with a similar name (same location) already exists, returns that one instead.
 */
export async function createBusiness(input: z.input<typeof CreateBusinessInput>, actor: string): Promise<CreateBusinessResult> {
  const v = CreateBusinessInput.parse(input);
  assertNoSecrets({
    name: v.name, location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website,
    ownerEmail: v.ownerEmail, outreachAreas: v.outreachAreas as string | string[] | null | undefined, notes: v.notes,
  });
  const dupe = await findSimilarBusiness(v.name, v.location);
  if (dupe) {
    return {
      created: false, id: dupe.id, name: dupe.name, active: !dupe.archived,
      message: `${dupe.name}${dupe.location ? ` (${dupe.location})` : ""} is already in Nora HQ (id ${dupe.id}${dupe.archived ? ", currently Inactive" : ""}) — nothing new was created. Update it with update_business${dupe.archived ? " or set_business_status" : ""}. If it really is a different business, include its location.`,
    };
  }
  const ig = normalizeHandle(v.instagramHandle, "instagram");
  const tt = normalizeHandle(v.tiktokHandle, "tiktok");
  const site = normalizeWebsite(v.website);
  const id = await onboardClient(
    {
      name: v.name, location: blank(v.location), instagramHandle: ig, tiktokHandle: tt, website: site,
      services: v.services, notes: blank(v.notes), outreachAreas: joinOutreachAreas(v.outreachAreas ?? null),
    },
    actor,
  );
  const email = blank(v.ownerEmail)?.toLowerCase();
  if (email) {
    const db = await getDb();
    await db.update(schema.clients).set({ ownerEmail: email }).where(eq(schema.clients.id, id));
  }
  const steps = await getOnboardingTasks(id);
  const services = normalizeServices(v.services).map((s) => SERVICE_LABELS[s]);
  return {
    created: true, id, name: v.name.trim(), services,
    checklist: steps.map((t) => ({ title: t.title, for: t.assignee })),
    message: `Set up ${v.name.trim()} with a starting monthly plan (${services.join(", ")}) and a Getting started checklist, plus a research ask for you. Next: send_onboarding_form so a person can text the owner the welcome form.`,
  };
}
