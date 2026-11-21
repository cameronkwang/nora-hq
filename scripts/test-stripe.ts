/**
 * Pay online (Stripe) tests. Stripe itself is MOCKED: no call ever leaves the machine (global fetch is replaced and
 * any request that isn't to the mocked api.stripe.com paths fails the test).
 *
 *   npx tsx --require ./scripts/server-only-shim.cjs scripts/test-stripe.ts
 *     lib/stripe: form encoding, the webhook signature check, the Checkout Session request (fields, no customer, no
 *     surcharge line), Stripe errors that never carry the key.
 *   PGLITE_DIR=$(mktemp -d) npx tsx --require ./scripts/server-only-shim.cjs scripts/test-stripe.ts
 *     ALSO lib/ops-stripe against a THROWAWAY PGlite (never the dev data, never Neon): starting a checkout for the
 *     balance read from the database, reuse, the per-invoice limit, card only when it is on, refusals, and the webhook
 *     (bad signature, bank started / cleared / failed, card, expired, replays, metadata checks, a failed event retried).
 * All values are fake. Exits non-zero on the first wrong answer.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";

const ok = (msg: string) => console.log(`ok  ${msg}`);
const SK = "sk_test_mock_000000000000000000000000";
const WHSEC = "whsec_mock_0000000000000000000000000000";

type Call = { url: string; method: string; headers: Record<string, string>; body: URLSearchParams };
const calls: Call[] = [];
let sessionN = 0;
let piType: "us_bank_account" | "card" = "us_bank_account";
let failNextCreate = false;

/** Fake Stripe: Checkout Sessions, their expiry, and a PaymentIntent with a fee. Anything else throws. */
function installFakeStripe() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    if (!url.startsWith("https://api.stripe.com/v1/")) throw new Error(`unexpected request to ${url}`);
    calls.push({ url, method, headers, body });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    const path = new URL(url).pathname;
    if (method === "POST" && path === "/v1/checkout/sessions") {
      if (failNextCreate) {
        failNextCreate = false;
        return json(400, { error: { type: "invalid_request_error", code: "parameter_invalid", message: "Invalid locale (mock)." } });
      }
      sessionN++;
      const id = `cs_test_mock${String(sessionN).padStart(4, "0")}`;
      return json(200, { id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Number(body.get("expires_at")), customer: null });
    }
    if (method === "POST" && /^\/v1\/checkout\/sessions\/cs_[^/]+\/expire$/.test(path)) return json(200, { id: path.split("/")[4], status: "expired" });
    if (method === "GET" && path.startsWith("/v1/payment_intents/")) {
      return json(200, { id: path.split("/")[3], latest_charge: { id: "ch_mock", payment_method_details: { type: piType }, balance_transaction: { id: "txn_mock", fee: piType === "card" ? 1843 : 500 } } });
    }
    return json(404, { error: { type: "invalid_request_error", message: `No such path (mock): ${path}` } });
  }) as typeof fetch;
}

