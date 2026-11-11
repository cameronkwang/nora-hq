import { LEAD_OPPORTUNITIES, LEAD_STAGES, type LeadOpportunity, type LeadStage } from "@/lib/schema";

/**
 * Pure helpers for leads (no server-only imports): used by lib/ops-leads on the server, the pages,
 * and the CSV import screen in the browser (live preview).
 */

export const STAGE_LABEL: Record<LeadStage, string> = {
  found: "Found",
  qualified: "Qualified",
  contacted: "Contacted",
  talking: "Talking",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
  not_a_fit: "Not a fit",
};

/** The working pipeline, in order. Won / Lost / Not a fit sit collapsed below it. */
export const ACTIVE_STAGES = ["found", "qualified", "contacted", "talking", "proposal"] as const satisfies readonly LeadStage[];
export const CLOSED_STAGES = ["won", "lost", "not_a_fit"] as const satisfies readonly LeadStage[];
/** Stages Claude may set (research + triage). Contacted and later are set by people / by sending. */
export const CLAUDE_STAGES = ["found", "qualified", "not_a_fit"] as const satisfies readonly LeadStage[];
/** Stages where "Start managing this business" is offered. */
export const CONVERT_STAGES: readonly LeadStage[] = ["talking", "proposal", "won"];
/** Don't pitch these (honours "not interested"). */
export const NO_CONTACT_STAGES: readonly LeadStage[] = ["lost", "not_a_fit"];

export const OPP_LABEL: Record<LeadOpportunity, string> = {
  google: "Google reviews",
  social: "Social",
  collab: "Collab",
};
export const OPP_SHORT: Record<LeadOpportunity, string> = { google: "Google", social: "Social", collab: "Collab" };

export const isStage = (s: unknown): s is LeadStage => typeof s === "string" && (LEAD_STAGES as readonly string[]).includes(s);
export const isOpportunity = (s: unknown): s is LeadOpportunity => typeof s === "string" && (LEAD_OPPORTUNITIES as readonly string[]).includes(s);

/* ───────── Normalisation ───────── */

const BLANK = /^(-+|—|n\/?a|none|null|unknown|\?)$/i;
const isBlank = (s: string) => !s.trim() || BLANK.test(s.trim());

/** "https://www.Example.com/menu?x" → "example.com". Null when it isn't a usable host. */
export function websiteHost(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || isBlank(s)) return null;
  const host = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  // Social / link-in-bio / ordering pages many businesses list as their "website": the host says nothing about which business.
  if (SHARED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return host;
}

/** Hosts shared by many businesses (the business is in the path), so never used to tell two leads apart. */
const SHARED_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "fb.me", "tiktok.com", "x.com", "twitter.com", "youtube.com", "threads.net",
  "linktr.ee", "linkin.bio", "beacons.ai", "bio.link", "bit.ly", "carrd.co", "wixsite.com",
  "google.com", "goo.gl", "g.page", "business.site", "yelp.com", "tripadvisor.com",
  "toasttab.com", "squareup.com", "square.site", "clover.com", "doordash.com", "ubereats.com", "grubhub.com",
  "opentable.com", "resy.com", "chownow.com", "order.online", "menufy.com", "popmenu.com",
];

/** "https://example.com/" style link for a stored website (adds https:// when missing). */
export function websiteUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Same normalisation lib/ops applies to handles ("@Name", profile URLs → "name"). */
export function normalizeHandle(s: string | null | undefined): string | null {
  const v = s?.trim();
  if (!v || isBlank(v)) return null;
  const h = v
    .replace(/^@/, "")
    .replace(/^(https?:\/\/)?((www|m)\.)?(instagram|tiktok)\.com\/@?/i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  // Anything still URL-shaped (another site, a bare domain, a stray scheme) isn't a handle.
  if (!h || h.includes(":") || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|ee|bio|ai|me|io|site|page|link)$/.test(h)) return null;
  return h;
}

