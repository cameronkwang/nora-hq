// Clearly-fake sample data for LOCAL smoke tests/screenshots only (embedded PGlite in ./.data). Never touches Neon.
// Usage: rm -rf .data && npm run dev:sample-data && npm run dev
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync } from "node:fs";
import * as schema from "../src/lib/schema";
import { seed } from "../src/lib/seed";

if (process.env.DATABASE_URL) {
  console.error("Refusing to seed sample data: DATABASE_URL is set (this script is for the local PGlite dev database only).");
  process.exit(1);
}
mkdirSync("./.data/pglite", { recursive: true });
const client = new PGlite("./.data/pglite");
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
await seed(db as any);

const ny = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const now = Date.now();
const day = 86400000;
// follower snapshots: last 35 days, both platforms (sample numbers)
for (let i = 34; i >= 0; i--) {
  const date = ny(new Date(now - i * day));
  await db.insert(schema.creatorSnapshots).values([
    { id: `sample-ig-${date}`, platform: "instagram", date, followers: 23100 + (34 - i) * 12, views: 41000 + i * 300, reach: 18000, source: "manual" },
    { id: `sample-tt-${date}`, platform: "tiktok", date, followers: 48200 + (34 - i) * 30, views: 90000 + i * 500, source: "manual" },
  ]).onConflictDoNothing();
}
// 10 sample posts per platform
for (let i = 0; i < 10; i++) {
  const postedAt = new Date(now - (i * 3 + 1) * day);
  await db.insert(schema.creatorMedia).values([
    { id: `sample-igm-${i}`, platform: "instagram", externalId: `sample-ig-${i}`, permalink: `https://example.com/sample-ig-${i}`, caption: `SAMPLE reel #${i + 1} (fake data)`, mediaType: "reel", postedAt, views: 18000 + i * 1500, reach: 12000, likes: 900 + i * 40, comments: 40, shares: 60, saves: 120 },
    { id: `sample-ttm-${i}`, platform: "tiktok", externalId: `sample-tt-${i}`, permalink: `https://example.com/sample-tt-${i}`, caption: `SAMPLE TikTok #${i + 1} (fake data)`, mediaType: "video", postedAt, views: 30000 + i * 2500, likes: 2100, comments: 80, shares: 150, saves: 200 },
  ]).onConflictDoNothing();
}
await db.insert(schema.creatorAudience).values({ id: "sample-aud", platform: "instagram", data: { city: [{ key: "Sampleton, VA", value: 3100 }, { key: "Testburg, VA", value: 2200 }, { key: "Fakeville, NC", value: 1500 }], gender: [{ key: "F", value: 60 }, { key: "M", value: 40 }], age: [{ key: "25-34", value: 45 }] } }).onConflictDoNothing();
// three fake Google reviews for Crab O Clock (no Google connection: approving just marks approved)
const reviewers = ["Sample Sam", "Test Taylor", "Demo Dana"];
for (let i = 0; i < 3; i++) {
  await db.insert(schema.reviews).values({ id: `sample-review-${i}`, clientId: "crab-o-clock", resourceName: `accounts/sample/locations/sample/reviews/sample-${i}`, rating: 5 - i, reviewer: reviewers[i], comment: `SAMPLE review ${i + 1}: the garlic butter crab was great (fake data).`, createTime: new Date(now - (i + 1) * day) }).onConflictDoNothing();
}
await db.update(schema.clients).set({ ownerEmail: "owner@example.com" }).where((await import("drizzle-orm")).eq(schema.clients.id, "crab-o-clock"));
// Public facts "looked up" for one business (all fake), so the form's "Is this right?" card, the send card's
// prefill checklist and Settings → Public facts have something to show. Every other sample business has none.
await db.update(schema.clients).set({
  website: "https://sample-snf-kingdom.example.com",
  instagramHandle: "sample_snf_kingdom",
  publicInfo: {
    address: "SAMPLE 100 Example St, Sampleton, VA 23000",
    phone: "(555) 010-0100",
    hours: "SAMPLE Mon–Thu 11am–9pm\nFri–Sat 11am–10pm\nSun 12pm–8pm",
    facebook: "facebook.com/sample-snf-kingdom",
    googleListing: "https://maps.app.goo.gl/sampleSnfKingdom",
    sells: "SAMPLE seafood boils, fried chicken",
    priceRange: "$$",
    sources: {
      address: "https://maps.app.goo.gl/sampleSnfKingdom", phone: "https://maps.app.goo.gl/sampleSnfKingdom", hours: "https://sample-snf-kingdom.example.com/hours",
      website: "https://maps.app.goo.gl/sampleSnfKingdom", instagram: "https://sample-snf-kingdom.example.com", facebook: "https://sample-snf-kingdom.example.com",
      googleListing: "https://maps.app.goo.gl/sampleSnfKingdom", sells: "https://sample-snf-kingdom.example.com/menu", priceRange: "https://maps.app.goo.gl/sampleSnfKingdom",
    },
    notFound: ["tiktok"],
    checkedAt: new Date(now - 2 * day).toISOString(),
    checkedBy: "claude",
  },
}).where((await import("drizzle-orm")).eq(schema.clients.id, "snf-kingdom"));
// An onboarding form sent back on the EARLIER 7-step form (old answer keys), so the team view's "Earlier answers" stay tested.
await db.insert(schema.clientIntakes).values({
  id: "intake_sample_legacy", clientId: "poke-bros", tokenHash: "sample-legacy-intake-not-a-real-token", tokenEnc: "sample-not-decryptable",
  status: "submitted", lang: "zh-Hans", createdBy: "nora", createdAt: new Date(now - 9 * day), openedAt: new Date(now - 8 * day), submittedAt: new Date(now - 8 * day),
  answers: {
    businessName: "Poke Bros", businessNameZh: "SAMPLE 波奇兄弟", address: "SAMPLE 1 Example Ave, Sampleton, VA 23000", hours: "SAMPLE 周一至周日 11am–9pm",
    priceRange: "2", signatureDishes: "SAMPLE 三文鱼波奇碗", customers: ["students", "office"], goals: ["walkIns"], tone: ["friendly", "fun"], emojis: "some",
    postLangs: "both", instagram: "@sample_poke", accessMeta: "done", accessGoogle: "help", accessTiktok: "call", complaints: "askFirst",
    creatorsOk: "maybe", creatorOffer: ["meal2"], visitTimes: "SAMPLE 周二下午", contactName: "SAMPLE 李先生", contactRole: "SAMPLE 老板",
    contactPhone: "(555) 010-0000", talkLang: "mandarin", reachBy: ["wechat"], wechatId: "sample_wechat", approvalSpeed: "fewDays",
    oddKeyFromTheFuture: { nested: true }, uploads: "not-a-list",
    _meta: { ipHash: null },
  },
}).onConflictDoNothing();
await client.close();
console.log("sample data ready");
