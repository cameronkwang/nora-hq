import type { Client } from "./schema";

/**
 * Where one business stands with Google reviews, in plain words. One derivation shared by Settings, the business
 * page, Home's health strip and Claude's briefing, so they never disagree.
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
  /** True when a person should look at it (everything except a fresh, non-empty sync). */
  needsAttention: boolean;
};

/** The sync runs hourly; two days without one means something is off. */
export const GOOGLE_SYNC_STALE_HOURS = 48;

type SyncFields = Pick<Client, "googleLocation" | "googleSyncAt" | "googleSyncStatus" | "googleSyncCount" | "googleSyncError">;

const plural = (n: number) => `${n.toLocaleString("en-US")} review${n === 1 ? "" : "s"}`;

/** `connected` = the shared Google Business Profile account is connected (a connection row exists). */
export function googleSyncInfo(c: SyncFields, connected: boolean, now = new Date()): GoogleSyncInfo {
  const base = { error: null, count: c.googleSyncCount ?? null, at: c.googleSyncAt ?? null, stale: false };
  if (!c.googleLocation?.trim()) {
    return { ...base, count: null, at: null, state: "unlinked", tone: "warn", label: "Not linked", hint: "Pick its Google listing to pull reviews.", needsAttention: true };
  }
  if (!connected) {
    return { ...base, state: "disconnected", tone: "warn", label: "Google not connected", hint: "Connect Google Business Profile in Settings.", needsAttention: true };
  }
  if (c.googleSyncStatus === "error") {
    return { ...base, state: "error", tone: "danger", label: "Sync failed", hint: null, error: c.googleSyncError?.trim() || "Google refused this listing.", needsAttention: true };
  }
  if (c.googleSyncStatus === "empty") {
    return { ...base, count: 0, state: "empty", tone: "warn", label: "0 reviews", hint: "Check it's the right listing.", needsAttention: true };
  }
  if (c.googleSyncStatus === "ok") {
    const stale = !!c.googleSyncAt && now.getTime() - c.googleSyncAt.getTime() > GOOGLE_SYNC_STALE_HOURS * 3_600_000;
    return {
      ...base, stale, state: "ok", tone: stale ? "warn" : "ok",
      label: c.googleSyncCount != null ? plural(c.googleSyncCount) : "Synced",
      hint: stale ? "Hasn't synced lately. Press Sync reviews." : null,
      needsAttention: stale,
    };
  }
  return { ...base, count: null, at: null, state: "never", tone: "neutral", label: "Not synced yet", hint: "Press Sync reviews to pull them in.", needsAttention: true };
}

/** One plain sentence (no time), for places with no room for a badge: flash messages, the briefing, the health strip. */
export function googleSyncSentence(info: GoogleSyncInfo): string {
  switch (info.state) {
    case "unlinked": return "Google not linked";
    case "disconnected": return "Google account not connected";
    case "never": return "Google reviews not synced yet";
    case "error": return "Google review sync failing";
    case "empty": return "Google shows 0 reviews — check the listing";
    default: return info.stale ? "Google reviews haven't synced lately" : `${info.label} synced`;
  }
}
