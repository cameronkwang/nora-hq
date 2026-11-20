# Invoicing (customers, invoices, payments, Stripe)

Nora HQ makes its own invoices, tracks who owes what, and records every payment. It replaces Skynova. There is no
monthly fee: the invoices, the customer list, reminders and reports are all ours. Stripe is used only to take a
payment online when a customer wants to pay that way, through Stripe Checkout:

| Way to pay | What Nora pays | Notes |
|---|---|---|
| Zelle | nothing | Printed on every invoice (email or phone, and the name Zelle shows). |
| Check | nothing | Payee and mailing address printed on every invoice. |
| Venmo, PayPal | their own fees, if any | Optional, printed as plain instructions. Nothing is connected. |
| Bank transfer (ACH) through Stripe | 0.8%, capped at $5 | "Pay online". Clears in about 4 business days. |
| Card through Stripe | 2.9% + 30c | "Pay online". A setting turns card off. |

We do not use the Stripe Invoicing product (it adds about 0.4% per paid invoice) and we do not install the Stripe npm
package: the app calls Stripe's REST API with `fetch` and form encoding. Without `STRIPE_SECRET_KEY` everything works
and invoices simply have no "Pay online".

Both Cameron and Nora use invoicing (it is Nora's money). Money never appears on Nora's Schedule.

Shared code: `src/lib/invoices-types.ts` (types and pure helpers), `src/lib/ops-invoices.ts` (every write and read,
final signatures), `src/lib/stripe.ts` (Stripe REST), `src/lib/invoice-copy.ts` (customer-facing words in three
languages). Tables: `src/lib/schema.ts`, migration `drizzle/0016_invoicing.sql`.

## Who can do what

Enforced in `lib/ops-invoices` (and `lib/ops-stripe`), not only in the UI.

| Actor | May | May never |
|---|---|---|
| Nora, Cameron (signed in) | Everything: customers, drafts, Send, edit, record and delete payments, void, links, retainers, import, settings, reports, CSV | |
| `claude` (MCP) | Read invoices and customers; create a DRAFT invoice when a person asked (source `claude`); make the customer row for a managed business (`customerForClient`) | Send, mark paid, record or delete a payment, void, delete, edit a sent invoice, make or read a customer link, import, read or change payment settings |
| `system` | The daily retainer run (drafts only); the verified Stripe webhook records a Stripe payment | Anything a person decides |
| `public` (the /i/<token> page) | Read that one invoice; mark it viewed; start a Stripe Checkout for what is still owed | Everything else |

"A person presses Send." Nora HQ never emails or texts a customer by itself: Send finalises the invoice and the page
then shows the link and ready-made texts that the person sends from their own mail app or phone.

## Data model

Integer cents everywhere, currency `usd`. Dates are `"YYYY-MM-DD"` in the app timezone (America/New_York).

### customers

Who gets billed: a managed business (`clientId` set, at most one customer per client) or a collab business with no
`clients` row (made from a deal, by hand, or by the import).

| Column | |
|---|---|
| `id` | `cus_…` |
| `name`, `nameKey` | `nameKey = customerNameKey(name)` (lowercase, punctuation gone, CJK kept): matches imports and deals |
| `contactName`, `email`, `phone`, `billingAddress` (multi-line) | Printed under "Bill to" (email and phone are not printed on the public page) |
| `notes` | Team only |
| `clientId` | Optional link to `clients.id` (`customers_client_uq`); never Nora's creator workspace |
| `lang` | `en` / `zh-Hans` / `zh-Hant`: the pay page's language and the default for new invoices |
| `archived`, `source` (`manual`, `client`, `deal`, `import`) | |

Balance and history are derived from invoices; nothing is stored on the customer.

### invoices

| Column | |
|---|---|
| `id` | `inv_…` |
| `number` | `INV-YYYY-NNNN`, unique, null on a draft (see Numbers). An imported invoice keeps Skynova's number |
| `customerId` | `restrict`: a customer with invoices can't be deleted (archive instead) |
| `status` | `draft`, `sent`, `partially_paid`, `paid`, `void`. "Overdue" is derived, never stored |
| `issueDate`, `dueDate`, `termsDays` (default 14) | A draft may leave the dates empty: no issue date means "the day it is sent", no due date means issue date + `termsDays` (`resolveInvoiceDates`). A sent invoice always has both |
| `items` (jsonb `InvoiceItem[]`) | `{ description, quantity, unitCents }` in order. Quantity up to 2 decimals. Stored with the totals in the same UPDATE (one statement, so no transaction is needed) |
| `subtotalCents`, `discountCents`, `discountLabel`, `totalCents` | `invoiceTotals(items, discount)`: the discount is a fixed amount, 0 to the subtotal. The UI may offer "%" and convert |
| `paidCents` | Sum of `invoice_payments`, recomputed from them in ONE UPDATE after every payment change |
| `notes` | Printed on the invoice (a thank-you, terms) |
| `privateNotes` | Team only |
| `dealId` | Optional link to a collab deal (see Deals) |
| `retainerId`, `retainerMonth` | Unique together: one retainer draft per month |
| `tokenHash`, `tokenEnc`, `lang` | The customer link, made on first send (see The customer's page) |
| `source` | `manual`, `deal`, `retainer`, `import`, `claude`. A Claude draft says so on its page |
| `importRef` | The Skynova invoice it came from |
| `sentAt`, `sentBy`, `viewedAt`, `lastViewedAt`, `paidAt`, `lastRemindedAt`, `reminderCount`, `voidedAt`, `voidedBy`, `voidReason` | |

No tax line: Nora's services are not taxed in Virginia. Add one later only if that changes.

### invoice_payments

Many per invoice (partial payments).

| Column | |
|---|---|
| `amountCents` (> 0), `paidOn` | Cash basis: reports and the tax CSV go by `paidOn` |
| `method` | `zelle`, `check`, `cash`, `stripe_ach`, `stripe_card`, `paypal`, `venmo`, `other`. People pick from `MANUAL_PAYMENT_METHODS`; the two Stripe ones come only from the webhook |
| `reference` | A check number or a confirmation code, never a card or bank number |
| `note`, `recordedBy` (`system` for Stripe) | |
| `stripeSessionId` (unique), `stripePaymentIntentId`, `feeCents` | The webhook's payment is idempotent on the session id. `feeCents` is Stripe's real fee when known |

Refunds are not modelled now: refund in the Stripe dashboard (or hand the money back), then delete the payment here.

### retainers

A monthly retainer per customer: `description`, `amountCents`, `dayOfMonth` (1 to 28 so it falls in every month),
`startMonth` (optional "YYYY-MM"), `active`, `lastRunMonth`. See Recurring.

### invoice_checkouts and stripe_events (Stripe only)

`invoice_checkouts`: one row per Stripe Checkout Session started from a pay page (`sessionId` unique, `url`,
`amountCents`, `status` `open` / `processing` / `paid` / `failed` / `expired`, `method`, `expiresAt`).
`stripe_events`: webhook events already handled (`id` = Stripe's event id, `type`, `attempts`, `error`,
`processedAt`). Never the payload, never a card or bank detail.

### The SEQUENCE

`invoice_number_seq` (`schema.invoiceNumberSeq`), START 1. Read only inside the send UPDATE (below).

### Settings (app_settings, extended)

The existing row `app_settings[NORA_PAYMENT_KEY]` ("nora_payment") keeps its `line` (the deal "Request payment" text)
and gains the invoice settings (`InvoiceSettings` in `invoices-types`): `fromName`, `fromEmail`, `fromPhone`,
`fromAddress`, `zelle`, `zelleName`, `checkPayee`, `checkAddress`, `venmo`, `paypal`, `achEnabled`, `cardEnabled`,
`termsDays`, `footer`. `readInvoiceSettings(value)` reads any version of the row and never throws.

Every writer MERGES (`value = coalesce(value, '{}') || $patch`, one statement). Today `savePaymentLine` in
`lib/ops-payment.ts` replaces the whole value with `{ line }`: the core builder must change it to merge, or saving the
deal payment line would wipe the invoice settings. The settings refuse a password (`credential-guard`) and a card or
bank account number (`looksLikeCardOrBankNumber`). Stripe keys are never here: only the env vars
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

## The life of an invoice

```
draft ──Send──> sent ──payment──> partially_paid ──payment──> paid
  │               │  (past due: shown as Overdue)               │ delete a payment: back to partially_paid / sent
  │ delete        └──Void (no payments)──> void                 │
  └─> gone
```

- **Draft.** Anyone allowed (people, or Claude when asked) makes one. No number, no link. A person can edit
  everything, preview the PDF (printed "DRAFT") and delete it.
- **Send** (people). One UPDATE fixes the dates, takes the number, sets `sent`, stamps `sentAt` / `sentBy` and
  makes the customer link if there is none. Pressing it again changes nothing and returns the same link. A $0 total
  or a void invoice is refused. The page then shows "Copy link" and the texts to send (`getInvoiceMessages`).
- **Edit after sending** (people). Allowed while not paid and not void: lines, dates, discount, notes, language.
  Not the customer. The total can't go below what is already paid. The status is recomputed. Logged.
- **Viewed.** The customer opening the link stamps `viewedAt` once (`lastViewedAt` at most every 10 minutes). A
  signed-in person opening it does not count.
- **Overdue.** `invoiceDisplayStatus`: sent or partially paid with `dueDate < today`. Never stored, so it never
  goes stale.
- **Paid.** When payments reach the total. `paidAt` is stamped; deleting a payment clears it again.
- **Void** (people). Only with no payments (delete them first). Keeps its number; its link then shows "This invoice
  was cancelled" and nothing else. A sent invoice is never deleted.

### Numbers

`INV-<issue year>-<nextval, at least 4 digits>`, for example `INV-2026-0007`. Taken in the same UPDATE that first
sends the invoice, so a deleted draft never burns a number and two sends can't share one. The count goes on across
years (INV-2026-0041 can be followed by INV-2027-0042) and is never reused. Imported invoices keep Skynova's own
number (it can't collide: ours always start with `INV-YYYY-`).

### Status words (team pages)

`INVOICE_STATUS_LABEL` and `INVOICE_STATUS_TONE`: Draft (hollow dot), Sent (info), Partly paid (warn), Overdue
(danger, plus "12 days" in meta), Paid (ok), Void (hollow). A dot and words, never a pill. "Viewed Nov 18" is meta
text, not a status.

## Payments

- **Record payment** (people only): amount (default: the balance), date (default today), method, optional reference
  and note. Refused on a draft or void invoice and above the balance ("That's more than the $200.00 still owed.").
  Insert, then the ONE recompute UPDATE, then the deal sync.
- **Delete payment** (people): with a confirm. Recompute and deal sync. A Stripe payment can be deleted too (after a
  refund in Stripe); the activity log keeps who and when.
- **Stripe payment** (`system`, from the verified webhook): `recordStripePayment`, ON CONFLICT
  (`stripe_session_id`) DO NOTHING, so a replay records nothing. Never refused for being more than the balance (the
  money arrived): the invoice page shows "Overpaid by $X" so a person can sort it out.
- Payments never appear on Nora's Schedule, in the schedule's pushes or in its calendar entries.

## Pay options on every invoice

`payOptions(settings, stripeConfigured())`, shown in this order on the page and the PDF:

1. **Zelle** to the email or phone, with the name Zelle shows ("Send to nora@example.com (Nora Chen)").
2. **Check** payable to, and the mailing address.
3. **Venmo**, **PayPal** if set, as plain instructions (a handle or a paypal.me link).
4. **Pay online** (bank transfer and, unless turned off, card) only when `STRIPE_SECRET_KEY` is set and at least one
   of `achEnabled` / `cardEnabled` is on. Not on the PDF (the PDF prints the link to the page instead).

If nothing is set, the team's invoice page warns before Send: "Add how you get paid in Settings first." (a `.notice`).

## Stripe (Pay online)

- **Checkout Session** (`lib/stripe.ts createCheckoutSession`): `POST https://api.stripe.com/v1/checkout/sessions`,
  form encoded, `Authorization: Bearer $STRIPE_SECRET_KEY`, an `Idempotency-Key` header. Fields: `mode=payment`,
  `payment_method_types[]=us_bank_account` and/or `card`, one `line_items[0]` with `price_data[currency]=usd`,
  `price_data[unit_amount]=<balance cents>`, `price_data[product_data][name]=Invoice INV-2026-0007`, `quantity=1`,
  `client_reference_id=<invoice id>`, `metadata[invoice_id]`, `payment_intent_data[metadata][invoice_id]`,
  `customer_email` when known, `locale` (`en`, `zh`, `zh-TW`), `success_url=<page>?paid=1`, `cancel_url=<page>`,
  `expires_at` (1 hour). Card can be left out by the setting; bank transfer uses Stripe's instant bank verification.
- **Starting it** (`lib/ops-stripe startCheckout`, public): POST from the pay page. Refused for a draft, void, paid
  invoice, or while a bank payment is clearing ("A bank payment is on its way"). An `open` session for the same
  amount that hasn't expired is reused instead of making another; at most a handful of new sessions per invoice per
  hour (count in `invoice_checkouts`). The amount is always the balance at that moment, read on the server.
- **Webhook** `POST /api/stripe/webhook` (public prefix; it checks the signature itself). Read the raw body with
  `await req.text()`. Verify `Stripe-Signature` (`t=…,v1=…`): HMAC-SHA256 of `${t}.${rawBody}` with
  `STRIPE_WEBHOOK_SECRET`, hex, constant-time compared with every `v1`, `t` within 5 minutes. Bad signature: 400.
  Then claim the event (ONE statement, below): a processed event answers 200 and does nothing. Events:
  - `checkout.session.completed`: `payment_status = paid` (card) records the payment; `unpaid` (bank transfer
    started) marks the checkout `processing`.
  - `checkout.session.async_payment_succeeded`: records the payment (bank transfer cleared).
  - `checkout.session.async_payment_failed`: checkout `failed`; push to Nora "Bank payment failed: <customer>".
  - `checkout.session.expired`: checkout `expired`.
  The invoice comes from `metadata.invoice_id` (never from anything else the customer controls); the amount from
  `amount_total`. The method is `stripe_ach` or `stripe_card`. The fee can be read from the PaymentIntent
  (`expand[]=latest_charge.balance_transaction`) and stored as `feeCents`; skip it if that call fails. Any other
  event type: 200, ignored. A failure while processing answers 500 so Stripe retries (the claim allows a retry).
- **Keys**: env only. Never logged, never in the database, never in MCP output, never in an error message. The
  settings card says "Pay online: on (test mode)" / "off: add STRIPE_SECRET_KEY" without showing any of the key.
- Setup steps for Nora (account, turning on ACH Direct Debit, the webhook endpoint and events, test mode): in
  `docs/stripe-setup.md`.

## Deals

- **Create invoice** on a deal's page (people): `createInvoiceFromDeal`. The customer is the deal's client, else a
  customer with the same name key and email, else a new one from the deal's contact (source `deal`). The draft gets
  the fee as one line ("Collab: Instagram Reel, TikTok" from the deliverables) at `amountCents`, `dealId` set, due in
  the settings' terms. A deal that already has a draft or an open invoice opens that one instead.
- **The deal follows its invoices** (`syncDealFromInvoices`, after send, void and every payment change): all sent
  invoices paid → the deal's `paymentStatus` is `paid` (`paidAt` = last payment); any unpaid → `requested` with the
  earliest unpaid due date; none left after a void → back to `not_requested` if it was `requested`. Deleting a
  payment moves it back. One UPDATE on the deal.
- **A deal with an invoice shows it** on its Payment card: "INV-2026-0003 · Sent · due Dec 4" linking to the invoice
  (`invoicesForDeal`). With an invoice, the card's manual "Invoice sent / Mark paid" buttons give way to "Record
  payment" on the invoice. The existing "Request payment" text stays for deals without an invoice.
- `dealsOwed` and the Deals card keep working from the deal fields, which the sync keeps right.

## Recurring (monthly retainers)

A retainer belongs to a customer: amount, description, day of month. The existing daily reminders cron
(`runDailyReminders`, once a day after 8am New York) calls `runRetainers` first. For each retainer that is due
(`retainerDue`: active, started, not made this month, today on or after its day; a missed day catches up), it claims
the month with ONE conditional UPDATE on `lastRunMonth`, then inserts ONE draft (source `retainer`, one line
"Social media management (November 2026)", `retainerMonth`), unique per retainer and month. A person presses Send.
A draft someone deleted is not made again that month. If the insert fails, the claim is released so the next run
retries. The preview mode (`?preview=1`) makes nothing (`dryRun`).

## Reminders

All to Nora, topic `payment_overdue` (relabel it "Payments" in `components/notify-topics.ts`: "Morning reminder when
an invoice is due tomorrow or late, and when a retainer invoice is ready to send (Nora)").

- In the daily run (`invoiceReminders(today)`): invoices due tomorrow ("Due tomorrow: Crab O Clock $800"), overdue
  invoices (joined with today's overdue deals into one "3 payments overdue" push; a deal whose payment is tracked by
  an invoice is counted once, as its invoice), and retainer drafts made today ("Invoice ready to send: Crab O Clock
  $800"). Links go to `/invoices/<id>` or `/invoices?status=overdue`.
- **Friendly reminder** a person sends: the invoice page's "Remind" shows the email (built with
  `lib/payment-request.ts`, which gains an invoice variant that reuses `formatAmount`, `longDate`, `mailtoHref` and
  the first-name rule) and the short text in the customer's language; "I sent it" stamps `lastRemindedAt`.
- Pushes carry the amount, as the deal pushes already do. None of this touches the schedule.

## Reports

`/invoices` shows four figures: Outstanding, Overdue, Paid this month, Paid this year (cash basis, by payment date).
`/invoices/reports` adds paid by month for the year, by method, Stripe fees, and a by-customer table (outstanding,
overdue, invoiced and paid this year). **Export payments (CSV)** for taxes (`paymentsCsv({ year })`): one row per
payment, oldest first: Date, Invoice, Customer, Method, Reference, Amount, Stripe fee, Net. Amounts as `1250.50`.
`toCsv` quotes properly and defuses cells that start with `=`, `+`, `-`, `@` (names come from imports).

## Import from Skynova

Skynova has no real export, so `/invoices/import` takes a paste (copy the table from Skynova's Customers or Invoices
page, or a CSV someone typed) in two steps:

1. **Preview** (`previewSkynovaImport(text, kind)`; the parser is `lib/invoice-import.ts`, pure). Tab, comma or
   semicolon separated, header row matched loosely (Customer / Client / Company / Name; Email; Phone; Address;
   Contact; Invoice # / Number / No.; Date / Issue date; Due / Due date; Total / Amount; Paid / Amount paid; Balance
   / Amount due; Status; Description). Dollar amounts like "$1,250.50"; dates as 2026-11-20, 11/20/2026 or
   Nov 20, 2026. Each row shows what will happen: new customer, matches "Crab O Clock", new open invoice, already
   imported (same number), or an issue ("no amount", "card or bank number in the text"). Nothing is written.
2. **Save** (`saveSkynovaImport(text, kind, actor)`): re-parses the same text on the server (never trusts the
   browser's rows). Customers are matched by name key, never duplicated. Invoices are saved as `sent` with Skynova's
   number, source `import`, one line "Imported from Skynova (invoice 1043)", and an `other` payment ("Skynova") for
   any amount already paid, so the status comes out right. Rows with issues are skipped and listed.

An imported invoice has no customer link until a person presses "Copy link" (`getInvoiceLink` makes one).

## Claude (MCP)

New file `src/lib/mcp/tools-invoices.ts`, registered in `mcp/server.ts`:

| Tool | Does | Never returns |
|---|---|---|
| `list_invoices` (read) | Number, customer, status (overdue derived), issue and due dates, total, paid, balance, deal id. Filters: status, customer_id, deal_id | Links, tokens, Stripe ids, fees |
| `get_invoice` (read) | One invoice: lines, totals, notes, payments (date, amount, method), customer name and contact | The link, private settings, Stripe ids |
| `list_customers` (read) | Name, contact, email, phone, client id, outstanding and overdue | |
| `create_draft_invoice` | Only when Nora or Cameron asked. Customer by `customer_id`, `client_id` (makes the customer from the business) or `deal_id` (like Create invoice). Lines as `{ description, quantity, unit_cents }`, optional `due_days`, `notes`, `ask_id`. Returns the draft id and `/invoices/<id>` | |

There is no tool to send, record a payment, mark paid, void, delete, make a link, import or read or change payment
settings. The output goes through the same compact JSON helper as the other tools.

Rule for `src/lib/mcp/rules.ts` (replace the end of the schedule rule that says "the app writes her invoice and
payment-reminder text from the deal, don't draft those"):

> Invoices (list_invoices, get_invoice, list_customers, create_draft_invoice): you may read them, and make a DRAFT
> invoice only when Nora or Cameron asked for one, in chat or in an ask. Use the customer, business or deal they
> named and the amounts they gave you; never invent a price, a discount or a due date. A person reviews the draft
> and presses Send; you never send an invoice, record or delete a payment, mark one paid, void or delete one, share
> its link, or change how Nora gets paid. Don't draft a separate invoice or payment-reminder text either: the app
> writes those. If an ask is about money you can't see (an amount, who paid), ask in the thread. Invoices are never
> on Nora's schedule.

## The customer's page (/i/<token>)

Public (middleware: add `"/i"` to `PUBLIC_PAGES`, `"/api/stripe/webhook"` to `PUBLIC_PREFIXES`). Outside the
`(app)` group, no app chrome, `IntakeShell`-style wrapper like `/drop`.

- **The link** works like the drop link: 32 random bytes (base64url); only the sha256 (`intakeTokenHash`) is used
  for lookup and an encrypted copy (`lib/crypto`) lets the team copy it again. Made on first send. "New link"
  (people) makes another and the old one stops working at once. No expiry: a customer may pay months later.
- **Lookup** `getInvoiceByToken`: never a link → 404; void → "This invoice was cancelled. Questions? Contact <from
  name>." with no amounts; otherwise the invoice. `noindex`, `referrer: no-referrer`, `Cache-Control: no-store`.
- **Language**: `?lang=` → the invoice's `lang` → the customer's → Accept-Language. The switch at the top
  (English / 简体中文 / 繁體中文), as on `/drop`. Copy: `lib/invoice-copy.ts` (no em dashes, typed dictionaries).
- **What it shows**, phone first: who it's from (name, email, phone); "Invoice INV-2026-0007"; the status line
  ("Due Dec 4", "Overdue since Dec 4", "Paid, thank you", "A bank payment of $600.00 is on its way"); Bill to (name,
  contact, address); the lines, subtotal, discount, total, paid, **Amount due** (Newsreader figure); the notes; then
  How to pay: the free options first (Zelle, check, Venmo, PayPal, each with a copy button for the handle), then
  **Pay online** (the one primary button on this page: cinnabar, as outside the app shell); then "Download PDF"
  (secondary). After Stripe returns (`?paid=1`): "Thank you! Card payments show here right away; bank transfers in a
  few days."
- **Nothing else**: no other invoices, no business page, no deal, no private note, no source, no Nora HQ links.
- **PDF** `GET /i/<token>/pdf`: `invoicePdf(id, { public: true })`, `Content-Disposition: attachment;
  filename="INV-2026-0007.pdf"`, `no-store`. English (Helvetica): characters it can't draw are dropped, so the PDF
  says "see the online invoice" under a name it couldn't print in full.
- **Pay online** `POST /i/<token>/pay` (form, works without JavaScript): `startCheckout`, then 303 to Stripe.
- A signed-in person opening the link is not counted as viewed (check the session cookie; don't redirect them).

## The team's pages

All signed-in, all following `docs/design.md` (Ink: hairlines not boxes, one ink-filled focal button per screen at
most, status = dot + words, figures, 44px touch targets, 16px inputs on phones, nothing under 12px, light and dark
via tokens, no em dashes in copy).

**Navigation.** Since #20 to #26, Nora's HQ shows only her things: `components/sidebar.tsx` gives her
`NORA_MORE` (Contracts, Collab requests, My stats) instead of `GROW`, and `components/section-tabs.tsx` filters
section tabs through `NORA_TABS`. Invoicing must be visible to both: add an `INVOICES` item (`/invoices`,
"Invoices") to BOTH `GROW` and `NORA_MORE` (it then appears in the phone More sheet for both too), add a section
`invoices` (tabs Invoices `/invoices`, Customers `/invoices/customers`, Reports `/invoices/reports`) and put all three
tab keys in `NORA_TABS`. Never gate invoicing with `seesDrafts`. Add `/invoices` routes to the smoke's `ROUTES` and
`NORA_ROUTES`.

| Route | What |
|---|---|
| `/invoices` | Figures (Outstanding, Overdue, Paid this month, Paid this year); filter chips Open · Overdue · Drafts · Paid · All; one list: number, customer, due, amount due, status. Head actions: New invoice, Import, Export payments (CSV). `?status=`, `?customer=` |
| `/invoices/new` | The draft editor (`?customer=`, `?deal=` pre-fill): customer picker (or "New customer"), lines (description, qty, price, line total), discount, dates (empty = when sent / net 14), notes, private note, language. Save draft |
| `/invoices/[id]` | The invoice as the customer will see it, plus the team's bits: status line, viewed, deal link, private note, payments list, a bank payment clearing. Actions: **Send** (the focal button on a draft), Edit, Preview PDF, Delete draft; once sent: Copy link, Texts (email, text in en / 简 / 繁), Record payment (the focal button once sent), Remind, PDF, New link, Void |
| `/invoices/[id]/pdf` | Signed-in PDF route (`invoicePdf(id)`); drafts print "DRAFT" |
| `/invoices/customers`, `/invoices/customers/new`, `/invoices/customers/[id]` | Customers with outstanding / overdue; a customer's contact, invoices, payments, retainers (add, edit, pause), balance; "New invoice for them" |
| `/invoices/reports` | Paid by month, by method, by customer; Export payments (CSV) per year |
| `/invoices/export` | `route.ts`: `paymentsCsv({ year })`, `text/csv`, attachment, `no-store`, signed-in |
| `/invoices/import` | Paste box, kind (Customers / Invoices), Preview, then Save |
| `/settings` | New "Invoices and payments" card (`#invoicing`), visible to both: From, Zelle, check, Venmo, PayPal, Pay online (status from `stripeConfigured()` / `stripeTestMode()`, card on/off, bank transfer on/off, the fee table), default terms and note. The existing payment line stays |
| `/deals/[id]` | Payment card: "Create invoice", or the deal's invoice line(s) |

Money input fields take dollars (`parseDollars`, `centsToDollarsInput`); everything is shown with `formatCents`
(`decimals: "always"` on invoices, `"auto"` in lists and pushes).

## Atomic statements

Neon over HTTP has no interactive transactions. These are the statements the design relies on; each was run against
PGlite on top of the 0016 migration.

Send (number, dates, link, status in one UPDATE; a second send changes nothing):

```sql
update invoices set
  issue_date = coalesce(issue_date, $today),
  due_date   = coalesce(due_date, to_char(coalesce(issue_date, $today)::date + terms_days, 'YYYY-MM-DD')),
  number     = case when number is null
                 then 'INV-' || substr(coalesce(issue_date, $today), 1, 4) || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0')
                 else number end,
  status     = case when status = 'draft' then 'sent' else status end,
  token_hash = coalesce(token_hash, $hash), token_enc = coalesce(token_enc, $enc),
  sent_at    = coalesce(sent_at, now()), sent_by = coalesce(sent_by, $actor), updated_at = now()
where id = $id and status <> 'void' and total_cents > 0
returning *;
```

Payment recompute (after every insert or delete of a payment):

```sql
update invoices i set
  paid_cents = p.total,
  status = case when i.status in ('draft','void') then i.status
                when i.total_cents > 0 and p.total >= i.total_cents then 'paid'
                when p.total > 0 then 'partially_paid' else 'sent' end,
  paid_at = case when i.total_cents > 0 and p.total >= i.total_cents then coalesce(i.paid_at, now()) else null end,
  updated_at = now()
from (select coalesce(sum(amount_cents), 0)::int as total from invoice_payments where invoice_id = $id) p
where i.id = $id
returning i.*;
```

Stripe payment: `insert into invoice_payments … on conflict (stripe_session_id) do nothing returning id`, then the
recompute.

Retainer month claim, then the draft:

```sql
update retainers set last_run_month = $month, updated_at = now()
where id = $id and active and day_of_month <= $day
  and (start_month is null or start_month <= $month)
  and last_run_month is distinct from $month
returning id;
-- then: insert into invoices (…, retainer_id, retainer_month) … on conflict do nothing returning id
```

Stripe event claim (new: a row; processed: nothing; failed earlier: a row again, so Stripe's retry is processed):

```sql
insert into stripe_events (id, type) values ($id, $type)
on conflict (id) do update set attempts = stripe_events.attempts + 1
  where stripe_events.processed_at is null
returning id;
-- process, then: update stripe_events set processed_at = now(), error = null where id = $id
```

Settings merge: `insert … on conflict (key) do update set value = coalesce(app_settings.value, '{}'::jsonb) ||
excluded.value`.

## Safety checklist

- No secrets in the database, code, logs or MCP output. Stripe keys: env only. Customer links: hash plus encrypted
  copy, like the drop link. The activity log never holds the settings' values, a link or a token.
- No card or bank details anywhere. Stripe's hosted page takes them; we keep the session id, payment intent id,
  amount, method and fee. `looksLikeCardOrBankNumber` refuses them in settings, references, notes and imports.
- Everything a customer or an import typed is untrusted text: control characters stripped (`cleanLine`,
  `cleanBlock`), lengths capped, rendered as text, CSV cells defused.
- Money is integer cents; amounts are bounded ($1,000,000 max per line, discount, total and payment).
- Public routes answer 404 for an unknown token, never say whether an invoice id exists, and send no referrer.
- The webhook trusts only a verified signature, uses `metadata.invoice_id`, and is idempotent twice over (event
  claim and the unique session id).

## Files and who builds them

Three builders work in parallel on `feature/invoicing` after this step. Each owns its files; a change someone else
needs in your file is a message to that builder, not an edit.

**core** (the data, the rules, the texts and the tests)
- `src/lib/ops-invoices.ts` (fill in every stub; signatures are final, add helpers freely)
- `src/lib/invoice-pdf.ts` (new: pdf-lib, Letter, the `contract-pdf.ts` style; server side)
- `src/lib/invoice-import.ts` (new: the pure paste / CSV parser)
- `src/lib/invoices-types.ts` (may add; don't change existing signatures without telling the others)
- `src/lib/payment-request.ts` (the invoice email and reminder), `src/lib/ops-payment.ts` (merge fix)
- `src/lib/ops-notify.ts` (retainers first, then the invoice pushes in `runDailyReminders`)
- `src/lib/mcp/tools-invoices.ts` (new), `src/lib/mcp/server.ts` (register), `src/lib/mcp/rules.ts` (the rule above)
- `scripts/test-invoices-types.ts`, `scripts/test-invoice-import.ts`, `scripts/test-invoices-ops.ts` (ops against a
  throwaway PGlite: `PGLITE_DIR=$(mktemp -d) npx tsx --require ./scripts/server-only-shim.cjs scripts/test-invoices-ops.ts`),
  and extending `scripts/sample-seed.mts` if more sample data helps

**team_ui** (every signed-in page)
- `src/app/(app)/invoices/**` (all the routes in the table above, their server actions, the PDF and CSV routes)
- `src/components/invoice-*.tsx` (new), `src/app/styles/invoicing.css` (new, imported like the other area sheets)
- `src/components/sidebar.tsx`, `src/components/section-tabs.tsx` (nav entry for both), `src/components/notify-topics.ts` (label)
- `src/app/(app)/settings/page.tsx` plus a new settings card component and its action
- `src/app/(app)/deals/[id]/page.tsx` and `src/app/(app)/deals/actions.ts` (Create invoice, the invoice line)
- `scripts/smoke.mjs` signed-in routes (`ROUTES`, `NORA_ROUTES`) and flows

**public_stripe** (the customer's side and Stripe)
- `src/app/i/[token]/page.tsx`, `src/app/i/[token]/pdf/route.ts`, `src/app/i/[token]/pay/route.ts`, any components
  it needs (`src/components/invoice-public*.tsx`)
- `src/app/api/stripe/webhook/route.ts`
- `src/lib/stripe.ts` (fill in the stubs), `src/lib/ops-stripe.ts` (new: `startCheckout`, `handleStripeEvent`, the
  `invoice_checkouts` and `stripe_events` rows; calls core's `getInvoiceByToken` and `recordStripePayment`)
- `src/lib/invoice-copy.ts` (the page copy in three languages; `share` is used by core)
- `src/middleware.ts` (`/i`, `/api/stripe/webhook`), `src/lib/integrations/env.ts` (the two optional Stripe vars),
  `docs/stripe-setup.md` (new), `docs/setup.md` (env vars)
- `scripts/test-stripe.ts` (signature, form encoding), `scripts/smoke.mjs` `PUBLIC_ROUTES`

Seams, so nobody waits: team_ui and public_stripe code against the stubs in `ops-invoices.ts` (they throw "Invoicing
is not built yet" until core lands; catch `OpsError` where a page must still render). `stripeConfigured()`,
`stripeTestMode()` and `stripeWebhookConfigured()` are real already. `getInvoiceByToken` returns everything the
public page needs, `PayOptions` included. Core's `getInvoiceMessages` uses `invoiceCopy(lang).share.message`.

## Local development

`rm -rf .data && npm run dev:sample-data` loads fake customers, retainers and one invoice in each state (draft, sent,
overdue and partly paid, paid, void; one linked to the sample deal "SAMPLE Bakery 小点心", whose page language is
简体). Customer links (each token is 43 characters):
`/i/sample-invoice-open-00000000000000000000000`, `/i/sample-invoice-overdue-00000000000000000000`,
`/i/sample-invoice-paid-00000000000000000000000`, `/i/sample-invoice-void-00000000000000000000000`. The sample deal "Sample Pizzeria" has no
invoice, for trying Create invoice. Use Stripe test keys (`sk_test_…`) and `stripe listen --forward-to
localhost:3200/api/stripe/webhook` to try Pay online.
