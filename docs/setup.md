# Nora HQ setup

Step-by-step for Cameron. Budget about an hour, plus waiting time for Google to approve Business Profile API access, so **start step 6a first**.

When you finish, **Settings** in the app shows a checklist of every variable and the status of each connection.

---

## 1. Vercel project

1. Push this repo to GitHub (private).
2. In Vercel, go to **Add New → Project** and import the repo. Use the default framework preset (Next.js).
   - The build command is `npm run build`. It runs database migrations, then `next build`.
3. Don't deploy yet. Add the database and variables first (steps 2–3).

## 2. Database & storage

1. In the Vercel project, open **Storage → Create Database → Neon (Marketplace)**. Pick the region nearest Virginia (`us-east-1`) and connect it to the project for all environments. This adds `DATABASE_URL`.
2. Still under **Storage**, create a **Blob** store and connect it. This adds `BLOB_READ_WRITE_TOKEN`.
   - Uploads need Blob. So does Instagram auto-publish, because Instagram downloads the media from a public URL.

## 3. Environment variables

Set these under **Vercel → Project → Settings → Environment Variables** (Production, plus Preview if you use it). `.env.example` lists all of them with comments.

| Variable | Value |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `APP_PASSWORD` | A long shared password |
| `APP_USERS` | `Cameron:you@…,Nora:nora@…` |
| `APP_URL` | `https://ops.cameronwang.com` (no trailing slash) |
| `TOKEN_ENC_KEY` | `openssl rand -base64 32` (if you change it later, you'll need to reconnect every account) |
| `MCP_TOKEN` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `APP_TZ` | `America/New_York` |
| `IG_APP_ID`, `IG_APP_SECRET` | From step 5 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From step 6 |
| `OUTREACH_FROM_NAME` | e.g. `Nora` (optional) |
| `OUTREACH_FOOTER` | Optional. See step 7 |
| `INTAKE_ACCESS_EMAIL` | Optional. The email new clients add as a helper on their accounts in the onboarding form (`/start/<token>`). Suggested: `norachen.2019@gmail.com` (Nora's). Without it the form says "we'll text it to you". See [client-onboarding-form.md](client-onboarding-form.md) |

`DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` come from step 2. Now deploy.

## 4. Custom domain: ops.cameronwang.com

1. In Vercel, go to **Project → Settings → Domains → Add** and enter `ops.cameronwang.com`.
2. At your DNS provider, add a **CNAME** record: name `ops`, value `cname.vercel-dns.com` (or the exact target Vercel shows).
3. Wait until Vercel shows "Valid configuration". HTTPS is automatic.
4. Make sure `APP_URL` is `https://ops.cameronwang.com`, then redeploy.

## 5. Instagram (Meta app)

The app uses the **Instagram API with Instagram Login**, so it doesn't need a Facebook Page. Every Instagram account you connect must be a **Business** or **Creator** account. To switch, open the Instagram app and go to **Settings → Account type and tools**.

1. Go to <https://developers.facebook.com/apps> and choose **Create app**. Pick the **Other → Business** type, or the "Manage messaging & content on Instagram" use case.
2. Add the **Instagram** product, then open **API setup with Instagram login**.
3. Copy the **Instagram app ID** and **Instagram app secret** into `IG_APP_ID` and `IG_APP_SECRET`. These are *not* the Facebook app id and secret shown on the Basic settings page.
4. Under **Set up Instagram business login → Business login settings**, add this OAuth redirect URI:
   `https://ops.cameronwang.com/api/oauth/instagram/callback`
5. Leave the app in **Development mode**. You don't need App Review for your own accounts.
6. Under **App roles → Roles → Instagram testers**, add each restaurant's Instagram account (plus Nora's and yours if needed).
7. Accept each tester invite. Log in to that Instagram account on the web, go to **Settings → Apps and websites → Tester invites**, and accept. Do this once per account.
8. In Nora HQ, open **Settings → Instagram** and click **Connect** next to each business. Log in as that business's account.
   - Instagram reuses whatever account is logged in. Before connecting the next business, log out of instagram.com or use a private window.
9. Tokens last 60 days. The sync job renews them automatically when fewer than 15 days remain. If one expires anyway, click **Reconnect**.

Notes:
- Images must be **JPEG**. Reels and videos must be MP4 or MOV, and stories accept either. Carousels take 2–10 items.
- Instagram now reports **views** in place of impressions. The app stores those as the monthly "views" number.

## 6. Google Cloud (Business Profile + Gmail)

### 6a. Request Business Profile API access (do this first)

Google keeps every Business Profile API at **0 requests per minute** until it approves your project. Until then, syncing shows the message "Google hasn't approved Business Profile API access…".

1. Create the Cloud project (6b, step 1) and copy its **project number**.
2. Submit the **GBP API access request** form, linked from <https://developers.google.com/my-business/content/prereqs>. Use a Google account that manages the restaurants' profiles and an email that matches your website domain if you can. Explain that you're an agency managing reviews for 6 restaurants.
3. Approval usually takes a few days. You'll get an email, and the quota in **APIs & Services → Quotas** changes from 0.

### 6b. Project, APIs and OAuth client

1. In <https://console.cloud.google.com>, create a project named `nora-hq`.
2. Under **APIs & Services → Library**, enable:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API** (the v4 API used for reviews; it appears after access is approved)
   - **Gmail API**
3. Configure the **OAuth consent screen** under Google Auth Platform:
   - User type: **External**. App name: Nora HQ. Support email: yours.
   - Authorized domain: `cameronwang.com`.
   - Scopes: `business.manage`, `gmail.send`, `gmail.readonly`, `openid`, `email`.
4. **Publish the app to Production** under **Audience → Publish app**. In Testing mode, Google refresh tokens **expire after 7 days**, and you'd have to reconnect every week.
   - With only a couple of users, you can leave the app unverified. You'll see a "Google hasn't verified this app" screen. Click **Advanced → Go to Nora HQ**. Gmail scopes are "restricted", so Google may limit an unverified app to about 100 users, which is more than enough here.
5. Under **Clients → Create client**, choose type **Web application** and add these redirect URIs:
   - `https://ops.cameronwang.com/api/oauth/google/callback`
   - `https://ops.cameronwang.com/api/oauth/gmail/callback`
   - For local dev, optionally also add `http://localhost:3000/api/oauth/google/callback` and `http://localhost:3000/api/oauth/gmail/callback`
6. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then redeploy.

### 6c. Connect Google Business Profile

1. Make sure the Google account you'll use is an **Owner or Manager** of each restaurant's Business Profile. Each owner can invite it from their Business Profile under **Business Profile settings → People and access**.
2. In Nora HQ, open **Settings → Google Business Profile → Connect**.
3. In **Google locations → businesses**, pick the listing for each business and click **Save locations**.
4. Click **Sync reviews**. Reviews then appear under **Google reviews**, where you can ask Claude to draft replies. Approved replies are posted to Google automatically.

## 7. Gmail outreach inbox

1. Pick the mailbox that creator outreach goes out from. It can be a different Google account from the Business Profile one.
2. Go to **Settings → Gmail outreach inbox → Connect** and log in with that mailbox.
3. Each approved outreach email is sent from this mailbox with a footer. The default footer is:
   ```
   --
   <OUTREACH_FROM_NAME>
   Not interested? Just reply 'stop' and we won't email again.
   ```
   To customize it, set `OUTREACH_FOOTER`. Use `\n` for new lines and `{sender}` for the name. **CAN-SPAM** requires a valid postal address in commercial email, so include one, e.g.
   `--\n{sender} · Social for Yummy Red Bowl & friends\n123 Main St, Richmond VA 23220\nNot interested? Just reply 'stop' and we won't email again.`
4. The sync job checks outreach threads for replies and moves creators to **Replied**. A reply that starts with "stop" marks the creator **do-not-contact** and moves the outreach to **Declined**.

## 8. Scheduled jobs

- **Vercel Cron** (`vercel.json`) runs `/api/cron/sync` once a day. On Hobby that's the most Vercel allows. Vercel sends `CRON_SECRET` automatically.
- **GitHub Actions** (`.github/workflows/cron.yml`) runs the frequent jobs: publishing every 15 minutes and syncing hourly. In GitHub, go to **Repo → Settings → Secrets and variables → Actions → New repository secret** and add:
  - `APP_URL`: `https://ops.cameronwang.com`
  - `CRON_SECRET`: the same value as in Vercel
- To test, open **Actions → Scheduled jobs → Run workflow** and pick `sync`. The log prints a JSON summary of each step.
- If either secret is missing, the workflow skips quietly. GitHub can delay scheduled runs by a few minutes, so posts go out within about 15–20 minutes of their scheduled time.

## 9. Claude connector

1. Make sure `MCP_TOKEN` is set and the app is deployed.
2. In Claude (Cameron's account), go to **Settings → Connectors → Add custom connector**.
   - Name: `Nora HQ`
   - URL: `https://ops.cameronwang.com/api/mcp`
   - Request header: `Authorization` = `Bearer <MCP_TOKEN>`
3. In a chat, enable the connector and ask "check Nora HQ for new asks". Claude writes drafts, and you approve them in **Review queue**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "…sign-in expired or came from another browser" | Start the connection again from Settings, in the same browser, within 10 minutes. |
| Google connection keeps expiring weekly | The OAuth consent screen is still in Testing. Publish it to Production (6b.4), then reconnect. |
| "Google hasn't approved Business Profile API access…" | Wait for the access request from 6a to be approved. |
| Instagram "Insufficient developer role" | The account isn't an accepted Instagram tester (5.6–5.7). |
| Instagram "Only JPEG images" | Convert the image to .jpg and re-upload it. |
| Everything says "can't read saved token" | `TOKEN_ENC_KEY` changed or is missing. Set it, then reconnect each account. |

## Nora's own stats (@noraeatsgood)

**My stats** (`/stats`) tracks Nora's own Instagram and TikTok: follower growth, views, engagement, top posts, Instagram audience and a copy-ready media-kit summary. It works with no setup at all. Use **Log today's numbers** (followers, plus views if you like) until the APIs are connected. Once connected, the hourly sync job saves a snapshot every day. Platforms only expose current totals, so the growth history starts on the day you connect (or the first day you log by hand).

### Connect Nora's Instagram

This uses the same Meta app as the businesses (step 5). It only asks for read access: `instagram_business_basic` and `instagram_business_manage_insights`.

1. @noraeatsgood must be a **Creator** or **Business** account (Instagram app → **Settings → Account type and tools**).
2. In the Meta app, go to **App roles → Roles → Instagram testers** and add `noraeatsgood`. Then accept the invite: log in as @noraeatsgood on instagram.com, go to **Settings → Apps and websites → Tester invites**, and accept. The app can stay in Development mode, so you don't need App Review.
3. In a private window (or after logging out of instagram.com), open **My stats → Connect Instagram** and log in as @noraeatsgood. The redirect URI is the same `…/api/oauth/instagram/callback` you added in step 5.
4. Instagram only reports audience (cities, ages) and daily new follows for accounts with 100+ followers. Audience is refreshed weekly. The token renews automatically with the businesses' tokens.

### Connect Nora's TikTok

1. Go to <https://developers.tiktok.com>, log in, and choose **Manage apps → Connect an app**.
2. Add the **Login Kit** product. Then add the **Display API** scopes: `user.info.basic`, `user.info.profile`, `user.info.stats` and `video.list`.
3. Under **Login Kit → Redirect URI**, add `https://ops.cameronwang.com/api/oauth/tiktok/callback` (that is, `${APP_URL}/api/oauth/tiktok/callback`).
4. Copy the **Client key** and **Client secret** into `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` in Vercel, then redeploy.
5. While the app isn't reviewed, use **Sandbox**. Under **Sandbox → Target users**, add Nora's TikTok account (up to 10 accounts are allowed). Then, signed in as Nora, open **My stats → Connect TikTok** and allow every permission.
   - If she turns any permission off, My stats lists what's missing. Use **Reconnect** to allow it.
   - TikTok hasn't said whether sandbox apps return real follower and view counts. If a sync shows an error or zeros, submit the app for review (Production) with the same scopes.
6. Access tokens last about 24 hours and are renewed automatically before each sync. The refresh token lasts about a year, and after that you'll need to reconnect.

Notes:
- TikTok's API has no audience, reach or daily views. "Views, 28 days" for TikTok is the growth in total views across Nora's latest ~60 videos, measured from the daily snapshots. It becomes accurate after about four weeks of syncing.
- On each post in **Top posts**, pick a business to tag it as a collab. Claude can read all of these numbers through the connector (`get_creator_stats`) when drafting pitches.
