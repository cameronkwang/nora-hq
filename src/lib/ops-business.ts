import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { getOnboardingTasks, onboardClient } from "./ops-onboarding";
import { joinOutreachAreas, normalizeServices, ACCEPTED_SERVICES, SERVICE_LABELS } from "./onboard-services";
import { looksLikeSecret, secretRefusal } from "./credential-guard";
import { cleanBlock, cleanLine } from "./ops-collab";
import {
  FACT_KEYS, FACT_LABEL, FACT_MAX, FB_LINK, INFO_FACT_KEYS, OWNER_SOURCE, PRICE_RANGES, SOURCE_MAX, businessFacts, forgetFactProvenance, sourceLabel, factsChecklist, isGoogleListingUrl, readPublicInfo,
  type FactKey, type FactsChecklist, type InfoFactKey, type PublicInfo,
} from "./business-facts";

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
 * Refuses: any value that looks like a password; Claude touching googleLocation or ownerEmail (who receives reports), or replacing notes.
 * Returns the list of changes (before → after), also written to the activity log.
 */
export async function updateBusinessDetails(clientId: string, patch: BusinessDetailsPatch, actor: string): Promise<{ changed: string[] }> {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError("Only Nora, Cameron or Claude can edit a business.");
  const v = BusinessDetailsPatch.parse(patch);
  const claude = isClaude(actor);
  if (claude && v.googleLocation !== undefined) throw new OpsError("Only Nora or Cameron can link the Google location (Settings & plan → Google location).");
  if (claude && v.ownerEmail !== undefined) throw new OpsError("Only Nora or Cameron can change who receives reports.");
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
  // A website or handle changed here no longer has the source (or "not found" mark) that was saved with the old one.
  const moved: FactKey[] = [...("website" in set ? ["website" as const] : []), ...("instagramHandle" in set ? ["instagram" as const] : []), ...("tiktokHandle" in set ? ["tiktok" as const] : [])];
  const info = moved.length ? forgetFactProvenance(cur.publicInfo, moved) : null;
  if (info) set.publicInfo = info;
  const db = await getDb();
  await db.update(schema.clients).set(set).where(eq(schema.clients.id, clientId));
  await logActivity({
    actor, action: "client.updated", entityType: "client", entityId: clientId, clientId,
    summary: `${claude ? "Claude updated" : "Updated"} ${cur.name}: ${changed.join("; ")}`.slice(0, 1000),
  });
  return { changed };
}

/* ───────────────────────── Public facts ───────────────────────── */

export const FactInput = z.object({
  fact: z.enum(FACT_KEYS),
  /** The fact as found. People may pass "" to clear it. */
  value: z.string().max(2000).nullish(),
  /** Public URL where it was found. Required for Claude. */
  source: z.string().max(SOURCE_MAX).nullish(),
  /** Looked for it in public sources and couldn't find it. */
  notFound: z.boolean().optional(),
});
export const SetFactsInput = z.array(FactInput).min(1, "Give at least one fact.").max(40);

/** A public web address (http/https, no logins in it). Throws in plain words otherwise. */
function normalizeSource(v: string): string {
  const s = cleanLine(v);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new OpsError("A source must be the full web address where you found the fact (https://…).");
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) {
    throw new OpsError("A source must be a public web address (https://…) with no login in it.");
  }
  return s;
}

/** Did the owner correct our details on their newest submitted onboarding form ("Something's off")? */
async function ownerCorrected(clientId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ answers: schema.clientIntakes.answers }).from(schema.clientIntakes)
    .where(and(eq(schema.clientIntakes.clientId, clientId), eq(schema.clientIntakes.status, "submitted")))
    .orderBy(desc(schema.clientIntakes.submittedAt)).limit(1);
  return (row?.answers as Record<string, unknown> | null | undefined)?.factsOk === "no";
}

