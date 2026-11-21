# Invoicing (customers, invoices, payments, contracts, Stripe)

Nora HQ makes its own invoices, tracks who owes what, and records every payment. It replaces Skynova, and there is
no monthly fee: the invoices, the customer list, reminders and reports are all ours. The main job is **making a PDF
for Nora to send, fast**: pick who it's for, tap a saved line or two, press **Make PDF**, share it. Everything that
is the same every time (her name and address, Zelle, "due on receipt", the next number) is filled in already.

Stripe is used only to take a payment online when an invoice asks for that, through Stripe Checkout:

| Way to pay | What Nora pays | Notes |
|---|---|---|
| **Zelle** (the default) | nothing | Every invoice, unless a person chose otherwise. The PDF prints the number and "Put invoice 0000170 in the Zelle memo" |
| Check | nothing | Payee and mailing address from Settings |
| Venmo, PayPal | their own fees, if any | Plain instructions (a handle or a paypal.me link). Nothing is connected |
| Other (custom) | | One line typed on that invoice ("Cash at the shoot is fine") |
| Bank transfer online (ACH through Stripe) | 0.8%, capped at $5 (plus instant verification, see "Stripe bank reuse") | The online option. Clears in about 4 business days |
| Card online (through Stripe) | 2.9% + 30c | **Off by default**; a person turns it on in Settings |

**Never a surcharge or fee for any way to pay.** The total is the same however the customer pays; the app never adds
a "card fee" line and Claude never drafts one.

We do not use the Stripe Invoicing product (it adds about 0.4% per paid invoice) and we do not install the Stripe npm
package: the app calls Stripe's REST API with `fetch` and form encoding. Without `STRIPE_SECRET_KEY` everything works
and no invoice can offer paying online.

