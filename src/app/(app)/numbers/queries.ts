import "server-only";
import { and, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentMonth, isMonth, lastMonths } from "@/lib/dates";

export const RANGE = 6;

/** ?end=YYYY-MM, never past the current month. */
export function resolveEnd(raw: string | null | undefined): string {
  const cur = currentMonth();
  return raw && isMonth(raw) && raw <= cur ? raw : cur;
}

export function rangeMonths(end: string) {
  return lastMonths(RANGE, end);
}

export async function listMetricRows(months: string[]) {
  const db = await getDb();
  const m = schema.monthlyMetrics;
  return db
    .select({
      clientId: m.clientId, month: m.month, platform: m.platform, source: m.source,
      views: m.views, reach: m.reach, followers: m.followers, engagements: m.engagements,
    })
    .from(m)
    .where(and(inArray(m.month, months), inArray(m.platform, ["instagram", "tiktok"])));
}
