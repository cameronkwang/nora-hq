import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { recordGoogleSync, type GoogleSyncOutcome } from "../ops-google";
import type { Connection, Review } from "../schema";
import { notConfigured, type IntegrationResult } from "./types";
import { fetchJson } from "./http";
import { findConnection, ops } from "./connections";
import { friendlyGoogleError, googleAccessToken, googleOAuthConfigured } from "./google-auth";

/**
 * Google Business Profile: one shared connection (clientId null) for the Google account that manages all
 * the restaurants' profiles. Each business maps to a location via clients.googleLocation
 * ("accounts/{a}/locations/{l}", set on the Settings page).
 */
export const GOOGLE_BUSINESS_SCOPES = ["https://www.googleapis.com/auth/business.manage", "openid", "email"];

export function googleConfigured(): boolean {
  return googleOAuthConfigured();
}

type Auth = { conn: Connection; token: string };

async function auth(): Promise<Auth | { ok: false; error: string; notConfigured?: boolean }> {
  if (!googleConfigured()) return { ok: false, notConfigured: true, error: "Google sign-in isn't set up yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — see Settings)." };
  const conn = await findConnection("google", null);
  if (!conn) return { ok: false, notConfigured: true, error: "Google Business Profile is not connected yet (Settings → Connections)." };
  const t = await googleAccessToken(conn);
  if (!t.ok) return { ok: false, error: t.error };
  return { conn, token: t.token };
}

const isAuth = (a: unknown): a is Auth => !!a && typeof a === "object" && "token" in a;

async function markError(conn: Connection, msg: string) {
  try {
    const { setConnectionStatus } = await ops();
    await setConnectionStatus(conn.id, "error", msg);
  } catch {
    /* bookkeeping only */
  }
}
async function markOk(conn: Connection) {
  if (conn.status === "ok") return;
  try {
    const { setConnectionStatus } = await ops();
    await setConnectionStatus(conn.id, "ok", null);
  } catch {
    /* bookkeeping only */
  }
}

/* ───────────── Locations ───────────── */

export type GoogleLocation = { name: string; title: string; address: string | null; accountName: string | null };

type Address = { addressLines?: string[]; locality?: string; administrativeArea?: string };
const formatAddress = (a?: Address) => (a ? [...(a.addressLines ?? []), a.locality, a.administrativeArea].filter(Boolean).join(", ") || null : null);