Both Cameron and Nora use invoicing (it is Nora's money). Money never appears on Nora's Schedule.

Shared code: `src/lib/invoices-types.ts` (types and pure helpers: numbers, defaults, ways to pay, saved lines, the
PDF's wording, the creator, contract links, next steps), `src/lib/ops-invoices.ts` (every write and read, final
signatures), `src/lib/stripe.ts` (Stripe REST), `src/lib/invoice-copy.ts` (customer-facing words in three languages,
including the text sent with the PDF). Tables: `src/lib/schema.ts`, migrations `drizzle/0016_invoicing.sql` and
`drizzle/0017_invoicing_fast_creator.sql`. Proofs of the numbering SQL: `scripts/test-invoice-numbers.mts`.

## What changed from the first design

Cameron, Nov 20: "make the invoice creator super easy to generate PDFs for nora to send. payment method is always
zelle unless stated otherwise, default other things found in her invoice screenshot before as well. the invoice
creator should be very fast. additionally our contract generator should also be linked and talking to this as well.
can easily follow up with 1 or the other". So, compared with the first design:

- Numbers continue her Skynova sequence (`0000170`, 7 digits, no prefix) instead of `INV-YYYY-NNNN`.
- Invoice date today, **due on receipt** (same day) instead of net 14.
- Each invoice chooses its **ways to pay** (`payWays`); Zelle by default. Card is off by default. No surcharges.
- Saved lines as one-tap chips ("Standard Content Creation Package" $550.00, "Food Stipend" typed each time).
- The PDF keeps her Skynova layout and wording (Ink style, no Item column).
- `/invoices/new` is a **fast one-screen creator** whose one button, **Make PDF**, saves and finalizes in one step
  and lands on a done state (Share PDF, Download, Copy message). "Send" is now "Make PDF" (`finalizeInvoice`).
- **Contracts and invoices link both ways** (`invoices.contractId`), each shows the other, and the next step is one
  tap from either.

## Defaults (from her Skynova invoice)

Her current Skynova invoice (a screenshot Cameron shared; it holds her real address and Zelle number, which are never
copied into code, seeds, tests, docs or screenshots: a person types them once in Settings) sets every default:

| | Default | Changeable |
|---|---|---|
| From | Her name and address from Settings, top left. The first time anyone makes an invoice and these (or the Zelle number) are empty, the creator asks once, inline, with the name prefilled "Nora Chen" (`CREATOR_LEGAL_NAME` in `lib/contract`) | Settings |
| Number | The next in her sequence: 7 digits, zero padded, no prefix. The first Nora HQ invoice is `0000170` | "Next invoice number" (Settings, or tap the number in the creator) |
| Invoice date | Today | Per invoice |
| Due date | The same day: "Due on receipt" (`termsDays` 0) | Per invoice; a contract's payment days set it |
| Ways to pay | Zelle, printed as "PAYMENT INFORMATION", the Zelle number and "Put invoice 0000170 in the Zelle memo" | Per invoice (people; Claude only when Nora or Cameron said so) |
| Lines | One tap: "Standard Content Creation Package" $550.00; "Food Stipend" (amount typed each time). Quantity 1 | Saved lines in Settings; any line per invoice |
| Notes | None (Settings' default note, if any) | Per invoice |
| Language | The customer's (English unless set) for the message and the pay page. The PDF is English | Per invoice |

## Who can do what

Enforced in `lib/ops-invoices` (and `lib/ops-stripe`), not only in the UI.

| Actor | May | May never |
|---|---|---|
| Nora, Cameron (signed in) | Everything: customers, Make PDF, drafts, edit, record and delete payments, void, links, retainers, import, settings, saved lines, next number, reports, CSV, contracts and their links | |
| `claude` (MCP) | Read invoices and customers; create a DRAFT invoice when a person asked (source `claude`), with ways to pay only when Nora or Cameron said how; make the customer row for a managed business (`customerForClient`) or a deal (`customerForDeal`) | Make PDF / finalize, mark paid, record or delete a payment, void, delete, edit a finalized invoice, make or read a customer link, import, read or change payment settings, saved lines or the next number, add a fee or surcharge, read, make or link contracts |
| `system` | The daily retainer run (drafts only); the verified Stripe webhook records a Stripe payment | Anything a person decides |
| `public` (the /i/<token> page) | Read that one invoice; mark it viewed; start a Stripe Checkout for what is still owed (only when the invoice offers paying online) | Everything else |

"A person presses Make PDF." Nora HQ never emails or texts a customer by itself: Make PDF finalizes the invoice and
the done state hands the person the PDF and a ready-made message to send from their own phone or mail app.

## Data model

Integer cents everywhere, currency `usd`. Dates are `"YYYY-MM-DD"` in the app timezone (America/New_York).

### customers

Who gets billed: a managed business (`clientId` set, at most one customer per client) or a collab business with no
`clients` row (made inline in the creator, from a deal, from a contract, by hand, or by the import).

| Column | |
|---|---|
| `id` | `cus_…` |
| `name`, `nameKey` | `nameKey = customerNameKey(name)` (lowercase, punctuation gone, CJK kept): matches imports, deals and contracts |
| `contactName`, `email`, `phone` | Team and messages (email and phone are not printed on the PDF or the public page) |
| `billingAddress` (multi-line) | Printed on one line under the name on the PDF. Filled from `clients.public_info.address` for a managed business, the deal's address for a deal, or typed in the creator (saved for next time) |
| `notes` | Team only |
| `clientId` | Optional link to `clients.id` (`customers_client_uq`); never Nora's creator workspace |
| `lang` | `en` / `zh-Hans` / `zh-Hant`: the message's and pay page's language, the default for new invoices |
| `archived`, `source` (`manual`, `client`, `deal`, `import`, `contract`) | |
| `stripeCustomerId` (new in 0017) | Stripe's Customer id, only if bank reuse works (see "Stripe bank reuse"). An id, never a card or bank detail. Never in MCP output |

Balance and history are derived from invoices; nothing is stored on the customer.

### invoices

| Column | |
|---|---|
| `id` | `inv_…` |
| `number` | `0000170`, unique, null on a draft (see Numbers). An imported invoice keeps Skynova's number. Rows numbered `INV-…` by an earlier preview build keep that number |
| `customerId` | `restrict`: a customer with invoices can't be deleted (archive instead) |
| `status` | `draft`, `sent` (finalized: has a number and a PDF), `partially_paid`, `paid`, `void`. "Overdue" is derived, never stored |
| `issueDate`, `dueDate`, `termsDays` (default **0**) | The creator always sets both dates (today, and due the same day unless changed). A draft may leave them empty: no issue date = the day it is finalized, no due date = issue date + `termsDays` (`resolveInvoiceDates`). A finalized invoice always has both |
| `items` (jsonb `InvoiceItem[]`) | `{ description, quantity, unitCents }` in order; the first is the **main line** (the package). Quantity up to 2 decimals. Stored with the totals in the same statement |
| `subtotalCents`, `discountCents`, `discountLabel`, `totalCents` | `invoiceTotals(items, discount)`: the discount is a fixed amount, 0 to the subtotal. The UI may offer "%" and convert |
| `paidCents` | Sum of `invoice_payments`, recomputed from them in ONE UPDATE after every payment change |
| `payWays` (jsonb, new, default `["zelle"]`) | How this invoice asks to be paid: any of `zelle`, `check`, `venmo`, `paypal`, `custom`, `bank`, `card` (`PAY_WAYS`), shown in that order (Zelle first) |
| `payNote` (new) | The `custom` way's line |
| `notes` | Printed after "NOTES:" on the PDF |
| `privateNotes` | Team only |
| `dealId` | Optional link to a collab deal (see Deals) |
| `contractId` (new, `on delete set null`) | The contract it bills. Many invoices per contract (a deposit and the rest; each month) |
| `retainerId`, `retainerMonth` | Unique together: one retainer draft per month |
| `tokenHash`, `tokenEnc`, `lang` | The customer link, made when finalized (see The customer's page) |
| `source` | `manual`, `deal`, `retainer`, `import`, `claude`, `contract`. A Claude draft says so on its page |
| `importRef` | The Skynova invoice it came from |
| `sentAt`, `sentBy` (= finalized at / by), `viewedAt`, `lastViewedAt`, `paidAt`, `lastRemindedAt`, `reminderCount`, `voidedAt`, `voidedBy`, `voidReason` | |

No tax line: Nora's services are not taxed in Virginia. Add one later only if that changes.

### contracts (existing, extended)

The contract generator's history (`lib/contract`, `lib/ops-contracts`). New in 0017: `customerId` (`on delete set
null`), set when a contract is made from an invoice or an invoice is made from it, and indexes on `dealId` and
`customerId`. A contract has no invoice column: the link is `invoices.contractId`, read both ways.

### invoice_payments

Many per invoice (partial payments).

| Column | |
|---|---|
| `amountCents` (> 0), `paidOn` | Cash basis: reports and the tax CSV go by `paidOn` |
| `method` | `zelle`, `check`, `cash`, `stripe_ach`, `stripe_card`, `paypal`, `venmo`, `other`. People pick from `MANUAL_PAYMENT_METHODS` (preselected from the invoice's first way, `PAY_WAY_METHOD`); the two Stripe ones come only from the webhook |
| `reference` | A check number or a confirmation code, never a card or bank number |
| `note`, `recordedBy` (`system` for Stripe) | |
| `stripeSessionId` (unique), `stripePaymentIntentId`, `feeCents` | The webhook's payment is idempotent on the session id. `feeCents` is Stripe's real fee when known |

Refunds are not modelled now: refund in the Stripe dashboard (or hand the money back), then delete the payment here.

### retainers

A monthly retainer per customer: `description`, `amountCents`, `dayOfMonth` (1 to 28 so it falls in every month),
`startMonth` (optional "YYYY-MM"), `active`, `lastRunMonth`, and (new) `contractId` (`on delete set null`, unique:
one retainer per contract) when it came from "Set up monthly invoices". See Recurring.

### invoice_checkouts and stripe_events (Stripe only)

`invoice_checkouts`: one row per Stripe Checkout Session started from a pay page (`sessionId` unique, `url`,
`amountCents`, `status` `open` / `processing` / `paid` / `failed` / `expired`, `method`, `expiresAt`).
`stripe_events`: webhook events already handled (`id` = Stripe's event id, `type`, `attempts`, `error`,
`processedAt`). Never the payload, never a card or bank detail.

### The SEQUENCE

`invoice_number_seq` (`schema.invoiceNumberSeq`), START 170 (0017 moves an existing one; below). Read only by the
finalize statements and the two sequence moves (all in "Atomic statements").

### Settings (app_settings, extended)

The existing row `app_settings[NORA_PAYMENT_KEY]` ("nora_payment") keeps its `line` (the deal "Request payment" text)
and holds the invoice settings (`InvoiceSettings` in `invoices-types`, defaults in `DEFAULT_INVOICE_SETTINGS`):

| Key | Default | |
|---|---|---|
| `fromName`, `fromAddress` | empty (asked once in the creator; name prefilled "Nora Chen") | Printed top left |
| `fromEmail`, `fromPhone` | empty | Printed under the address only when set (her Skynova invoice has neither) |
| `zelle`, `zelleName` | empty (asked once) | The Zelle phone or email; the optional name Zelle shows |
| `checkPayee`, `checkAddress`, `venmo`, `paypal` | empty | A way is offered in the creator only when its details are set |
| `achEnabled` | on | Bank transfer online (needs `STRIPE_SECRET_KEY`) |
| `cardEnabled` | **off** | Card online (needs `STRIPE_SECRET_KEY` and this on) |
| `termsDays` | 0 | Due on receipt |
| `footer` | empty | Default note for new invoices |
| `savedItems` | the two defaults | `SavedItem[]` (`{ id, description, unitCents | null }`, at most 20); a missing key reads as the defaults, an edited list (even empty) is kept |

`readInvoiceSettings(value)` reads any version of the row and never throws. Every writer MERGES (`value =
coalesce(value, '{}') || $patch`, one statement); saved lines are replaced as one key. Today `savePaymentLine` in
`lib/ops-payment.ts` replaces the whole value with `{ line }`: core must change it to merge, or saving the deal payment
line would wipe the invoice settings. The settings refuse a password (`credential-guard`) and a card or bank account
number (`looksLikeCardOrBankNumber`). Stripe keys are never here: only the env vars `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`. The next invoice number is not here either: it is the SEQUENCE.

## Numbers

- **Format**: 7 digits, zero padded, no prefix (`formatInvoiceNumber(170)` = `"0000170"`); a number past 9999999 just
  grows (`10000000`), never cut.
- **First number** `0000170` on a fresh database (her last Skynova invoice was 0000169), unless a person sets "Next
  invoice number".
- **Taken when finalized**, in the same statement that finalizes (the create-and-finalize INSERT, or the finalize
  UPDATE on a draft). Drafts have none, so a deleted draft never burns a number.
- **Never repeated or reused.** The statement takes `nextval` and skips any number already on an invoice (an imported
  one, or one a race just wrote), burning it. `invoices_number_unique` is the last guard: on a unique violation the
  op retries once.
- **Imports keep their numbers**, padded the same way (`normalizeImportedNumber`: "169" → "0000169"; anything not all
  digits, like "SKY-12", is kept as typed). After an import ONE `setval` moves the sequence past every all-digit
  number used, never backwards.
- **"Next invoice number"** (Settings; tapping "#0000170" in the creator opens the same field): ONE `setval` to
  `max(typed, highest used + 1)`, so a person can skip ahead but never back onto a used number. Logged.
- **Peek** (`nextInvoiceNumber`, the creator's quiet line and Settings): the sequence's next value, skipping used
  numbers. Shown, never reserved: two people pressing Make PDF at once get two different numbers.
- 0017 moves an existing sequence (a preview that already applied 0016) to `max(170, highest all-digit number + 1,
  its own next)`. Proved on PGlite: fresh migrate + seed gives 0000170; an upgrade from 0016 with data gives 0000170
  (or 0000181 when 0000180 was imported); finalizing takes 0000170 then 0000171 and skips a 0000172 an import wrote.

## The fast creator (/invoices/new)

The main way to make an invoice. One screen, phone first, great on desktop. Server-rendered from ONE call
(`getInvoiceCreatorContext`), so it opens with everything filled in and no loading state.

```
  New invoice
  Bill to  [ Sample Bistro              ]  ← focus starts here
           1 Example Ave, Sampleton, VA 23000            (tap to edit)
           Same as last time

  [+ Standard Content Creation Package $550]  [+ Food Stipend]

  Standard Content Creation Package   1   550.00     ×
  Food Stipend                        1   [ 75.10 ]  ×
  [ Description          ] [ Amount ]
                                       Total  $625.10

  Due on receipt · Zelle · #0000170        (each part tappable)
  More: discount, notes, language, private note

  [ Make PDF ]        Save as draft
```

- **Bill to** is a typeahead (`billToOptions`, filtered in the browser with `filterBillTo`) over customers, managed
  businesses and deal businesses, each name once. Picking one fills the address (the customer's billing address,
  else the business's public facts address in `clients.public_info`, else the deal's address); the address is
  editable and saved on the customer. The creator always sends what the address box shows, so an address that came
  from the public facts is printed and saved the first time (the op writes it only when it differs). A name that
  matches nothing creates the customer inline on Make PDF, with an address box. `?customer=`, `?client=`, `?deal=`,
  `?contract=` (+ `&part=rest`) and `?draft=` open it pre-filled. A managed business that already has a customer is
  found by the business (`BillToOption.clientId`), not by its name: a deal made from Nora's schedule keeps the
  schedule's name, and must still bill that business's one customer.
- **Same as last time** repeats the last invoice she MADE for that customer: sent (paid or not), never an unsent
  draft and never a Skynova import (its one line is a placeholder). `BillToOption.hasLast` says whether there is one
  (`hasPastInvoices` only words the list: "Customer" or "Customer, no invoices yet"). The lines come with the page
  for the 40 most recently billed customers (`BillToOption.last`, one `select distinct on (customer_id)`), so the
  button works the moment she picks one; for anyone else they are fetched on pick (`lastInvoiceForCustomer`), the
  button already there and focused: a tap or Enter while it loads is kept and applied when it arrives. It copies the
  lines (and ways to pay, notes); a saved line typed each time (Food Stipend) comes back with its amount empty and
  focused (`sameAsLastTime`).
- **Lines**: the saved lines are chips (`lineFromSavedItem`); a description + amount row adds a custom line; Enter
  moves to the next field (and from the amount adds the line); quantity is 1 unless changed; totals update live
  (`invoiceTotals`) from exactly the lines Make PDF will send, a custom line typed but not added yet included.
  `readyItems` names the first line that still needs an amount.
- **Dates follow today.** Until she sets a date herself, the invoice is dated the day it is MADE, not the day the
  screen was opened: the creator checks today (America/New_York) when the tab comes back and again when Make PDF is
  pressed, and moves the default dates with it (due on receipt stays due on receipt, "15 days" stays 15 days; a
  deal's agreed due date stays that date). "New invoice" on the done state starts from today too.
- **What the PDF can't print.** The PDF has English letters only (Helvetica). The creator says so under the field
  before Make PDF ("The PDF prints English letters only: 小点心 will be left out"), and stops when a customer's name
  or a line would print EMPTY (Chinese only): "Add the name in English for the PDF (you can keep both)". The ops
  refuse the same (`createAndFinalizeInvoice`, `finalizeInvoice`), so no PDF ever says "Customer" or has a blank row.
  One rule for all of it: `invoices-types pdfText / pdfUnprintable / pdfPrintsEmpty`.
- **Defaults** show as one quiet line, `creatorDefaultsLine`: "Due on receipt · Zelle · #0000170". Each part is
  tappable: the due date (a date field, plus "Due on receipt"), the ways to pay (a checklist from
  `availablePayWays`, each unavailable one saying why, e.g. "Card is off. Turn it on in Settings first."; "Other"
  asks for its line) and the number ("Next invoice number").
- **More** (folded): discount (dollars or %), notes, language (English / 简体中文 / 繁體中文), private note.
- **The one-time ask**: when `setupMissing` is not empty (no From name, address or Zelle number in Settings), a short
  block above Make PDF asks for them once ("Your name", prefilled "Nora Chen"; "Your address"; "Zelle number") and
  Make PDF saves them into Settings first (`QuickInvoiceInput.setup`). It never shows again once filled.
- **ONE focal button, "Make PDF"** (Cmd/Ctrl+Enter on desktop): `createAndFinalizeInvoice` saves and finalizes in one
  step (number, status sent, link) and the screen turns into the **done state**. **Save as draft** is secondary
  (`saveQuickDraft`). Errors show inline next to the field, the form keeps everything.
- **Pressed again after a lost response.** The creator sends an id with the form (`QuickInvoiceInput.requestId`, a new
  one whenever the form changed); the invoice's own id is made from it. A second press with the same form conflicts
  on that id, takes no number and returns the invoice the first press made.
- **Editing a finalized invoice** (`?edit=<id>`, `getInvoiceEditContext`) opens the same screen with everything the
  form can change: lines, dates, ways to pay, notes, language AND the discount and the private note, so Save changes
  never clears what she didn't touch.

### The done state

```
  0000170 · $625.10 · Sample Bistro                       (Status: Sent)
  [ Share PDF ]   Download PDF   Copy message   Copy pay link
  Next: Make contract · New invoice
```

`InvoiceDone` (also `getInvoiceDone(id)` for an invoice that is already finalized, and after Make PDF on the invoice
page). Buttons in order (`doneActions`):

- **Share PDF** (phones, when `navigator.canShare({ files })`): iOS only allows `share()` inside a fresh tap, so Share
  is a second tap on a file that is already there. After Make PDF on such a phone the PDF comes back WITH the answer
  (`InvoiceDone.pdfBase64`, asked for with `makePdfAction(input, { pdf: true })`): no second round trip. On a reload
  of the done state and on the invoice page it is fetched (`pdfPath`) as soon as the buttons appear; while it loads
  the button says "Getting PDF…"; if fetching fails it falls back to Download.
- **Download PDF**: a link to `pdfPath?download=1` (works everywhere, no JavaScript needed).
- **Copy message**: the short text to send with it, in the customer's language (`message`; all three in `messages`):
  "Hi Sam! Here is invoice 0000170 for $625.10, due on receipt. The PDF is attached. / Zelle: (555) 010-0100, with
  0000170 in the memo. / Thank you!" (`invoiceCopy(lang).share.pdfMessage`).
- **Copy pay link**: only when an online way is on (`payUrl` set).
- **Next steps** (`nextSteps`, `invoiceNextSteps`): "Make contract" when it has none; then "New invoice". They sit
  right under the buttons, above the message, so Make contract is on the first screen of the smallest iPhone. The
  focal button on the done state is Share PDF on phones and Download PDF on desktop (one ink-filled button, never two).
- **It stays put.** After Make PDF the address gains `?done=<id>` next to what it had; `done` is not part of the
  page's key, so the app's live refresh (every 20 s and whenever the tab comes back) re-renders the same screen
  instead of remounting it: Share stays ready and the chosen message language stays chosen.

### Speed

- `/invoices/new` is a server component plus ONE small client component. No heavy client libraries on load: no
  pdf-lib (the PDF is made on the server), no date or form libraries; the contract PDF code stays lazy-loaded on
  `/contracts` as today. Anything optional (the date picker, the ways-to-pay sheet) is plain HTML or loaded on tap.
- `getInvoiceCreatorContext` runs its reads in parallel (settings, saved lines, customers, clients, deals, the
  next number, the prefill): one round trip's worth of waiting.
- Make PDF is ONE server action: at most 4 statements on the common path (customer exists: the INSERT that
  finalizes, then nothing; a new customer: one more INSERT; a deal: one deal UPDATE). The PDF is made by pdf-lib
  (standard fonts, nothing embedded): for a phone that will share it, inside the same action, next to the log write
  (about 20 ms, no second round trip); otherwise on the GET of `/invoices/<id>/pdf`.
- Budget: Make PDF round trip well under a second locally after warm-up (aim for under 300 ms), the PDF route under
  200 ms. **Measure and report**: team_ui times the action and the PDF fetch in the browser (`performance.now()`,
  five runs after one warm-up) and puts the numbers in its report; core reports the statement count per path.

## The PDF

`invoicePdf(id)` draws `invoiceDocument(...)` (pure, in `invoices-types`: every word and number already formatted, so
the team's invoice page can show the same thing). It keeps her Skynova invoice's layout, fields and wording so
clients see a familiar document, in the clean Ink style:

```
  Nora Chen                                                      I N V O I C E
  100 Sample St
  Sampleton, VA 23000

  Sample Bistro                                       Invoice #      0000170
  1 Example Ave, Sampleton, VA 23000                  Invoice Date   11/20/2026
                                                      Due Date       11/20/2026
  ───────────────────────────────────────────────────────────────────────────
  Description                              Unit Price    Quantity      Amount
  ───────────────────────────────────────────────────────────────────────────
  Standard Content Creation Package            550.00        1.00      550.00
  Food Stipend                                  75.10        1.00       75.10

  NOTES: PAYMENT INFORMATION:
  (555) 010-0100 [Zelle]
  Put invoice 0000170 in the Zelle memo
  ───────────────────────────────────────────────────────────────────────────
                                                      Subtotal        625.10
                                                      Total           625.10
                                                      Amount Paid       0.00
                                                      Balance Due    $625.10
```

- Letter, pdf-lib, Helvetica. Server side. Helvetica has the Western European letters only: `invoices-types pdfText`
  is the one rule for what prints (curly quotes and dashes become plain, an accent it lacks is dropped from its
  letter so "Phở" prints "Pho", anything else is left out; line breaks in the notes are kept), checked against the
  real font for every character in `scripts/test-invoice-review.ts`.
- Top left: From name and address lines (email / phone under them only if set). Top right: "INVOICE" large,
  letter-spaced, grey.
- Left: the customer's name and their address on one line (`oneLineAddress`). Right column: "Invoice #", "Invoice
  Date", "Due Date" (bold labels, right-aligned), dates as `11/20/2026` (`usDate`).
- The table: Description | Unit Price | Quantity | Amount. Skynova's "Item: Service" column is dropped. **No blue
  header bar**: header text in ink-muted, hairline rules above and below. Amounts like `550.00`, quantities `1.00`
  (`pdfAmount`, `pdfQuantity`).
- Under the rows: "NOTES:" (underlined, as hers) then the invoice's notes; with no notes it reads "NOTES: PAYMENT
  INFORMATION:" on one line, exactly like hers. Then the payment lines (`paymentInfoLines`): `(555) 010-0100 [Zelle]`
  and `Put invoice 0000170 in the Zelle memo`; `Check payable to …, mail to …`; `@handle [Venmo]`; `… [PayPal]`; the
  custom line; `Pay online by bank transfer: <link>` (only with an online way and a link).
- Bottom right: Subtotal, Discount (only when there is one, as `-25.00`), Total, Amount Paid, **Balance Due with a
  dollar sign** (`$625.10`), bold, a hairline above. No grey band.
- A draft prints "DRAFT" (and "DRAFT" as the number); a void one "VOID". Long tables flow onto more pages with the
  header repeated; "Page 1 of 2" at the bottom only when there is more than one page.
- File name `Invoice 0000170 - Sample Bistro.pdf` (`invoiceFileName`). English only; a name Helvetica can't draw in
  full ("SAMPLE Bakery 小点心") is printed with what it can, the creator and the invoice page say what is left out,
  and the message and the pay page carry the full name. A name or a line that would print empty (Chinese only) is
  refused before the PDF is made. Embedding a Chinese font (pdf-lib + fontkit, a subset, only when needed) is the
  fuller answer and is not built.

## The life of an invoice

```
             Make PDF (createAndFinalizeInvoice: one INSERT, already sent)
  creator ───────────────────────────────────────────────────────────┐
     │ Save as draft                                                  ▼
     └──> draft ──Make PDF (finalizeInvoice)──> sent ──payment──> partially_paid ──payment──> paid
            │                                     │ (past due: shown as Overdue)               │ delete a payment: back
            │ delete                              └──Void (no payments)──> void                │ to partially_paid / sent
            └─> gone
```

- **Make PDF from the creator** (people): `createAndFinalizeInvoice` makes the invoice already finalized in ONE
  INSERT (number, dates, status sent, link). With `draftId` it saves the form onto that draft and finalizes it in ONE
  UPDATE (`where status = 'draft'`; if it was finalized meanwhile, nothing is overwritten and its done state returns).
- **Draft** (Save as draft, a retainer, or Claude when asked): no number, no link. A person can edit everything,
  preview the PDF (printed "DRAFT") and delete it.
- **Make PDF on a draft** (the invoice page, people): `finalizeInvoice`, ONE UPDATE fixes the dates, takes the number,
  sets `sent`, stamps `sentAt` / `sentBy` and makes the customer link if there is none. Pressing it again changes
  nothing, burns no number and returns the same done state. A $0 total, a void invoice, or a way to pay that isn't
  available is refused.
- **Edit after finalizing** (people). Allowed while not paid and not void: lines, dates, discount, notes, language,
  ways to pay. Not the customer. The total can't go below what is already paid. The status is recomputed. Logged. The
  PDF is always made fresh from the invoice, so a re-download shows the edit.
- **Viewed.** The customer opening the link stamps `viewedAt` once (`lastViewedAt` at most every 10 minutes). A
  signed-in person opening it does not count.
- **Overdue.** `invoiceDisplayStatus`: sent or partially paid with `dueDate < today`. Due on receipt is overdue from
  the next day. Never stored, so it never goes stale.
- **Paid.** When payments reach the total. `paidAt` is stamped; deleting a payment clears it again.
- **Void** (people). Only with no payments (delete them first). Keeps its number; its link then shows "This invoice
  was cancelled" and nothing else. A finalized invoice is never deleted.

### Status words (team pages)

`INVOICE_STATUS_LABEL` and `INVOICE_STATUS_TONE`: Draft (hollow dot), Sent (info), Partly paid (warn), Overdue
(danger, plus "12 days" in meta), Paid (ok), Void (hollow). A dot and words, never a pill. "Viewed Nov 18" is meta
text, not a status.

## Payments

- **Record payment** (people only): amount (default: the balance), date (default today), method (default from the
  invoice's first way: Zelle), optional reference and note. Refused on a draft or void invoice and above the balance
  ("That's more than the $200.00 still owed."). The amount is HELD first in one conditional UPDATE (below, "Record a
  payment"), so two people recording the same payment at the same moment can't both pass; then the insert, the ONE
  recompute UPDATE, the deal sync, and any open Stripe page for the old balance is closed.
- **Delete payment** (people): with a confirm. Recompute and deal sync. A Stripe payment can be deleted too (after a
  refund in Stripe); the activity log keeps who and when.
- **Stripe payment** (`system`, from the verified webhook): `recordStripePayment`, ON CONFLICT
  (`stripe_session_id`) DO NOTHING, so a replay records nothing. Never refused for being more than the balance (the
  money arrived): the invoice page shows "Overpaid by $X" so a person can sort it out, and Nora gets a push ("Paid
  twice", or "Paid after it was cancelled" for a void invoice) saying to refund it in Stripe.
- Payments never appear on Nora's Schedule, in the schedule's pushes or in its calendar entries.

## Ways to pay on each invoice

- `invoices.payWays` holds the invoice's chosen ways; the creator starts with `["zelle"]` (`DEFAULT_PAY_WAYS`).
  Order doesn't matter when stored; everything shows them in `PAY_WAYS` order: **Zelle first**, then check, Venmo,
  PayPal, the custom line, then the online ways.
- **Available** (`availablePayWays(settings, stripeConfigured())`): Zelle, check, Venmo, PayPal need their details in
  Settings; custom needs its line typed (`payNote`); **bank transfer** needs `STRIPE_SECRET_KEY` and `achEnabled`;
  **card** needs `STRIPE_SECRET_KEY` and `cardEnabled`, which is **off by default**. `checkPayWays` refuses anything
  unavailable with a plain message, in the op as well as the UI.
- **What prints** (`payOptions(settings, invoice, stripeReady)`): exactly the chosen ways with their details. A way
  whose details were later removed from Settings, or an online way while Stripe isn't set up or that way is off, is
  left out, so nothing prints an empty way. The PDF prints them as `paymentInfoLines` (above); the pay page
  `/i/<token>` shows exactly the same ways, Zelle first, plus "Pay online" when bank or card is chosen and available.
- **Who sets them**: people, per invoice. Claude only when Nora or Cameron said how that invoice should be paid
  (`create_draft_invoice`'s `pay_ways`); otherwise Claude's drafts are Zelle.
- If nothing prints (no Zelle number yet and no other way), the creator's one-time ask covers it; the invoice page
  warns before Make PDF: "Add how you get paid in Settings first." (a `.notice`).
- No way ever adds a fee. The Stripe fee table in Settings is information for Nora, not a charge.

## Stripe (Pay online)

Only for invoices whose ways include `bank` or `card`.

- **Checkout Session** (`lib/stripe.ts createCheckoutSession`): `POST https://api.stripe.com/v1/checkout/sessions`,
  form encoded, `Authorization: Bearer $STRIPE_SECRET_KEY`, an `Idempotency-Key` header. Fields: `mode=payment`,
  `payment_method_types[]` = `us_bank_account` and/or `card` (the invoice's online ways that are available), one
  `line_items[0]` with `price_data[currency]=usd`, `price_data[unit_amount]=<balance cents>`,
  `price_data[product_data][name]=Invoice 0000170`, `quantity=1`, `client_reference_id=<invoice id>`,
  `metadata[invoice_id]`, `payment_intent_data[metadata][invoice_id]`, `customer_email` when known (or `customer`
  when bank reuse applies), `locale` (`en`, `zh`, `zh-TW`), `success_url=<page>?paid=1`, `cancel_url=<page>`,
  `expires_at` (1 hour). No surcharge line, ever. With bank transfer:
  `payment_method_options[us_bank_account][verification_method]=instant` (Stripe's API allows `automatic`, the
  default, or `instant`). `automatic` falls back to typing the account by hand and confirming two small deposits a
  day or two later; Checkout then completes before any money moves and the invoice would say "a bank payment is on
  its way" for up to 10 days with nothing debited. With `instant` a started transfer is always a real debit; a
  customer whose bank can't be verified instantly pays by Zelle.
- **Starting it** (`lib/ops-stripe startCheckout`, public): POST from the pay page. Refused for a draft, void, paid
  invoice, an invoice without an online way, or while a bank payment is clearing ("A bank payment is on its way").
  An `open` session for the same amount that hasn't expired is reused instead of making another; at most 6 new
  sessions per invoice per hour and 20 per day (an atomic counter in `app_settings`, key
  `stripe.checkout_rate.<invoice id>`). The amount is always the balance at that
  moment, read on the server. Older open sessions for ANOTHER amount are expired; one for the same amount is left
  alone (two presses at once must not expire the page the browser is following).
- **Open pages are closed when they stop being right** (`lib/ops-invoices closeOpenCheckouts`: expire at Stripe, mark
  `expired`): when the invoice is voided, a payment is recorded or deleted, the total is edited, the link is
  replaced, a bank transfer starts on another page, or a Stripe payment is recorded. So a Stripe page the customer
  opened earlier can't take the money for a cancelled invoice, a paid one or an old amount. A payment already in
  flight can still land: it is recorded (it is real money), logged without the amount, and Nora is pushed "Paid
  after it was cancelled: <customer>" or "Paid twice: <customer>" with "refund it in Stripe" and a link to the
  invoice; the invoice page says the same.
- **Void waits for a bank transfer.** An invoice can't be voided while a bank transfer is clearing (a checkout in
  `processing`): the money would land on a void invoice about 4 business days later. `voidInvoice` checks it in its
  one UPDATE and says "A bank payment is on its way for this invoice. Wait until it arrives or fails, then void
  it."; the invoice page hides Void meanwhile.
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

### Stripe bank reuse (researched: not used)

Bank transfer through Checkout verifies the customer's bank instantly (Financial Connections), which Stripe charges
for (about $1.50 per verification). Stripe's docs say Checkout can show a returning Customer's saved, verified bank
account (with `customer` and `saved_payment_method_options[allow_redisplay_filters]`), but not plainly whether the
customer can opt in to saving it on the hosted page or whether reusing it skips the fee, and none of it could be tried
in test mode from the build machine. Unclear, so not used: no session sets `customer`, `customer_creation`,
`setup_future_usage` or `saved_payment_method_options`, and `customers.stripeCustomerId` stays empty. Findings, links
and the test-mode steps to turn it on later: `docs/stripe-setup.md` "Saved bank accounts".

## Contracts and invoices, linked both ways

The contract generator (`lib/contract.ts`, `lib/contract-pdf.ts`, `lib/ops-contracts.ts`,
`components/contract-builder.tsx`, `app/(app)/contracts/**`) and invoicing talk to each other. **Contracts stay
people only: no Claude tool reads, makes or links contracts**, and invoice tools never return a contract.

- **The link**: `invoices.contractId` (nullable, `on delete set null`); `contracts.customerId` (set null). Many
  invoices per contract.
- **Contract to invoice.** After a contract downloads, the builder offers **"Make the invoice"**, which opens the fast
  creator pre-filled (`/invoices/new?contract=<id>`, `invoicePrefillFromContract`). On a wide screen it sits under the
  Download button; under 1200px (phones, an iPad) it takes the fixed bar where Download was, as the bar's ink button
  with "Downloaded and saved." and a quiet "Download again" above it, so the next step is on the screen the moment
  the download lands (the same for "Back to the invoice" on a contract made from an invoice). Changing the form after
  a download puts Preview and Download back (what was saved is no longer what the form shows). It opens with:
  - customer: the contract's `customerId`, else a customer whose name key matches the contract's business, else a new
    one (made on Make PDF) from the business, contact and email;
  - lines and due date (`invoiceFromContractFields`, matching what the contract says): the saved package name at the
    contract fee, due in the contract's payment days; with a deposit (1 to 99%), first **"Deposit (30%)"** at that
    share, due on receipt (the contract says the deposit is due on signing), and later "Invoice the rest"
    ("Standard Content Creation Package, remaining 70%", due in the payment days); with 100%, the package due on
    receipt; a monthly contract, one month ("Social media services (December 2026)"), due in the payment days;
    a gifted contract (no fee) offers nothing;
  - `contractId` set, source `contract`.
  - A **monthly** contract also offers **"Set up monthly invoices"** (`createRetainerFromContract`): a retainer from its
    fee, start date (day of month, first month) and term (`retainerFromContractFields`; the term is a minimum and the
    contract then runs month to month, so the retainer has no end: a person pauses it). One per contract. Its drafts
    carry the `contractId` and are due in the contract's "pay within" days (`contractPaymentDays`), as the contract
    says. **A month is never billed twice**, whichever button is pressed first: `createRetainerFromContract` marks a
    month an invoice already bills, and `runRetainers` checks again before each draft (an invoice of the contract for
    that month, by its retainer month or its first line, takes the month). "Invoice this month" is offered only while
    the contract has no invoice and its monthly invoices haven't taken this month.
- **Invoice to contract.** The invoice page and the done state offer **"Make contract"**, which opens `/contracts`
  pre-filled (`/contracts?invoice=<id>`, `contractPrefillFromInvoice` → `contractFieldsFromInvoice`): business,
  contact, email, the fee from the main line (a retainer invoice opens a monthly contract), plus the invoice's deal.
  The saved contract links back: `saveContract({ fields, dealId, invoiceId })` calls `linkContractToInvoice`. A
  contract made from a retainer's invoice takes that retainer as its own (`retainers.contractId`), so it shows as
  billing monthly already and never offers a second "Set up monthly invoices".
- **Each shows the other**:
  - Past contracts rows show their invoices ("0000170 · Paid", `invoicesForContracts` + `invoiceRefLabel`), or the
    next step ("Make invoice", "Make deposit invoice", "Invoice the rest", "Set up monthly invoices";
    `contractNextSteps`).
  - The invoice page shows its contract ("Contract Nov 20 · Download again", `InvoiceDetail.contract` +
    `contractRefLabel`; Download again rebuilds the PDF in the browser from `fields`, lazy-loaded) or "Make contract".
    The same is in the line under the invoice's number at the top of the page ("Contract Nov 20", which jumps to that
    section, or "Make contract"), so the other half of the pair is one tap from the top on a phone too.
  - The customer page lists both: invoices and contracts (`CustomerDetail.contracts`, each with its invoices and next
    steps).
  - A deal page shows both: its invoices (`invoicesForDeal`) and its contracts (`contractsForDeal`).
- **Follow up from either one in one tap**: the next step is always a button on the row or page (`invoiceNextSteps`,
  `contractNextSteps`). The invoice's own follow-ups (Record payment, Remind with the reminder text) are unchanged;
  the new ones are "Make invoice" / "Invoice the rest" / "Set up monthly invoices" from a contract and "Make contract"
  from an invoice.

## Deals

- **Make invoice** on a deal's page (people) opens the fast creator pre-filled (`/invoices/new?deal=<id>`): the
  customer is the deal's client, else a customer with the same name key (and email), else a new one from the deal's
  contact and address (`customerForDeal`); one line "Collab: Instagram Reel, TikTok" (from the deliverables) at the
  deal's amount, `dealId` set. A deal that already has a draft opens that draft instead.
  `createInvoiceFromDeal` (a draft, no creator) stays for Claude's `create_draft_invoice` with `deal_id`.
- **The deal follows its invoices** (`syncDealFromInvoices`, after finalize, void and every payment change): all
  finalized invoices paid → the deal's `paymentStatus` is `paid` (`paidAt` = last payment); any unpaid → `requested`
  with the earliest unpaid due date; none left after a void → back to `not_requested` if it was `requested`.
  Deleting a payment moves it back. One UPDATE on the deal.
- **A deal shows its invoices and contracts** on its Payment card: "0000170 · Sent · due Dec 4" linking to the
  invoice, and "Contract Nov 20". With an invoice, the card's manual "Invoice sent / Mark paid" buttons give way to
  "Record payment" on the invoice. The existing "Request payment" text stays for deals without an invoice; "Make
  contract" on a deal stays as it is (`/contracts?deal=<id>`).
- `dealsOwed` and the Deals card keep working from the deal fields, which the sync keeps right.

## Recurring (monthly retainers)

A retainer belongs to a customer (and maybe a contract): amount, description, day of month. The existing daily
reminders cron (`runDailyReminders`, once a day after 8am New York) calls `runRetainers` first. For each retainer that
is due (`retainerDue`: active, started, not made this month, today on or after its day; a missed day catches up), it
claims the month with ONE conditional UPDATE on `lastRunMonth`, then inserts ONE draft (source `retainer`, one line
"Social media services (November 2026)", `retainerMonth`, Zelle, the retainer's `contractId`; due on receipt, or in
its contract's "pay within" days when it bills a contract), unique per retainer and month. A retainer with a
contract first checks that no invoice of that contract already bills the month (a hand-made "Invoice this month"):
if one does, the month is marked taken and no draft is made. A person presses Make PDF. A draft someone deleted is not made again that month. If
the insert fails, the claim is released so the next run retries. The preview mode (`?preview=1`) makes nothing
(`dryRun`).

## Reminders

All to Nora, topic `payment_overdue` (relabel it "Payments" in `components/notify-topics.ts`: "Morning reminder when
an invoice is due tomorrow or late, and when a retainer invoice is ready (Nora)").

- In the daily run (`invoiceReminders(today)`): invoices due tomorrow ("Due tomorrow: Crab O Clock $800"), overdue
  invoices (joined with today's overdue deals into one "3 payments overdue" push; a deal whose payment is tracked by
  an invoice is counted once, as its invoice), and retainer drafts made today ("Invoice ready: Crab O Clock $800,
  tap to make the PDF"). Links go to `/invoices/<id>` or `/invoices?status=overdue`. With due on receipt the "due
  tomorrow" line only appears for invoices whose due date was changed.
- **Friendly reminder** a person sends: the invoice page's "Remind" shows the email (built with
  `lib/payment-request.ts`, which gains an invoice variant that reuses `formatAmount`, `longDate`, `mailtoHref` and
  the first-name rule) and the short text in the customer's language, both with the Zelle memo line when Zelle is a
  way; "I sent it" stamps `lastRemindedAt`.
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
   Contact; Invoice # / Number / No.; Date / Invoice Date / Issue date; Due / Due Date; Total / Amount; Paid / Amount
   Paid; Balance / Balance Due / Amount due; Status; Description). Dollar amounts like "$1,250.50"; dates as
   2026-11-20, 11/20/2026 or Nov 20, 2026. Numbers normalized (`normalizeImportedNumber`). Each row shows what will
   happen: new customer, matches "Crab O Clock", new open invoice, already imported (same number), or an issue ("no
   amount", "card or bank number in the text"). Nothing is written.
2. **Save** (`saveSkynovaImport(text, kind, actor)`): re-parses the same text on the server (never trusts the
   browser's rows). Customers are matched by name key, never duplicated. Invoices are saved as `sent` with Skynova's
   number, source `import`, Zelle as their way, one line (the pasted Skynova description when there is one, so "Same
   as last time" can reuse it, else "Imported from Skynova (invoice 0000169)"), and an `other`
   payment ("Skynova") for any amount already paid, so the status comes out right. Then ONE `setval` moves the
   sequence past every number used (`ImportResult.nextNumber` says what's next). Rows with issues are skipped and
   listed.

An imported invoice has no customer link until a person presses "Copy link" (`getInvoiceLink` makes one).

## Claude (MCP)

New file `src/lib/mcp/tools-invoices.ts`, registered in `mcp/server.ts`:

| Tool | Does | Never returns |
|---|---|---|
| `list_invoices` (read) | Number, customer, status (overdue derived), issue and due dates, total, paid, balance, ways to pay, deal id. Filters: status, customer_id, deal_id | Links, tokens, Stripe ids, fees, contract ids |
| `get_invoice` (read) | One invoice: lines, totals, notes, ways to pay, payments (date, amount, method), customer name and contact | The link, private settings, Stripe ids, anything about a contract |
| `list_customers` (read) | Name, contact, email, phone, client id, outstanding and overdue | `stripeCustomerId` |
| `create_draft_invoice` | Only when Nora or Cameron asked. Customer by `customer_id`, `client_id` (makes the customer from the business) or `deal_id` (like Make invoice on the deal). Lines as `{ description, quantity, unit_cents }`, optional `due_date` (default: due on receipt), `notes`, `ask_id`, and **optional `pay_ways`** (`zelle`, `check`, `venmo`, `paypal`, `custom`, `bank`, `card`) **and `pay_note`**, only when a person said how it should be paid. Returns the draft id and `/invoices/<id>` | |

There is no tool to make the PDF / finalize, record a payment, mark paid, void, delete, make a link, import, set the
next number, edit saved lines, read or change payment settings, or read, make or link a contract. The output goes
through the same compact JSON helper as the other tools.

Rule for `src/lib/mcp/rules.ts` (replace the end of the schedule rule that says "the app writes her invoice and
payment-reminder text from the deal, don't draft those"):

> Invoices (list_invoices, get_invoice, list_customers, create_draft_invoice): you may read them, and make a DRAFT
> invoice only when Nora or Cameron asked for one, in chat or in an ask. Use the customer, business or deal they
> named and the amounts they gave you; never invent a price, a discount or a due date. Invoices are paid by Zelle
> unless they told you otherwise: set pay_ways only when they said how this invoice should be paid, and never add a
> fee or surcharge for any way to pay. A person reviews the draft and presses Make PDF; you never finalize or send an
> invoice, record or delete a payment, mark one paid, void or delete one, share its link, or change how Nora gets
> paid. Contracts are people only: you don't read, make or link them. Don't draft a separate invoice or
> payment-reminder text either: the app writes those. If an ask is about money you can't see (an amount, who paid),
> ask in the thread. Invoices are never on Nora's schedule.

## The customer's page (/i/<token>)

Public (middleware: add `"/i"` to `PUBLIC_PAGES`, `"/api/stripe/webhook"` to `PUBLIC_PREFIXES`). Outside the
`(app)` group, no app chrome, `IntakeShell`-style wrapper like `/drop`.

- **The link** works like the drop link: 32 random bytes (base64url); only the sha256 (`intakeTokenHash`) is used
  for lookup and an encrypted copy (`lib/crypto`) lets the team copy it again. Made when finalized. "New link"
  (people) makes another and the old one stops working at once. No expiry: a customer may pay months later.
- **Lookup** `getInvoiceByToken`: never a link → 404; void → "This invoice was cancelled. Questions? Contact <from
  name>." with no amounts; otherwise the invoice and exactly its ways (`PayOption[]`, Zelle first). `noindex`,
  `referrer: no-referrer`, `Cache-Control: no-store`.
- **Language**: `?lang=` → the invoice's `lang` → the customer's → Accept-Language (`PublicInvoice.lang` is null when
  neither the invoice nor the customer has one). The switch at the top
  (English / 简体中文 / 繁體中文), as on `/drop`. Copy: `lib/invoice-copy.ts` (no em dashes, typed dictionaries).
- **What it shows**, phone first: who it's from (name, address); "Invoice 0000170"; the status line ("Due on
  receipt", "Due Dec 4", "Overdue since Dec 4", "Paid, thank you", "A bank payment of $600.00 is on its way"); Bill to
  (name, address); the lines, subtotal, discount, total, paid, **Balance due** (Newsreader figure); the notes; then
  How to pay: exactly the invoice's ways, Zelle first (the Zelle number with a copy button and "Put invoice 0000170 in
  the Zelle memo"; check; Venmo; PayPal; the custom line), then **Pay online** only when the invoice has bank or card
  and it's available (the one primary button on this page: cinnabar, as outside the app shell); then "Download PDF"
  (secondary). After Stripe returns (`?paid=1`): "Thank you! Card payments show here right away; bank transfers in a
  few days."
- **Nothing else**: no other invoices, no business page, no deal, no contract, no private note, no source, no Nora HQ
  links.
- **PDF** `GET /i/<token>/pdf`: `invoicePdf(id, { public: true })`, `Content-Disposition: attachment;
  filename="Invoice 0000170 - Sample Bistro.pdf"`, `no-store`.
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
tab keys in `NORA_TABS`. Never gate invoicing with `seesDrafts`. A "New invoice" shortcut belongs wherever Nora
starts work (the Invoices head action, and her Home's quick actions if that area has them). Add `/invoices` routes to
the smoke's `ROUTES` and `NORA_ROUTES`.

| Route | What |
|---|---|
| `/invoices` | Figures (Outstanding, Overdue, Paid this month, Paid this year); filter chips Open · Overdue · Drafts · Paid · All; one list: number, customer, due, amount due, status, and a **one-tap PDF download on every row** (`invoicePdfPath(id, { download: true })`). Head actions: **New invoice** (the focal button), Import, Export payments (CSV). `?status=`, `?customer=` |
| `/invoices/new` | **The fast creator** (above), with its done state. `?customer=`, `?client=`, `?deal=`, `?contract=` (+`&part=rest` or `&part=full`), `?draft=` pre-fill. `?done=<id>` shows the done state again after a reload (Make PDF replaces the URL with it). `?edit=<id>` edits a finalized, unpaid invoice in the same screen: customer locked, the button reads "Save changes", saved through `updateInvoice` |
| `/invoices/[id]` | The invoice as the PDF shows it (`InvoiceDetail.document`), plus the team's bits: status line, viewed, deal link, **its contract** ("Contract Nov 20 · Download again" or "Make contract"), private note, payments list, a bank payment clearing. Actions: **Make PDF** (the focal button on a draft), Edit (opens the creator with `?draft=`), Preview PDF, Delete draft; once finalized: Share PDF / Download PDF / Copy message (the done state's buttons), Copy link, Record payment (the focal button once finalized), Remind, New link, Void |
| `/invoices/[id]/pdf` | Signed-in PDF route (`invoicePdf(id)`); `inline`, or `attachment` with `?download=1`; drafts print "DRAFT"; `Cache-Control: private, no-store` |
| `/invoices/customers`, `/invoices/customers/new`, `/invoices/customers/[id]` | Customers with outstanding / overdue; a customer's contact, invoices, payments, retainers (add, edit, pause), **contracts** (each with its invoices and next step), balance; "New invoice for them" (`/invoices/new?customer=`) |
| `/invoices/reports` | Paid by month, by method, by customer; Export payments (CSV) per year |
| `/invoices/export` | `route.ts`: `paymentsCsv({ year })`, `text/csv`, attachment, `no-store`, signed-in |
| `/invoices/import` | Paste box, kind (Customers / Invoices), Preview, then Save |
| `/settings` | New "Invoices and payments" card (`#invoicing`), visible to both: From (name, address, optional email / phone), Zelle (number, optional name), check, Venmo, PayPal, **Saved lines** (add, edit, reorder, remove; amount optional = typed each time), **Next invoice number** (shows the next; setting it can't go back onto a used number), Pay online (status from `stripeConfigured()` / `stripeTestMode()`, bank transfer on/off, **card on/off, off by default**, the fee table, "No fee is ever added for the customer"), default due days (0 = due on receipt) and note. The existing payment line stays |
| `/contracts` | The builder gains: after a download, **"Make the invoice"** (and "Set up monthly invoices" for a monthly contract with a fee); `?invoice=<id>` opens pre-filled from an invoice and the save links back; **Past contracts rows show their invoices** ("0000170 · Paid") or their next step |
| `/deals/[id]` | Payment card: "Make invoice" (opens the creator), or the deal's invoice line(s) and contract(s) |

Money input fields take dollars (`parseDollars`, `centsToDollarsInput`); everything is shown with `formatCents`
(`decimals: "always"` on invoices, `"auto"` in lists and pushes); the PDF uses `pdfAmount`.

## Atomic statements

Neon over HTTP has no interactive transactions. These are the statements the design relies on; the numbering ones
are proved in `scripts/test-invoice-numbers.mts` (PGlite, on top of 0017), the others were run against PGlite on top
of 0016.

The next free number (used inside the two finalize statements; uncorrelated, so Postgres evaluates it only when
`number` is null, and `nextval` runs once per row the LIMIT pulls, so a used number is skipped and burned):

```sql
-- TAKE
(select n from (
   select lpad(v::text, greatest(7, length(v::text)), '0') as n
   from (select nextval('invoice_number_seq') as v from generate_series(1, 1000)) q
 ) s
 where not exists (select 1 from invoices x where x.number = s.n)
 limit 1)
```

Create and finalize (the fast creator's Make PDF, ONE INSERT):

```sql
insert into invoices (id, number, customer_id, status, issue_date, due_date, terms_days, items, subtotal_cents,
  discount_cents, discount_label, total_cents, notes, private_notes, deal_id, contract_id, pay_ways, pay_note, lang,
  token_hash, token_enc, source, sent_at, sent_by, created_by)
values ($id, TAKE, $customerId, 'sent', $issue, $due, $termsDays, $items, $subtotal, $discount, $label, $total,
  $notes, $private, $dealId, $contractId, $payWays, $payNote, $lang, $hash, $enc, $source, now(), $actor, $actor)
returning *;
```

Finalize a draft (Make PDF on the invoice page; the creator's `draftId` path adds the form's columns to the SET and
`and status = 'draft'` to the WHERE; a second press changes nothing and burns nothing):

```sql
update invoices set
  issue_date = coalesce(issue_date, $today),
  due_date   = coalesce(due_date, to_char(coalesce(issue_date, $today)::date + terms_days, 'YYYY-MM-DD')),
  number     = coalesce(number, TAKE),
  status     = case when status = 'draft' then 'sent' else status end,
  token_hash = coalesce(token_hash, $hash), token_enc = coalesce(token_enc, $enc),
  sent_at    = coalesce(sent_at, now()), sent_by = coalesce(sent_by, $actor), updated_at = now()
where id = $id and status <> 'void' and total_cents > 0
returning *;
```

Either one failing on `invoices_number_unique` (a concurrent import wrote the same number between the check and the
write) is retried once.

Make PDF pressed again after a lost response (the creator's `requestId`): `$id` is `inv_<requestId>`, the number is
`case when exists (select 1 from invoices y where y.id = $id) then null else TAKE end` (the CASE never reaches the
sequence when the row is there, so a repeat takes no number) and the INSERT ends `on conflict (id) do nothing`. No
row back: the op reads `$id` and returns the invoice the first press made.

Move the sequence past every number used (after an import), and "Next invoice number" (floored the same way):

```sql
select setval('invoice_number_seq', greatest(
  (select case when is_called then last_value + 1 else last_value end from invoice_number_seq),
  (select coalesce(max(number::bigint), 0) + 1 from invoices where number ~ '^[0-9]{1,18}$')
), false);

select setval('invoice_number_seq', greatest($n::bigint,
  (select coalesce(max(number::bigint), 0) + 1 from invoices where number ~ '^[0-9]{1,18}$')), false);
```

Peek (`nextInvoiceNumber`), with `NEXT` = `(select case when is_called then last_value + 1 else last_value end from
invoice_number_seq)`:

```sql
select lpad(min(g)::text, greatest(7, length(min(g)::text)), '0') as next
from generate_series(NEXT, NEXT + 1000) g
where not exists (select 1 from invoices x where x.number = lpad(g::text, greatest(7, length(g::text)), '0'));
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

Record a payment (people): the amount is held first, so two people recording the same payment at once can't both
pass (the second waits for the row, then sees the first one's amount and is refused). Then the insert, then the
recompute above, which sets `paid_cents` to the true sum whether or not the insert worked:

```sql
update invoices set paid_cents = paid_cents + $amount
where id = $id and status in ('sent', 'partially_paid') and total_cents - paid_cents >= $amount
returning id;
```

Void (only with no payment and no bank transfer on its way):

```sql
update invoices set status = 'void', voided_at = now(), voided_by = $actor, void_reason = $reason, updated_at = now()
where id = $id and status in ('sent', 'partially_paid', 'paid')
  and not exists (select 1 from invoice_payments p where p.invoice_id = invoices.id)
  and not exists (select 1 from invoice_checkouts k where k.invoice_id = invoices.id and k.status = 'processing')
returning *;
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
-- then: insert into invoices (…, retainer_id, retainer_month, contract_id) … on conflict do nothing returning id
```

Retainer from a contract (one per contract, `retainers_contract_uq`):
`insert into retainers (…, contract_id) values (…) on conflict (contract_id) do nothing returning *`, then read the
existing one when nothing came back.

Link a saved contract to its invoice (single-row statements; each is idempotent). The invoice's retainer, if it has
one, becomes the contract's, so the contract never offers a second "Set up monthly invoices":

```sql
update invoices set contract_id = $contractId, updated_at = now() where id = $invoiceId returning customer_id, deal_id, retainer_id;
update retainers set contract_id = $contractId, updated_at = now() where id = $retainerId and contract_id is null;
update contracts set customer_id = coalesce(customer_id, $customerId), deal_id = coalesce(deal_id, $dealId) where id = $contractId;
```

Stripe event claim (new: a row; processed: nothing; failed earlier: a row again, so Stripe's retry is processed):

```sql
insert into stripe_events (id, type) values ($id, $type)
on conflict (id) do update set attempts = stripe_events.attempts + 1
  where stripe_events.processed_at is null
returning id;
-- process, then: update stripe_events set processed_at = now(), error = null where id = $id
```

Settings merge (saved lines included, as one key): `insert … on conflict (key) do update set value =
coalesce(app_settings.value, '{}'::jsonb) || excluded.value`.

## Safety checklist

- No secrets in the database, code, logs or MCP output. Stripe keys: env only. Customer links: hash plus encrypted
  copy, like the drop link. The activity log never holds the settings' values, a link, a token or a Zelle number.
- Nora's real address and Zelle number live only in Settings (typed by a person). Code, seeds, tests, docs,
  screenshots, commits and PR text use fake values ("100 Sample St", "(555) 010-0100").
- No card or bank details anywhere. Stripe's hosted page takes them; we keep the session id, payment intent id,
  amount, method, fee and (only if bank reuse works) the Stripe Customer id. `looksLikeCardOrBankNumber` refuses them
  in settings, references, notes and imports.
- No surcharge or fee for any way to pay, in code, copy, Claude's drafts or the PDF.
- Everything a customer or an import typed is untrusted text: control characters stripped (`cleanLine`,
  `cleanBlock`), lengths capped, rendered as text, CSV cells defused.
- Money is integer cents; amounts are bounded ($1,000,000 max per line, discount, total and payment).
- Numbers are never repeated: taken in the finalize statement, used ones skipped, imports and "Next invoice number"
  floored past every used number, the unique constraint as the last guard.
- Contracts are people only: no MCP tool reads them and invoice tools never return a contract.
- Public routes answer 404 for an unknown token, never say whether an invoice id exists, and send no referrer.
- The webhook trusts only a verified signature, uses `metadata.invoice_id`, and is idempotent twice over (event
  claim and the unique session id).

## Files and who builds them

Three builders work in parallel on `feature/invoicing` after this step. Each owns its files; a change someone else
needs in your file is a message to that builder, not an edit. Shared files written by the design step
(`invoices-types.ts`, the stubs in `ops-invoices.ts`, `schema.ts`, the 0017 migration) change only by adding, and
anything that changes a signature is told to the others first.

**core** (the data, the rules, the PDF, the texts and the tests)
- `src/lib/ops-invoices.ts` (fill in every stub; signatures are final, add helpers freely): customers, the fast
  create-and-finalize and draft save, the creator context and Bill to list, last invoice, numbering (the finalize
  statements, peek, next number, import bump), saved lines, recurring, reminders, reports, settings, the deal sync,
  the contract links (prefills both ways, link, lists, retainer from a contract), the public lookup, the import
- `src/lib/invoice-pdf.ts` (new: pdf-lib, Letter, draws `invoiceDocument`; server side)
- `src/lib/invoice-import.ts` (new: the pure paste / CSV parser)
- `src/lib/invoices-types.ts` (may add; don't change existing signatures without telling the others)
- `src/lib/ops-contracts.ts` (`saveContract` with `invoiceId` is wired to `linkContractToInvoice`; add what the
  contract links need), `src/lib/contract.ts` helpers (pure; no change to the contract's words)
- `src/lib/payment-request.ts` (the invoice email and reminder, with the Zelle memo line), `src/lib/ops-payment.ts`
  (merge fix)
- `src/lib/ops-notify.ts` (retainers first, then the invoice pushes in `runDailyReminders`)
- `src/lib/mcp/tools-invoices.ts` (new, with `pay_ways` / `pay_note`), `src/lib/mcp/server.ts` (register),
  `src/lib/mcp/rules.ts` (the rule above)
- Unit tests: `scripts/test-invoices-types.ts`, `scripts/test-invoice-numbers.mts`, `scripts/test-invoice-import.ts`,
  `scripts/test-invoices-ops.ts` (ops against a throwaway PGlite:
  `PGLITE_DIR=$(mktemp -d) npx tsx --require ./scripts/server-only-shim.cjs scripts/test-invoices-ops.ts`),
  `scripts/test-invoice-review.ts` (the same way; one stand-alone check per review finding: a void while a bank
  transfer clears, stale Stripe pages, two people recording one payment, Make PDF pressed twice, Same as last time,
  a month billed twice, the PDF's letters against the real font), and extending `scripts/sample-seed.mts` if more
  sample data helps

**team_ui** (every signed-in page)
- `src/app/(app)/invoices/**`: the list (one-tap PDF per row), **the fast creator `/invoices/new` and its done state**,
  the invoice page, customers, reports, import, their server actions, the PDF route `[id]/pdf/route.ts` and the CSV
  route `export/route.ts`
- `src/components/invoice-*.tsx` (new), `src/app/styles/invoicing.css` (new, imported like the other area sheets)
- `src/components/sidebar.tsx`, `src/components/section-tabs.tsx` (nav entry for both), `src/components/notify-topics.ts` (label)
- `src/app/(app)/settings/page.tsx` plus a new settings card component and its action (From, Zelle, ways, saved
  lines, next number, Pay online, card off by default)
- `src/app/(app)/deals/[id]/page.tsx` and `src/app/(app)/deals/actions.ts` (Make invoice, the invoice and contract lines)
- `src/components/contract-builder.tsx` and `src/app/(app)/contracts/**` ("Make the invoice", "Set up monthly
  invoices", `?invoice=` prefill and `invoiceId` on save, Past contracts rows with their invoices / next step)
- `scripts/smoke.mjs` signed-in routes (`ROUTES`, `NORA_ROUTES`) and flows; the speed measurements

**public_stripe** (the customer's side and Stripe)
- `src/app/i/[token]/page.tsx`, `src/app/i/[token]/pdf/route.ts`, `src/app/i/[token]/pay/route.ts`, any components
  it needs (`src/components/invoice-public*.tsx`): exactly the invoice's ways, Zelle first, Pay online only for bank
  / card
- `src/app/api/stripe/webhook/route.ts`
- `src/lib/stripe.ts` (fill in the stubs), `src/lib/ops-stripe.ts` (new: `startCheckout`, `handleStripeEvent`, the
  `invoice_checkouts` and `stripe_events` rows; calls core's `getInvoiceByToken` and `recordStripePayment`), the
  **Stripe bank reuse research** and, only if it works, its implementation
- `src/lib/invoice-copy.ts` (the page copy in three languages; `share.message` and `share.pdfMessage` are used by
  core and the done state: change their wording only by telling the others)
- `src/middleware.ts` (`/i`, `/api/stripe/webhook`), `src/lib/integrations/env.ts` (the two optional Stripe vars),
  `docs/stripe-setup.md` (new, with what the bank reuse research found), `docs/setup.md` (env vars)
- `scripts/test-stripe.ts` (signature, form encoding), `scripts/smoke.mjs` `PUBLIC_ROUTES`

Seams, so nobody waits: team_ui and public_stripe code against the stubs in `ops-invoices.ts` (they throw "Invoicing
is not built yet" until core lands; catch `OpsError` where a page must still render). Everything pure is real already
in `invoices-types.ts` (numbers, defaults, `availablePayWays`, `payOptions`, `paymentInfoLines`, `invoiceDocument`,
`sameAsLastTime`, `readyItems`, `filterBillTo`, `creatorDefaultsLine`, `doneActions`, the contract mappings and next
steps), and so are `stripeConfigured()`, `stripeTestMode()`, `stripeWebhookConfigured()` and
`invoiceCopy(lang).share`. `getInvoiceByToken` returns everything the public page needs, its `PayOption[]` included.

## Local development

`rm -rf .data && npm run dev:sample-data` loads fake payment settings (From "Nora Chen", "100 Sample St, Sampleton, VA
23000", Zelle "(555) 010-0100", check, Venmo, bank transfer on, card off, the two saved lines), fake customers,
retainers, two contracts and one invoice in each state, all numbered from before Nora HQ so the sequence is untouched:
an imported Skynova invoice `0000165` (paid), `0000166` (overdue and partly paid, from the sample deal "SAMPLE Bakery
小点心", page language 简体), `0000167` (void), `0000168` (from the SAMPLE Taco Spot contract: the package and a Food
Stipend, Zelle or check), `0000169` (this month's retainer, due on receipt today, Zelle or bank transfer online: without
`STRIPE_SECRET_KEY` it offers Zelle only), and a draft. The Sample Pizzeria contract (from its deal, 30% deposit) has
no invoice yet, for trying "Make deposit invoice". **The creator's next number is `0000170`**, as on Nora's first day
(the smoke test checks it on fresh sample data). Customer links (each token is 43 characters):
`/i/sample-invoice-open-00000000000000000000000`, `/i/sample-invoice-overdue-00000000000000000000`,
`/i/sample-invoice-paid-00000000000000000000000`, `/i/sample-invoice-void-00000000000000000000000`,
`/i/sample-invoice-contract-0000000000000000000`. The sample deal "Sample Pizzeria" has no invoice, for trying Make
invoice. To try the creator's one-time ask, clear From and Zelle in Settings. Use Stripe test keys (`sk_test_…`) and
`stripe listen --forward-to localhost:3200/api/stripe/webhook` to try Pay online.

### Testing

Test a production build, not `next dev` (several times faster, no dev-server restarts):

```
pkill -f next-server; rm -rf .data public/uploads && npm run -s dev:sample-data && npx next build && npm run start:test
BASE_URL=http://localhost:3200 MCP_TOKEN=test CRON_SECRET=test NODE_PATH=$(npm root -g) node scripts/smoke.mjs invoicing
```

- `npm run start:test` is `next start -p 3200` with throwaway test values: `MCP_TOKEN=test`, `CRON_SECRET=test`,
  `STRIPE_WEBHOOK_SECRET=whsec_test`, and the `AUTH_SECRET`, `APP_USERS` (cameron@local, nora@local) and
  `TOKEN_ENC_KEY` a production build needs (in `next dev` those have built-in defaults). Because that `AUTH_SECRET`
  is written in the repo, the script also blanks `DATABASE_URL` (the server can only open the embedded sample
  database in `./.data`, never the real one) and listens on 127.0.0.1 only. `next start` runs as a process named
  `next-server`, so `pkill -f "next start"` does not stop it; `pkill -f next-server` does.
- **Signing in.** A production build checks the real password's built-in hash (`src/lib/team.ts`), so the local
  password "dev" does not work on its sign-in form, and no test should know the real one. Tests sign themselves in
  with a session cookie made from the test server's own `AUTH_SECRET`: `scripts/test-login.mjs` (`signIn(context,
  base, "nora@local")`; `node scripts/test-login.mjs nora@local` prints the cookie for curl). The app has no special
  case for this; a server with any other `AUTH_SECRET` ignores the cookie. On `next dev` the same helper uses the form.
- **Sections.** `node scripts/smoke.mjs list` prints them. One or more names run just those: `invoicing`, `v6`
  (deals), `v8` (navigation, schedule), `v10` (settings, payment text), or by feature: `deals`, `contracts`,
  `settings`, `navigation`, `schedule`. No name runs `all` (the crawl and every flow). `responsive` is the long page
  audit and only runs when named.
- **Sizes.** The crawls run in dark mode only (both themes share one layout), at every distinct iPhone screen from
  the iPhone 14 on (390 x 844, 393 x 852, 402 x 874, 420 x 912, 428 x 926, 430 x 932, 440 x 956, and the folding
  iPhone Duo's 466 x 678 and 626 x 890), the iPad Pro 11-inch (834 x 1194) and a 1080p desktop; each is named by its
  models in the output (`DEVICE_SIZES` in the script). `SMOKE_FULL=1` adds the old generic widths and light mode.
  `SMOKE_SIZES=393x852,ipad,desktop` and `SMOKE_ROUTES=/invoices,/i/` narrow a run to some sizes or routes.
- **Two things only a production build shows.** (1) `next start` serves the public folder as it was at start, so a
  file uploaded during a run (`public/uploads`, the local stand-in for Vercel Blob) answers 404; the smoke test
  skips that one console error on the test server and says how many it skipped. (2) **A known issue, older than
  invoicing and on main too:** now and then React reports hydration error #418 while a page loads, throws away the
  server's HTML and draws the page again in the browser. The page works afterwards. It happens on every page (signed
  in or not), never on `next dev`. What sets it off: React starts on the page before all of the page's data has
  arrived (a long page's data comes in several pieces, and a list's later rows are among the last), and its second
  try, when the rest arrives, fails. So it is rare on a fast connection (none in hundreds of loads with one browser,
  about 1 load in 75 with four browsers at once) and common on a slow one: at 400 kbit/s, 3 to 20% of loads across
  pages and about 1 in 4 on the invoice list; holding the app's main script back until the page has fully arrived
  makes it go away (0 in 30). `node scripts/hydration-check.mjs` measures it. The page crawls load such a page again
  and count it (a note at the end) instead of failing; the same error on every load of a page is still a failure.
  It needs its own decision: a newer React / Next if they fixed it, or a loading boundary around the page content
  (which changes how pages appear: the frame first, then the content).
- The overflow check looks at what is cut off, not at sideways scrolling: `html` and `body` clip sideways overflow
  (`overflow-x: clip`), so the page never scrolls sideways and `documentElement.scrollWidth` alone would never fail.
