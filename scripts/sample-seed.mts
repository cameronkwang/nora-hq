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
// Collab deals + a busy schedule for this month (fake businesses), so phone screens can be checked with real-looking load.
{
  const today = ny(new Date(now));
  const month = today.slice(0, 7);
  const dayOf = (offset: number) => ny(new Date(now + offset * day));
  await db.insert(schema.deals).values([
    {
      id: "sample-deal-pizza", businessName: "Sample Pizzeria", contactName: "Pat Sample", contactEmail: "owner@sample-pizzeria.test",
      contactPhone: "555-0100", address: "123 Fake St, Sampleton, VA", compType: "paid", amountCents: 45000,
      visitAt: new Date(now + 2 * day), status: "scheduled", menuNotes: "Margherita, hot honey pie, garlic knots (fake)",
      shotList: [{ id: "s1", text: "Pizza coming out of the oven", done: false }, { id: "s2", text: "Cheese pull", done: false }],
      createdBy: "sample",
    },
    { id: "sample-deal-cafe", businessName: "Sample Cafe", contactName: "Sam Sample", compType: "gifted", visitAt: new Date(now + 5 * day), status: "planning", createdBy: "sample" },
  ]).onConflictDoNothing();
  await db.insert(schema.dealDeliverables).values([
    { id: "sample-dd-1", dealId: "sample-deal-pizza", kind: "ig_reel", dueDate: dayOf(9), sortOrder: 0 },
    { id: "sample-dd-2", dealId: "sample-deal-pizza", kind: "tiktok", dueDate: dayOf(9), sortOrder: 1 },
    { id: "sample-dd-3", dealId: "sample-deal-pizza", kind: "ig_story", dueDate: dayOf(2), sortOrder: 2 },
  ]).onConflictDoNothing();
  const jobs: { name: string; offset: number | null; free?: boolean; reel?: boolean; deal?: string }[] = [
    { name: "Sample Pizzeria", offset: 2, reel: true, deal: "sample-deal-pizza" },
    { name: "Sample Cafe", offset: 5, free: true, reel: true, deal: "sample-deal-cafe" },
    { name: "Fake Burger Bar", offset: -3, reel: true },
    { name: "Test Taqueria", offset: -1, free: true, reel: true },
    { name: "Demo Dumplings", offset: 1 },
    { name: "Mock Noodle House", offset: 7, reel: true },
    { name: "Placeholder Bakery", offset: null, free: true },
  ];
  await db.insert(schema.scheduleItems).values(jobs.map((j, i) => {
    const date = j.offset === null ? null : dayOf(j.offset);
    return {
      id: `sample-job-${i}`, month: date ? date.slice(0, 7) : month, date, businessName: j.name, nameKey: j.name.toLowerCase(),
      dealId: j.deal ?? null, isFree: !!j.free, needsReel: !!j.reel, source: "manual" as const, createdBy: "sample",
    };
  })).onConflictDoNothing();
}

// Two asks Nora sent (local dev user nora@local): one Claude answered with a question, one done.
await db.insert(schema.asks).values([
  { id: "sample-ask-1", body: "Can you draft a caption for the Sample Pizzeria reel? (fake)", createdBy: "nora@local", status: "in_progress", kind: "request", forWho: "claude", claudeNote: "Asked Nora which pie to lead with." },
  { id: "sample-ask-2", body: "Add Demo Dumplings to my schedule for Wednesday (fake)", createdBy: "nora@local", status: "done", kind: "request", forWho: "claude", claudeNote: "Added." },
]).onConflictDoNothing();
await db.insert(schema.askMessages).values({ id: "sample-askmsg-1", askId: "sample-ask-1", author: "claude", body: "Which pie should the caption lead with? (fake)" }).onConflictDoNothing();