async function pure() {
  process.env.STRIPE_SECRET_KEY = SK;
  const S = await import("../src/lib/stripe");

  /* ── form encoding ── */
  const f = S.stripeForm({
    mode: "payment",
    payment_method_types: ["us_bank_account", "card"],
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 62510, product_data: { name: "Invoice 0000170" } } }],
    metadata: { invoice_id: "inv_1" },
    skip: null,
    nope: undefined,
    flag: true,
    off: false,
    at: new Date("2026-11-20T12:00:00Z"),
    nan: Number.NaN,
  });
  assert.equal(f.get("mode"), "payment");
  assert.equal(f.get("payment_method_types[0]"), "us_bank_account");
  assert.equal(f.get("payment_method_types[1]"), "card");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "62510");
  assert.equal(f.get("line_items[0][price_data][product_data][name]"), "Invoice 0000170");
  assert.equal(f.get("line_items[0][quantity]"), "1");
  assert.equal(f.get("metadata[invoice_id]"), "inv_1");
  assert.equal(f.has("skip") || f.has("nope") || f.has("nan"), false, "null, undefined and NaN are left out");
  assert.equal(f.get("flag"), "true");
  assert.equal(f.get("off"), "false");
  assert.equal(f.get("at"), String(Date.parse("2026-11-20T12:00:00Z") / 1000));
  assert.equal(f.toString().includes("%5B"), true, "brackets are percent-encoded on the wire");
  ok("stripeForm: nested objects, indexed arrays, nulls dropped, booleans, dates as unix seconds");

  /* ── signature ── */
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_800_000_000;
  const good = S.signStripePayload(body, WHSEC, now);
  assert.equal(S.verifyStripeSignature(body, good, WHSEC, now), true, "valid");
  assert.equal(S.verifyStripeSignature(body, good, "whsec_other", now), false, "wrong secret");
  assert.equal(S.verifyStripeSignature(`${body} `, good, WHSEC, now), false, "body changed by one byte");
  assert.equal(S.verifyStripeSignature(body, good, WHSEC, now + 301), false, "older than 5 minutes");
  assert.equal(S.verifyStripeSignature(body, good, WHSEC, now + 300), true, "exactly 5 minutes is still fine");
  assert.equal(S.verifyStripeSignature(body, good, WHSEC, now - 301), false, "from the future");
  assert.equal(S.verifyStripeSignature(body, null, WHSEC, now), false, "no header");
  assert.equal(S.verifyStripeSignature(body, good, "", now), false, "no secret");
  assert.equal(S.verifyStripeSignature(body, "garbage", WHSEC, now), false, "garbage header");
  assert.equal(S.verifyStripeSignature(body, `t=${now}`, WHSEC, now), false, "no v1");
  const v1 = good.split("v1=")[1];
  assert.equal(S.verifyStripeSignature(body, `t=${now},v1=${"0".repeat(64)},v1=${v1}`, WHSEC, now), true, "one of several v1 matches (secret rolling)");
  assert.equal(S.verifyStripeSignature(body, `t=${now},v0=${v1}`, WHSEC, now), false, "v0 is never accepted");
  assert.equal(S.verifyStripeSignature(body, `t=${now + 1},v1=${v1}`, WHSEC, now), false, "the timestamp is part of what is signed");
  assert.equal(S.verifyStripeSignature(body, `t=${now},v1=${v1.toUpperCase()}`, WHSEC, now), true, "hex case doesn't matter");
  ok("verifyStripeSignature: HMAC over t.body, every v1, 5 minute tolerance, tampering and wrong secrets refused");

  /* ── the Checkout Session request ── */
  installFakeStripe();
  const s = await S.createCheckoutSession({
    invoiceId: "inv_1", number: "0000170", amountCents: 62510, customerEmail: "sam@sample-taco.test", methods: ["us_bank_account"],
    successUrl: "https://hq.example.test/i/tok?lang=en&paid=1", cancelUrl: "https://hq.example.test/i/tok?lang=en", locale: "zh-TW",
    idempotencyKey: "chk_test_1", expiresAt: new Date(Date.now() + 3_600_000),
  });
  const c = calls.at(-1)!;
  assert.equal(s.url.startsWith("https://checkout.stripe.com/"), true);
  assert.equal(c.method, "POST");
  assert.equal(c.headers.authorization, `Bearer ${SK}`);
  assert.equal(c.headers["idempotency-key"], "chk_test_1");
  assert.equal(c.headers["content-type"], "application/x-www-form-urlencoded");
  const b = c.body;
  assert.equal(b.get("mode"), "payment");
  assert.deepEqual(b.getAll("payment_method_types[0]"), ["us_bank_account"]);
  assert.equal(b.has("payment_method_types[1]"), false, "card only when asked for");
  assert.equal(b.get("line_items[0][price_data][unit_amount]"), "62510");
  assert.equal(b.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(b.has("line_items[1][quantity]"), false, "ONE line: never a surcharge or fee line");
  assert.equal(b.get("payment_method_options[us_bank_account][verification_method]"), "instant", "bank: instant verification only (a started transfer is a real debit)");
  assert.equal(b.get("metadata[invoice_id]"), "inv_1");
  assert.equal(b.get("payment_intent_data[metadata][invoice_id]"), "inv_1");
  assert.equal(b.get("client_reference_id"), "inv_1");
  assert.equal(b.get("customer_email"), "sam@sample-taco.test");
  assert.equal(b.get("locale"), "zh-TW");
  assert.equal(b.get("success_url"), "https://hq.example.test/i/tok?lang=en&paid=1");
  assert.equal(b.get("cancel_url"), "https://hq.example.test/i/tok?lang=en");
  assert.ok(Number(b.get("expires_at")) > Date.now() / 1000 + 3000);
  for (const k of b.keys()) assert.equal(/^(customer$|customer_creation|setup_future_usage|payment_intent_data\[setup_future_usage\]|saved_payment_method_options)/.test(k), false, `bank reuse is not used: no ${k}`);
  ok("createCheckoutSession: one line for the amount, bank only, metadata + client_reference_id, locale, idempotency key, no customer / saving");

  failNextCreate = true;
  await assert.rejects(
    S.createCheckoutSession({ invoiceId: "inv_1", number: "0000170", amountCents: 62510, customerEmail: null, methods: ["card"], successUrl: "https://x.test/a", cancelUrl: "https://x.test/b", locale: "en" }),
    (e: Error) => e instanceof S.StripeApiError && /Invalid locale/.test(e.message) && !e.message.includes(SK),
  );
  await assert.rejects(S.createCheckoutSession({ invoiceId: "i", number: "1", amountCents: 49, customerEmail: null, methods: ["card"], successUrl: "https://x.test/a", cancelUrl: "https://x.test/b", locale: "en" }), /too small/);
  await assert.rejects(S.createCheckoutSession({ invoiceId: "i", number: "1", amountCents: 5000, customerEmail: null, methods: [], successUrl: "https://x.test/a", cancelUrl: "https://x.test/b", locale: "en" }), /No way to pay online/);
  const before = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  await assert.rejects(S.createCheckoutSession({ invoiceId: "i", number: "1", amountCents: 5000, customerEmail: null, methods: ["card"], successUrl: "https://x.test/a", cancelUrl: "https://x.test/b", locale: "en" }), /not set up/);
  process.env.STRIPE_SECRET_KEY = before;
  ok("Stripe errors: Stripe's own message, never the key; refuses under 50 cents, no method, no key");

  piType = "card";
  assert.deepEqual(await S.getPaymentIntentFacts("pi_mock_123456"), { feeCents: 1843, methodType: "card" });
  assert.equal(calls.at(-1)!.url.includes("expand%5B0%5D=latest_charge.balance_transaction"), true);
  assert.deepEqual(await S.getPaymentIntentFacts("not-a-pi"), { feeCents: null, methodType: null });
  ok("getPaymentIntentFacts: the fee and the way paid, from the PaymentIntent's latest charge");
}

