import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { logActivity } from "./activity";
import type { GoogleSyncStatus } from "./schema";

/**
 * Per-business Google review sync bookkeeping (clients.googleSync*). Written by the review sync
 * (integrations/google.ts) after each listing; read through lib/google-status.
 *
 * Kept apart from lib/ops so the sync can import it directly (ops imports the integrations).
 */

/** Spread into a clients update when a business's googleLocation changes: the old result described another listing. */
export const GOOGLE_SYNC_RESET = { googleSyncAt: null, googleSyncStatus: null, googleSyncCount: null, googleSyncError: null } as const;

export type GoogleSyncOutcome =
  | { status: "ok" | "empty"; count: number }
  | { status: "error"; error: string };

/**
 * Stores what the last sync found for one business. An error keeps the previous review count (those reviews are
 * still in the app). The activity log only gets a line when the status changes, so an hourly sync stays quiet.
 */
export async function recordGoogleSync(clientId: string, outcome: GoogleSyncOutcome, actor = "system"): Promise<void> {
  const db = await getDb();
  const [cur] = await db
    .select({ name: schema.clients.name, status: schema.clients.googleSyncStatus })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId));
  if (!cur) return;
  const status: GoogleSyncStatus = outcome.status === "error" ? "error" : outcome.count > 0 ? "ok" : "empty";
  await db
    .update(schema.clients)
    .set(
      outcome.status === "error"
        ? { googleSyncAt: new Date(), googleSyncStatus: status, googleSyncError: outcome.error.slice(0, 500) }
        : { googleSyncAt: new Date(), googleSyncStatus: status, googleSyncCount: outcome.count, googleSyncError: null },
    )
    .where(eq(schema.clients.id, clientId));
  if (cur.status === status) return;
  const summary =
    outcome.status === "error"
      ? `Google reviews for ${cur.name}: sync failed: ${outcome.error}`.slice(0, 500)
      : status === "empty"
        ? `Google reviews for ${cur.name}: the linked listing returned 0 reviews (check it's the right listing)`
        : cur.status
          ? `Google reviews for ${cur.name} are syncing again (${outcome.count})`
          : `Google reviews for ${cur.name}: first sync (${outcome.count})`;
  await logActivity({ actor, action: `google_sync.${status}`, entityType: "client", entityId: clientId, clientId, summary });
}
