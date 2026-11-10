import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { isMonth, monthLabel } from "./dates";
import { logActivity } from "./activity";

/**
 * Cell-level writes for the Numbers sheet (/numbers). Unlike upsertMetric() — which replaces a whole
 * client/month/platform row — this changes ONE field and leaves the others alone, so typing reach
 * never wipes views. Any hand edit marks the row source "manual". Same table the business page reads.
 */

export const METRIC_FIELDS = ["views", "reach", "followers", "engagements"] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export const MetricCellInput = z.object({
  clientId: z.string().min(1),
  month: z.string().refine(isMonth, "month must be YYYY-MM"),
  platform: z.enum(["instagram", "tiktok"]),
  field: z.enum(METRIC_FIELDS),
  // integer column (int4)
  value: z.number().int().nonnegative().max(2_000_000_000).nullable(),
});
export type MetricCell = z.infer<typeof MetricCellInput>;

export type CellResult = { ok: true } | { ok: false; error: string };

const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok" } as const;

/** Saves each cell independently; returns one result per input, in order. Logs one activity entry per business. */
export async function setMetricCells(input: unknown[], actor: string): Promise<CellResult[]> {
  if (input.length > 1000) throw new Error("Too many numbers at once (max 1000).");
  const db = await getDb();
  const m = schema.monthlyMetrics;
  const results: CellResult[] = [];
  const changed: MetricCell[] = [];

  for (const raw of input) {
    const parsed = MetricCellInput.safeParse(raw);
    if (!parsed.success) {
      results.push({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid number" });
      continue;
    }
    const c = parsed.data;
    try {
      const vals = { [c.field]: c.value } as Partial<Pick<typeof m.$inferInsert, MetricField>>;
      if (c.value === null) {
        // Clearing: only touch a row that exists; never create an empty one.
        const res = await db
          .update(m)
          .set({ ...vals, source: "manual", updatedAt: new Date() })
          .where(and(eq(m.clientId, c.clientId), eq(m.month, c.month), eq(m.platform, c.platform)))
          .returning({ id: m.id });
        if (res.length) changed.push(c);
      } else {
        await db
          .insert(m)
          .values({ id: newId("met_"), clientId: c.clientId, month: c.month, platform: c.platform, source: "manual", ...vals })
          .onConflictDoUpdate({ target: [m.clientId, m.month, m.platform], set: { ...vals, source: "manual", updatedAt: new Date() } });
        changed.push(c);
      }
      results.push({ ok: true });
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : "Couldn't save" });
    }
  }

  const byClient = new Map<string, MetricCell[]>();
  for (const c of changed) byClient.set(c.clientId, [...(byClient.get(c.clientId) ?? []), c]);
  for (const [clientId, cells] of byClient) {
    const one = cells.length === 1 ? cells[0] : null;
    await logActivity({
      actor,
      action: "metric.updated",
      entityType: "metric",
      entityId: one ? `${clientId}:${one.month}:${one.platform}` : `${clientId}:numbers`,
      clientId,
      summary: one
        ? `${PLATFORM_LABEL[one.platform]} ${one.field} for ${monthLabel(one.month, "short")}: ${one.value == null ? "cleared" : one.value.toLocaleString("en-US")}`
        : `Updated ${cells.length} numbers on the numbers sheet`,
    });
  }

  return results;
}
