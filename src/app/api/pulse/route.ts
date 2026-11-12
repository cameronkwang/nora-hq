import { NextResponse } from "next/server";
import { desc, max, sql } from "drizzle-orm";
import { getUser, allowedUsers } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Cheap "has anything changed?" probe for <LiveRefresh/>. Returns a version string that changes whenever
 * any ask, draft, task or activity row changes, plus the newest ask so the page can say who sent it.
 * Session-protected by middleware and checked again here.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const [[act], [latest]] = await Promise.all([
    db.select({ at: max(schema.activity.createdAt), n: sql<number>`count(*)::int` }).from(schema.activity),
    db.select({ id: schema.asks.id, createdBy: schema.asks.createdBy, body: schema.asks.body, createdAt: schema.asks.createdAt })
      .from(schema.asks).orderBy(desc(schema.asks.createdAt)).limit(1),
  ]);
  // Every mutation goes through ops.ts, which logs activity — so activity count + newest timestamp is a full change signal.
  const version = `${act?.n ?? 0}:${act?.at ? new Date(act.at).getTime() : 0}`;
  const who = latest ? (latest.createdBy === "claude" ? "Claude" : allowedUsers().find((u) => u.email === latest.createdBy)?.name ?? "Someone") : null;
  return NextResponse.json(
    {
      version,
      latestAsk: latest ? { id: latest.id, from: who, mine: latest.createdBy === user.email, preview: latest.body.slice(0, 80) } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
