# Phone notifications & calendar feed

Everything lives in **Settings → Notifications & calendar** (`/settings/notifications`). No new nav item.

## 1. Set up Web Push (once)

1. On your computer: `npx web-push generate-vapid-keys`
2. In Vercel → Project → Settings → Environment Variables add:
   - `VAPID_PUBLIC_KEY` — the public key
   - `VAPID_PRIVATE_KEY` — the private key (secret)
   - `VAPID_SUBJECT` — `mailto:you@example.com` or your https `APP_URL` (Apple rejects localhost)
3. Redeploy. Without these, the app works as before and simply sends nothing.

Changing the keys later invalidates every device: each person has to turn notifications on again.

## 2. Turn it on, per device

- **iPhone/iPad (iOS 16.4+):** Safari → Share → **Add to Home Screen**, open Nora HQ from the icon,
  then Settings → Notifications → **Turn on notifications** and allow. (iOS never offers web notifications
  inside a Safari tab; the page shows these steps instead of the button.)
- **Android / desktop Chrome, Edge, Firefox, Safari:** open the page and tap **Turn on notifications**.
- **Send test** pushes to all of your devices.
- Each device has its own toggles. Removing a device stops pushes to it.

| Topic | Who | When |
|---|---|---|
| `collab_request` | Nora | A business submits the public `/collab` form |
| `ask_for_me` | the person | An ask is created as a request for you, Claude/the other person routes one to you, or the other person posts an idea/FYI/question for "anyone". Never for your own asks, never for asks meant for Claude |
| `drafts_waiting` | both | Claude creates a draft. At most one per person per 2 hours (throttle in `app_settings`, key `notify.throttle.drafts_waiting.<email>`) |
| `payment_overdue` | Nora | Daily: deals with payment **requested** and due date before today |
| `visit_reminder` | Nora | Daily: one push per deal visit tomorrow (NY time), with address |

Tapping a notification opens/focuses Nora HQ at the right page (`public/sw.js`).

## 3. Daily reminders

`runDailyReminders()` (lib/ops-notify.ts) runs as the `dailyReminders` step of `/api/cron/sync`. The sync
runs hourly from GitHub Actions; the reminders go out on the **first run at or after 08:00 America/New_York**
and only once per day (row `notify.daily` in `app_settings`, claimed atomically).

`/api/cron/reminders` runs just this step (same `CRON_SECRET`); `?force=1` sends again today (testing).
If you rely on Vercel Cron only (no GitHub Actions), the daily Vercel sync at 09:17 UTC is before 8am NY and
would skip — add a Vercel cron for `/api/cron/reminders` at e.g. `17 13 * * *`.

## 4. Calendar subscription

Settings → Notifications → **Calendar → Make my calendar link**. The private link is shown once
(only its sha256 hash is stored); making a new one turns the old one off; **Turn off** revokes it.

- Apple Calendar: tap **Add to Apple Calendar** (`webcal://…`) → Subscribe.
- Google Calendar: calendar.google.com → Other calendars **+** → **From URL** → paste the https link.

`GET /api/calendar/<token>.ics` (public route; the token is the credential) returns RFC 5545 `text/calendar`
with `Cache-Control: private, max-age=900`. Unknown or revoked tokens → 404. Window: 30 days back, 120 ahead.

| Event | From | Type |
|---|---|---|
| Visit: business | `deals.visitAt` (not cancelled), 90 min, address + notes + shot list + link | timed (UTC) |
| Post: client (platform) | `content_posts.scheduledFor`, 15 min, ✓ when published | timed (UTC) |
| Due: deliverable for business | `deal_deliverables.dueDate`, ✓ when posted | all-day |
| Task: title | your tasks (`assignee` = your first name) with a due date, not done | all-day |

UIDs are stable (`deal-visit-<id>@nora-hq`, `post-…`, `deliverable-…`, `task-…`), so edits update in place.
Calendar apps refresh on their own schedule (Apple ~hourly, Google every few hours to a day).

## Safety

- Notifications are information only: nothing is sent, approved or paid from a notification.
- Claude has no notification or calendar tools.
- `/api/push/*` need a signed-in session and a same-origin request.
