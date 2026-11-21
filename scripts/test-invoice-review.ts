/**
 * Regression checks for the invoicing review findings (money safety with Stripe, contracts and retainers, the
 * creator's server side, the PDF's letters). Each check stands alone and names what it guards, so one wrong answer
 * doesn't hide the others. A THROWAWAY PGlite database only (never the dev data, never Neon); Stripe is MOCKED (no
 * request leaves the machine). All values are fake.
 *   PGLITE_DIR=$(mktemp -d) npx tsx --require ./scripts/server-only-shim.cjs scripts/test-invoice-review.ts
 * Prints "ok" or "FAIL" per check and exits non-zero when any failed.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";

const SK = "sk_test_mock_000000000000000000000000";
const WHSEC = "whsec_mock_0000000000000000000000000000";
const O = "https://hq.example.test";

type Call = { url: string; method: string; body: URLSearchParams };
const calls: Call[] = [];
let sessionN = 0;
let createDelays: number[] = [];

/** Fake Stripe: Checkout Sessions (optionally slow), their expiry, a PaymentIntent with a fee. Anything else throws. */
function installFakeStripe() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://api.stripe.com/v1/")) throw new Error(`unexpected request to ${url}`);
    const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    const path = new URL(url).pathname;
    if (method === "POST" && path === "/v1/checkout/sessions") {
      sessionN++;
      const id = `cs_test_review${String(sessionN).padStart(4, "0")}`;
      const wait = createDelays.shift() ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      calls.push({ url, method, body });
      return json(200, { id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Number(body.get("expires_at")), customer: null });
    }
    calls.push({ url, method, body });
    if (method === "POST" && /^\/v1\/checkout\/sessions\/cs_[^/]+\/expire$/.test(path)) return json(200, { id: path.split("/")[4], status: "expired" });
    if (method === "GET" && path.startsWith("/v1/payment_intents/")) return json(200, { id: path.split("/")[3], latest_charge: { id: "ch_mock", payment_method_details: { type: "us_bank_account" }, balance_transaction: { id: "txn_mock", fee: 500 } } });
    return json(404, { error: { type: "invalid_request_error", message: `No such path (mock): ${path}` } });
  }) as typeof fetch;
}

