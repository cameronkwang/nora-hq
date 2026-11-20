import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe, used ONLY to take a payment online (Checkout: bank transfer "us_bank_account" and card). Nora HQ makes its
 * own invoices, so there is no Stripe Invoicing (it adds about 0.4%) and no Stripe npm package: the REST API is
 * called with fetch and form encoding. Keys live only in env vars and never reach the database, logs or MCP output:
 *   STRIPE_SECRET_KEY     sk_live_… / sk_test_… (or a restricted key: Checkout Sessions write, PaymentIntents read)
 *   STRIPE_WEBHOOK_SECRET whsec_… for POST /api/stripe/webhook
 * Without STRIPE_SECRET_KEY, invoices simply show no "Pay online" (Zelle and check still work). See docs/invoicing.md
 * and docs/stripe-setup.md. Pay online is offered only on invoices whose ways include "bank" (bank transfer, the
 * online option) or "card" (off unless turned on in Settings). Never a surcharge or fee added for either.
 *
 * Bank reuse (docs/stripe-setup.md "Saved bank accounts"): researched and NOT used. Stripe's hosted Checkout only
 * prefills a returning customer's saved CARD, so a saved bank account would not skip the bank login, and Stripe's
 * docs don't say a reused account avoids the instant-verification fee. So no session sets `customer`,
 * `customer_creation` or `setup_future_usage`, and customers.stripe_customer_id stays empty. `stripeCustomerId` is
 * kept on the input only so the interface doesn't change if Stripe adds it; lib/ops-stripe never passes one.
 *
 * Everything here is either pure (stripeForm, verifyStripeSignature) or one REST call. Errors never carry the key:
 * a failed call throws StripeApiError with Stripe's error type / code and its own message (which never holds a key).
 */

export const STRIPE_API = "https://api.stripe.com/v1";
/** Stripe's documented replay window for webhook signatures. */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;
/** A Checkout Session stays open this long (Stripe allows 30 minutes to 24 hours). */
export const CHECKOUT_SESSION_TTL_SEC = 60 * 60;
/** How long one REST call may take before it is given up. */
const STRIPE_TIMEOUT_MS = 10_000;

/** True when Pay online can be offered (STRIPE_SECRET_KEY is set). Never returns or logs the key. */
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY?.trim();
}

/** True when the webhook can verify events (STRIPE_WEBHOOK_SECRET is set). */
export function stripeWebhookConfigured(): boolean {
  return !!process.env.STRIPE_WEBHOOK_SECRET?.trim();
}

/** "sk_test_…" keys: the settings card says "Test mode". */
export function stripeTestMode(): boolean {
  return /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? "");
}

export type CheckoutMethod = "us_bank_account" | "card";

export type CreateCheckoutInput = {
  invoiceId: string;
  /** "0000170": the product name the customer sees on Stripe's page is "Invoice 0000170". */
  number: string;
  /** What is still owed, in cents (USD). */
  amountCents: number;
  customerEmail: string | null;
  methods: CheckoutMethod[];
  successUrl: string;
  cancelUrl: string;
  /** Stripe Checkout's page language: "en" | "zh" | "zh-TW". */
  locale: "en" | "zh" | "zh-TW";
  /** Bank reuse is not used (see the top of this file): always null from lib/ops-stripe. */
  stripeCustomerId?: string | null;
  /** Sent as Stripe's Idempotency-Key, so a retried request can't make a second session. */
  idempotencyKey?: string;
  /** When the session stops working (default: CHECKOUT_SESSION_TTL_SEC from now). */
  expiresAt?: Date;
};

/** customerId: Stripe's Customer on the session (null: no customer is ever made, see "Bank reuse" above). */
export type CheckoutSession = { id: string; url: string; expiresAt: Date; customerId?: string | null };

/** A Stripe API call failed. `message` is Stripe's own text (safe to log: it never holds the key). */
export class StripeApiError extends Error {
  constructor(message: string, readonly status: number, readonly type: string | null, readonly code: string | null) {
    super(message);
    this.name = "StripeApiError";
  }
}

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeApiError("Pay online is not set up (STRIPE_SECRET_KEY is missing).", 0, null, "not_configured");
  return key;
}