/** Every location the connected Google account can manage, with v4-style names for the reviews API. */
export async function listLocations(): Promise<{ ok: true; locations: GoogleLocation[] } | { ok: false; error: string; notConfigured?: boolean }> {
  const a = await auth();
  if (!isAuth(a)) return a;
  const headers = { Authorization: `Bearer ${a.token}` };
  try {
    const accounts: Array<{ name: string; accountName?: string }> = [];
    let pageToken: string | undefined;
    do {
      const u = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
      u.searchParams.set("pageSize", "20");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const r = await fetchJson<{ accounts?: Array<{ name: string; accountName?: string }>; nextPageToken?: string }>(u.toString(), { headers });
      accounts.push(...(r.accounts ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken && accounts.length < 200);

    const locations: GoogleLocation[] = [];
    for (const acct of accounts) {
      let lpt: string | undefined;
      let pages = 0;
      do {
        const u = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations`);
        u.searchParams.set("readMask", "name,title,storefrontAddress");
        u.searchParams.set("pageSize", "100");
        if (lpt) u.searchParams.set("pageToken", lpt);
        const r = await fetchJson<{ locations?: Array<{ name: string; title?: string; storefrontAddress?: Address }>; nextPageToken?: string }>(u.toString(), { headers });
        for (const l of r.locations ?? []) {
          const id = l.name.split("/").pop();
          locations.push({ name: `${acct.name}/locations/${id}`, title: l.title ?? id ?? l.name, address: formatAddress(l.storefrontAddress), accountName: acct.accountName ?? null });
        }
        lpt = r.nextPageToken;
      } while (lpt && ++pages < 10);
    }
    await markOk(a.conn);
    const seen = new Set<string>();
    return { ok: true, locations: locations.filter((l) => (seen.has(l.name) ? false : (seen.add(l.name), true))).sort((x, y) => x.title.localeCompare(y.title)) };
  } catch (e) {
    const msg = friendlyGoogleError(e, "Business Profile");
    await markError(a.conn, msg);
    return { ok: false, error: msg };
  }
}

/* ───────────── Reviews ───────────── */

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

type ApiReview = {
  name: string;
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string; state?: string; reviewReplyState?: string; policyViolation?: unknown };
  reviewReplyState?: string;
  policyViolation?: unknown;
};

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v || null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
};

/**
 * `empty` = businesses whose linked listing answered with 0 reviews (worth checking it's the right listing);
 * `unlinked` = active businesses with no listing picked, which the sync can't reach at all. Both are labels for people.
 */
export type ReviewSyncResult = { ok: boolean; synced: number; locations: number; errors: string[]; notConfigured?: boolean; empty?: string[]; unlinked?: string[] };

/** Per-business result (clients.googleSync*), so each business shows its own status instead of one global badge. Never throws. */
async function noteSync(clientId: string, outcome: GoogleSyncOutcome) {
  try {
    await recordGoogleSync(clientId, outcome);
  } catch {
    /* bookkeeping only */
  }
}

/** Pulls reviews for every business with a mapped location (up to 500 newest per location) into the reviews table. */
export async function syncGoogleReviews(): Promise<ReviewSyncResult> {
  const a = await auth();
  const db = await getDb();
  const businesses = await db.select({ id: schema.clients.id, name: schema.clients.name, location: schema.clients.location, googleLocation: schema.clients.googleLocation, prelaunch: schema.clients.prelaunch })
    .from(schema.clients).where(and(eq(schema.clients.archived, false), eq(schema.clients.kind, "business")));
  const labelOf = (c: { name: string; location: string | null }) => (c.location ? `${c.name} (${c.location})` : c.name);
  const clients = businesses.filter((c) => !!c.googleLocation?.trim());
  if (!isAuth(a)) {
    // Connected but the saved access no longer works: every linked business is failing, so say so on each of them.
    if (!a.notConfigured) for (const c of clients) await noteSync(c.id, { status: "error", error: a.error });
    return { ok: false, synced: 0, locations: 0, errors: [a.error], notConfigured: a.notConfigured };
  }
  // A business that isn't open yet has no listing to link; the others are silently skipped by the sync, so name them.
  const unlinked = businesses.filter((c) => !c.googleLocation?.trim() && !c.prelaunch).map(labelOf);
  const out: ReviewSyncResult = { ok: true, synced: 0, locations: 0, errors: [], empty: [], unlinked };
  if (clients.length === 0) {
    out.errors.push("No business is mapped to a Google location yet — pick one for each business in Settings.");
    return out;
  }
  const { upsertReviews } = await ops();
  let quotaHit = false;
  for (const [i, c] of clients.entries()) {
    const loc = c.googleLocation!.replace(/^\/+|\/+$/g, "");
    const byId = new Map<string, ApiReview>();
    try {
      let pageToken: string | undefined;
      let pages = 0;
      let total: number | null = null;
      do {
        const u = new URL(`https://mybusiness.googleapis.com/v4/${loc}/reviews`);
        u.searchParams.set("pageSize", "50");
        if (pageToken) u.searchParams.set("pageToken", pageToken);
        const r = await fetchJson<{ reviews?: ApiReview[]; totalReviewCount?: number; nextPageToken?: string }>(u.toString(), { headers: { Authorization: `Bearer ${a.token}` } });
        for (const rv of r.reviews ?? []) if (rv.reviewId && !byId.has(rv.reviewId)) byId.set(rv.reviewId, rv);
        if (typeof r.totalReviewCount === "number") total = r.totalReviewCount;
        pageToken = r.nextPageToken;
      } while (pageToken && ++pages < 10);
      await upsertReviews([...byId.values()].map((rv) => ({
        id: rv.reviewId,
        clientId: c.id,
        resourceName: rv.name || `${loc}/reviews/${rv.reviewId}`,
        rating: rv.starRating ? STARS[rv.starRating] ?? null : null,
        reviewer: rv.reviewer?.isAnonymous ? "Anonymous" : rv.reviewer?.displayName ?? null,
        comment: rv.comment ?? null,
        createTime: rv.createTime ? new Date(rv.createTime) : null,
        replyText: rv.reviewReply?.comment ?? null,
        replyState: str(rv.reviewReply?.state ?? rv.reviewReply?.reviewReplyState ?? rv.reviewReplyState),
        policyViolation: str(rv.reviewReply?.policyViolation ?? rv.policyViolation),
      })));
      out.synced += byId.size;
      out.locations++;
      // Google's own total when it gives one (we only keep the newest 500), else what came back.
      const count = Math.max(byId.size, total ?? 0);
      if (count === 0) out.empty!.push(labelOf(c));
      await noteSync(c.id, { status: count > 0 ? "ok" : "empty", count });
    } catch (e) {
      const msg = friendlyGoogleError(e, "Business Profile");
      out.ok = false;
      const label = labelOf(c);
      if (msg.startsWith("Google hasn't approved")) {
        if (!quotaHit) out.errors.push(msg);
        quotaHit = true;
        // Every call will fail the same way: mark this business and the ones not tried yet.
        for (const rest of clients.slice(i)) await noteSync(rest.id, { status: "error", error: msg });
        break;
      }
      out.errors.push(`${label}: ${msg}`);
      await noteSync(c.id, { status: "error", error: msg });
    }
  }
  if (out.ok) await markOk(a.conn);
  else if (quotaHit || out.locations === 0) await markError(a.conn, out.errors[0] ?? "Review sync failed");
  return out;
}

export async function replyToGoogleReview(review: Review, text: string): Promise<IntegrationResult> {
  const a = await auth();
  if (!isAuth(a)) return a.notConfigured ? notConfigured("Google Business Profile") : { ok: false, error: a.error };
  if (!text.trim()) return { ok: false, error: "The reply is empty." };
  try {
    await fetchJson(`https://mybusiness.googleapis.com/v4/${review.resourceName}/reply`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text }),
    });
    return { ok: true, externalId: review.id };
  } catch (e) {
    const msg = friendlyGoogleError(e, "Business Profile");
    if (msg.startsWith("Google hasn't approved")) await markError(a.conn, msg);
    return { ok: false, error: msg };
  }
}