async function ops() {
  const dir = process.env.PGLITE_DIR ?? "";
  if (process.env.DATABASE_URL) throw new Error("Refusing: DATABASE_URL is set. This test needs a throwaway PGlite (PGLITE_DIR=$(mktemp -d)).");
  if (/\.data[\\/]pglite\/?$/.test(dir) || (existsSync(dir) && readdirSync(dir).length > 0)) {
    throw new Error("Refusing: set PGLITE_DIR to a NEW empty folder, e.g. PGLITE_DIR=$(mktemp -d). Never the dev data in ./.data.");
  }
  process.env.STRIPE_SECRET_KEY = SK;
  process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
  process.env.APP_URL = "https://hq.example.test";
  installFakeStripe();

  const { getDb, schema } = await import("../src/lib/db");
  const inv = await import("../src/lib/ops-invoices");
  const st = await import("../src/lib/ops-stripe");
  const { signStripePayload } = await import("../src/lib/stripe");
  const { today: todayNY } = await import("../src/lib/dates");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  const NORA = "nora@local";
  const today = todayNY();
  const tokenOf = (url: string | null) => decodeURIComponent(new URL(url!).pathname.split("/")[2]);
  const sessionsMade = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/checkout/sessions")).length;
  const lastSession = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/checkout/sessions")).at(-1)!.body;

  await inv.saveInvoiceSettings({ fromName: "Nora Chen", fromAddress: "100 Sample St\nSampleton, VA 23000", zelle: "(555) 010-0100", achEnabled: true, cardEnabled: false }, NORA);
  const two = [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }, { description: "Food Stipend", quantity: 1, unitCents: 7510 }];
  const bank = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Bistro", email: "owner@sample-bistro.test" }, items: two, payWays: ["zelle", "bank"] }, NORA, { today, origin: "https://hq.example.test" });
  assert.ok(bank.payUrl, "an invoice with bank transfer online has a pay link");
  const tok = tokenOf(bank.payUrl);

  /* ── starting a checkout ── */
  const n0 = sessionsMade();
  const first = await st.startCheckout(tok, { origin: "https://hq.example.test", lang: "zh-Hans" });
  assert.equal(first.reused, false);
  assert.equal(first.url.startsWith("https://checkout.stripe.com/"), true);
  const body1 = lastSession();
  assert.equal(body1.get("line_items[0][price_data][unit_amount]"), String(bank.balanceCents), "the amount is the balance read from the database");
  assert.equal(body1.get("line_items[0][price_data][product_data][name]"), `Invoice ${bank.number}`);
  assert.deepEqual([body1.get("payment_method_types[0]"), body1.get("payment_method_types[1]")], ["us_bank_account", null], "card is off: bank only");
  assert.equal(body1.get("metadata[invoice_id]"), bank.id);
  assert.equal(body1.get("customer_email"), "owner@sample-bistro.test");
  assert.equal(body1.get("locale"), "zh");
  assert.equal(body1.get("success_url"), `https://hq.example.test/i/${tok}?lang=zh-Hans&paid=1`);
  assert.equal(body1.get("cancel_url"), `https://hq.example.test/i/${tok}?lang=zh-Hans`);
  assert.equal(body1.has("customer"), false, "no Stripe Customer (bank reuse not used)");
  const again = await st.startCheckout(tok, { origin: "https://hq.example.test" });
  assert.equal(again.reused, true);
  assert.equal(again.sessionId, first.sessionId);
  assert.equal(sessionsMade() - n0, 1, "the open session for the same amount is reused: one Stripe call for two presses");
  const [row1] = await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, first.sessionId));
  assert.equal(row1.status, "open");
  assert.equal(row1.amountCents, bank.balanceCents);
  assert.equal(row1.method, "stripe_ach");
  ok(`startCheckout: ${bank.number} for ${bank.balanceCents} cents from the database, bank only, reused on a second press`);

  // The balance changes (a person records a Zelle payment): a new session for the new amount, the old one expired.
  await inv.recordPayment(bank.id, { amountCents: 10000, paidOn: today, method: "zelle", reference: null, note: null }, NORA);
  const third = await st.startCheckout(tok, { origin: "https://hq.example.test" });
  assert.equal(third.reused, false);
  assert.equal(lastSession().get("line_items[0][price_data][unit_amount]"), String(bank.balanceCents - 10000), "the new balance");
  await new Promise((r) => setTimeout(r, 100)); // the expiry runs after the response
  assert.ok(calls.some((c) => c.url.endsWith(`/checkout/sessions/${first.sessionId}/expire`)), "the older session was expired at Stripe");
  const [old] = await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, first.sessionId));
  assert.equal(old.status, "expired");
  ok("startCheckout: after a payment the new balance gets a new session and the old one is expired");

  // Refusals.
  const zelleOnly = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Cafe" }, items: two }, NORA, { today });
  const zTok = tokenOf(await inv.getInvoiceLink(zelleOnly.id, NORA, { origin: "https://hq.example.test" }));
  await assert.rejects(st.startCheckout(zTok, { origin: "https://hq.example.test" }), (e: Error) => e instanceof st.PayOnlineError && e.key === "unavailable");
  await assert.rejects(st.startCheckout("sample-invoice-nope-0000000000000000000000000", {}), (e: Error) => e instanceof st.PayLinkGoneError);
  await assert.rejects(st.startCheckout("short", {}), (e: Error) => e instanceof st.PayLinkGoneError);
  delete process.env.STRIPE_SECRET_KEY;
  await assert.rejects(st.startCheckout(tok, { origin: "https://hq.example.test" }), (e: Error) => e instanceof st.PayOnlineError && e.key === "unavailable");
  process.env.STRIPE_SECRET_KEY = SK;
  failNextCreate = true;
  await inv.recordPayment(bank.id, { amountCents: 100, paidOn: today, method: "zelle", reference: null, note: null }, NORA); // new amount: no reuse
  await assert.rejects(st.startCheckout(tok, { origin: "https://hq.example.test" }), (e: Error) => e instanceof st.PayOnlineError && e.key === "failed");
  ok("startCheckout refuses: Zelle-only invoice, unknown link, Stripe not set up, Stripe error (shown as 'failed')");

  // Card only when it is on in Settings, and only when the invoice asks for it.
  await inv.saveInvoiceSettings({ cardEnabled: true }, NORA);
  const both = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Deli" }, items: two, payWays: ["bank", "card"] }, NORA, { today, origin: "https://hq.example.test" });
  const bothTok = tokenOf(both.payUrl);
  await st.startCheckout(bothTok, { origin: "https://hq.example.test" });
  assert.deepEqual([lastSession().get("payment_method_types[0]"), lastSession().get("payment_method_types[1]")], ["us_bank_account", "card"]);
  await inv.saveInvoiceSettings({ cardEnabled: false }, NORA);
  const bothAfter = await inv.getInvoiceByToken(bothTok);
  assert.equal(bothAfter.state === "open" && bothAfter.options.some((o) => o.way === "card"), false, "card turned off in Settings: the page stops offering it");
  ok("card is offered only while it is on in Settings and the invoice chose it");

  /* ── the per-invoice limit (one atomic counter) ── */
  const t0 = new Date("2026-11-20T15:00:00Z");
  const claims = await Promise.all(Array.from({ length: 10 }, () => st.claimCheckoutSlot("inv_rate_test", t0)));
  assert.equal(claims.filter(Boolean).length, st.CHECKOUTS_PER_HOUR, "10 at once: exactly the hourly limit get through");
  assert.equal(await st.claimCheckoutSlot("inv_rate_test", new Date(t0.getTime() + 30 * 60_000)), false, "still full half an hour later");
  let day = 0;
  for (let h = 1; h <= 4; h++) for (let i = 0; i < 6; i++) if (await st.claimCheckoutSlot("inv_rate_test", new Date(t0.getTime() + h * 3_600_001))) day++;
  assert.equal(st.CHECKOUTS_PER_HOUR + day, st.CHECKOUTS_PER_DAY, "the daily limit caps it across hours");
  assert.equal(await st.claimCheckoutSlot("inv_rate_test", new Date(t0.getTime() + 25 * 3_600_000)), true, "a day later it works again");
  ok(`checkout limit: ${st.CHECKOUTS_PER_HOUR} an hour, ${st.CHECKOUTS_PER_DAY} a day per invoice, safe under parallel presses`);

  /* ── the webhook ── */
  let evtN = 0;
  const nowSec = () => Math.floor(Date.now() / 1000);
  const deliver = (type: string, session: Record<string, unknown>, opts: { id?: string; secret?: string } = {}) => {
    const id = opts.id ?? `evt_mock_${++evtN}`;
    const raw = JSON.stringify({ id, object: "event", type, created: nowSec(), livemode: false, data: { object: { object: "checkout.session", mode: "payment", currency: "usd", ...session } } });
    return { id, res: st.handleStripeEvent(raw, signStripePayload(raw, opts.secret ?? WHSEC, nowSec())) };
  };
  const after = await inv.getInvoiceByToken(tok);
  assert.equal(after.state, "open");
  const owed = after.state === "open" ? after.invoice.balanceCents : 0;
  // The $1 recorded above closed the page opened before it (its amount was stale): the customer opens a new one.
  assert.equal((await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, third.sessionId)))[0].status, "expired", "a recorded payment closes the page opened for the old balance");
  const live = await st.startCheckout(tok, { origin: "https://hq.example.test" });
  assert.equal(lastSession().get("line_items[0][price_data][unit_amount]"), String(owed));
  const s3 = live.sessionId;
  const sess = (extra: Record<string, unknown> = {}) => ({ id: s3, client_reference_id: bank.id, metadata: { invoice_id: bank.id }, amount_total: owed, payment_intent: "pi_mock_bank0001", payment_method_types: ["us_bank_account"], ...extra });

  assert.equal((await deliver("checkout.session.completed", sess({ payment_status: "unpaid" }), { secret: "whsec_wrong" }).res).status, 400, "bad signature: 400");
  const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await deliver("checkout.session.completed", sess({ payment_status: "unpaid" })).res).status, 400, "not configured: 400");
  process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
  const ignored = await deliver("payment_intent.created", { id: "pi_x" }).res;
  assert.deepEqual([ignored.status, ignored.body.outcome], [200, "ignored"]);
  assert.equal((await db.select().from(schema.stripeEvents)).length, 0, "nothing stored for events we don't handle or can't verify");

  // Bank transfer started: processing; the page says so and Pay online is refused meanwhile.
  const started = await deliver("checkout.session.completed", sess({ payment_status: "unpaid" })).res;
  assert.deepEqual([started.status, started.body.outcome], [200, "processing"]);
  const clearing = await inv.getInvoiceByToken(tok);
  assert.equal(clearing.state === "open" && clearing.invoice.processing[0]?.amountCents, owed, "the page shows the bank payment on its way (the session's amount)");
  await assert.rejects(st.startCheckout(tok, { origin: "https://hq.example.test" }), (e: Error) => e instanceof st.PayOnlineError && e.key === "processing");
  // Bank transfer cleared: one stripe_ach payment for amount_total, with Stripe's fee; the invoice is paid.
  piType = "us_bank_account";
  const cleared = deliver("checkout.session.async_payment_succeeded", sess({ payment_status: "paid" }));
  const clearedRes = await cleared.res;
  assert.deepEqual([clearedRes.status, clearedRes.body.outcome], [200, "recorded"]);
  const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, bank.id));
  const stripePay = pays.find((p) => p.stripeSessionId === s3)!;
  assert.equal(stripePay.method, "stripe_ach");
  assert.equal(stripePay.amountCents, owed);
  assert.equal(stripePay.feeCents, 500);
  assert.equal(stripePay.recordedBy, "system");
  assert.equal(stripePay.stripePaymentIntentId, "pi_mock_bank0001");
  const paidNow = await inv.getInvoice(bank.id);
  assert.equal(paidNow?.status, "paid");
  const [row3] = await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, s3));
  assert.equal(row3.status, "paid");
  // Replays: the same event id is a no-op; another event for the same session records nothing more.
  const replay = await deliver("checkout.session.async_payment_succeeded", sess({ payment_status: "paid" }), { id: cleared.id }).res;
  assert.deepEqual([replay.status, replay.body.outcome], [200, "duplicate"]);
  const resend = await deliver("checkout.session.completed", sess({ payment_status: "paid" })).res;
  assert.deepEqual([resend.status, resend.body.outcome], [200, "already_recorded"]);
  assert.equal((await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.stripeSessionId, s3))).length, 1, "recorded once");
  await assert.rejects(st.startCheckout(tok, { origin: "https://hq.example.test" }), (e: Error) => e instanceof st.PayOnlineError && e.key === "paid");
  ok("webhook, bank: started → processing (Pay online refused), cleared → one stripe_ach payment with fee, paid; replays are no-ops");

  // Card: completed + paid records at once, as stripe_card, for what Stripe actually charged.
  piType = "card";
  const cardInv = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Grill" }, items: two }, NORA, { today });
  const cardRes = await deliver("checkout.session.completed", { id: "cs_test_card0001", client_reference_id: cardInv.id, metadata: { invoice_id: cardInv.id }, amount_total: 30000, payment_status: "paid", payment_intent: { id: "pi_mock_card0001" }, payment_method_types: ["us_bank_account", "card"] }).res;
  assert.deepEqual([cardRes.status, cardRes.body.outcome], [200, "recorded"]);
  const [cardPay] = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.stripeSessionId, "cs_test_card0001"));
  assert.deepEqual([cardPay.method, cardPay.amountCents, cardPay.feeCents], ["stripe_card", 30000, 1843]);
  assert.equal((await inv.getInvoice(cardInv.id))?.status, "partially_paid", "the amount actually paid, not the invoice total");
  ok("webhook, card: recorded at once as stripe_card for amount_total (a partial amount leaves it partly paid)");

  // Bank transfer failed: the checkout is failed, a log line, the invoice stays owed and Pay online works again.
  piType = "us_bank_account";
  const failInv = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Noodles" }, items: two, payWays: ["zelle", "bank"] }, NORA, { today, origin: "https://hq.example.test" });
  const fTok = tokenOf(failInv.payUrl);
  const fs1 = await st.startCheckout(fTok, { origin: "https://hq.example.test" });
  const fsess = { id: fs1.sessionId, client_reference_id: failInv.id, metadata: { invoice_id: failInv.id }, amount_total: failInv.balanceCents, payment_intent: "pi_mock_fail0001", payment_method_types: ["us_bank_account"] };
  await deliver("checkout.session.completed", { ...fsess, payment_status: "unpaid" }).res;
  const failed = await deliver("checkout.session.async_payment_failed", { ...fsess, payment_status: "unpaid" }).res;
  assert.deepEqual([failed.status, failed.body.outcome], [200, "failed"]);
  const [fRow] = await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, fs1.sessionId));
  assert.equal(fRow.status, "failed");
  assert.equal((await inv.getInvoice(failInv.id))?.paidCents, 0);
  const acts = await db.select().from(schema.activity).where(eq(schema.activity.entityId, failInv.id));
  const failLog = acts.find((a) => a.action === "invoice.stripe_failed");
  assert.ok(failLog, "the failure is in the activity log");
  assert.equal(/\$|\d+\.\d{2}/.test(failLog!.summary), false, "no amount in the activity log");
  const retry = await st.startCheckout(fTok, { origin: "https://hq.example.test" });
  assert.equal(retry.reused, false, "a failed session is never handed out again: a new one");
  ok("webhook, bank failed: checkout failed, logged without the amount, invoice still owed, Pay online available again");
}