/** Case/space-insensitive key for "same name in the same city". */
export function nameCityKey(name: string | null | undefined, city: string | null | undefined): string | null {
  const n = (name ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return null;
  const c = (city ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${n}|${c}`;
}

/* ───────── Numbers people (and Claude) write ───────── */

/** "1,234" / "1.2k" / "312 reviews" / "2.1K followers" → integer. Blank → null. Unreadable → NaN. */
export function parseCount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : Number.NaN;
  const s = String(raw).trim().toLowerCase().replace(/[,\s_]/g, "").replace(/(reviews?|followers?|ratings?)$/, "").replace(/\+$/, "");
  if (!s || BLANK.test(s)) return null;
  const m = /^~?(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return Number.NaN;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return Math.round(Number(m[1]) * mult);
}

/** "4.3" / "4.3★" / "4.3/5" / "4,3 stars" → 4.3 (0–5). Blank → null. Unreadable → NaN. */
export function parseRating(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw >= 0 && raw <= 5 ? Math.round(raw * 10) / 10 : Number.NaN;
  const s = String(raw).trim().toLowerCase().replace(/★|☆|stars?|\/\s*5(\.0)?$/g, "").replace(",", ".").trim();
  if (!s || BLANK.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : Number.NaN;
}

/** "5%" / "5" / 5 → 5 (0–100, whole number). Blank → null. Unreadable → NaN. */
export function parsePercent(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : (() => {
    const s = String(raw).trim().replace(/%$/, "").replace(",", ".").trim();
    return !s || BLANK.test(s) ? null : Number(s);
  })();
  if (n === null) return null;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : Number.NaN;
}

/** Fit score 0–100: out-of-range numbers are clamped rather than refused. Blank → null. Unreadable → NaN. */
export function parseScore(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : (() => {
    const s = String(raw).trim().replace(/%$/, "").replace(/\/\s*100$/, "").trim();
    return !s || BLANK.test(s) ? null : Number(s);
  })();
  if (n === null) return null;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : Number.NaN;
}

/** "2026-08-01" / ISO date-time / Date → Date. Blank → null. Unreadable → Invalid Date. */
export function parseDateish(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return raw;
  const s = String(raw).trim();
  if (!s || BLANK.test(s)) return null;
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-15T12:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`);
  return new Date(s);
}

/** "google, social" / ["Google reviews", "IG"] → ["google", "social"]. Unknown words are ignored. */
export function parseOpportunities(raw: unknown): LeadOpportunity[] {
  const parts = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,;/|+&]|\band\b/i) : [];
  const out = new Set<LeadOpportunity>();
  for (const p of parts) {
    const s = p.toLowerCase().trim();
    if (!s) continue;
    if (/google|review|gbp|gmb|maps|yelp/.test(s)) out.add("google");
    else if (/collab|creator|ugc|influenc|nora|visit|feature/.test(s)) out.add("collab");
    else if (/social|insta|^ig$|tiktok|smm|content|posting|media/.test(s)) out.add("social");
  }
  return LEAD_OPPORTUNITIES.filter((o) => out.has(o));
}

/* ───────── Display ───────── */

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** "3 mo ago" / "2 wk ago" / "today" for a last-post date. */
export function agoShort(d: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  if (days < 365 * 2) return `${Math.round(days / 30.4)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}

type SignalLead = {
  googleRating: number | null;
  googleReviewCount: number | null;
  replyRate: number | null;
  instagramFollowers: number | null;
  lastPostAt: Date | null;
};

/** The key facts in plain words, e.g. "4.1★ · 312 reviews · replies to 5%" and "2.1k IG followers · last post 3 mo ago". */
export function leadSignals(l: SignalLead, now = new Date()): { google: string | null; social: string | null } {
  const g: string[] = [];
  if (l.googleRating != null) g.push(`${l.googleRating.toFixed(1)}★`);
  if (l.googleReviewCount != null) g.push(`${compact(l.googleReviewCount)} review${l.googleReviewCount === 1 ? "" : "s"}`);
  if (l.replyRate != null) g.push(l.replyRate === 0 ? "no owner replies" : `replies to ${l.replyRate}%`);
  const s: string[] = [];
  if (l.instagramFollowers != null) s.push(`${compact(l.instagramFollowers)} IG followers`);
  if (l.lastPostAt) s.push(`last post ${agoShort(l.lastPostAt, now)}`);
  return { google: g.length ? g.join(" · ") : null, social: s.length ? s.join(" · ") : null };
}

export function googleMapsHref(l: { googleMapsUrl: string | null; name: string; city: string | null }): string {
  const u = websiteUrl(l.googleMapsUrl);
  if (u && /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\./i.test(u)) return u;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.name, l.city].filter(Boolean).join(" "))}`;
}
export const igHref = (h: string) => `https://www.instagram.com/${encodeURIComponent(h)}/`;
export const ttHref = (h: string) => `https://www.tiktok.com/@${encodeURIComponent(h)}`;

/* ───────── CSV import mapping ───────── */

export const LEAD_IMPORT_FIELDS = [
  "name", "city", "category", "website", "instagramHandle", "tiktokHandle", "googleMapsUrl",
  "googleRating", "googleReviewCount", "replyRate", "instagramFollowers", "lastPostAt",
  "opportunities", "score", "why", "stage", "contactName", "contactEmail", "contactPhone", "nextStepAt", "notes", "source",
] as const;
export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];
export type RawLeadRow = Partial<Record<LeadImportField, string>>;
export const MAX_LEAD_IMPORT_ROWS = 500;

export const LEAD_FIELD_LABEL: Record<LeadImportField, string> = {
  name: "Name", city: "City", category: "Type of place", website: "Website", instagramHandle: "Instagram", tiktokHandle: "TikTok",
  googleMapsUrl: "Google Maps link", googleRating: "Google rating", googleReviewCount: "Google reviews", replyRate: "Reply rate %",
  instagramFollowers: "IG followers", lastPostAt: "Last post date", opportunities: "Opportunity", score: "Score", why: "Why they're a fit",
  stage: "Stage", contactName: "Contact name", contactEmail: "Contact email", contactPhone: "Contact phone", nextStepAt: "Next step date",
  notes: "Notes", source: "Source",
};

