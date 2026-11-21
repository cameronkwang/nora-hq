# Stripe setup (Pay online)

Invoices are paid by **Zelle** unless an invoice also offers another way. Nora HQ makes its own invoices (no monthly
fee, no Stripe Invoicing) and uses Stripe for one thing only: when an invoice offers **Pay online**, the customer's
page (`/i/<token>`) sends them to Stripe's own secure Checkout page to pay by bank transfer (or by card, if card is
turned on). Nora HQ never sees or stores a card or bank number. Without the keys below everything else works and no
invoice offers paying online.

How it fits together: the customer taps **Pay online** → Nora HQ asks Stripe for a Checkout page for exactly what is
still owed (read from the database) → the customer pays on Stripe's page → Stripe tells Nora HQ through the webhook →
the payment is recorded on the invoice (by "system") and the invoice turns Paid. A bank transfer shows "A bank payment
of $625.10 is on its way" until it clears, about 4 business days later. If the bank turns it down, Nora gets a phone
notification ("Bank payment failed: <customer>") and the invoice stays owed.

## What it costs (in plain words)

- **No monthly fee.** Stripe charges only when someone pays online.
- **Bank transfer** (ACH Direct Debit): **0.8% of the payment, never more than $5**. When the customer connects their
  bank by logging in to it (Stripe's instant bank verification), Stripe also charges about **$1.50** for that
  verification. Customers who pay every month connect their bank each time (see "Saved bank accounts" below).
- **Card**: **2.9% + 30¢**. Card is **off** in Nora HQ unless a person turns it on in Settings.
- **Zelle, check, Venmo, PayPal**: Stripe isn't involved at all.
- **No surcharges, ever.** The customer pays the invoice amount, whatever way they pay. Stripe takes its fee out of
  what it sends Nora. Nora HQ never adds a "card fee" or any other line.

Example, an invoice for $625.10: Zelle, Nora gets $625.10. Bank transfer, Stripe keeps $5.00 (0.8% is $5.00, the
cap) plus about $1.50 for the bank login, so about $618.60. Card, Stripe keeps $18.43, so $606.67.
Stripe's real fee for each payment is saved on it when Stripe reports it, so the tax export (Invoices → Reports →
Export payments) shows the fee and the net.

Check Stripe's pricing page for today's numbers: <https://stripe.com/pricing> and
<https://stripe.com/financial-connections#pricing>.

## 1. Make the Stripe account

1. Go to <https://dashboard.stripe.com/register> and sign up with **noraeatsgood.manager@gmail.com** (Nora HQ's own
   Google account). It's free.
2. Fill in the business details Stripe asks for (Nora as a sole proprietor is fine) and her personal details for
   identity checks.
3. **Payout bank**: add the bank account Stripe should send the money to (Settings → Business → **Bank accounts and
   currencies**, or "Payouts"). Stripe pays out on its own schedule, usually 2 business days after a payment clears.

## 2. Turn on bank transfers

1. Settings → Payments → **Payment methods**.
2. Find **ACH Direct Debit** and turn it on. Stripe may ask a few questions first.
3. **Cards** can stay as they are. Nora HQ chooses the ways on each Checkout itself: bank transfer when the invoice
   asks for it, card only when card is turned on in Nora HQ's Settings (off by default) and the invoice asks for it.

## 3. Test mode first

Stripe has a test mode with its own keys (`sk_test_…`). Use it until a test payment works end to end.

1. In the Stripe dashboard, switch **Test mode** on (top right).
2. Developers → **API keys** → copy the **Secret key** (`sk_test_…`).
   - Optional, safer: make a **restricted key** instead, with write access to Checkout Sessions and read access to
     PaymentIntents, Charges and Balance transactions (that is all Nora HQ calls).
3. Vercel → Project → Settings → Environment Variables: set `STRIPE_SECRET_KEY` to it.
4. Developers → **Webhooks** → **Add endpoint**:
   - Endpoint URL: `https://ops.cameronwang.com/api/stripe/webhook` (that is, `${APP_URL}/api/stripe/webhook`).
   - Events to send (exactly these four):
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
     - `checkout.session.expired`
   - Save, then reveal the endpoint's **Signing secret** (`whsec_…`) and set it as `STRIPE_WEBHOOK_SECRET` in Vercel.
5. Redeploy. Settings → **Invoices and payments** now shows Pay online "On (test mode)".

Try it:

1. Make an invoice in Nora HQ and, under the ways to pay, tick **Bank transfer online** as well as Zelle.
2. Make the PDF, copy the customer link and open it in a private window. Tap **Pay online**.
3. On Stripe's page pick the bank option and Stripe's test bank ("Test Institution", the success account).
   For card (only if card is on): `4242 4242 4242 4242`, any future date, any CVC.
4. Back on the invoice page you'll see "Thank you!". A test bank payment first shows as "on its way" and is recorded
   once Stripe sends `async_payment_succeeded` (in test mode Stripe does that by itself, usually within minutes). A
   test card payment is recorded at once.
