# Collab with Nora — intake form

A public page where businesses ask to work with Nora, and an inbox where she decides.

| | |
|---|---|
| Public form | `/collab` — no sign-in, no app chrome, not indexed |
| Inbox | `/collabs` (tabs New · Reviewing · Accepted · Declined, plus Spam when there is any) |
| Request page | `/collabs/<id>` |
| Copy | `src/lib/collab-copy.ts` |
| Logic | `src/lib/ops-collab.ts` |
| Claude tools | `src/lib/mcp/tools-collab.ts` — `list_collab_requests`, `get_collab_request` (read-only) |

## What happens when someone sends it

1. The request is saved (`collab_requests`), status **New**.
2. A lead is added or merged (opportunity *Collab*, stage *Qualified*, source “collab form”) with their contact details, handles, website and a one-line summary of what they want and what they're offering.
3. An ask goes to Nora (“Collab request: …”), filed under her workspace, and a task lands on her list. The ask links to `/collabs/<id>`.

Nothing is emailed to the sender. The thank-you screen tells them Nora will reply to their address within a few business days.

## Deciding

On the request page:

- **Accept**: the lead moves to *Talking*, and Nora's task is marked done.
- **Decline**: the lead moves to *Lost*, and her task is marked done. Unsent reply drafts to that lead are withdrawn, so **send the reply first**, then decline.
- **Spam**: the lead moves to *Not a fit* (only if this request created it), the task is removed and the ask is archived.
- **Ask Claude to draft a reply**: you can add an optional note. This routes an ask to Claude, which reads the request with `get_collab_request` and writes a `lead_email` draft as Nora. A paid offer gets next steps (a call or her rates, never a quoted price). A gifted-only request that isn't a fit gets a kind decline. The draft goes to Review like every other outbound message. A New request moves to Reviewing.

Leads only move forward. A request that merged into a lead already at *Proposal* or *Won* leaves that lead alone.

## What the form asks, and why

It's written from Nora's side as a working food creator. Every question exists so she can say yes, or no, from one read, without a back-and-forth.

**1 · About you.** Business name, your name and role, email (required), phone, type of business, Instagram, TikTok, website, city (required), address/neighborhood.
*Why:* who's asking and whether they can make the call (owner versus agency), where the place is (travel and fit with her area), and the handles so she can look at the food and the vibe before replying.

**2 · The collab.** What they're interested in (dine-in feature, launch, event, packaged product, recurring, UGC for their channels, giveaway), the deliverables they're hoping for, compensation (paid, paid + hosted, gifted, affiliate, not sure), a budget range (shown for paid options), timing and any hard deadline, content usage (organic, reposting, paid ads/whitelisting, which is priced separately) and exclusivity.
*Why:* this is the yes/no part. Compensation and budget set expectations early. Usage and exclusivity change the price, so they are raised up front. UGC, meaning content she makes but doesn't post, is its own option because it's a different job.

**3 · Details.** What makes the spot special, dietary/menu notes, the best days and times to visit or film, filming restrictions (busy hours, staff on camera, lighting), links (menu, press kit, Drive), how they heard about her, and anything else.
*Why:* this is what makes a great video. She learns the signature dishes and the story, allergies to plan around, and when the light and the room are right.

**Required acknowledgements:** sponsored and gifted content is always disclosed (#ad / Paid partnership / “gifted”) per FTC guidelines, and reviews are honest, so a collab doesn't guarantee positive coverage. Setting this up front avoids awkward conversations later.

## Editing the words

Everything the visitor sees is in `src/lib/collab-copy.ts`: the intro paragraph, step titles, labels, placeholders, option lists, the acknowledgements and the thank-you text.

- Change any `label`, `hint`, or paragraph freely.
- **Don't change an option's `value`** once requests exist. Values are what's stored, and labels are looked up from them when a request is shown.
- To add an option, add a `{ value, label }` line. Removing one is safe for new submissions, but older requests that used it will show the raw value.
- Field length limits and validation messages are in `CollabInput` in `src/lib/ops-collab.ts`.

## Anti-spam (no third parties)

- **Honeypot:** a hidden `homepage` field. People never see it. If it's filled in, the request is silently “accepted” and nothing is stored.
- **Minimum fill time:** the page stamps an HMAC-signed timestamp (keyed by `AUTH_SECRET`). A submission less than 4 seconds after render, or with a forged stamp, is dropped the same silent way. There's no upper limit, so a tab left open for days still works.
- **Rate limit:** at most 5 requests per hour from the same IP, matched by a salted SHA-256 hash (`COLLAB_IP_SALT`, falling back to `AUTH_SECRET`). The IP itself is never stored.
- **Input hygiene:** every field is length-capped (in the browser and in zod on the server). Control characters, zero-width characters and bidi characters are stripped. Handles are normalised and checked, websites must parse as URLs, and option fields only accept known values. Text is only ever rendered as text, never as HTML. In the Links field, only `http(s)` URLs are linked.

If spam gets through anyway, use **Spam** on the request page.

## Sharing tips

- The inbox's **Share your form** card shows the public link (`<APP_URL>/collab`) with a copy button. Set `APP_URL` in production so the link is right.
- Put it in the Instagram and TikTok link-in-bio, or in a link-in-bio tool as “Work with me”.
- When a business DMs “are you open to collabs?”, reply with the link. You'll get the full picture in one go.
- Add it to the email signature and the media kit.

## Later: an automatic confirmation email

The form doesn't send email, to keep things simple. To add one, use the Gmail connection already in Settings. After `submitCollabRequest` succeeds, queue a short “Got it — I'll reply within a few business days” message through the same send path the review queue uses. Keep it plain text and send at most one per request. Or skip automation and have Claude draft the confirmation as part of the reply.

## Limitations

- No file uploads (press kits go in Links).
- No email to the sender, and no notification beyond Nora's ask and task. The app's live refresh picks it up.
- Declining withdraws unsent reply drafts to that lead (see above).
