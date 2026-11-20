import { NextResponse } from "next/server";
import { handleStripeEvent } from "@/lib/ops-stripe";

/**
 * POST /api/stripe/webhook: PUBLIC (middleware lets it through); it trusts only a valid Stripe-Signature over the raw
 * body, checked in lib/ops-stripe with STRIPE_WEBHOOK_SECRET (5 minute tolerance). Idempotent by event id and, for
 * payments, by the Checkout Session id. Events: checkout.session.completed, .async_payment_succeeded,
 * .async_payment_failed, .expired (docs/stripe-setup.md). Any other event: 200 and nothing happens.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stripe's events are a few KB; anything far bigger isn't one. */
const MAX_BODY_BYTES = 512 * 1024;

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return NextResponse.json({ received: false, error: "Too large." }, { status: 413 });
  const raw = await req.text(); // the exact bytes Stripe signed: never parse before verifying
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ received: false, error: "Too large." }, { status: 413 });
  const result = await handleStripeEvent(raw, req.headers.get("stripe-signature"));
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
