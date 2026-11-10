import "server-only";
import { getDb, schema } from "./db";
import { newId } from "./ids";

export async function logActivity(entry: {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  clientId?: string | null;
  summary: string;
}) {
  const db = await getDb();
  await db.insert(schema.activity).values({ id: newId("act_"), ...entry, clientId: entry.clientId ?? null });
}