const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const EXACT: Record<string, LeadImportField> = {
  name: "name", business: "name", businessname: "name", restaurant: "name", restaurantname: "name", place: "name", lead: "name", company: "name",
  city: "city", location: "city", area: "city", town: "city", neighborhood: "city",
  category: "category", type: "category", cuisine: "category", typeofplace: "category", kind: "category",
  website: "website", url: "website", site: "website", web: "website", domain: "website",
  instagram: "instagramHandle", ig: "instagramHandle", instagramhandle: "instagramHandle", ighandle: "instagramHandle", insta: "instagramHandle",
  tiktok: "tiktokHandle", tiktokhandle: "tiktokHandle", tt: "tiktokHandle",
  googlemaps: "googleMapsUrl", googlemapsurl: "googleMapsUrl", googlemapslink: "googleMapsUrl", maps: "googleMapsUrl", mapsurl: "googleMapsUrl",
  rating: "googleRating", googlerating: "googleRating", stars: "googleRating",
  reviews: "googleReviewCount", reviewcount: "googleReviewCount", googlereviews: "googleReviewCount", googlereviewcount: "googleReviewCount",
  replyrate: "replyRate", replyratepct: "replyRate", ownerreplies: "replyRate", replies: "replyRate",
  followers: "instagramFollowers", igfollowers: "instagramFollowers", instagramfollowers: "instagramFollowers",
  lastpost: "lastPostAt", lastpostat: "lastPostAt", lastpostdate: "lastPostAt", lastposted: "lastPostAt",
  opportunity: "opportunities", opportunities: "opportunities", whatfor: "opportunities", services: "opportunities",
  score: "score", fit: "score", fitscore: "score",
  why: "why", whytheyreafit: "why", pitch: "why", angle: "why", pitchangle: "why",
  stage: "stage", status: "stage",
  contact: "contactName", contactname: "contactName", owner: "contactName",
  email: "contactEmail", contactemail: "contactEmail", emailaddress: "contactEmail",
  phone: "contactPhone", contactphone: "contactPhone", phonenumber: "contactPhone", tel: "contactPhone",
  nextstep: "nextStepAt", nextstepat: "nextStepAt", nextstepdate: "nextStepAt", followup: "nextStepAt", nextfollowup: "nextStepAt",
  notes: "notes", note: "notes", comments: "notes",
  source: "source",
};

function fuzzy(header: string): LeadImportField | null {
  const h = squash(header);
  if (!h) return null;
  if (h.includes("follow")) return "instagramFollowers";
  if (h.includes("mail")) return "contactEmail";
  if (h.includes("phone")) return "contactPhone";
  if (h.includes("tiktok")) return "tiktokHandle";
  if (h.includes("insta") || h.startsWith("ig")) return "instagramHandle";
  if (h.includes("map")) return "googleMapsUrl";
  if (h.includes("rating") || h.includes("star")) return "googleRating";
  if (h.includes("repl")) return "replyRate";
  if (h.includes("review")) return "googleReviewCount";
  if (h.includes("website") || h.includes("url")) return "website";
  if (h.includes("lastpost")) return "lastPostAt";
  if (h.includes("name")) return "name";
  if (h.includes("city")) return "city";
  if (h.includes("note")) return "notes";
  return null;
}

/** Best guess per header column; each field used at most once (exact names first, then the leftmost partial match). */
export function guessLeadMapping(headers: string[]): Array<LeadImportField | ""> {
  const out: Array<LeadImportField | ""> = headers.map(() => "");
  const used = new Set<LeadImportField>();
  for (const pass of [(h: string) => EXACT[squash(h)] ?? null, fuzzy]) {
    headers.forEach((h, i) => {
      if (out[i]) return;
      const f = pass(h);
      if (f && !used.has(f)) {
        out[i] = f;
        used.add(f);
      }
    });
  }
  return out;
}

export function applyLeadMapping(rows: string[][], mapping: Array<LeadImportField | "">): RawLeadRow[] {
  return rows.map((cells) => {
    const out: RawLeadRow = {};
    mapping.forEach((f, i) => {
      if (f && cells[i] != null && cells[i].trim() !== "") out[f] = cells[i].trim();
    });
    return out;
  });
}

/** Stage words in a sheet → a stage. Unknown → undefined (keeps the default). */
export function parseStage(raw: string | undefined): LeadStage | undefined {
  const s = (raw ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!s) return undefined;
  if (isStage(s)) return s;
  if (/^(new|lead|sourced)$/.test(s)) return "found";
  if (/^(not_interested|declined|dead|no)$/.test(s)) return "lost";
  if (/^(client|signed|closed_won)$/.test(s)) return "won";
  if (/^(in_talks|replied|meeting)$/.test(s)) return "talking";
  if (/^(pitched|emailed|dm(ed|'d)?)$/.test(s)) return "contacted";
  return undefined;
}