/** One fact, tidied the way we store it. Throws a plain-words OpsError when it doesn't look like that kind of fact. */
function normalizeFact(key: FactKey, raw: string): string {
  const tooLong = (v: string) => {
    if (v.length > FACT_MAX[key]) throw new OpsError(`${FACT_LABEL[key]} is too long (keep it under ${FACT_MAX[key]} characters).`);
    return v;
  };
  switch (key) {
    case "hours":
      return tooLong(cleanBlock(raw));
    case "phone": {
      const v = tooLong(cleanLine(raw));
      const digits = v.replace(/\D/g, "").length;
      if (!/^\+?[\d\s().-]+(\s*(x|ext\.?)\s*\d{1,6})?$/i.test(v) || digits < 7 || digits > 21) throw new OpsError("That doesn't look like a phone number.");
      return v;
    }
    case "website":
      return normalizeWebsite(raw) ?? "";
    case "instagram":
    case "tiktok":
      return normalizeHandle(raw, key) ?? "";
    case "facebook": {
      const v = tooLong(cleanLine(raw));
      if (!FB_LINK.test(v)) throw new OpsError("Give the Facebook Page as a link (facebook.com/their-page).");
      return v;
    }
    case "googleListing": {
      const typed = cleanLine(raw);
      const v = tooLong(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
      if (!isGoogleListingUrl(v)) throw new OpsError("Give the Google listing as its Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…).");
      return v;
    }
    case "priceRange": {
      const v = cleanLine(raw);
      const byNumber = PRICE_RANGES[Number(v) - 1];
      const hit = (PRICE_RANGES as readonly string[]).includes(v) ? v : /^[1-4]$/.test(v) ? byNumber : null;
      if (!hit) throw new OpsError(`Price range is one of ${PRICE_RANGES.join(", ")}.`);
      return hit;
    }
    default:
      return tooLong(cleanLine(raw));
  }
}

const isInfoFact = (k: FactKey): k is InfoFactKey => (INFO_FACT_KEYS as readonly string[]).includes(k);

/**
 * Save public facts about a business (what anyone can find on Google Maps, its website or its social profiles).
 * - Claude: every value needs the public URL it came from; a fact it looked for and couldn't find is marked
 *   notFound instead (which never removes a value that's already saved). Claude can't clear a fact.
 * - People (Settings): no source needed; an empty value clears the fact.
 * Likely passwords are refused. Every change is logged before → after. Each call stamps "checked now, by <actor>".
 */
export async function setBusinessFacts(
  clientId: string,
  items: z.input<typeof SetFactsInput>,
  actor: string,
): Promise<{ changed: string[]; kept: string[]; checklist: FactsChecklist }> {
  if (!isPerson(actor) && !isClaude(actor)) throw new OpsError("Only Nora, Cameron or Claude can save business facts.");
  const list = SetFactsInput.parse(items);
  const claude = isClaude(actor);
  for (const i of list) assertNoSecrets({ [FACT_LABEL[i.fact]]: i.value, [`the ${FACT_LABEL[i.fact]} source`]: i.source });

  const cur = await getBusiness(clientId);
  if (cur.kind === "creator") throw new OpsError("Public facts are for businesses we manage.");
  const before = businessFacts(cur);
  const info: PublicInfo = readPublicInfo(cur.publicInfo);
  const sources: Partial<Record<FactKey, string>> = { ...(info.sources ?? {}) };
  const notFound = new Set<FactKey>(info.notFound ?? []);
  const set: Partial<typeof schema.clients.$inferInsert> = {};
  const changed: string[] = [];
  const kept: string[] = [];
  const after = { ...before };
  let ownerSaid: boolean | undefined;

  const store = (key: FactKey, value: string | null) => {
    after[key] = value ? (key === "instagram" || key === "tiktok" ? `@${value}` : value) : null;
    if (key === "website") set.website = value;
    else if (key === "instagram") set.instagramHandle = value;
    else if (key === "tiktok") set.tiktokHandle = value;
    else if (isInfoFact(key)) {
      if (value) info[key] = value;
      else delete info[key];
    }
  };

  for (const it of list) {
    const key = it.fact;
    const label = FACT_LABEL[key];
    const raw = typeof it.value === "string" ? it.value.trim() : "";
    if (it.notFound && !raw) {
      // "Not found" never removes something a person or earlier research saved.
      if (after[key]) kept.push(`${label}: kept ${show(after[key])} (already saved)`);
      else if (!notFound.has(key)) {
        notFound.add(key);
        changed.push(`${label}: marked not found`);
      }
      continue;
    }
    if (!raw) {
      if (claude) throw new OpsError(`${label}: give the value and its source, or mark it not_found. Claude can't clear a fact — ask Nora or Cameron.`);
      if (it.value === undefined || it.value === null) continue;
      if (after[key]) {
        changed.push(`${label}: ${show(after[key])} → —`);
        store(key, null);
      }
      delete sources[key];
      continue;
    }
    const fromOwner = it.source?.trim().toLowerCase() === OWNER_SOURCE;
    if (fromOwner && claude && !(ownerSaid ??= await ownerCorrected(clientId))) {
      throw new OpsError(`${label}: source "${OWNER_SOURCE}" is only for a correction the owner made on their onboarding form ("Something's off"). Give the public web address where you found it.`);
    }
    const src = fromOwner ? OWNER_SOURCE : it.source?.trim() ? normalizeSource(it.source) : null;
    if (claude && !src) throw new OpsError(`${label}: add the source — the public web address where you found it (https://…).`);
    const value = normalizeFact(key, raw);
    const shown = key === "instagram" || key === "tiktok" ? `@${value}` : value;
    const was = after[key];
    notFound.delete(key);
    if (was !== shown) {
      store(key, value);
      if (src) sources[key] = src;
      else delete sources[key]; // the old source vouched for the old value
      changed.push(`${label}: ${show(was)} → ${show(shown)}${src ? ` (source: ${sourceLabel(src)})` : ""}`);
    } else if (src && sources[key] !== src) {
      sources[key] = src;
      changed.push(`${label}: source → ${sourceLabel(src)}`);
    }
  }

  const next: PublicInfo = { ...info, checkedAt: new Date().toISOString(), checkedBy: actor };
  if (Object.keys(sources).length) next.sources = sources;
  else delete next.sources;
  if (notFound.size) next.notFound = [...notFound];
  else delete next.notFound;
  set.publicInfo = next;

  const db = await getDb();
  await db.update(schema.clients).set(set).where(eq(schema.clients.id, clientId));
  if (changed.length) {
    await logActivity({
      actor, action: "client.updated", entityType: "client", entityId: clientId, clientId,
      summary: `${claude ? "Claude saved" : "Saved"} public facts for ${cur.name}: ${changed.join("; ")}`.slice(0, 1000),
    });
  }
  return { changed, kept, checklist: factsChecklist({ ...cur, ...set, publicInfo: next } as schema.Client) };
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
  return fullNameKey(name).replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim();
}
/** Lowercase words only, noise words kept: "Pike Kitchen" → "pike kitchen". */
function fullNameKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * Same business name? Exact (noise words kept), or the same name once "Kitchen"/"Grill"/"The"… are dropped
 * when that's still distinctive ("Pike Kitchen" ≠ "Pike Grill"), or every whole word of one is in the other
 * ("Golden Wok" ~ "Golden Wok Chinese"; "Bloom" ≁ "Bloomfield Diner").
 */
function sameName(a: string, b: string): boolean {
  const fa = fullNameKey(a), fb = fullNameKey(b);
  if (!fa || !fb) return false;
  if (fa === fb || fa.replace(/\s+/g, "") === fb.replace(/\s+/g, "")) return true;
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return ka.replace(/\s+/g, "").length >= 5;
  const ta = ka.split(" "), tb = kb.split(" ");
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.join("").length >= 5 && small.every((t) => big.includes(t));
}

/**
 * An existing business with (nearly) the same name. Two locations of one brand are two businesses, so when both
 * have a location they must match. `sure` is false when only one side has a location — maybe a second location,
 * maybe the same place: the caller may confirm it's different.
 */
export async function findSimilarBusiness(name: string, location?: string | null): Promise<{ client: schema.Client; sure: boolean } | null> {
  if (!fullNameKey(name)) return null;
  const loc = blank(location)?.toLowerCase() ?? null;
  const db = await getDb();
  const rows = await db.select().from(schema.clients).where(eq(schema.clients.kind, "business"));
  const hits = rows
    .filter((c) => sameName(name, c.name))
    .map((c) => {
      const cl = blank(c.location)?.toLowerCase() ?? null;
      if (loc && cl) return cl.includes(loc) || loc.includes(cl) ? { client: c, sure: true } : null;
      return { client: c, sure: !loc && !cl };
    })
    .filter((x): x is { client: schema.Client; sure: boolean } => !!x);
  return hits.sort((a, b) => Number(b.sure) - Number(a.sure) || Number(a.client.archived) - Number(b.client.archived))[0] ?? null;
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
  /** The caller checked: a similar name without a matching location really is a different business. */
  confirmDifferent: z.boolean().optional(),
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
  if (isClaude(actor) && blank(v.ownerEmail)) throw new OpsError("Only Nora or Cameron can change who receives reports. Set the business up without it and mention the email in the ask thread.");
  assertNoSecrets({
    name: v.name, location: v.location, instagramHandle: v.instagramHandle, tiktokHandle: v.tiktokHandle, website: v.website,
    ownerEmail: v.ownerEmail, outreachAreas: v.outreachAreas as string | string[] | null | undefined, notes: v.notes,
  });
  const similar = await findSimilarBusiness(v.name, v.location);
  if (similar && (similar.sure || !v.confirmDifferent)) {
    const dupe = similar.client;
    const where = dupe.location ? ` (${dupe.location})` : "";
    return {
      created: false, id: dupe.id, name: dupe.name, active: !dupe.archived,
      message: similar.sure
        ? `${dupe.name}${where} is already in Nora HQ (id ${dupe.id}${dupe.archived ? ", currently Inactive" : ""}) — nothing new was created. Update it with update_business${dupe.archived ? " or set_business_status" : ""}. If it really is a different business, include its location.`
        : `${dupe.name}${where || " (no location saved)"} may be the same business (id ${dupe.id}${dupe.archived ? ", currently Inactive" : ""}) — nothing new was created. If it's the same, update it with update_business; if the person confirmed it's a different business (e.g. another location), call create_business again with confirm_different: true.`,
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
    message: `Set up ${v.name.trim()} with a starting monthly plan (${services.join(", ")}) and a Getting started checklist, plus a research ask for you. Next, work that ask: look up their public facts and save them with set_business_facts, then send_onboarding_form gets the welcome form link for a person to text the owner.`,
  };
}
