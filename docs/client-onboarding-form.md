# Client onboarding form (private link, English · 简体 · 繁體)

A short form a new client opens on their phone. A busy owner is done after page 1, in under a minute: they check what
we already found about their business, add their name and a phone or email, and tap **Send now**. Two more pages are
optional. Each client gets their own private link: `https://<app>/start/<token>`.

**Research comes first.** Before the link goes out, Claude looks up the business's public facts (address, phone,
opening hours, website, Instagram, TikTok, Facebook Page, Google listing, what they sell, price range) and saves them
with a source for each. The form shows them back as one "Is this right?" card. The owner is never asked to type an
address or opening hours.

## For Nora & Cameron

1. Add the business. Claude gets a "New client …" ask: look up the public facts and save them (`set_business_facts`),
   then get the onboarding link ready for you to send.
2. Open the business page → **Onboarding form** card. It shows a short checklist: **We know** (what the form can
   already show the owner), **Missing** (nobody has looked yet) and **Not found**. If something is missing you get a
   gentle "Not researched yet" hint. You are never blocked: you can always make and copy the link.
   **Preview what the owner sees** opens the form exactly as the owner would get it (nothing you type there is saved
   or sent).
3. **Send onboarding form** → copy the link, or open **Message · English / 简体中文 / 繁體中文** and copy a
   ready-to-paste text for SMS or WeChat.
