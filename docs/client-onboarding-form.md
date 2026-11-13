# Client onboarding form (private link, English · 简体 · 繁體)

A friendly form a new restaurant client fills in on their phone in about 10 minutes, so we can onboard them
faster. Each client gets their own private link: `https://<app>/start/<token>`.

## For Nora & Cameron

1. Open the business page → **Onboarding form** card → **Send onboarding form**.
2. Copy the link, or open **Message · English / 简体中文 / 繁體中文** and copy a ready-to-paste text for SMS or WeChat.
3. The card shows where things are: *not sent* → *link made* → *opened* → *answers in*.
4. When answers arrive:
   - Nora gets a push notification ("Asks for me"), if she turned notifications on.
   - Claude gets **one ask**: draft the brand voice (in the languages they post in), a first-month plan per platform,
     review-reply guidelines, and a list of anything missing. Claude reads the answers with `get_client_intake`.
   - Empty business fields are filled in: Instagram, TikTok, website, location (the city from the address) and the
     owner email for monthly reports. **Nothing you already entered is ever overwritten.** A short summary is added
     to the business notes.
   - The "Kickoff call" step in Getting started is **not** ticked automatically. Tick it after the call.
5. **View answers** (`/clients/<id>/intake`) shows every answer by section, with a tag such as "Answered in 简体",
   the access checklist (Meta / Google / TikTok: done or needs help), and a **Copy all** button.

Links:
- Work for 60 days. **New link** replaces the old one (the old link stops working, even if it was opened).
- **Turn off** stops a link right away. A form can be sent only once. After that the client sees "Thanks, we got
  your answers. Need to change something? Text Nora."
- An expired or turned-off link shows "This link has expired. Ask Nora for a new one."

## What the client sees

- A language switch at the top (English · 简体 · 繁體). It starts from their phone's language: zh-TW/HK/Hant → 繁體,
  any other Chinese → 简体, everything else → English. Their choice is remembered.
- 7 steps with a progress bar and Back/Next buttons: Welcome · Your business · Customers & goals · Look & voice ·
  Your accounts (plus step-by-step help for adding Nora in Meta Business Suite and Google Business Profile, with
  **no passwords**) · Reviews & creators · Contact & approvals.
- Only three things are required: the business name, their name, and a phone number or email. Everything else can
  be skipped ("we'll ask on our call").
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
  `untrustedSource` note, so Claude treats it as data and never as instructions.

## Code map

| Piece | File |
| --- | --- |
| All client-facing text (3 languages, one typed dictionary) | `src/lib/intake-copy.ts` |
| Links, validation, submit, team helpers | `src/lib/ops-intake.ts` |
| Public page / server action / Blob upload token | `src/app/start/[token]/page.tsx`, `actions.ts`, `upload/route.ts` |
| Form UI | `src/components/intake-form.tsx`, `intake-upload.tsx`, `intake-lang.tsx`, `intake-screens.tsx` |
| Business page card | `src/components/client-intake-card.tsx` (+ `intake-share-panel.tsx`) |
| Team view | `src/app/(app)/clients/[id]/intake/page.tsx` (+ `actions.ts`) |
| Claude (read-only) | `src/lib/mcp/tools-intake.ts` → `get_client_intake(client_id)` |

To add a question, add it to `TEXT_FIELDS` or `CHOICE_FIELDS` and `INTAKE_STEP_FIELDS` in `intake-copy.ts`, then give
it a label in all three languages. TypeScript reports an error until every language has it.
