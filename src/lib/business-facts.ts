/**
 * Public facts about a business: what anyone can find on Google Maps, the business's own website or its social
 * profiles. Claude looks them up BEFORE the onboarding form is sent (set_business_facts), a person can edit them in
 * Settings, and the form shows them back to the owner as one "Is this right?" card, so a busy owner never types
 * an address or opening hours.
 *
 * Where they live: website, Instagram and TikTok in their own client columns; the rest in clients.public_info
 * (jsonb), together with the source URL of each fact, the facts that were looked for and not found, and when/who
 * last checked.
 *
 * Pure (no server imports): shared by the server, the Settings page and the public form.
 */

export const FACT_KEYS = ["address", "phone", "hours", "website", "instagram", "tiktok", "facebook", "googleListing", "sells", "priceRange"] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** Facts kept inside clients.public_info (the other three have their own columns). */
export const INFO_FACT_KEYS = ["address", "phone", "hours", "facebook", "googleListing", "sells", "priceRange"] as const;
export type InfoFactKey = (typeof INFO_FACT_KEYS)[number];

export const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"] as const;
export const PRICE_RANGE_HINT: Record<(typeof PRICE_RANGES)[number], string> = { $: "under $15", $$: "$15–30", $$$: "$30–60", $$$$: "over $60" };

export type PublicInfo = {
  address?: string;
  phone?: string;
  hours?: string;
  facebook?: string;
  googleListing?: string;
  sells?: string;
  priceRange?: string;
  /** Where each fact was found: a public URL, or "owner" when the owner gave it to us on their form. */
  sources?: Partial<Record<FactKey, string>>;
  /** Looked for in public sources and not found. */
  notFound?: FactKey[];
  /** ISO time of the last save, and who made it (a person's email, or "claude"). */
  checkedAt?: string;
  checkedBy?: string;
};

export const FACT_LABEL: Record<FactKey, string> = {
  address: "Address",
  phone: "Phone",
  hours: "Opening hours",
  website: "Website",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook Page",
  googleListing: "Google listing",
  sells: "What they sell",
  priceRange: "Price range",
};

/** Length caps (characters). */
export const FACT_MAX: Record<FactKey, number> = {
  address: 300, phone: 40, hours: 600, website: 500, instagram: 300, tiktok: 300, facebook: 300, googleListing: 600, sells: 300, priceRange: 4,
};
export const SOURCE_MAX = 600;
/** A fact's source when the owner gave it to us on their onboarding form (instead of a public URL). */
export const OWNER_SOURCE = "owner";
/** How a stored source reads to people: the site it came from, or "the owner". */
export function sourceLabel(source: string | undefined): string {
  if (!source) return "";
  if (source === OWNER_SOURCE) return "the owner (onboarding form)";
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const isFactKey = (v: unknown): v is FactKey => typeof v === "string" && (FACT_KEYS as readonly string[]).includes(v);
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && s.length <= max ? s : undefined;
};

