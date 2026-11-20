import "server-only";
import { after } from "next/server";
import { and, desc, eq, gt, inArray, like, ne, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { today as todayNY } from "./dates";
import { intakeBaseUrl } from "./ops-intake";
import { personEmail, sendToAll, sendToUser } from "./notify";
import { getInvoiceByToken, recordStripePayment } from "./ops-invoices";
import { formatCents, type StripePaymentMethod } from "./invoices-types";
import type { IntakeLangCode } from "./intake-copy";
import {
  CHECKOUT_SESSION_TTL_SEC,
  StripeApiError,
  createCheckoutSession,
  expireCheckoutSession,
  getPaymentIntentFacts,
  stripeConfigured,
  verifyStripeSignature,
  type CheckoutMethod,
} from "./stripe";

/**
 * Pay online (Stripe Checkout) for the customer's page /i/<token>, and the Stripe webhook. docs/invoicing.md
 * "Stripe (Pay online)" and docs/stripe-setup.md.
 *
 * - startCheckout (actor "public", the pay page's POST /i/<token>/pay): the amount is ALWAYS the invoice's balance
 *   read here from the database, never anything the request sent. Only for an invoice whose chosen ways include bank
 *   transfer or card and only while that way is on (lib/invoices-types payOptions: Stripe set up, the setting on).
 *   Refused for a void or paid invoice and while a bank payment is clearing. An open session for the same amount is
 *   reused; otherwise a new one is made (at most CHECKOUTS_PER_HOUR / CHECKOUTS_PER_DAY per invoice: one atomic
 *   counter, the drop link's pattern) and older open ones for another amount are expired at Stripe.
 * - handleStripeEvent (the webhook): checks the signature on the raw body (5 minute tolerance), claims the event id
 *   in ONE statement (a processed event is a no-op, a failed one is retried by Stripe), then:
 *     checkout.session.completed            paid (card) → records the payment; unpaid (bank started) → "processing"
 *     checkout.session.async_payment_succeeded         → records the payment (bank transfer cleared)
 *     checkout.session.async_payment_failed            → "failed", and a push to Nora
 *     checkout.session.expired                         → "expired"
 *   The invoice comes from metadata.invoice_id (set by us; it must agree with client_reference_id), the amount from
 *   amount_total (what was actually paid), the method stripe_ach / stripe_card. recordStripePayment (lib/ops-invoices)
 *   is idempotent on the session id, so the payment is recorded once however often Stripe delivers.
 *
 * Stored: invoice_checkouts (session id, url, amount, status, method, expiry) and stripe_events (id, type, attempts,
 * a short error). Never a card or bank detail, never the event payload, never a key. No Stripe Customer is made or
 * kept: bank reuse doesn't work through hosted Checkout (see lib/stripe). Nothing here ever adds a fee.
 */

/** New Checkout Sessions one invoice may start: per hour and per day. Reuse of an open one doesn't count. */
export const CHECKOUTS_PER_HOUR = 6;
export const CHECKOUTS_PER_DAY = 20;
/** An open session closer than this to its expiry isn't handed out again (the customer needs time to pay). */
const REUSE_MARGIN_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const PAY_ERROR_KEYS = ["unavailable", "paid", "processing", "rateLimited", "failed"] as const;
export type PayErrorKey = (typeof PAY_ERROR_KEYS)[number];
export const isPayErrorKey = (v: unknown): v is PayErrorKey => typeof v === "string" && (PAY_ERROR_KEYS as readonly string[]).includes(v);

/** Pay online can't start. `key` picks the words on the page (lib/invoice-copy page.errors). */
export class PayOnlineError extends OpsError {
  constructor(readonly key: PayErrorKey) {
    super(`Pay online refused: ${key}`);
  }
}
/** The link isn't (or is no longer) an invoice the customer can see: the route answers 404. */
export class PayLinkGoneError extends OpsError {
  constructor() {
    super("Not found.");
  }
}

const STRIPE_LOCALE: Record<IntakeLangCode, "en" | "zh" | "zh-TW"> = { en: "en", "zh-Hans": "zh", "zh-Hant": "zh-TW" };
const errName = (e: unknown) => (e instanceof StripeApiError ? `${e.status} ${e.type ?? ""} ${e.code ?? ""} ${e.message}`.trim() : e instanceof Error ? e.message : "unknown error");

/** Runs after the response when inside a request (next/server after), otherwise right away (scripts). Never throws. */
function inBackground(label: string, fn: () => Promise<unknown>) {
  const run = () => fn().then(() => undefined, (e) => console.error(`[stripe] ${label} failed:`, errName(e)));
  try {
    after(run);
  } catch {
    void run();
  }
}

/* ───────────────────────── Starting a checkout (public) ───────────────────────── */

const rateKey = (invoiceId: string) => `stripe.checkout_rate.${invoiceId}`;

/**
 * Takes one of the invoice's new-session slots for this hour and day; false when there is none left. ONE statement:
 * the counters live in an app_settings row per invoice (like notify's throttle slots) and are checked and bumped by
 * INSERT … ON CONFLICT DO UPDATE … WHERE, which locks the row, so a burst of parallel requests can't all slip under.
 */
export async function claimCheckoutSlot(invoiceId: string, now = new Date()): Promise<boolean> {
  const db = await getDb();
  const s = schema.appSettings;
  const at = now.toISOString();
  const v = sql`${s.value}`;
  const hourOver = sql`((${v}->>'h') is null or (${v}->>'h')::timestamptz <= ${new Date(now.getTime() - HOUR_MS).toISOString()}::timestamptz)`;
  const dayOver = sql`((${v}->>'d') is null or (${v}->>'d')::timestamptz <= ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz)`;
  const hc = sql`coalesce((${v}->>'hc')::int, 0)`;
  const dc = sql`coalesce((${v}->>'dc')::int, 0)`;
  const rows = await db.insert(s)
    .values({ key: rateKey(invoiceId), value: { h: at, hc: 1, d: at, dc: 1 }, updatedBy: "public", updatedAt: now })
    .onConflictDoUpdate({
      target: s.key,
      set: {
        value: sql`jsonb_build_object(
          'h', case when ${hourOver} then ${at}::text else ${v}->>'h' end,
          'hc', case when ${hourOver} then 1 else ${hc} + 1 end,
          'd', case when ${dayOver} then ${at}::text else ${v}->>'d' end,
          'dc', case when ${dayOver} then 1 else ${dc} + 1 end)`,
        updatedBy: "public",
        updatedAt: now,
      },
      setWhere: sql`(${hourOver} or ${hc} < ${CHECKOUTS_PER_HOUR}) and (${dayOver} or ${dc} < ${CHECKOUTS_PER_DAY})`,
    })
    .returning({ key: s.key });
  return rows.length > 0;
}

/** The customer's page, as the Checkout's way back. APP_URL if set, else the origin the request came in on. */
function payPageUrl(token: string, lang: IntakeLangCode, origin: string | null | undefined, extra?: string): string {
  const base = intakeBaseUrl(origin);
  if (!/^https?:\/\//.test(base)) throw new PayOnlineError("failed"); // Stripe needs an absolute URL
  return `${base}/i/${encodeURIComponent(token)}?lang=${lang}${extra ? `&${extra}` : ""}`;
}

/**
 * Starts (or reuses) a Stripe Checkout Session for what is still owed on the invoice behind `token`. Throws
 * PayLinkGoneError for an unknown or void link, PayOnlineError(key) when it can't start. Returns Stripe's page URL.
 */
export async function startCheckout(
  token: unknown,
  opts: { origin?: string | null; lang?: IntakeLangCode | null; now?: Date } = {},
): Promise<{ url: string; reused: boolean; sessionId: string }> {
  const now = opts.now ?? new Date();
  const found = await getInvoiceByToken(token);
  if (found.state !== "open") throw new PayLinkGoneError();
  const { invoice: inv, options } = found;
  const lang = opts.lang ?? inv.lang ?? "en";
  if (!stripeConfigured()) throw new PayOnlineError("unavailable");
  if (inv.display === "paid" || inv.balanceCents <= 0) throw new PayOnlineError("paid");
  // Exactly the invoice's chosen online ways that are on right now (payOptions already dropped the rest).
  const methods: CheckoutMethod[] = [];
  if (options.some((o) => o.way === "bank")) methods.push("us_bank_account");
  if (options.some((o) => o.way === "card")) methods.push("card");
  if (!methods.length) throw new PayOnlineError("unavailable");
  if (inv.processing.length) throw new PayOnlineError("processing");
  const amountCents = inv.balanceCents; // from the database, never from the request
  if (amountCents < 50) throw new PayOnlineError("unavailable"); // Stripe's minimum charge

  const db = await getDb();
  const c = schema.invoiceCheckouts;
  const [open] = await db.select().from(c)
    .where(and(
      eq(c.invoiceId, inv.id), eq(c.status, "open"), like(c.sessionId, "cs_%"), eq(c.amountCents, amountCents),
      gt(c.expiresAt, new Date(now.getTime() + REUSE_MARGIN_MS)),
    ))
    .orderBy(desc(c.createdAt)).limit(1);
  if (open?.url) return { url: open.url, reused: true, sessionId: open.sessionId };

  if (!(await claimCheckoutSlot(inv.id, now))) throw new PayOnlineError("rateLimited");
  const [cust] = await db.select({ email: schema.customers.email }).from(schema.invoices)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
    .where(eq(schema.invoices.id, inv.id));
  const id = newId("chk_");
  let session;
  try {
    session = await createCheckoutSession({
      invoiceId: inv.id,
      number: inv.number,
      amountCents,
      customerEmail: cust?.email ?? null,
      methods,
      successUrl: payPageUrl(String(token), lang, opts.origin, "paid=1"),
      cancelUrl: payPageUrl(String(token), lang, opts.origin),
      locale: STRIPE_LOCALE[lang] ?? "en",
      stripeCustomerId: null, // bank reuse: not used (lib/stripe)
      idempotencyKey: id,
      expiresAt: new Date(now.getTime() + CHECKOUT_SESSION_TTL_SEC * 1000),
    });
  } catch (e) {
    if (e instanceof PayOnlineError) throw e;
    console.error("[stripe] checkout session failed:", errName(e));
    throw new PayOnlineError("failed");
  }
  await db.insert(c).values({
    id,
    invoiceId: inv.id,
    sessionId: session.id,
    url: session.url,
    amountCents,
    status: "open",
    method: methods.length === 1 ? (methods[0] === "card" ? "stripe_card" : "stripe_ach") : null,
    expiresAt: session.expiresAt,
  }).onConflictDoNothing({ target: c.sessionId });
  // Older open sessions (another amount: the balance changed) stop working, so a stale tab can't pay the old figure.
  inBackground("expire older sessions", async () => {
    const older = await db.select({ sessionId: c.sessionId }).from(c)
      .where(and(eq(c.invoiceId, inv.id), eq(c.status, "open"), like(c.sessionId, "cs_%"), ne(c.sessionId, session.id)));
    for (const o of older) {
      try {
        await expireCheckoutSession(o.sessionId);
      } catch (e) {
        console.error("[stripe] expire failed:", errName(e)); // it expires by itself within the hour anyway
        continue;
      }
      await db.update(c).set({ status: "expired", updatedAt: new Date() }).where(and(eq(c.sessionId, o.sessionId), eq(c.status, "open")));
    }
  });
  return { url: session.url, reused: false, sessionId: session.id };
}

/* ───────────────────────── The webhook (Stripe → us) ───────────────────────── */

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;
type HandledEvent = (typeof HANDLED_EVENTS)[number];

/** The parts of a Checkout Session the webhook reads (Stripe sends much more; nothing else is kept). */
type StripeSession = {
  id?: unknown;
  object?: unknown;
  mode?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  client_reference_id?: unknown;
  metadata?: { invoice_id?: unknown } | null;
  payment_intent?: unknown;
  payment_method_types?: unknown;
};
type StripeEventBody = { id?: unknown; type?: unknown; created?: unknown; data?: { object?: StripeSession } };

export type WebhookOutcome = "recorded" | "already_recorded" | "processing" | "failed" | "expired" | "ignored" | "duplicate";
export type WebhookResult = { status: number; body: { received: boolean; outcome?: WebhookOutcome; error?: string } };

/** Claims Stripe's event id: true = process it now; false = it was processed already. ONE statement. */
async function claimEvent(id: string, type: string): Promise<boolean> {
  const db = await getDb();
  const e = schema.stripeEvents;
  const rows = await db.insert(e).values({ id, type: type.slice(0, 80) })
    .onConflictDoUpdate({ target: e.id, set: { attempts: sql`${e.attempts} + 1` }, setWhere: sql`${e.processedAt} is null` })
    .returning({ id: e.id });
  return rows.length > 0;
}

async function markEvent(id: string, error: string | null) {
  const db = await getDb();
  const e = schema.stripeEvents;
  await db.update(e).set(error ? { error: error.slice(0, 200) } : { processedAt: new Date(), error: null }).where(eq(e.id, id));
}

const str = (v: unknown, max = 255): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as { id?: unknown }).id) : null);

