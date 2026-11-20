import "server-only";

/**
 * Stripe, used ONLY to take a payment online (Checkout: bank transfer "us_bank_account" and card). Nora HQ makes its
 * own invoices, so there is no Stripe Invoicing (it adds about 0.4%) and no Stripe npm package: the REST API is
 * called with fetch and form encoding. Keys live only in env vars and never reach the database, logs or MCP output:
 *   STRIPE_SECRET_KEY     sk_live_… / sk_test_… (or a restricted key: Checkout Sessions write, PaymentIntents read)
 *   STRIPE_WEBHOOK_SECRET whsec_… for POST /api/stripe/webhook
 * Without STRIPE_SECRET_KEY, invoices simply show no "Pay online" (Zelle and check still work). See docs/invoicing.md
 * and docs/stripe-setup.md.
 *
 * STATUS: interface only (design and schema step). stripeConfigured is real; the rest throw until the public_stripe
 * builder fills them in. Webhook events, idempotency and the invoice_checkouts rows live in lib/ops-stripe (theirs).
 */

export const STRIPE_API = "https://api.stripe.com/v1";
/** Stripe's documented replay window for webhook signatures. */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

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
  /** "INV-2026-0007": the product name the customer sees on Stripe's page. */
  number: string;
  /** What is still owed, in cents (USD). */
  amountCents: number;
  customerEmail: string | null;
  methods: CheckoutMethod[];
  successUrl: string;
  cancelUrl: string;
  /** Stripe Checkout's page language: "en" | "zh" | "zh-TW". */
  locale: "en" | "zh" | "zh-TW";
};

export type CheckoutSession = { id: string; url: string; expiresAt: Date };

/** POST /v1/checkout/sessions (mode payment, metadata.invoice_id, client_reference_id = invoiceId). */
export async function createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
  void input;
  throw new Error("Pay online is not built yet (createCheckoutSession).");
}

/**
 * Stripe-Signature check: t=<unix>,v1=<hex>[,v1=…]. Expected = HMAC-SHA256(secret, `${t}.${rawBody}`) in hex,
 * compared in constant time against every v1; t must be within toleranceSec of now. Pure (no env read).
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = STRIPE_SIGNATURE_TOLERANCE_SEC): boolean {
  void rawBody; void header; void secret; void nowSec; void toleranceSec;
  throw new Error("Pay online is not built yet (verifyStripeSignature).");
}

/** Nested object → Stripe form encoding (a[b][0][c]=…). Pure. */
export function stripeForm(params: Record<string, unknown>): URLSearchParams {
  void params;
  throw new Error("Pay online is not built yet (stripeForm).");
}