/** One call to Stripe's REST API. Form encoded, bearer key, optional idempotency key, 10 second timeout. */
async function stripeRequest<T>(method: "GET" | "POST", path: string, opts: { form?: URLSearchParams; query?: URLSearchParams; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey()}` };
  if (opts.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const qs = opts.query?.toString();
  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers,
      body: opts.form?.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new StripeApiError(`Stripe could not be reached (${e instanceof Error ? e.name : "network error"}).`, 0, null, "network");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string; type?: string; code?: string } }) | null;
  if (!res.ok || !body) {
    const err = body?.error;
    throw new StripeApiError(err?.message?.slice(0, 300) || `Stripe answered ${res.status}.`, res.status, err?.type ?? null, err?.code ?? null);
  }
  return body;
}

/**
 * POST /v1/checkout/sessions: mode payment, one line "Invoice 0000170" for exactly `amountCents` (the balance read
 * from the database by lib/ops-stripe, never from the request), metadata.invoice_id on the session and its
 * PaymentIntent, client_reference_id = the invoice id. No surcharge line, ever.
 */
export async function createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 50) throw new StripeApiError("The amount is too small to pay online.", 0, null, "amount_too_small");
  const methods = [...new Set(input.methods)].filter((m) => m === "us_bank_account" || m === "card");
  if (!methods.length) throw new StripeApiError("No way to pay online is on.", 0, null, "no_methods");
  const expiresAt = input.expiresAt ?? new Date(Date.now() + CHECKOUT_SESSION_TTL_SEC * 1000);
  const name = `Invoice ${input.number}`;
  const customer = input.stripeCustomerId && /^cus_[A-Za-z0-9]{6,64}$/.test(input.stripeCustomerId) ? input.stripeCustomerId : null;
  const form = stripeForm({
    mode: "payment",
    submit_type: "pay",
    payment_method_types: methods,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: input.amountCents, product_data: { name } } }],
    client_reference_id: input.invoiceId,
    metadata: { invoice_id: input.invoiceId },
    payment_intent_data: { description: name, metadata: { invoice_id: input.invoiceId } },
    // Exactly one of these: Stripe refuses both. `customer` only if bank reuse is ever turned on (it isn't).
    customer: customer ?? undefined,
    customer_email: customer ? undefined : input.customerEmail?.trim() || undefined,
    locale: input.locale,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
  });
  const s = await stripeRequest<{ id?: string; url?: string | null; expires_at?: number; customer?: string | { id?: string } | null }>("POST", "/checkout/sessions", {
    form,
    idempotencyKey: input.idempotencyKey,
  });
  if (!s.id || !s.url) throw new StripeApiError("Stripe did not return a checkout page.", 200, null, "no_url");
  const cust = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
  return { id: s.id, url: s.url, expiresAt: s.expires_at ? new Date(s.expires_at * 1000) : expiresAt, customerId: cust };
}

/** POST /v1/checkout/sessions/<id>/expire: an older open session for a different amount stops working. */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) return;
  await stripeRequest("POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, { form: new URLSearchParams() });
}

/** What the webhook reads from a PaymentIntent: Stripe's real fee and which way was used. Both null when unknown. */
export type PaymentIntentFacts = { feeCents: number | null; methodType: CheckoutMethod | null };

/**
 * GET /v1/payment_intents/<id>?expand[]=latest_charge.balance_transaction: the fee Stripe kept (balance
 * transaction `fee`, cents) and the payment method type of the charge ("us_bank_account" or "card").
 */
export async function getPaymentIntentFacts(paymentIntentId: string): Promise<PaymentIntentFacts> {
  if (!/^pi_[A-Za-z0-9_]{6,200}$/.test(paymentIntentId)) return { feeCents: null, methodType: null };
  type Charge = { payment_method_details?: { type?: string } | null; balance_transaction?: { fee?: number } | string | null };
  const pi = await stripeRequest<{ latest_charge?: Charge | string | null }>("GET", `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    query: stripeForm({ expand: ["latest_charge.balance_transaction"] }),
  });
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  const type = charge?.payment_method_details?.type;
  return {
    feeCents: bt && Number.isInteger(bt.fee) && (bt.fee as number) >= 0 ? (bt.fee as number) : null,
    methodType: type === "us_bank_account" || type === "card" ? type : null,
  };
}

/**
 * Stripe-Signature check: t=<unix>,v1=<hex>[,v1=…]. Expected = HMAC-SHA256(secret, `${t}.${rawBody}`) in hex,
 * compared in constant time against every v1; t must be within toleranceSec of now. Pure (no env read).
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = STRIPE_SIGNATURE_TOLERANCE_SEC): boolean {
  if (!header || !secret || header.length > 4096) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) sigs.push(v.toLowerCase());
  }
  if (t == null || !sigs.length) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex"), "utf8");
  let ok = false;
  for (const s of sigs) {
    const got = Buffer.from(s, "utf8");
    if (got.length === expected.length && timingSafeEqual(got, expected)) ok = true; // no early exit: same work for every v1
  }
  return ok;
}

/** The Stripe-Signature header for a body (tests and local tools only; the real one comes from Stripe). Pure. */
export function signStripePayload(rawBody: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSec},v1=${createHmac("sha256", secret).update(`${nowSec}.${rawBody}`, "utf8").digest("hex")}`;
}

/**
 * Nested object → Stripe form encoding (a[b][0][c]=…). Arrays are indexed (payment_method_types[0]=card); null and
 * undefined are left out; booleans become "true" / "false"; Dates become unix seconds. Pure.
 */
export function stripeForm(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (key: string, v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${key}[${i}]`, item));
    else if (v instanceof Date) out.append(key, String(Math.floor(v.getTime() / 1000)));
    else if (typeof v === "object") for (const [k, inner] of Object.entries(v as Record<string, unknown>)) walk(`${key}[${k}]`, inner);
    else if (typeof v === "boolean") out.append(key, v ? "true" : "false");
    else if (typeof v === "number") {
      if (Number.isFinite(v)) out.append(key, String(v));
    } else out.append(key, String(v));
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out;
}