/**
 * POST /api/stripe/webhook. `rawBody` is the exact request body (the signature is over it). Answers:
 * 400 not configured / bad signature / not JSON; 200 for a handled, duplicate or ignored event; 500 when handling
 * failed (Stripe retries, and the claim lets the retry through). Never echoes the payload or a secret.
 */
export async function handleStripeEvent(rawBody: string, signature: string | null, opts: { nowSec?: number } = {}): Promise<WebhookResult> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return { status: 400, body: { received: false, error: "Webhook not configured." } };
  if (!verifyStripeSignature(rawBody, signature, secret, opts.nowSec)) return { status: 400, body: { received: false, error: "Bad signature." } };
  let event: StripeEventBody;
  try {
    event = JSON.parse(rawBody) as StripeEventBody;
  } catch {
    return { status: 400, body: { received: false, error: "Not JSON." } };
  }
  const id = str(event.id, 120);
  const type = str(event.type, 120);
  if (!id || !type) return { status: 400, body: { received: false, error: "Not an event." } };
  if (!(HANDLED_EVENTS as readonly string[]).includes(type)) return { status: 200, body: { received: true, outcome: "ignored" } };
  if (!(await claimEvent(id, type))) return { status: 200, body: { received: true, outcome: "duplicate" } };
  try {
    const outcome = await processEvent(type as HandledEvent, event);
    await markEvent(id, null);
    return { status: 200, body: { received: true, outcome } };
  } catch (e) {
    const msg = errName(e);
    console.error(`[stripe] ${type} ${id} failed:`, msg);
    await markEvent(id, msg).catch(() => undefined);
    return { status: 500, body: { received: false, error: "Handling failed; Stripe will retry." } };
  }
}