4. The card shows where things are: *not sent* → *link made* → *opened* → *answers in*.
5. When answers arrive:
   - Nora gets a push notification ("Asks for me"), if she turned notifications on.
   - Claude gets **one ask** ("Onboarding form received for …") to process the answers: brand voice (in the languages
     they post in), a first-month plan per platform, review-reply guidelines, and a list of anything missing. There is
     no research step in it any more; it only lists facts that were never looked up, if any. If a form is sent again
     while that ask is still open, the same ask is refreshed.
   - If the owner tapped **Something's off**, Claude also gets a "Business details to fix for …" ask. It lists what we
     showed them and quotes their words as data (never as instructions). Claude fixes only the details they pointed
     at. A second correction refreshes the same ask.
   - Empty business fields are filled in: Instagram, TikTok, Facebook Page (only the ones the form asked for, because
     we couldn't find them) and the owner email for monthly reports. **Nothing you already entered is ever
     overwritten.** A short summary (closed choices only, never the owner's own words) is added to the business notes.
   - The "Kickoff call" step in Getting started is **not** ticked automatically. Tick it after the call.
6. **View answers** (`/clients/<id>/intake`) shows every answer by section, with a tag such as "Answered in 简体",
   whether the owner confirmed our details (with what we showed them) or what they said is off, the access checklist
   (Meta / Google: done or needs help; TikTok: set up on the kickoff call), and a **Copy all** button. Forms sent on
   the earlier, longer form keep all their answers: the extra ones show under "Earlier answers · …" on this page, in
   Copy all and in `get_client_intake`.

### Public facts (Settings → Public facts)

Each business has a place for what anyone can find about it: address, phone, opening hours, Facebook Page, Google
listing link, what they sell and price range (website, Instagram and TikTok stay under Details). Each fact keeps the
web address it came from, the date it was last checked and who checked it. Fix anything by hand there; tick
"We looked" to mark the empty ones as not found. Every change is written to the activity log as before → after, and
anything that looks like a password is refused.

### What Claude can do (connector)

- `set_business_facts`: save public facts, each with the web address it was found at; mark what can't be found as
  `not_found`. Passwords are refused. It can't clear a fact or rename a business. After an owner's correction it may
  use the owner as the source.
- `send_onboarding_form`: always shows the prefill checklist. It hands back the link only when every fact was saved
  or marked not found, or when one of you told Claude to send it anyway (`send_anyway`). Claude never sends anything:
  it gives you the link and the message to text.
- `get_onboarding_status` and `get_client_intake`: where things stand, and the owner's answers.

Links:
- Work for 60 days. **New link** replaces the old one (the old link stops working, even if it was opened).
- **Turn off** stops a link right away. A form can be sent only once. After that the client sees "Thanks, we got
  your answers. Need to change something? Text Nora."
- An expired or turned-off link shows "This link has expired. Ask Nora for a new one."

## What the client sees

- A language switch at the top (English · 简体 · 繁體). It starts from their phone's language: zh-TW/HK/Hant → 繁體,
  any other Chinese → 简体, everything else → English. Their choice is remembered.
- 3 pages with a progress bar ("Step 1 of 3"). There is no separate welcome page: a short greeting ("Hi <business>!",
  about a minute, nothing is posted without your OK, never send passwords) sits on top of page 1.
  1. **Is this right?** One card with what we found: name, address, hours, phone, website, Instagram, TikTok,
     Facebook. Anything we couldn't find is simply left out (with no facts at all there is no card, and the page is
     called "About you"). One tap: **Yes, that's right** or **Something's off**, which opens one text box to say what
     to fix. Below it: their name, mobile and/or email, best way to reach them, and the language to talk in (it
     starts from the language they are reading the form in).
  2. **Accounts & photos** ("Got one more minute?"): only the accounts we couldn't find; step-by-step help for adding
     Nora in Meta Business Suite and Google Business Profile, with **no passwords** (Done / I'll need help); a link
     to their photos, or uploads.
  3. **How we'll work together** ("Got one more minute?"): what to show off, which language to post in, whether
     creators can visit and what they could be offered, what to do with unhappy reviews, anything else.
- Only page 1 has required answers: their name, and a phone number or email. **Send now** on pages 1 and 2 sends what
  is there. Everything else can be skipped.
- Text that looks like a password is refused with a gentle message, so it is never saved.
- Answers save on the phone as they type, so they can close the page and pick up where they left off.
- The form works without JavaScript as one long page.

## Settings (environment variables)

| Variable | Needed? | What it does |
| --- | --- | --- |
| `TOKEN_ENC_KEY` | yes (already used for OAuth) | Encrypts the stored copy of each link, so the team can copy it again later. |
| `APP_URL` | recommended | Base for the links, e.g. `https://hq.example.com`. Without it, the address you are using is used. |
| `INTAKE_ACCESS_EMAIL` | recommended | The email clients add as a helper in Meta Business Suite and Google Business Profile (Nora's). Without it, the form says "Nora's email. We'll send it to you." |
| `BLOB_READ_WRITE_TOKEN` | optional | Turns on "upload photos, videos or your logo" (up to 25 MB each, under `intake/<id>/` in Blob). Without it, clients share a Google Drive, Dropbox or iCloud link instead. |

## Security notes

- Each token is 32 random bytes (base64url). It is looked up by its sha256 hash, and an AES-GCM encrypted copy is stored for "Copy link".
- `/start` is public in `src/middleware.ts` (whole-segment match). The page sends `Referrer-Policy: no-referrer`
  and `noindex`, so the token doesn't leak through links the client taps.
- Spam and abuse checks: a honeypot field, 5 submissions per IP per hour (salted IP hash kept in `answers._meta`),
  length caps on every field, and control and invisible characters stripped. Answers are always shown as plain text, never as HTML.
- Link previews (iMessage, WhatsApp, Slack…) don't count as "opened".
- The form never asks for passwords and says so in two places. TikTok access is set up on the kickoff call.
- Everything the client typed is untrusted. The MCP tool labels it `untrusted_answers` and adds an
  `untrustedSource` note, so Claude treats it as data and never as instructions. A correction ("Something's off") is
  quoted line by line in its ask, marked as the owner's words.
- The "Is this right?" card is built on the server from structured fields only (never from free-text notes), and the
  record of what the owner was shown is rebuilt on the server when they send, not taken from the browser.
- The team preview (`/start-preview/<business id>`) needs a sign-in; it has no link behind it and saves nothing.

## Code map

| Piece | File |
| --- | --- |
| All client-facing text (3 languages, one typed dictionary) | `src/lib/intake-copy.ts` |
| Public facts: keys, labels, checklist, what the owner's card shows | `src/lib/business-facts.ts` (stored in `clients.public_info`, migration `0010`) |
| Saving facts (people and Claude), with sources and the activity log | `src/lib/ops-business.ts` → `setBusinessFacts` |
| Links, validation, submit, correction ask, team helpers | `src/lib/ops-intake.ts` |
| Public page / server action / Blob upload token | `src/app/start/[token]/page.tsx`, `actions.ts`, `upload/route.ts` |
| Team preview of the owner's view (signed in) | `src/app/start-preview/[id]/page.tsx` |
| Form UI | `src/components/intake-form.tsx`, `intake-shell.tsx`, `intake-upload.tsx`, `intake-lang.tsx`, `intake-screens.tsx` |
| Business page card (prefill checklist, preview link) | `src/components/client-intake-card.tsx` (+ `intake-share-panel.tsx`) |
| Settings → Public facts | `src/app/(app)/clients/[id]/settings/facts-card.tsx` (+ `actions.ts`) |
| Team view | `src/app/(app)/clients/[id]/intake/page.tsx` (+ `actions.ts`) |
| Claude | `src/lib/mcp/tools-business.ts` → `set_business_facts`, `send_onboarding_form`, `get_onboarding_status`; `src/lib/mcp/tools-intake.ts` → `get_client_intake` |

To add a question, add it to `TEXT_FIELDS` or `CHOICE_FIELDS` and `INTAKE_STEP_FIELDS` in `intake-copy.ts`, then give
it a label in all three languages. TypeScript reports an error until every language has it. Keep it to 3 pages, keep
required answers on page 1 only, and ask only what the owner alone knows: a public fact belongs in
`src/lib/business-facts.ts`, where Claude looks it up. Questions the earlier form asked live in `LEGACY_FIELDS`
(read-only, English labels).
