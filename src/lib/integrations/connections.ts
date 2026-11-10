import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decryptJson } from "../crypto";
import type { Connection, Provider } from "../schema";

/**
 * Read helpers for OAuth connections. Writes go through ops.ts (saveConnection, updateConnectionTokens,
 * setConnectionStatus) — imported lazily here because ops.ts itself imports the integrations.
 */

export async function ops() {
  return import("../ops");
}

/** The connection for a provider + business (or the shared one when clientId is null). Newest wins. */
export async function findConnection(provider: Provider, clientId: string | null): Promise<Connection | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.provider, provider), clientId ? eq(schema.connections.clientId, clientId) : isNull(schema.connections.clientId)))
    .orderBy(desc(schema.connections.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function listConnectionsFor(provider: Provider): Promise<Connection[]> {
  const db = await getDb();
  return db.select().from(schema.connections).where(eq(schema.connections.provider, provider)).orderBy(desc(schema.connections.updatedAt));
}

/** Decrypts a connection's tokens. Returns null (and never throws) if TOKEN_ENC_KEY is missing/wrong. */
export function readTokens<T>(conn: Connection): T | null {
  try {
    return decryptJson<T>(conn.tokenEnc);
  } catch {
    return null;
  }
}

/** Safe view of a connection for pages (no tokens). */
export type ConnectionSummary = Pick<Connection, "id" | "provider" | "clientId" | "label" | "externalId" | "scopes" | "expiresAt" | "status" | "lastError" | "createdAt" | "updatedAt">;

export async function listConnectionSummaries(): Promise<ConnectionSummary[]> {
  const db = await getDb();
  const c = schema.connections;
  return db
    .select({ id: c.id, provider: c.provider, clientId: c.clientId, label: c.label, externalId: c.externalId, scopes: c.scopes, expiresAt: c.expiresAt, status: c.status, lastError: c.lastError, createdAt: c.createdAt, updatedAt: c.updatedAt })
    .from(c)
    .orderBy(desc(c.updatedAt));
}