async function opsMore() {
  const { getDb, schema } = await import("../src/lib/db");
  const st = await import("../src/lib/ops-stripe");
  const inv = await import("../src/lib/ops-invoices");
  const { signStripePayload } = await import("../src/lib/stripe");
  const { today: todayNY } = await import("../src/lib/dates");
  const { eq, sql } = await import("drizzle-orm");
  const db = await getDb();
  const NORA = "nora@local";
  const today = todayNY();
  const nowSec = () => Math.floor(Date.now() / 1000);
  const send = (id: string, type: string, session: Record<string, unknown>) => {
    const raw = JSON.stringify({ id, object: "event", type, created: nowSec(), data: { object: { object: "checkout.session", mode: "payment", currency: "usd", ...session } } });
    return st.handleStripeEvent(raw, signStripePayload(raw, WHSEC, nowSec()));
  };
  const two = [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }];
  const x = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Bakery" }, items: two, payWays: ["zelle", "bank"] }, NORA, { today, origin: "https://hq.example.test" });

  // Only sessions carrying our metadata count, and the two ids we set must agree.
  const noMeta = await send("evt_more_1", "checkout.session.completed", { id: "cs_test_other01", amount_total: 1000, payment_status: "paid" });
  assert.equal(noMeta.body.outcome, "ignored", "a session Nora HQ didn't start (no metadata) is ignored");
  const mismatch = await send("evt_more_2", "checkout.session.completed", { id: "cs_test_other02", client_reference_id: "inv_someone_else", metadata: { invoice_id: x.id }, amount_total: 1000, payment_status: "paid" });
  assert.equal(mismatch.body.outcome, "ignored", "metadata and client_reference_id disagree: ignored");
  const eur = await send("evt_more_3", "checkout.session.completed", { id: "cs_test_other03", client_reference_id: x.id, metadata: { invoice_id: x.id }, amount_total: 1000, currency: "eur", payment_status: "paid" });
  assert.equal(eur.body.outcome, "ignored", "not USD: ignored");
  assert.equal((await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, x.id))).length, 0, "nothing recorded for any of them");
  // A session started for one invoice can't pay another (its checkout row names the invoice).
  const tokX = decodeURIComponent(new URL(x.payUrl!).pathname.split("/")[2]);
  const sx = await st.startCheckout(tokX, { origin: "https://hq.example.test" });
  const other = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Tea" }, items: two }, NORA, { today });
  const swapped = await send("evt_more_4", "checkout.session.completed", { id: sx.sessionId, client_reference_id: other.id, metadata: { invoice_id: other.id }, amount_total: 55000, payment_status: "paid" });
  assert.equal(swapped.body.outcome, "ignored", "a session can't be pointed at another invoice");
  ok("webhook: only our sessions count (metadata, client_reference_id, the checkout row, USD)");

  // Expired: the open checkout is marked expired.
  const exp = await send("evt_more_5", "checkout.session.expired", { id: sx.sessionId, client_reference_id: x.id, metadata: { invoice_id: x.id }, amount_total: 55000, payment_status: "unpaid" });
  assert.equal(exp.body.outcome, "expired");
  const [ex] = await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, sx.sessionId));
  assert.equal(ex.status, "expired");
  ok("webhook: checkout.session.expired marks the checkout expired");

  // An event that failed earlier (claimed, never processed) is processed when Stripe retries it.
  await db.insert(schema.stripeEvents).values({ id: "evt_more_retry", type: "checkout.session.completed", error: "earlier failure (mock)" });
  const retried = await send("evt_more_retry", "checkout.session.completed", { id: "cs_test_retry01", client_reference_id: x.id, metadata: { invoice_id: x.id }, amount_total: 55000, payment_status: "paid", payment_intent: "pi_mock_retry001" });
  assert.equal(retried.body.outcome, "recorded");
  const [ev] = await db.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.id, "evt_more_retry"));
  assert.equal(ev.attempts, 2);
  assert.ok(ev.processedAt);
  assert.equal(ev.error, null);
  ok("webhook: a failed event is retried (attempts 2) and then marked processed");

  // A void invoice's link: gone for Pay online too.
  const v = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Sample Void" }, items: two, payWays: ["zelle", "bank"] }, NORA, { today, origin: "https://hq.example.test" });
  await inv.voidInvoice(v.id, NORA, { reason: "test" });
  await assert.rejects(st.startCheckout(decodeURIComponent(new URL(v.payUrl!).pathname.split("/")[2]), { origin: "https://hq.example.test" }), (e: Error) => e instanceof st.PayLinkGoneError);
  ok("startCheckout: a cancelled invoice's link is gone (404)");

  // Nothing secret stored anywhere.
  const dump = JSON.stringify(await db.execute(sql`select * from stripe_events`)) + JSON.stringify(await db.execute(sql`select * from invoice_checkouts`)) +
    JSON.stringify(await db.execute(sql`select * from app_settings`)) + JSON.stringify(await db.execute(sql`select * from activity`)) + JSON.stringify(await db.execute(sql`select * from invoice_payments`));
  for (const secret of [SK, WHSEC, "sk_test", "whsec_"]) assert.equal(dump.includes(secret), false, `no ${secret} in the database`);
  const custs = await db.select({ s: schema.customers.stripeCustomerId }).from(schema.customers);
  assert.equal(custs.every((c) => c.s == null), true, "no Stripe Customer id kept (bank reuse not used)");
  ok("no key, webhook secret or Stripe Customer id in the database");
}

async function main() {
  await pure();
  if (process.env.PGLITE_DIR) {
    await ops();
    await opsMore();
  } else console.log("(skipped the database part: set PGLITE_DIR=$(mktemp -d) to run it)");
  const leaked = calls.filter((c) => !c.url.startsWith("https://api.stripe.com/v1/"));
  assert.equal(leaked.length, 0);
  console.log(`\nall Stripe tests passed (${calls.length} mocked Stripe calls, none left the machine)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