async function processEvent(type: HandledEvent, event: StripeEventBody): Promise<WebhookOutcome> {
  const s = event.data?.object;
  const sessionId = str(s?.id, 255);
  if (!s || s.object !== "checkout.session" || !sessionId?.startsWith("cs_")) return "ignored";
  const invoiceId = str(s.metadata?.invoice_id, 80);
  // Only sessions Nora HQ started carry our metadata; the two ids we set must agree.
  if (!invoiceId || (s.client_reference_id != null && s.client_reference_id !== invoiceId)) return "ignored";
  if (s.mode !== "payment") return "ignored";

  const db = await getDb();
  const c = schema.invoiceCheckouts;
  const [row] = await db.select().from(c).where(eq(c.sessionId, sessionId));
  if (row && row.invoiceId !== invoiceId) {
    console.error(`[stripe] session ${sessionId} names another invoice than the one it was started for; ignored`);
    return "ignored";
  }
  const setStatus = (status: schema.InvoiceCheckout["status"], from: schema.InvoiceCheckout["status"][], method?: StripePaymentMethod | null) =>
    db.update(c).set({ status, ...(method ? { method } : {}), updatedAt: new Date() }).where(and(eq(c.sessionId, sessionId), inArray(c.status, from)));

  if (type === "checkout.session.expired") {
    await setStatus("expired", ["open"]);
    return "expired";
  }
  if (type === "checkout.session.async_payment_failed") {
    await setStatus("failed", ["open", "processing"], "stripe_ach");
    await bankPaymentFailed(invoiceId, s);
    return "failed";
  }
  if (type === "checkout.session.completed" && s.payment_status !== "paid") {
    if (s.payment_status !== "unpaid") return "ignored"; // no_payment_required: nothing to record
    await setStatus("processing", ["open"], "stripe_ach"); // a bank transfer was started and is clearing
    return "processing";
  }
  // Paid: completed with payment_status "paid" (card, or a bank account that cleared at once) or async succeeded.
  if (s.payment_status !== "paid") return "ignored";
  if ((str(s.currency, 3) ?? "usd") !== "usd") return "ignored";
  const amountCents = typeof s.amount_total === "number" && Number.isInteger(s.amount_total) && s.amount_total > 0 ? s.amount_total : null;
  if (!amountCents) return "ignored";

  const paymentIntentId = idOf(s.payment_intent);
  let facts: Awaited<ReturnType<typeof getPaymentIntentFacts>> = { feeCents: null, methodType: null };
  if (paymentIntentId) {
    try {
      facts = await getPaymentIntentFacts(paymentIntentId);
    } catch (e) {
      console.error("[stripe] fee lookup skipped:", errName(e)); // the fee is nice to have, never a reason to fail
    }
  }
  const types = Array.isArray(s.payment_method_types) ? s.payment_method_types : [];
  const method: StripePaymentMethod =
    facts.methodType === "us_bank_account" ? "stripe_ach"
    : facts.methodType === "card" ? "stripe_card"
    : row?.method ?? (type === "checkout.session.async_payment_succeeded" || (types.length === 1 && types[0] === "us_bank_account") ? "stripe_ach" : "stripe_card");
  const createdSec = typeof event.created === "number" ? event.created : null;
  const res = await recordStripePayment({
    invoiceId,
    sessionId,
    paymentIntentId,
    amountCents,
    method,
    paidOn: todayNY(createdSec ? new Date(createdSec * 1000) : new Date()),
    feeCents: facts.feeCents,
    stripeCustomerId: null, // bank reuse is not used: no Stripe Customer is kept
  });
  await setStatus("paid", ["open", "processing", "failed", "expired"], method);
  if (!res.invoice) {
    console.error(`[stripe] session ${sessionId}: its invoice is gone; nothing recorded`);
    return "ignored";
  }
  return res.recorded ? "recorded" : "already_recorded";
}

/** A bank transfer bounced: the invoice stays owed. Logged, and Nora gets a push (no amount in the log). */
async function bankPaymentFailed(invoiceId: string, s: StripeSession) {
  const db = await getDb();
  const [row] = await db.select({ number: schema.invoices.number, name: schema.customers.name }).from(schema.invoices)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
    .where(eq(schema.invoices.id, invoiceId));
  if (!row) return;
  const amount = typeof s.amount_total === "number" ? ` (${formatCents(s.amount_total)})` : "";
  await logActivity({
    actor: "system", action: "invoice.stripe_failed", entityType: "invoice", entityId: invoiceId,
    summary: `Stripe: a bank transfer for invoice ${row.number ?? ""} failed; it is still owed`,
  });
  const payload = { title: `Bank payment failed: ${row.name}`, body: `Invoice ${row.number ?? ""}${amount} is still owed. Their bank turned it down.`, url: `/invoices/${invoiceId}`, tag: `stripe-failed-${invoiceId}` };
  const nora = personEmail("nora");
  if (nora) await sendToUser(nora, "payment_overdue", payload);
  else await sendToAll("payment_overdue", payload);
}
