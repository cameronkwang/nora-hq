import { today } from "./dates";
import { daysBetween, isDay, launchInfo } from "./launch";
import type { Client } from "./schema";

/**
 * Where one business stands with Google reviews, in plain words. One derivation shared by Settings, the business
 * page, Home's health strip and Claude's briefing, so they never disagree.
 *
 * Two things keep it quiet where nothing is wrong:
 *  - A listing that answers with 0 reviews is exactly what the right listing shows for a business that isn't open
 *    yet, or opened under GOOGLE_NEW_LISTING_DAYS ago. For those it counts as synced ("ok", 0 reviews), not as
 *    "probably the wrong listing".
 *  - A business with no Google item in its monthly plan (`googleWork: false`) isn't expected to have a listing:
 *    "not linked", "not synced yet" and "0 reviews" need nobody's attention there. A failing or stalled sync still does.
 *
 * Pure (no database, no "server-only"). Nothing is stored for "not linked": that's just an empty googleLocation.
 */

export type GoogleSyncState =
  | "unlinked" // no Google listing picked for this business
  | "disconnected" // a listing is picked, but the shared Google account isn't connected
  | "never" // linked, never synced
  | "ok"
  | "empty" // the listing answered with 0 reviews: probably the wrong listing
  | "error";

export type GoogleSyncTone = "ok" | "warn" | "danger" | "neutral";

export type GoogleSyncInfo = {
  state: GoogleSyncState;
  tone: GoogleSyncTone;
  /** Short status for a badge: "124 reviews", "0 reviews", "Sync failed", "Not linked". */
  label: string;
  /** What to do about it, or null when there's nothing to do. */
  hint: string | null;
  /** Google's message when the last sync failed. */
  error: string | null;
  count: number | null;
  at: Date | null;
  /** The last good sync is older than GOOGLE_SYNC_STALE_HOURS, so the hourly sync probably isn't running. */
  stale: boolean;
  /** True when a person should look at it (everything except a fresh sync, and the quiet cases in the file comment). */
  needsAttention: boolean;
};

export type GoogleSyncOpts = {
  /** Whether the business's monthly plan has an active Google item. Left out = it does (nothing is kept quiet). */
  googleWork?: boolean;
};

/** The sync runs hourly; two days without one means something is off. */
export const GOOGLE_SYNC_STALE_HOURS = 48;

/** 0 reviews is normal for a listing until this many days after opening day. */
export const GOOGLE_NEW_LISTING_DAYS = 30;

type LaunchFields = Partial<Pick<Client, "prelaunch" | "openingDate">>;
type SyncFields = Pick<Client, "googleLocation" | "googleSyncAt" | "googleSyncStatus" | "googleSyncCount" | "googleSyncError"> & LaunchFields;

const plural = (n: number) => `${n.toLocaleString("en-US")} review${n === 1 ? "" : "s"}`;

/** Not open yet (pre-launch, same rule as lib/launch), or opening day was under GOOGLE_NEW_LISTING_DAYS ago. */
export function isNewListing(c: LaunchFields, now = new Date()): boolean {
  const day = today(now);
  if (launchInfo({ prelaunch: !!c.prelaunch, openingDate: c.openingDate ?? null }, day).planOnHold) return true;
  return isDay(c.openingDate) && daysBetween(c.openingDate, day) < GOOGLE_NEW_LISTING_DAYS;
}

/** `connected` = the shared Google Business Profile account is connected (a connection row exists). */
export function googleSyncInfo(c: SyncFields, connected: boolean, now = new Date(), opts: GoogleSyncOpts = {}): GoogleSyncInfo {
  const base = { error: null, count: c.googleSyncCount ?? null, at: c.googleSyncAt ?? null, stale: false };
  const noGoogleWork = opts.googleWork === false;
  if (!c.googleLocation?.trim()) {
    if (noGoogleWork) return { ...base, count: null, at: null, state: "unlinked", tone: "neutral", label: "Not linked", hint: "Google isn't in its plan.", needsAttention: false };
    return { ...base, count: null, at: null, state: "unlinked", tone: "warn", label: "Not linked", hint: "Pick its Google listing to pull reviews.", needsAttention: true };
  }
  if (!connected) {
    return { ...base, state: "disconnected", tone: "warn", label: "Google not connected", hint: "Connect Google Business Profile in Settings.", needsAttention: true };
  }
  if (c.googleSyncStatus === "error") {
    return { ...base, state: "error", tone: "danger", label: "Sync failed", hint: null, error: c.googleSyncError?.trim() || "Google refused this listing.", needsAttention: true };
  }
  // 0 reviews usually means the wrong listing. Not for a business that isn't open yet or has just opened, nor for
  // one with no Google work in its plan: there it is simply a synced listing with nothing on it yet.
  const zeroIsFine = c.googleSyncStatus === "empty" && (noGoogleWork || isNewListing(c, now));
  if (c.googleSyncStatus === "empty" && !zeroIsFine) {
    return { ...base, count: 0, state: "empty", tone: "warn", label: "0 reviews", hint: "Check it's the right listing.", needsAttention: true };
  }
  if (c.googleSyncStatus === "ok" || zeroIsFine) {
    const count = zeroIsFine ? 0 : (c.googleSyncCount ?? null);
    const stale = !!c.googleSyncAt && now.getTime() - c.googleSyncAt.getTime() > GOOGLE_SYNC_STALE_HOURS * 3_600_000;
    return {
      ...base, count, stale, state: "ok", tone: stale ? "warn" : "ok",
      label: count != null ? plural(count) : "Synced",
      hint: stale ? "Hasn't synced lately. Press Sync reviews." : null,
      needsAttention: stale,
    };
  }
  return { ...base, count: null, at: null, state: "never", tone: "neutral", label: "Not synced yet", hint: "Press Sync reviews to pull them in.", needsAttention: !noGoogleWork };
}

/** One plain sentence (no time), for places with no room for a badge: flash messages, the briefing, the health strip. */
export function googleSyncSentence(info: GoogleSyncInfo): string {
  switch (info.state) {
    case "unlinked": return info.needsAttention ? "Google not linked" : "Google not linked (Google isn't in its plan)";
    case "disconnected": return "Google account not connected";
    case "never": return info.needsAttention ? "Google reviews not synced yet" : "Google reviews not synced yet (Google isn't in its plan)";
    case "error": return "Google review sync failing";
    case "empty": return "Google shows 0 reviews — check the listing";
    default: return info.stale ? "Google reviews haven't synced lately" : `${info.label} synced`;
  }
}
