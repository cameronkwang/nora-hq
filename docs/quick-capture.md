# Quick capture

Three ways to hand something to Claude or Cameron/Nora in one tap:

1. **Home composer** — the box at the very top of Home. Type a line, optionally pick a chip
   (Claude decides · Claude · *other person* · Ad hoc task · Idea), optionally add a photo, Send.
   It confirms inline ("Sent ✓") and stays on Home. **Ad hoc task** skips the ask and puts a task
   straight on the other person's list (no deliverable). Desktop: Enter sends, Shift+Enter is a new line.
2. **iPhone Shortcut** — Share sheet or "Hey Siri, Nora Ask". Set up below.
3. **App icon** — `/asks/new` added to the Home Screen.

Why a Shortcut? iOS Safari doesn't support the Web Share Target API (WebKit bug 194593), so a web
app can't appear in the iPhone Share sheet. A Shortcut can, and it can post to our API.

## 1. Make a key

Settings → **Quick capture** (`/settings/capture`) → *Make a key* (default name "<Name>'s iPhone").
The key (`nhq_…`) is shown **once** — copy it. Each key sends asks as the person who made it.
Turn a key off on the same page if a phone is lost; people removed from `APP_USERS` stop working automatically.

## 2. Install the iPhone Shortcut

In the **Shortcuts** app:

1. **+** → name it **Nora Ask** (also the Siri phrase).
2. ⓘ / Details → turn on **Show in Share Sheet**. In the first action set
   **Receive Text, URLs, Images and Safari web pages from Share Sheet**, and
   **If there's no input: Continue**.
3. **If** *Shortcut Input* **does not have any value**
   - **Dictate Text** (Stop listening: After Pause) → **Set Variable** `Note` to *Dictated Text*
   - **Otherwise** → **Set Variable** `Note` to *Shortcut Input*
   - **End If**
4. **Choose from Menu** "Who's it for?" with items **Claude decides**, **Cameron** (Nora on Cameron's phone),
   **Ad hoc task**, **Idea**. Under each, a **Text** action: `auto`, `cameron` (or `nora`), `adhoc`, `idea`.
   After **End Menu**: **Set Variable** `Route` to *Menu Result*. (Optional extra item **Claude** → `claude`.)
5. **Get Type of** `Note` → **If** *Type* **is** *Image*:
   - **Resize Image** `Note` to width **1600** (height Auto) → **Convert** to **JPEG**
   - **Get Contents of URL** `https://<your app>/api/asks/capture` — Show More:
     Method **POST**, Header `Authorization` = `Bearer nhq_…`, Request Body **Form**:
     `route` (Text) = `Route`, `file` (File) = *Converted Image*, optional `text` (Text).
6. **Otherwise**:
   - **Get URLs from** `Note`
   - **Get Contents of URL** same address, **POST**, same header, Request Body **JSON**:
     `text` (Text) = `Note`, `url` (Text) = *URLs*, `route` (Text) = `Route`.
   - **End If**
7. **Get Dictionary Value** `message` from *If Result* → **Show Notification** *Dictionary Value*.

Try it: Safari → Share → **Nora Ask**, or "Hey Siri, Nora Ask".

## 3. Add to Home Screen

Open `https://<your app>/asks/new` in Safari (signed in) → Share → **Add to Home Screen** → "Nora Ask".
Android/Chrome: ⋮ → Add to Home screen.

## API reference

`POST /api/asks/capture` — authenticates itself (middleware lets it through without a session).

- Header: `Authorization: Bearer nhq_…`
- JSON: `{ "text": "...", "url": "...", "route": "auto", "client": "Poke Bros" }`
- or `multipart/form-data` with fields `text`, `url`, `route`, `client` and one or more `file`
  parts (images/videos, **≤ 4MB each**; larger → 413 with a readable message).
- `route`: `auto` (Claude decides, default) · `claude` · `cameron` · `nora` · `idea` · `fyi` · `adhoc`.
  Menu labels also work ("Claude decides", "Ad hoc task", "Just an idea").
- `client`: a business id or name ("Yummy Red Bowl Richmond", "poke bros"). Fuzzy-matched; if nothing
  matches (or it's ambiguous) the name is kept in the ask text for Claude to sort.
- Text and url are combined into the ask body (url on its own line unless already in the text).

Response (always JSON): `{ "ok": true, "id": "ask_…", "kind": "ask" | "task", "message": "Sent to Claude ✓" }`.
Errors: `401` bad/revoked key, `400` unreadable body/unknown route, `413` file too big, `429` more than
30 sends a minute (per person), `500` otherwise — each with a short `message`.

Note: Vercel caps a request at ~4.5MB in total, so very large multipart requests may be rejected by
Vercel itself before reaching the app. Keep the Resize step.

```sh
curl -X POST https://<your app>/api/asks/capture \
  -H "Authorization: Bearer $NHQ_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Poke Bros wants a holiday promo","route":"auto"}'
```

Code: `src/lib/ops-capture.ts` (tokens, `captureAsk`), `src/app/api/asks/capture/route.ts`,
`src/components/quick-ask.tsx` (Home composer), `src/app/(app)/settings/capture/`.