5. The invoice in Nora HQ now shows the payment (method "Bank transfer (Stripe)" or "Card (Stripe)") and the fee.
6. One more look, once: on Stripe's bank step there should be **no** "Enter bank details manually" choice (Nora HQ
   asks for instant verification only, so a started bank payment is always a real debit). If Stripe still offers
   it, tell whoever maintains Nora HQ before going live: with manual entry a payment can show as "on its way" for up
   to 10 days with nothing debited. This is the one thing that could not be tried from the build machine (it has no
   Stripe account); the setting itself is in Stripe's published API.

Locally: run `stripe listen --forward-to localhost:3200/api/stripe/webhook` (the Stripe CLI prints a `whsec_…` for
your machine) and start the dev server with `STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_…`.

## 4. Go live

1. Switch the dashboard out of test mode. Copy the live **Secret key** (`sk_live_…`).
2. Add the same webhook endpoint again **in live mode** (live and test endpoints have different signing secrets).
3. Put the live key and the live `whsec_…` into Vercel (Production) and redeploy. The Settings card then shows Pay online "On", without "(test mode)".

## How Nora HQ uses Stripe (for whoever maintains it)

- Code: `src/lib/stripe.ts` (REST calls with `fetch`, form encoding, the signature check), `src/lib/ops-stripe.ts`
  (starting a Checkout, the webhook events), `src/app/i/[token]/pay/route.ts`, `src/app/api/stripe/webhook/route.ts`.
  No Stripe npm package.
- **Checkout Session**: `mode=payment`, one line "Invoice 0000170" for **the balance read from the database** (never
  from the request), `payment_method_types` = `us_bank_account` and/or `card` (the invoice's online ways that are on),
  `metadata[invoice_id]` on the session and its PaymentIntent, `client_reference_id` = the invoice id,
  `customer_email` when known, the page's language (`en`, `zh`, `zh-TW`), back to the invoice page with `?paid=1` or
  without, open for one hour. An open session for the same amount is reused; a new one makes older open ones for
  ANOTHER amount expire (never one for the same amount: two presses at once must not expire the page the browser is
  following). With bank transfer the session asks for **instant verification only**
  (`payment_method_options[us_bank_account][verification_method]=instant`; Stripe's API takes `automatic`, its
  default, or `instant`): the customer signs in to their bank and the debit starts at once. The default would also
  let them type the account by hand and confirm two small deposits a day or two later; Checkout then finishes before
  any money moves, and the invoice would say "a bank payment is on its way" for up to 10 days with nothing debited.
  A customer whose bank can't be verified instantly pays by Zelle.
  At most 6 new sessions per invoice per hour and 20 per day (one atomic counter per invoice in `app_settings`, key
  `stripe.checkout_rate.<invoice id>`, the drop link's pattern). Refused for a paid or cancelled invoice and while a
  bank payment is clearing. The Pay online route only redirects to `https://checkout.stripe.com/…`; if a custom
  Checkout domain is ever set up in Stripe, add it there.
- **Webhook**: the raw body's `Stripe-Signature` is checked with `STRIPE_WEBHOOK_SECRET` (HMAC-SHA256, constant time,
  5 minute tolerance); a bad one is a 400. Each event id is claimed once in `stripe_events` (a processed event is a
  no-op; a failed one answers 500 so Stripe retries). The payment is recorded once per Checkout Session (unique
  session id), for `amount_total` (what was actually paid), as `stripe_ach` or `stripe_card`, with Stripe's fee from
  the PaymentIntent's balance transaction when that call works. Only sessions carrying our `metadata.invoice_id` count.
- **Open pages are closed when they stop being right**: when the invoice is voided, a payment is recorded or deleted,
  its total is edited, its link is replaced, a bank transfer starts on another page or a Stripe payment is recorded,
  every open Checkout Session for it is expired at Stripe (`POST /v1/checkout/sessions/<id>/expire`). An invoice
  can't be voided while a bank transfer is clearing. A payment already in flight can still land on a cancelled or
  paid invoice: it is recorded, and Nora gets a push, "Paid after it was cancelled" or "Paid twice", to refund it.
- **Stored**: the session id, its URL while open, amount, status (open, processing, paid, failed, expired) and method;
  event ids and types. Never a card or bank detail, never the event payload, never a key.
- **Keys** live only in Vercel env vars. They are never in the database, logs, error messages or Claude's tools.
- **Refunds** are done in the Stripe dashboard; then delete that payment on the invoice in Nora HQ.

## Saved bank accounts (researched: not used)

Question: a client who pays every month would pay the ~$1.50 instant bank verification each time. Could Checkout
show their already-verified bank again (a Stripe Customer per Nora HQ customer, `setup_future_usage` or
`saved_payment_method_options`) so it isn't charged twice?

What Stripe's documentation says (read through search results quoting Stripe's pages, Nov 2026; docs.stripe.com and
stripe.com could not be opened from the build machine, so nothing was tried in test mode):

