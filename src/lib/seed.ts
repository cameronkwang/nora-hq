import { eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import * as schema from "./schema";
import { newId } from "./ids";

/** The businesses Nora manages. Handles/locations left blank where unknown — fill in on each client's settings tab. */
export const SEED_CLIENTS: Array<Pick<schema.Client, "id" | "name" | "location" | "brand">> = [
  { id: "yummy-red-bowl-richmond", name: "Yummy Red Bowl", location: "Richmond", brand: "Yummy Red Bowl" },
  { id: "yummy-red-bowl-sc", name: "Yummy Red Bowl", location: "South Carolina", brand: "Yummy Red Bowl" },
  { id: "crab-o-clock", name: "Crab O Clock", location: null, brand: null },
  { id: "poke-bros", name: "Poke Bros", location: null, brand: null },
  { id: "maxs-virginia-beach", name: "Max's", location: "Virginia Beach", brand: null },
  { id: "snf-kingdom", name: "SNF Kingdom", location: null, brand: null },
];

/** Starting monthly plan per client. Placeholders — edit per client to match what you've agreed with them. */
export const DEFAULT_DELIVERABLES: Array<Pick<schema.Deliverable, "title" | "platform" | "targetPerMonth">> = [
  { title: "Instagram feed posts / reels", platform: "instagram", targetPerMonth: 8 },
  { title: "Instagram stories", platform: "instagram", targetPerMonth: 12 },
  { title: "TikTok videos", platform: "tiktok", targetPerMonth: 4 },
  { title: "Reply to Google reviews", platform: "google", targetPerMonth: 0 },
  { title: "Creator outreach", platform: "other", targetPerMonth: 5 },
];

/** Nora's own creator workspace — pinned above the businesses. */
export const CREATOR_CLIENT = { id: "noraeatsgood", name: "Nora", location: "@noraeatsgood", brand: null, kind: "creator" as const, instagramHandle: "noraeatsgood", tiktokHandle: "noraeatsgood" };
/** Placeholder plan for Nora's own content — edit on her settings tab. */
export const CREATOR_DELIVERABLES: Array<Pick<schema.Deliverable, "title" | "platform" | "targetPerMonth">> = [
  { title: "Instagram reels / posts", platform: "instagram", targetPerMonth: 8 },
  { title: "TikTok videos", platform: "tiktok", targetPerMonth: 8 },
  { title: "Collab content", platform: "instagram", targetPerMonth: 0 },
];

export async function seed(db: DB) {
  await db.insert(schema.clients).values({ ...CREATOR_CLIENT, sortOrder: -1 }).onConflictDoNothing({ target: schema.clients.id });
  const [{ n: creatorDels }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deliverables).where(eq(schema.deliverables.clientId, CREATOR_CLIENT.id));
  if (creatorDels === 0) {
    await db.insert(schema.deliverables).values(CREATOR_DELIVERABLES.map((d, j) => ({ id: newId("dlv_"), clientId: CREATOR_CLIENT.id, sortOrder: j, ...d })));
  }

  for (const [i, c] of SEED_CLIENTS.entries()) {
    await db
      .insert(schema.clients)
      .values({ ...c, sortOrder: i })
      .onConflictDoNothing({ target: schema.clients.id });
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.deliverables)
      .where(eq(schema.deliverables.clientId, c.id));
    if (n === 0) {
      await db.insert(schema.deliverables).values(
        DEFAULT_DELIVERABLES.map((d, j) => ({ id: newId("dlv_"), clientId: c.id, sortOrder: j, ...d })),
      );
    }
  }
}
