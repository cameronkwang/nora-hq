import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "./db";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { emailSendPlan, outreachProfileOf, publicUrl, sendFromText, type OutreachProfile } from "./outreach-profile";

/**
 * Server side of the outreach profile and creator check (the pure rules live in lib/outreach-profile).
 * ops.ts loads this lazily (from approveDraft), so importing OpsError from it here is safe.
 */

/** The mailbox of the shared Gmail outreach inbox (provider "gmail", no business), lowercase. Null when none is connected. */
export async function outreachInboxAddress(): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ externalId: schema.connections.externalId, label: schema.connections.label })
    .from(schema.connections)
    .where(and(eq(schema.connections.provider, "gmail"), isNull(schema.connections.clientId)))
    .orderBy(desc(schema.connections.updatedAt))
    .limit(1);
  const address = (row?.externalId ?? row?.label ?? "").trim().toLowerCase();
  return address.includes("@") ? address : null;
}

/** A business's outreach profile (sender account + standing offer), or null for an unknown id. */
export async function getOutreachProfile(clientId: string | null | undefined): Promise<OutreachProfile | null> {
  if (!clientId) return null;
  const db = await getDb();
  const [c] = await db
    .select({ id: schema.clients.id, name: schema.clients.name, sendFromKind: schema.clients.sendFromKind, sendFrom: schema.clients.sendFrom, creatorOffer: schema.clients.creatorOffer })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId));
  return c ? outreachProfileOf(c) : null;
}

/**
 * What approving an outreach email for this business does: `auto` = the connected Gmail inbox sends it (only when that
 * inbox is the business's saved sender, or no sender is saved); otherwise a person sends it by hand, and `sendFrom`
 * says from where ("hello@example.com", or "Crab O Clock's own email" when the saved sender is a social account).
 */
export async function outreachEmailPlan(clientId: string | null | undefined): Promise<{ auto: boolean; from: string | null; sendFrom: string | null }> {
  const [profile, inbox] = await Promise.all([getOutreachProfile(clientId), outreachInboxAddress()]);
  const plan = emailSendPlan(profile, inbox);
  return { ...plan, sendFrom: profile && !plan.auto && plan.from ? sendFromText(profile, "email") : null };
}

/**
 * "I just looked at their page and the numbers are right": stamps the creator's stats as checked now.
 * People only (Claude records a check by saving the numbers with their source through upsertCreator).
 * `source` is the public page that was read; left out, the saved one is kept.
 */
export async function markCreatorStatsChecked(creatorId: string, actor: string, source?: string | null): Promise<void> {
  const who = actor.trim().toLowerCase();
  if (!who || who === "claude" || who === "system" || who === "public") throw new OpsError("Only Nora or Cameron can mark a creator's numbers as checked.");
  const url = source && source.trim() ? publicUrl(source) : undefined;
  if (source && source.trim() && !url) throw new OpsError("The link must be the public page the numbers were read from (https://…).");
  const db = await getDb();
  const [row] = await db
    .update(schema.creators)
    .set({ statsCheckedAt: new Date(), ...(url ? { statsSource: url } : {}) })
    .where(eq(schema.creators.id, creatorId))
    .returning({ name: schema.creators.name });
  if (!row) throw new OpsError("Creator not found.");
  await logActivity({ actor, action: "creator.updated", entityType: "creator", entityId: creatorId, summary: `Checked ${row.name}'s numbers against their page` });
}