/** clients.public_info as stored → a tidy PublicInfo. Never throws on odd data. */
export function readPublicInfo(raw: unknown): PublicInfo {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: PublicInfo = {};
  for (const k of INFO_FACT_KEYS) {
    const v = text(r[k], FACT_MAX[k]);
    if (v) out[k] = v;
  }
  if (r.sources && typeof r.sources === "object" && !Array.isArray(r.sources)) {
    const sources: Partial<Record<FactKey, string>> = {};
    for (const [k, v] of Object.entries(r.sources as Record<string, unknown>)) {
      const s = text(v, SOURCE_MAX);
      if (isFactKey(k) && s && (s === OWNER_SOURCE || /^https?:\/\//i.test(s))) sources[k] = s;
    }
    if (Object.keys(sources).length) out.sources = sources;
  }
  if (Array.isArray(r.notFound)) {
    const nf = [...new Set(r.notFound.filter(isFactKey))];
    if (nf.length) out.notFound = nf;
  }
  const at = text(r.checkedAt, 40);
  if (at && !Number.isNaN(Date.parse(at))) out.checkedAt = at;
  const by = text(r.checkedBy, 200);
  if (by) out.checkedBy = by;
  return out;
}

/** Who last checked the facts, as people read it: "Claude", or the first part of a person's email ("Nora"). */
export function checkerName(by: string | null | undefined): string {
  if (!by) return "";
  return by.toLowerCase() === "claude" ? "Claude" : by.split("@")[0].replace(/^./, (c) => c.toUpperCase());
}

/** A Facebook Page link, nothing else ("facebook.com/their-page"). */
export const FB_LINK = /^(https?:\/\/)?((www|m|web)\.)?(facebook|fb)\.com\/[^\s]+$/i;

/** A Google Maps / Business Profile link. */
export function isGoogleListingUrl(v: string): boolean {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) || h === "maps.app.goo.gl" || h === "goo.gl" || h === "g.page" || h === "g.co" || h === "share.google";
}

/**
 * A fact's value was changed somewhere other than set_business_facts (e.g. Settings → Details): the source that
 * vouched for the old value, and any "not found" mark, no longer apply. Returns the updated info, or null if
 * nothing needed to change.
 */
export function forgetFactProvenance(raw: unknown, keys: readonly FactKey[]): PublicInfo | null {
  const info = readPublicInfo(raw);
  let touched = false;
  for (const k of keys) {
    if (info.sources?.[k]) {
      delete info.sources[k];
      touched = true;
    }
    if (info.notFound?.includes(k)) {
      info.notFound = info.notFound.filter((x) => x !== k);
      touched = true;
    }
  }
  if (!touched) return null;
  if (info.sources && !Object.keys(info.sources).length) delete info.sources;
  if (info.notFound && !info.notFound.length) delete info.notFound;
  return info;
}

export type FactsRow = { website: string | null; instagramHandle: string | null; tiktokHandle: string | null; notes?: string | null; publicInfo?: unknown };

const handle = (h: string | null | undefined) => {
  const v = (h ?? "").trim().replace(/^@+/, "");
  return v ? `@${v}` : null;
};

/** Every fact we hold for a business (null = we don't have it). Handles come back as "@handle". */
export function businessFacts(c: FactsRow): Record<FactKey, string | null> {
  const info = readPublicInfo(c.publicInfo);
  // Before public_info existed, the Add-business form kept the Page in the notes as "Facebook Page: <link>".
  const fromNotes = c.notes?.match(/^Facebook Page:[ \t]*(\S+)[ \t]*$/im)?.[1] ?? "";
  const facebook = info.facebook ?? (fromNotes && fromNotes.length <= FACT_MAX.facebook && FB_LINK.test(fromNotes) ? fromNotes : null);
  return {
    address: info.address ?? null,
    phone: info.phone ?? null,
    hours: info.hours ?? null,
    website: c.website?.trim() || null,
    instagram: handle(c.instagramHandle),
    tiktok: handle(c.tiktokHandle),
    facebook,
    googleListing: info.googleListing ?? null,
    sells: info.sells ?? null,
    priceRange: info.priceRange ?? null,
  };
}

export type FactsChecklist = {
  /** Facts we hold, with where they were found when we know. */
  known: { key: FactKey; label: string; value: string; source?: string }[];
  /** Nobody has looked for these yet. */
  missing: { key: FactKey; label: string }[];
  /** Looked for and not found. */
  notFound: { key: FactKey; label: string }[];
  /** Research was attempted for every fact: each one is saved, or marked "not found". */
  researched: boolean;
  checkedAt: string | null;
  checkedBy: string | null;
};

/** The prefill checklist shown before sending the form: what we already know, what's missing. */
export function factsChecklist(c: FactsRow): FactsChecklist {
  const info = readPublicInfo(c.publicInfo);
  const facts = businessFacts(c);
  const nf = new Set(info.notFound ?? []);
  const known: FactsChecklist["known"] = [];
  const missing: FactsChecklist["missing"] = [];
  const notFound: FactsChecklist["notFound"] = [];
  for (const key of FACT_KEYS) {
    const value = facts[key];
    const label = FACT_LABEL[key];
    if (value) known.push({ key, label, value, ...(info.sources?.[key] ? { source: info.sources[key] } : {}) });
    else if (nf.has(key)) notFound.push({ key, label });
    else missing.push({ key, label });
  }
  return { known, missing, notFound, researched: missing.length === 0, checkedAt: info.checkedAt ?? null, checkedBy: info.checkedBy ?? null };
}

/** The facts the owner is shown on page 1 of the form, in this order (after the business name). */
export const OWNER_CARD_FACTS = ["address", "hours", "phone", "website", "instagram", "tiktok", "facebook"] as const;
export type OwnerCardFact = (typeof OWNER_CARD_FACTS)[number];

const bare = (url: string) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");

/** What the owner sees: only the facts we have, written the way they'd recognise them. Empty when we have none. */
export function ownerCardFacts(c: FactsRow): { key: OwnerCardFact; value: string }[] {
  const facts = businessFacts(c);
  const out: { key: OwnerCardFact; value: string }[] = [];
  for (const key of OWNER_CARD_FACTS) {
    const v = facts[key];
    if (!v) continue;
    out.push({ key, value: key === "website" || key === "facebook" ? bare(v) : v });
  }
  return out;
}

/** Short fingerprint of what the owner was shown, so a "Yes, that's right" is only recorded for what they actually saw. */
export function ownerCardKey(name: string, facts: readonly { key: string; value: string }[]): string {
  const s = JSON.stringify([name, ...facts.map((f) => [f.key, f.value])]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${s.length.toString(36)}`;
}
