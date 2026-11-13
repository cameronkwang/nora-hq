/**
 * What we can do for a business, in plain words. Shared by the New client form (client component),
 * ops-onboarding (server) and anything else that needs the service list — so it must stay free of
 * server-only imports.
 *
 * Older callers (leads, the original form) still send "social" — it means Instagram + TikTok.
 */

export const SERVICES = ["instagram", "facebook", "tiktok", "google", "creators", "collab"] as const;
export type Service = (typeof SERVICES)[number];

/** Old service names that are still accepted and mapped onto the new ones. */
export const LEGACY_SERVICE_MAP = { social: ["instagram", "tiktok"] } as const satisfies Record<string, readonly Service[]>;
export type LegacyService = keyof typeof LEGACY_SERVICE_MAP;
/** Anything onboardClient accepts: a current service or a legacy one. */
export type AnyService = Service | LegacyService;
export const ACCEPTED_SERVICES = [...SERVICES, ...(Object.keys(LEGACY_SERVICE_MAP) as LegacyService[])] as const;

export const SERVICE_LABELS: Record<Service, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  google: "Google reviews",
  creators: "Local creator outreach",
  collab: "Collab with Nora",
};

/** One-line hint under each chip, for people who don't live on social media. */
export const SERVICE_HINTS: Record<Service, string> = {
  instagram: "Posts, reels & stories",
  facebook: "Page posts",
  tiktok: "Short videos",
  google: "Reply to reviews",
  creators: "Invite local food creators",
  collab: "Nora visits & posts",
};

export const DEFAULT_SERVICES: readonly Service[] = ["instagram", "facebook", "tiktok", "google"];

/** Quick picks for "Where should we look for creators?" — Nora works Richmond and the 757. */
export const OUTREACH_AREA_CHIPS = ["Richmond", "757 / Hampton Roads"] as const;

export type PlanItemPreview = { title: string; platform: "instagram" | "facebook" | "tiktok" | "google" | "email" | "other"; targetPerMonth: number };

/** Starting plan per service. Placeholders — edit per client to match what was agreed. */
export const SERVICE_PLAN: Record<Service, PlanItemPreview[]> = {
  instagram: [
    { title: "Instagram posts / reels", platform: "instagram", targetPerMonth: 8 },
    { title: "Instagram stories", platform: "instagram", targetPerMonth: 12 },
  ],
  facebook: [{ title: "Facebook posts (cross-post from Instagram)", platform: "facebook", targetPerMonth: 8 }],
  tiktok: [{ title: "TikTok videos", platform: "tiktok", targetPerMonth: 4 }],
  google: [{ title: "Reply to Google reviews", platform: "google", targetPerMonth: 0 }],
  creators: [{ title: "Local creator outreach", platform: "other", targetPerMonth: 5 }],
  collab: [{ title: "Collab content with Nora", platform: "instagram", targetPerMonth: 1 }],
};

export const STARTING_PLAN_NOTE = "starting plan — edit to match what you agreed";

/** Current + legacy names in, current services out: stable order, no duplicates, unknown values dropped. */
export function normalizeServices(input: readonly string[]): Service[] {
  const want = new Set<string>();
  for (const raw of input) {
    const s = raw.trim().toLowerCase();
    if (s in LEGACY_SERVICE_MAP) for (const m of LEGACY_SERVICE_MAP[s as LegacyService]) want.add(m);
    else want.add(s);
  }
  return SERVICES.filter((s) => want.has(s));
}

/** The plan items for a set of services, in service order. */
export function planFor(services: readonly Service[]): PlanItemPreview[] {
  return SERVICES.filter((s) => services.includes(s)).flatMap((s) => SERVICE_PLAN[s]);
}

/**
 * Creator search areas: chip picks + free text → one tidy comma-separated string (or null).
 * Splits on commas, semicolons and new lines; drops duplicates (case-insensitive); keeps it short.
 */
export function joinOutreachAreas(...parts: Array<string | readonly string[] | null | undefined>): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const list = Array.isArray(p) ? p : typeof p === "string" ? [p] : [];
    for (const chunk of list) {
      for (const piece of String(chunk).split(/[,;\n]+/)) {
        const v = piece.trim().replace(/\s+/g, " ").slice(0, 80);
        const k = v.toLowerCase();
        if (v && !seen.has(k)) {
          seen.add(k);
          out.push(v);
        }
      }
    }
  }
  const s = out.slice(0, 12).join(", ");
  return s ? s.slice(0, 500) : null;
}

/** Splits a saved outreachAreas string back into chip picks + the leftover free text, for editing. */
export function splitOutreachAreas(saved: string | null | undefined): { chips: string[]; other: string } {
  const parts = (saved ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const chipKeys = new Map(OUTREACH_AREA_CHIPS.map((c) => [c.toLowerCase(), c] as const));
  const chips: string[] = [];
  const other: string[] = [];
  for (const p of parts) {
    const c = chipKeys.get(p.toLowerCase());
    if (c) chips.push(c);
    else other.push(p);
  }
  return { chips, other: other.join(", ") };
}