// Invoicing (docs/invoicing.md): fake payment settings and saved lines, fake customers, one invoice in each state,
// payments, two retainers, and two contracts (one linked to an invoice, one not). Every value is fake: the from-address
// is "100 Sample St" and the Zelle number "(555) 010-0100".
// Numbers: every sample invoice has a number from before Nora HQ (0000165 to 0000169, the end of her Skynova run; the
// paid one is marked imported), so the sequence is untouched and the creator's first invoice in local dev is 0000170,
// exactly as on her real first day (docs/invoicing.md "Numbers"). The smoke test relies on that.
// Customer links work locally: /i/<SAMPLE_INVOICE_TOKENS.x> (tokens are fixed so builders can bookmark them; the
// encrypted copy uses the same dev-only key as lib/crypto when TOKEN_ENC_KEY is unset).
{
  const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
  const { sql } = await import("drizzle-orm");
  const { defaultFields } = await import("../src/lib/contract");
  const today = ny(new Date(now));
  const month = today.slice(0, 7);
  const dayOf = (offset: number) => ny(new Date(now + offset * day));
  const encKey = Buffer.from(process.env.TOKEN_ENC_KEY ?? Buffer.alloc(32, "nora-hq-dev-only").toString("base64"), "base64");
  const enc = (value: unknown) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", encKey, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
  };
  const token = (name: string) => `sample-invoice-${name}-`.padEnd(43, "0");
  const link = (name: string) => ({ tokenHash: createHash("sha256").update(token(name), "utf8").digest("hex"), tokenEnc: enc({ t: token(name) }) });
  // Payment settings (merged, like every settings writer): fake From and Zelle, bank transfer on, card off, the two saved lines.
  const settings = {
    fromName: "Nora Chen", fromAddress: "100 Sample St\nSampleton, VA 23000", zelle: "(555) 010-0100",
    checkPayee: "Nora Chen", checkAddress: "100 Sample St\nSampleton, VA 23000", venmo: "@sample-nora",
    achEnabled: true, cardEnabled: false, termsDays: 0,
    savedItems: [
      { id: "package", description: "Standard Content Creation Package", unitCents: 55000 },
      { id: "food-stipend", description: "Food Stipend", unitCents: null },
    ],
  };
  await db.insert(schema.appSettings).values({ key: schema.NORA_PAYMENT_KEY, value: settings, updatedBy: "sample" })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: sql`coalesce(${schema.appSettings.value}, '{}'::jsonb) || excluded.value`, updatedBy: "sample" } });
  const [{ n: have }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.invoices);
  if (have === 0) {
    await db.insert(schema.customers).values([
      { id: "sample-cus-crab", name: "Crab O Clock", nameKey: "crab o clock", clientId: "crab-o-clock", contactName: "SAMPLE Owner", email: "owner@example.com", source: "client", createdBy: "sample" },
      { id: "sample-cus-snf", name: "SNF Kingdom", nameKey: "snf kingdom", clientId: "snf-kingdom", contactName: "SAMPLE Manager", billingAddress: "SAMPLE 100 Example St\nSampleton, VA 23000", source: "client", createdBy: "sample" },
      { id: "sample-cus-taco", name: "SAMPLE Taco Spot", nameKey: "sample taco spot", contactName: "Sam Sample", email: "sam@sample-taco.test", phone: "555-0101", billingAddress: "SAMPLE 1 Example Ave\nSampleton, VA 23000", source: "manual", createdBy: "sample" },
      { id: "sample-cus-bakery", name: "SAMPLE Bakery 小点心", nameKey: "sample bakery 小点心", contactName: "Lin Sample", email: "lin@sample-bakery.test", lang: "zh-Hans", source: "deal", createdBy: "sample" },
    ]);
    await db.insert(schema.retainers).values([
      { id: "sample-ret-crab", customerId: "sample-cus-crab", description: "Social media services", amountCents: 80000, dayOfMonth: 1, lastRunMonth: month, createdBy: "sample" },
      { id: "sample-ret-snf", customerId: "sample-cus-snf", description: "Google reviews and Instagram", amountCents: 60000, dayOfMonth: 28, createdBy: "sample" },
    ]);
    await db.insert(schema.deals).values({
      id: "sample-deal-bakery", businessName: "SAMPLE Bakery 小点心", contactName: "Lin Sample", contactEmail: "lin@sample-bakery.test", compType: "paid", amountCents: 50000,
      visitAt: new Date(now - 20 * day), status: "posted", paymentStatus: "requested", paymentDueDate: dayOf(-6), createdBy: "sample",
    }).onConflictDoNothing();
    // Two contracts: Taco Spot's is linked to its invoice (0000168); Sample Pizzeria's (from its deal, 30% deposit) has
    // none yet, so its Past contracts row offers "Make deposit invoice".
    await db.insert(schema.contracts).values([
      {
        id: "sample-ctr-taco", kind: "collab", clientBusiness: "SAMPLE Taco Spot", clientContact: "Sam Sample", agreementDate: dayOf(-3), feeCents: 55000, customerId: "sample-cus-taco",
        fields: { ...defaultFields(dayOf(-3)), clientBusiness: "SAMPLE Taco Spot", clientContact: "Sam Sample", clientEmail: "sam@sample-taco.test", fee: "550", paymentDays: "15" },
        createdBy: "nora@local", createdAt: new Date(now - 3 * day),
      },
      {
        id: "sample-ctr-pizza", kind: "collab", clientBusiness: "Sample Pizzeria", clientContact: "Pat Sample", agreementDate: dayOf(-1), feeCents: 45000, dealId: "sample-deal-pizza",
        fields: { ...defaultFields(dayOf(-1)), clientBusiness: "Sample Pizzeria", clientContact: "Pat Sample", clientEmail: "owner@sample-pizzeria.test", fee: "450", depositPercent: "30", visitDate: dayOf(2) },
        createdBy: "nora@local", createdAt: new Date(now - 1 * day),
      },
    ]).onConflictDoNothing();
    const reel = (cents: number) => [{ description: "Instagram Reel (SAMPLE)", quantity: 1, unitCents: cents }];
    // 0000165, paid: imported from Skynova with its own number (below 170, so the sequence doesn't move)
    await db.insert(schema.invoices).values({
      id: "sample-inv-paid", number: "0000165", customerId: "sample-cus-taco", status: "paid", issueDate: dayOf(-25), dueDate: dayOf(-25), termsDays: 0,
      items: [{ description: "Imported from Skynova (invoice 0000165)", quantity: 1, unitCents: 35000 }], subtotalCents: 35000, totalCents: 35000, paidCents: 35000,
      source: "import", importRef: "Skynova 0000165", lang: "en", ...link("paid"),
      sentAt: new Date(now - 25 * day), sentBy: "nora@local", paidAt: new Date(now - 12 * day), createdBy: "nora@local",
    });
    // 0000166: overdue and partly paid, from the bakery deal, page in 简体
    await db.insert(schema.invoices).values({
      id: "sample-inv-overdue", number: "0000166", customerId: "sample-cus-bakery", status: "partially_paid", issueDate: dayOf(-20), dueDate: dayOf(-6), termsDays: 14,
      items: [...reel(45000), { description: "Stories (SAMPLE)", quantity: 2, unitCents: 2500 }], subtotalCents: 50000, totalCents: 50000, paidCents: 20000,
      dealId: "sample-deal-bakery", source: "deal", lang: "zh-Hans", ...link("overdue"),
      sentAt: new Date(now - 20 * day), sentBy: "nora@local", viewedAt: new Date(now - 19 * day), createdBy: "nora@local",
    });
    // 0000169: this month's retainer invoice, due on receipt today (not overdue yet). Zelle or bank transfer online:
    // made while Stripe was set up, so without STRIPE_SECRET_KEY its page and PDF offer Zelle only (no Pay online).
    await db.insert(schema.invoices).values({
      id: "sample-inv-open", number: "0000169", customerId: "sample-cus-crab", status: "sent", issueDate: today, dueDate: today, termsDays: 0, payWays: ["zelle", "bank"],
      items: [{ description: `Social media services (SAMPLE ${month})`, quantity: 1, unitCents: 80000 }], subtotalCents: 80000, totalCents: 80000,
      retainerId: "sample-ret-crab", retainerMonth: month, source: "retainer", lang: "en", ...link("open"),
      sentAt: new Date(now), sentBy: "cameron@local", createdBy: "system",
    });
    // 0000167: void
    await db.insert(schema.invoices).values({
      id: "sample-inv-void", number: "0000167", customerId: "sample-cus-taco", status: "void", issueDate: dayOf(-15), dueDate: dayOf(-15), termsDays: 0,
      items: reel(20000), subtotalCents: 20000, totalCents: 20000, ...link("void"), sentAt: new Date(now - 15 * day), sentBy: "nora@local",
      voidedAt: new Date(now - 14 * day), voidedBy: "nora@local", voidReason: "Made twice (SAMPLE)", createdBy: "nora@local",
    });
    // 0000168: from Taco Spot's contract, her usual two lines, Zelle or check, due in the contract's 15 days
    await db.insert(schema.invoices).values({
      id: "sample-inv-contract", number: "0000168", customerId: "sample-cus-taco", status: "sent", issueDate: dayOf(-2), dueDate: dayOf(13), termsDays: 15,
      items: [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }, { description: "Food Stipend", quantity: 1, unitCents: 7510 }],
      subtotalCents: 62510, totalCents: 62510, payWays: ["zelle", "check"], contractId: "sample-ctr-taco", source: "contract", lang: "en", ...link("contract"),
      sentAt: new Date(now - 2 * day), sentBy: "nora@local", createdBy: "nora@local",
    });
    // a draft: no number until a person presses Make PDF
    await db.insert(schema.invoices).values({
      id: "sample-inv-draft", customerId: "sample-cus-taco", status: "draft", termsDays: 0,
      items: [...reel(45000), { description: "Stories (SAMPLE)", quantity: 3, unitCents: 5000 }], subtotalCents: 60000, discountCents: 5000, discountLabel: "Repeat customer", totalCents: 55000,
      notes: "Thank you! (SAMPLE)", privateNotes: "Waiting on the reel link before making the PDF (SAMPLE)", createdBy: "nora@local",
    });
    await db.insert(schema.invoicePayments).values([
      { id: "sample-pay-1", invoiceId: "sample-inv-paid", amountCents: 35000, paidOn: dayOf(-12), method: "check", reference: "Check #1043 (SAMPLE)", recordedBy: "nora@local" },
      { id: "sample-pay-2", invoiceId: "sample-inv-overdue", amountCents: 20000, paidOn: dayOf(-8), method: "zelle", reference: "SAMPLE", recordedBy: "nora@local" },
    ]);
  }
}

await client.close();
console.log("sample data ready");
