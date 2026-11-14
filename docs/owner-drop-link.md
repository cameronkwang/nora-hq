# Owner drop link (private link, English · 简体 · 繁體)

A private page a business owner keeps on their phone: `https://<app>/drop/<token>`. When they have a new deal or
flyer they open it, add a photo, answer one question ("What's the deal? When does it end?") and tap **Send to Nora**.
A photo or a few words is enough. The link doesn't expire; it works until someone turns it off.

## For Nora & Cameron

1. Open the business page → **Owner drop link** card → **Make drop link**.
2. Copy the link, or open **Message · English / 简体中文 / 繁體中文** and copy a ready-to-paste text for SMS or WeChat.
   You send it; the app never does. (Claude can fetch the same link and messages with `get_drop_link` when you ask.)
3. When the owner sends something:
   - Nora gets a push notification ("Asks for me"), if she turned notifications on.
   - Claude gets **one ask**, "Turn this flyer into a post + Story — <business>", with the photo attached. It drafts an
     Instagram post and a Story for you to approve in Review, as usual. Nothing is posted without your approval.
   - The ask page says it came "From the owner (drop link)".
4. **New link** makes a fresh link and the old one stops working (use it if the link got shared around).
   **Turn off** stops it. A business switched to Inactive has its link paused until it is Active again.

The card shows how many things the owner has sent and when the last one arrived.

## What the owner sees

- One short screen, made for a phone, in English, 简体 or 繁體. It opens in the language they last used here (or
  answered their onboarding form in); the switch at the top changes it.
- "Photo of the flyer or deal" (camera or photo library; a PDF works too; up to 4 files, 25 MB each).
- "What's the deal? When does it end?"
- After sending: a thank-you, and **Send another**.
- If the link was turned off: "This link has expired — just ask Nora for a new one."

## Safety

- The token is 32 random bytes. Only its SHA-256 hash is stored for lookup; an encrypted copy lets the team copy the
  link again. The page is `noindex` and sends no referrer. A token that was never a link answers 404 (page and
  upload route); a link that was turned off shows the "expired" message and can't send or upload.
- Everything the owner types is untrusted text: control characters are stripped, it is capped at 1,000 characters,
  and in the ask it is quoted line by line as data. Claude is told it describes the deal and is never an instruction.
- A typed password ("our Instagram password: …") is refused with a gentle message, so a login never reaches the
  database. Promo codes on a flyer are fine.
- Uploads go straight from the phone to our own Blob store under `drop/<link id>/<day>/`. Only files in that folder
  of our store are attached to the ask; any other URL posted to the page is dropped.
- Limits per link: 6 drops an hour, 20 a day, and 30 uploaded files a day. Each limit is a counter on the link that
  is checked and bumped in one database statement, so sending many requests at the same moment can't get past it.
  An upload token is good for one file and for 15 minutes. A leaked link can't flood the asks list or fill the
  store, and **New link** shuts it out for good.

## Setup

| Setting | Needed | What it does |
| --- | --- | --- |
| `TOKEN_ENC_KEY` | yes (already used for OAuth and onboarding links) | Encrypts the stored copy of each link. |
| `APP_URL` | recommended | Base for the links, e.g. `https://hq.example.com`. |
| `BLOB_READ_WRITE_TOKEN` | for photos | Turns on the photo picker. Without it the owner can only send a note. |

## Code

- `src/lib/ops-drop.ts`: links, the public submit, rate limits. `src/lib/drop-copy.ts`: every word the owner sees.
- `src/app/drop/[token]/`: the page, its server action and the upload route (public; listed in `src/middleware.ts`).
- `src/components/client-drop-card.tsx` + `drop-share-panel.tsx`: the business page card.
- `src/lib/mcp/tools-drop.ts`: `get_drop_link`.