async function main() {
  const dir = process.env.PGLITE_DIR ?? "";
  if (process.env.DATABASE_URL) throw new Error("Refusing: DATABASE_URL is set. This test needs a throwaway PGlite (PGLITE_DIR=$(mktemp -d)).");
  if (!dir || /\.data[\\/]pglite\/?$/.test(dir) || (existsSync(dir) && readdirSync(dir).length > 0)) {
    throw new Error("Refusing: set PGLITE_DIR to a NEW empty folder, e.g. PGLITE_DIR=$(mktemp -d). Never the dev data in ./.data.");
  }
  process.env.STRIPE_SECRET_KEY = SK;
  process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
  process.env.APP_URL = O;
  installFakeStripe();

  const { getDb, schema } = await import("../src/lib/db");
  const inv = await import("../src/lib/ops-invoices");
  const st = await import("../src/lib/ops-stripe");
  const S = await import("../src/lib/stripe");
  const T = await import("../src/lib/invoices-types");
  const deals = await import("../src/lib/ops-deals");
  const { saveContract, listContractsWithInvoices } = await import("../src/lib/ops-contracts");
  const { defaultFields } = await import("../src/lib/contract");
  const { renderInvoicePdf } = await import("../src/lib/invoice-pdf");
  const { today: todayNY } = await import("../src/lib/dates");
  const { and, eq } = await import("drizzle-orm");
  const db = await getDb();
  const NORA = "nora@local";
  const CAM = "cameron@local";
  const today = todayNY();
  // The loose view of the modules: several checks call things the first version did not have.
  const invX = inv as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const TX = T as unknown as Record<string, (...a: unknown[]) => unknown>;

  let failed = 0;
  const results: string[] = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push(`ok    ${name}`);
      console.log(`ok    ${name}`);
    } catch (e) {
      failed++;
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 220);
      results.push(`FAIL  ${name}: ${msg}`);
      console.log(`FAIL  ${name}: ${msg}`);
    }
  };

  const tokenOf = (url: string | null) => decodeURIComponent(new URL(url!).pathname.split("/")[2]);
  const expired = () => calls.filter((c) => /\/expire$/.test(c.url)).map((c) => c.url.split("/").at(-2));
  let evtN = 0;
  const event = (type: string, session: Record<string, unknown>) => {
    const raw = JSON.stringify({ id: `evt_review_${++evtN}`, type, created: Math.floor(Date.now() / 1000), data: { object: { object: "checkout.session", mode: "payment", currency: "usd", ...session } } });
    return st.handleStripeEvent(raw, S.signStripePayload(raw, WHSEC));
  };
  const rowOf = async (id: string) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];
  const chk = async (sid: string) => (await db.select().from(schema.invoiceCheckouts).where(eq(schema.invoiceCheckouts.sessionId, sid)))[0];
  const acts = async (id: string) => (await db.select().from(schema.activity).where(eq(schema.activity.entityId, id))).map((a) => `${a.action}: ${a.summary}`);
  const two = [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }, { description: "Food Stipend", quantity: 1, unitCents: 7510 }];
  const pkg = [{ description: "Standard Content Creation Package", quantity: 1, unitCents: 55000 }];
  const bankInvoice = async (name: string) => {
    const d = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name }, items: two, payWays: ["zelle", "bank"] }, NORA, { today, origin: O });
    return { ...d, tok: tokenOf(d.payUrl) };
  };
  const sess = (a: { id: string; balanceCents: number }, sid: string, pi: string) => ({ id: sid, amount_total: a.balanceCents, client_reference_id: a.id, metadata: { invoice_id: a.id }, payment_intent: pi, payment_method_types: ["us_bank_account"] });

  await inv.saveInvoiceSettings({ fromName: "Nora Chen", fromAddress: "100 Sample St\nSampleton, VA 23000", zelle: "(555) 010-0100", achEnabled: true, cardEnabled: false }, NORA);

  /* ───────── Stripe and money ───────── */

  await check("void is refused while a bank transfer is clearing (and allowed again once it fails)", async () => {
    const a = await bankInvoice("Review Clearing");
    const s = await st.startCheckout(a.tok, { origin: O });
    assert.equal((await event("checkout.session.completed", { ...sess(a, s.sessionId, "pi_review_000001"), payment_status: "unpaid" })).body.outcome, "processing");
    await assert.rejects(inv.voidInvoice(a.id, NORA), /bank payment is on its way/i);
    assert.equal((await rowOf(a.id)).status, "sent", "still owed, not void");
    await event("checkout.session.async_payment_failed", { ...sess(a, s.sessionId, "pi_review_000001"), payment_status: "unpaid" });
    assert.equal((await inv.voidInvoice(a.id, NORA)).status, "void", "after the transfer failed it can be voided");
  });

  await check("voiding an invoice closes its open Stripe page", async () => {
    const a = await bankInvoice("Review Void Open");
    const s = await st.startCheckout(a.tok, { origin: O });
    await inv.voidInvoice(a.id, NORA, { reason: "made by mistake" });
    assert.ok(expired().includes(s.sessionId), "the session was not expired at Stripe");
    assert.equal((await chk(s.sessionId)).status, "expired");
  });

  await check("a payment that still lands on a void invoice is logged for a refund (no amount in the log)", async () => {
    const a = await bankInvoice("Review Paid After Void");
    const s = await st.startCheckout(a.tok, { origin: O });
    await inv.voidInvoice(a.id, NORA);
    const r = await event("checkout.session.completed", { ...sess(a, s.sessionId, "pi_review_000002"), payment_status: "paid" });
    assert.equal(r.body.outcome, "recorded", "the money is still recorded");
    const log = (await acts(a.id)).find((x) => /cancelled/i.test(x) && /refund/i.test(x));
    assert.ok(log, `no "paid after it was cancelled" entry in ${JSON.stringify(await acts(a.id))}`);
    assert.doesNotMatch(log!, /\$\d|625/, "no amount in the activity log");
  });

  await check("recording the full amount by Zelle closes the open Stripe page (no second payment for the same invoice)", async () => {
    const a = await bankInvoice("Review Zelle Then Stripe");
    const s = await st.startCheckout(a.tok, { origin: O });
    await inv.recordPayment(a.id, { amountCents: a.balanceCents, paidOn: today, method: "zelle", reference: null, note: null }, NORA);
    assert.ok(expired().includes(s.sessionId), "the session was not expired at Stripe");
    assert.equal((await chk(s.sessionId)).status, "expired");
  });

  await check("paid twice (a Stripe payment on top of a full Zelle payment) is logged for a refund", async () => {
    const a = await bankInvoice("Review Paid Twice");
    const s = await st.startCheckout(a.tok, { origin: O });
    await inv.recordPayment(a.id, { amountCents: a.balanceCents, paidOn: today, method: "zelle", reference: null, note: null }, NORA);
    await event("checkout.session.completed", { ...sess(a, s.sessionId, "pi_review_000003"), payment_status: "paid" });
    const row = await rowOf(a.id);
    assert.equal(row.paidCents, 2 * row.totalCents, "the in-flight payment is still recorded");
    assert.ok((await acts(a.id)).some((x) => /paid twice/i.test(x) && /refund/i.test(x)), `no "paid twice" entry in ${JSON.stringify(await acts(a.id))}`);
  });

  await check("a partial payment, a deleted payment, an edited total and a new link each close the old Stripe page", async () => {
    const a = await bankInvoice("Review Stale Pages");
    const s1 = await st.startCheckout(a.tok, { origin: O });
    const p = await inv.recordPayment(a.id, { amountCents: 10000, paidOn: today, method: "zelle", reference: null, note: null }, NORA);
    assert.equal((await chk(s1.sessionId)).status, "expired", "after a partial payment");
    const s2 = await st.startCheckout(a.tok, { origin: O });
    await inv.deletePayment(p.payment.id, NORA);
    assert.equal((await chk(s2.sessionId)).status, "expired", "after a payment was deleted");
    const s3 = await st.startCheckout(a.tok, { origin: O });
    await inv.updateInvoice(a.id, { items: pkg }, NORA);
    assert.equal((await chk(s3.sessionId)).status, "expired", "after the total changed");
    const s4 = await st.startCheckout(a.tok, { origin: O });
    await inv.updateInvoice(a.id, { notes: "SAMPLE note" }, NORA);
    assert.equal((await chk(s4.sessionId)).status, "open", "an edit that keeps the total keeps the page");
    await inv.replaceInvoiceLink(a.id, NORA, { origin: O });
    assert.equal((await chk(s4.sessionId)).status, "expired", "after a new link");
  });

  await check("Pay online pressed twice: the page the browser follows stays open", async () => {
    const a = await bankInvoice("Review Double Press");
    createDelays = [300, 10];
    const p1 = st.startCheckout(a.tok, { origin: O });
    await new Promise((r) => setTimeout(r, 100));
    const p2 = st.startCheckout(a.tok, { origin: O });
    const [, second] = await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 250));
    createDelays = [];
    assert.equal((await chk(second.sessionId)).status, "open");
  });

  await check("two people recording the same payment at once: one is recorded, the other is refused", async () => {
    const a = await bankInvoice("Review Two Recorders");
    const pay = { amountCents: a.balanceCents, paidOn: today, method: "zelle" as const, reference: null, note: null };
    const res = await Promise.allSettled([inv.recordPayment(a.id, pay, NORA), inv.recordPayment(a.id, pay, CAM)]);
    const row = await rowOf(a.id);
    assert.deepEqual(res.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(row.paidCents, row.totalCents, "paid once");
    assert.equal(row.status, "paid");
    const rej = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rej.reason?.message), /already paid|more than/i, "refused in plain words");
    // And the money on the row is the true sum afterwards (the reservation never drifts).
    assert.equal((await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, a.id))).reduce((s, p) => s + p.amountCents, 0), row.paidCents);
  });

  await check("a payment above the balance is still refused and leaves the invoice untouched", async () => {
    const a = await bankInvoice("Review Over Balance");
    await assert.rejects(inv.recordPayment(a.id, { amountCents: a.balanceCents + 1, paidOn: today, method: "zelle" }, NORA), /more than the \$625\.10 still owed/);
    const row = await rowOf(a.id);
    assert.equal(row.paidCents, 0);
    assert.equal(row.status, "sent");
    const p = await inv.recordPayment(a.id, { amountCents: 20000, paidOn: today, method: "check", reference: "Check #1 (SAMPLE)" }, NORA);
    assert.equal(p.invoice.status, "partially_paid");
    assert.equal(p.invoice.paidCents, 20000);
  });

  await check("bank transfer Checkout asks for instant verification only (no slow micro-deposit path)", async () => {
    await S.createCheckoutSession({ invoiceId: "inv_1", number: "0000170", amountCents: 62510, customerEmail: null, methods: ["us_bank_account"], successUrl: `${O}/a`, cancelUrl: `${O}/b`, locale: "en" });
    assert.equal(calls.at(-1)!.body.get("payment_method_options[us_bank_account][verification_method]"), "instant");
    await S.createCheckoutSession({ invoiceId: "inv_1", number: "0000170", amountCents: 62510, customerEmail: null, methods: ["card"], successUrl: `${O}/a`, cancelUrl: `${O}/b`, locale: "en" });
    assert.equal([...calls.at(-1)!.body.keys()].some((k) => k.startsWith("payment_method_options")), false, "card only: no bank options");
  });

  /* ───────── the creator's server side ───────── */

  await check("editing a sent invoice opens with its discount and private note", async () => {
    const made = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Review Edit Bistro" }, items: two, discountCents: 1000, discountLabel: "Repeat customer", privateNotes: "SAMPLE: agreed $10 off by text" }, NORA, { today });
    const e = (await invX.getInvoiceEditContext(made.id, { today })) as { ctx: { prefill: Record<string, unknown> }; edit: { id: string; customerName: string } } | null;
    assert.ok(e, "no edit context");
    assert.equal(e!.ctx.prefill.discountCents, 1000);
    assert.equal(e!.ctx.prefill.discountLabel, "Repeat customer");
    assert.equal(e!.ctx.prefill.privateNotes, "SAMPLE: agreed $10 off by text");
    assert.equal(e!.edit.customerName, "Review Edit Bistro");
  });

  await check("Make PDF pressed again after a lost response returns the same invoice (no second one, no number spent)", async () => {
    const requestId = "review-retry-0000000001";
    const input = { billTo: { kind: "new" as const, name: "Review Retry Cafe" }, items: two, requestId };
    const first = await inv.createAndFinalizeInvoice(input, NORA, { today });
    const next = await inv.nextInvoiceNumber();
    const again = await inv.createAndFinalizeInvoice(input, NORA, { today });
    assert.equal(again.id, first.id);
    assert.equal(again.number, first.number);
    assert.equal(await inv.nextInvoiceNumber(), next, "the retry spent no number");
    assert.equal((await inv.listInvoices({ q: "Review Retry Cafe", status: "everything" })).length, 1);
    const other = await inv.createAndFinalizeInvoice({ ...input, requestId: "review-retry-0000000002" }, NORA, { today });
    assert.notEqual(other.id, first.id, "a new form makes a new invoice");
  });

  await check("Same as last time is the last invoice she MADE: never an unsent draft", async () => {
    const made = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Review Returning Taco" }, items: two }, NORA, { today });
    await inv.saveQuickDraft({ billTo: { kind: "customer", id: made.customerId }, items: [{ description: "Instagram Reel (SAMPLE)", quantity: 1, unitCents: 45000 }] }, NORA, { today });
    const last = await inv.lastInvoiceForCustomer(made.customerId);
    assert.equal(last?.number, made.number);
    assert.deepEqual(last?.lines.map((l) => [l.description, l.unitCents]), [["Standard Content Creation Package", 55000], ["Food Stipend", null]]);
    const ctx = await inv.getInvoiceCreatorContext({ today, customerId: made.customerId });
    assert.equal(ctx.prefill.last?.number, made.number, "the prefill's Same as last time");
  });

  await check("Same as last time is not offered from a Skynova import's placeholder line", async () => {
    await inv.saveSkynovaImport("Invoice #\tCustomer\tDate\tTotal\tStatus\n0000090\tReview Imported Diner\t11/01/2026\t625.10\tSent", "invoices", NORA);
    const c = (await inv.listCustomers({ q: "Review Imported Diner" }))[0];
    assert.equal(await inv.lastInvoiceForCustomer(c.id), null);
    const ctx = await inv.getInvoiceCreatorContext({ today, customerId: c.id });
    const opt = ctx.prefill.billTo as unknown as { hasPastInvoices: boolean; hasLast?: boolean };
    assert.equal(opt.hasPastInvoices, true, "they do have an invoice (the list's label)");
    assert.equal(opt.hasLast, false, "but nothing to repeat");
    assert.equal(ctx.prefill.last ?? null, null);
  });

  await check("returning customers come with their last lines (Same as last time needs no round trip)", async () => {
    const ctx = await inv.getInvoiceCreatorContext({ today });
    const opt = ctx.billTo.find((o) => o.name === "Review Returning Taco") as unknown as { hasLast?: boolean; last?: { lines: unknown[] } | null };
    assert.equal(opt.hasLast, true);
    assert.equal(opt.last?.lines.length, 2);
  });

  await check("a deal for a managed business bills that business's customer (no duplicate customer)", async () => {
    const yrb = "yummy-red-bowl-richmond";
    const d1 = await deals.createDeal({ businessName: "Yummy Red Bowl", clientId: yrb, compType: "paid", amountCents: 55000 }, NORA, { askClaude: false });
    const c1 = await inv.getInvoiceCreatorContext({ today, dealId: d1.id });
    assert.ok(c1.prefill.billTo, "first deal: the business is matched");
    const first = await inv.createAndFinalizeInvoice({ billTo: { kind: c1.prefill.billTo!.kind, id: c1.prefill.billTo!.id }, items: pkg, dealId: d1.id }, NORA, { today });
    const d2 = await deals.createDeal({ businessName: "Yummy Red Bowl", clientId: yrb, compType: "paid", amountCents: 55000 }, NORA, { askClaude: false });
    const c2 = await inv.getInvoiceCreatorContext({ today, dealId: d2.id });
    assert.equal(c2.prefill.billTo?.customerId, first.customerId, `second deal opens as ${c2.prefill.billTo?.key ?? `new: ${c2.prefill.newCustomer?.name}`}`);
    assert.equal(c2.prefill.newCustomer, null);
    const byClient = await inv.getInvoiceCreatorContext({ today, clientId: yrb });
    assert.equal(byClient.prefill.billTo?.customerId, first.customerId, "?client= finds the customer too");
  });

  /* ───────── contracts and retainers ───────── */

  await check("a monthly contract never bills a month twice (Set up monthly invoices first, then Make the invoice)", async () => {
    const f = { ...defaultFields(today), kind: "monthly" as const, clientBusiness: "Review Monthly Diner", clientContact: "Mo Diner", fee: "800", paymentDays: "15", startDate: today };
    const cid = await saveContract({ fields: f }, NORA);
    const ret = await inv.createRetainerFromContract(cid, NORA, { today });
    assert.equal(ret.retainer.lastRunMonth, null, "nothing billed yet");
    const pre = await inv.invoicePrefillFromContract(cid, { today });
    await inv.createAndFinalizeInvoice({ billTo: pre!.billTo ? { kind: pre!.billTo.kind, id: pre!.billTo.id } : { kind: "new", name: "Review Monthly Diner" }, items: pre!.lines.map((l) => ({ description: l.description, quantity: 1, unitCents: l.unitCents! })), dueDate: pre!.dueDate, contractId: cid }, NORA, { today });
    // The cron on the last day of this month: the retainer's day has come whatever today is.
    const eom = `${today.slice(0, 7)}-28T15:00:00Z`;
    const run = await inv.runRetainers(new Date(eom));
    assert.deepEqual(run.created.filter((c) => c.customerName === "Review Monthly Diner"), [], "a second draft for the month already invoiced");
    assert.equal((await inv.listInvoices({ contractId: cid, status: "everything" })).length, 1);
    const row = (await listContractsWithInvoices(200, { today })).find((c) => c.id === cid)!;
    assert.deepEqual(row.nextSteps.map((s) => s.label), [], "nothing left to offer this month");
  });

  await check("Invoice this month is not offered once the contract's monthly invoices have this month", async () => {
    const f = { ...defaultFields(today), kind: "monthly" as const, clientBusiness: "Review Monthly Cafe", clientContact: "Mo Cafe", fee: "700", startDate: `${today.slice(0, 7)}-01` };
    const cid = await saveContract({ fields: f }, NORA);
    await inv.createRetainerFromContract(cid, NORA, { today });
    const run = await inv.runRetainers(new Date(`${today.slice(0, 7)}-28T15:00:00Z`));
    const mine = run.created.find((c) => c.customerName === "Review Monthly Cafe");
    assert.ok(mine, "the retainer made this month's draft");
    await inv.deleteDraftInvoice(mine!.invoiceId, NORA); // she deleted it: this month is still taken
    const row = (await listContractsWithInvoices(200, { today })).find((c) => c.id === cid)!;
    assert.deepEqual(row.nextSteps.map((s) => s.label), []);
  });

  await check("monthly drafts from a contract are due in the contract's payment days", async () => {
    const f = { ...defaultFields(today), kind: "monthly" as const, clientBusiness: "Review Terms Diner", clientContact: "Tee Diner", fee: "900", paymentDays: "15", startDate: `${today.slice(0, 7)}-01` };
    const cid = await saveContract({ fields: f }, NORA);
    await inv.createRetainerFromContract(cid, NORA, { today });
    const run = await inv.runRetainers(new Date(`${today.slice(0, 7)}-28T15:00:00Z`));
    const mine = run.created.find((c) => c.customerName === "Review Terms Diner");
    assert.ok(mine);
    assert.equal((await rowOf(mine!.invoiceId)).termsDays, 15);
    const fin = await inv.finalizeInvoice(mine!.invoiceId, NORA, { today });
    assert.equal(fin.invoice.dueDate, T.addDaysYmd(today, 15));
    // A retainer without a contract stays due on receipt.
    const c = await inv.createCustomer({ name: "Review Plain Retainer" }, NORA);
    await inv.createRetainer({ customerId: c.id, description: "Social media services", amountCents: 50000, dayOfMonth: 1 }, NORA);
    const run2 = await inv.runRetainers(new Date(`${today.slice(0, 7)}-28T15:00:00Z`));
    assert.equal((await rowOf(run2.created.find((x) => x.customerName === "Review Plain Retainer")!.invoiceId)).termsDays, 0);
  });

  await check("a contract made from a retainer's invoice takes that retainer (no second one)", async () => {
    const cust = await inv.createCustomer({ name: "Review Retainer Cafe", contactName: "Rae", email: "rae@retainer.test" }, NORA);
    await inv.createRetainer({ customerId: cust.id, description: "Social media services", amountCents: 80000, dayOfMonth: 1 }, NORA);
    const run = await inv.runRetainers(new Date(`${today.slice(0, 7)}-28T15:00:00Z`));
    const mine = run.created.find((c) => c.customerName === "Review Retainer Cafe")!;
    const fin = await inv.finalizeInvoice(mine.invoiceId, NORA, { today });
    const pre = await inv.contractPrefillFromInvoice(fin.invoice.id, { today });
    assert.equal(pre!.fields.kind, "monthly");
    const cid = await saveContract({ fields: { ...defaultFields(today), ...pre!.fields }, invoiceId: fin.invoice.id }, NORA);
    const row = (await listContractsWithInvoices(200, { today })).find((c) => c.id === cid)!;
    assert.equal(row.hasRetainer, true);
    assert.equal(row.nextSteps.some((s) => s.kind === "monthly_invoices"), false, "still offers Set up monthly invoices");
    assert.equal((await inv.createRetainerFromContract(cid, NORA, { today })).created, false);
    assert.equal((await inv.listRetainers(cust.id)).length, 1);
  });

  /* ───────── the PDF's letters ───────── */

  await check("the PDF's letters: what it can't print is known before the PDF is made, and agrees with the real font", async () => {
    assert.equal(TX.pdfUnprintable("SAMPLE Bakery 小点心"), "小点心");
    assert.equal(TX.pdfUnprintable("Crab O’Clock — “Café” …"), "", "curly quotes, dashes and accents print");
    assert.equal(TX.pdfText("SAMPLE Bakery 小点心"), "SAMPLE Bakery");
    assert.equal(TX.pdfText("老四川"), "");
    assert.equal(TX.pdfText("Crab O’Clock — “Café” …"), "Crab O'Clock - \"Café\" ...");
    // Every character of the Basic Multilingual Plane: the pure rule says "prints" exactly when Helvetica can encode it.
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const wrong: string[] = [];
    for (let cp = 0x20; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCharCode(cp);
      const kept = TX.pdfText(`a${ch}b`) as string;
      const middle = kept.slice(1, -1);
      let fontOk = true;
      try {
        font.encodeText(middle || ch);
      } catch {
        fontOk = false;
      }
      // What the rule keeps must be drawable; what it drops must be something the font can't draw (or a mapped character).
      if (middle && !fontOk) wrong.push(`U+${cp.toString(16)} kept but not drawable`);
      if (!middle && fontOk && ch.trim() && !(TX.pdfUnprintable(ch) as string)) wrong.push(`U+${cp.toString(16)} dropped silently`);
      if (wrong.length > 5) break;
    }
    assert.deepEqual(wrong, []);
  });

  await check("Make PDF refuses a customer or a line the PDF would print empty (Chinese only), and prints a mixed name", async () => {
    await assert.rejects(inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "老四川" }, items: pkg }, NORA, { today }), /English/);
    assert.equal((await inv.listCustomers({ q: "老四川" })).some((c) => c.invoiceCount > 0), false, "no invoice was made");
    await assert.rejects(inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "Review Sichuan House" }, items: [{ description: "探店视频", quantity: 1, unitCents: 55000 }] }, NORA, { today }), /English/);
    const mixed = await inv.createAndFinalizeInvoice({ billTo: { kind: "new", name: "湘味轩 Xiang Wei Xuan" }, items: [{ description: "探店视频 Reel", quantity: 1, unitCents: 55000 }] }, NORA, { today });
    const doc = (await inv.getInvoice(mixed.id, { today }))!.document;
    const bytes = await renderInvoicePdf(doc);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
    // A draft may still hold it (Claude or a person can save one); it is refused when the PDF is made.
    const d = await inv.saveQuickDraft({ billTo: { kind: "new", name: "老四川" }, items: pkg }, NORA, { today });
    await assert.rejects(inv.finalizeInvoice(d.id, NORA, { today }), /English/);
  });

  void and;
  console.log(`\n${results.length - failed} of ${results.length} review checks passed${failed ? `, ${failed} FAILED` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