- **Checkout can show a saved bank account, with settings.** Stripe's ACH migration guide says Checkout displays a
  customer's previously saved, *verified* US bank accounts when the session has `customer`, includes
  `us_bank_account` in `payment_method_types`, and sets `saved_payment_method_options[allow_redisplay_filters]` to
  the values the accounts were saved with; "bank accounts that are already verified don't need re-verification".
  <https://docs.stripe.com/payments/ach-direct-debit/migrating-from-charges>
- **But by default it shows only what the customer agreed to redisplay.** Checkout shows only payment methods with
  `allow_redisplay: always`; a method saved through a Checkout payment is saved as `limited` unless the customer
  ticks "save for later" (`saved_payment_method_options[payment_method_save]`), and Stripe's pages disagree on
  whether that box is offered for bank accounts on the hosted page ("only cards and ACH Direct Debit are supported
  for saved payment methods" on one, "You can't save other payment methods, such as bank accounts" on another, and
  the support article on prefilling covers cards only).
  <https://docs.stripe.com/payments/save-customer-payment-methods>, <https://docs.stripe.com/payments/save-during-payment>,
  <https://docs.stripe.com/payments/checkout/save-during-payment>, <https://support.stripe.com/questions/prefilling-saved-cards-in-checkout>
- **Saving a bank account is a mandate.** For ACH, `payment_intent_data[setup_future_usage]` saves the account under
  a mandate that lets the business debit it later itself, which is more than "the customer pays this invoice".
  <https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment>, <https://docs.stripe.com/payments/ach-direct-debit/set-up-payment>
- **The fee.** Stripe prices instant verification at **$1.50 per successful verification** (micro-deposits are
  free). No Stripe page says in so many words that paying again with a saved, verified account is free; it follows
  only from "per verification" plus "no re-verification". One third-party write-up says $0.10 per account inside
  Stripe ACH payments, which Stripe's own pages don't confirm.
  <https://stripe.com/financial-connections#pricing>, <https://stripe.com/pricing>, <https://stripe.com/payments/us-bank-payments>

Decision: **not used (unclear).** Reuse looks possible, but whether the customer can opt in on the hosted page,
which redisplay settings that needs, and whether the fee is skipped are not stated plainly, and none of it could be
tried in test mode from here. Sending Stripe parameters that were never tried would risk breaking Pay online for
everyone. So no session sets `customer`, `customer_creation`, `setup_future_usage` or `saved_payment_method_options`,
and `customers.stripe_customer_id` stays empty. Bank transfer works as it is; a returning client verifies again
(about $1.50) or pays by Zelle.

To turn it on later (a client pays by bank every month), in test mode with `stripe listen`:

1. First session: `customer_creation=always` and `saved_payment_method_options[payment_method_save]=enabled`; tick
   "save" on Stripe's page and pay with the test bank.
2. Second session with `customer=<the cus_… from step 1>` and
   `saved_payment_method_options[allow_redisplay_filters][]=always`: does Stripe's page offer the saved bank without
   a new bank login? Does the Financial Connections usage in the dashboard grow by one or by two?
3. If yes and one: store the session's `customer` id (`StripePaymentRecord.stripeCustomerId`, already accepted by
   `recordStripePayment`) and pass it as `CreateCheckoutInput.stripeCustomerId`. Or ask Stripe support the same two
   questions.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No "Pay online" on an invoice page | `STRIPE_SECRET_KEY` isn't set (Settings shows Pay online as off), bank transfer is off in Settings, or the invoice's ways don't include bank transfer / card. Card also needs card turned on in Settings |
| Stripe's webhook page shows 400 "Bad signature" | `STRIPE_WEBHOOK_SECRET` is from the other mode (test vs live) or another endpoint. Copy the signing secret of this endpoint, redeploy |
| Webhook 400 "Webhook not configured" | `STRIPE_WEBHOOK_SECRET` is missing |
| Paid on Stripe but not on the invoice | Look at the endpoint's recent deliveries in Stripe. A 500 is retried by Stripe for up to 3 days; "Resend" works too (it is recorded only once) |
| "Too many tries" on Pay online | More than 6 new checkouts for that invoice in an hour. Wait, or pay another way |
| A customer says Stripe wouldn't take their bank | Their bank can't be verified instantly (Nora HQ asks for instant verification only, so a started transfer is always a real debit). They pay by Zelle, the default |
| A push "Paid after it was cancelled" or "Paid twice" | A Stripe payment landed on a void invoice, or on top of one already paid (the customer finished paying on a page opened earlier). Refund it in the Stripe dashboard, then delete that payment on the invoice |
| "A bank payment is on its way" and Void is missing | A bank transfer is clearing (about 4 business days). The invoice can be voided once it arrives (delete or refund the payment first) or fails |
