# Claude connector (MCP)

Nora HQ doesn't run an AI model itself. Claude does the drafting through a **custom connector**: a remote MCP server at `/api/mcp` that Cameron adds once in Claude. It runs on Cameron's Claude subscription, so there's no Anthropic API key and no per-token bill in the app.

What Claude can do through it:

- read the queue: new asks from Nora, drafts that were sent back, tasks, follow-ups, unreplied Google reviews
- read each business: brand voice, monthly plan and progress, outstanding tasks, creator outreach, monthly views, calendar
- write **drafts** (captions, review replies, creator emails/DMs, recaps), tasks, calendar ideas, creators and outreach (sourced or shortlisted only), and monthly numbers Nora pastes in
- talk with Nora on each ask: ask questions when something is unclear, read her answers, and leave a short note saying what it did

What Claude **cannot** do: approve, reject, mark sent, schedule, publish or send anything. There are no tools for those. Every outbound message or post waits for Cameron or Nora in the app's Review queue. Claude also can't see OAuth tokens or connection settings.

## 1. Set the token

Make a long random secret:

```bash
openssl rand -hex 32
```

Add it as an environment variable named `MCP_TOKEN` wherever the app is deployed (e.g. Vercel → Project → Settings → Environment Variables), then redeploy. For local dev, put it in `.env.local`.

- If `MCP_TOKEN` isn't set, `/api/mcp` answers **503** and the connector stays off.
- A wrong or missing token gets **401**.
- To revoke Claude's access, change or delete `MCP_TOKEN` and redeploy.

Optional: set `APP_URL` (e.g. `https://nora-hq.example.com`) so attachment links Claude sees are always absolute. Without it, the request's host is used.

## 2. Add the connector in Claude

Custom connectors are called **from Anthropic's cloud**, not from your computer. The app must be deployed and reachable on the public internet over HTTPS. `localhost` won't work here. For local testing, see section 5.

1. In Claude (claude.ai or Claude Desktop): **Settings → Connectors → Add custom connector**.
2. **Name:** `Nora HQ`
3. **URL:** `https://<your-host>/api/mcp`
4. Under **Advanced settings → Request headers**, add:
   - Header: `Authorization`
   - Value: `Bearer <your MCP_TOKEN>`
5. Save, then enable **Nora HQ** in a chat from the tools/connectors menu.

On a Team or Enterprise plan, an owner may need to add the connector for the organisation first.

The connector also works in **Cowork** and **Claude Code**. In Claude Code you can also add it directly:

```bash
claude mcp add --transport http nora-hq https://<your-host>/api/mcp \
  --header "Authorization: Bearer <your MCP_TOKEN>"
```

Treat the token like a password: don't paste it into chats, asks or shared docs.

## 3. Day-to-day use (Cowork / claude.ai)

Start a conversation with the Nora HQ connector on and say:

> Check Nora HQ and work through the queue.

Claude calls `get_briefing` first. That returns the working rules, new asks, drafts that were sent back, tasks due, follow-ups, and a summary for each business. Then Claude:

1. revises sent-back drafts using the reviewer's note
2. works through new asks (captions, review replies, creator research and outreach drafts, recording numbers)
3. picks up open tasks and due follow-ups
4. updates every ask it touched with a status and a short note

### Questions and answers on asks

Each ask has a simple conversation. When an ask is unclear, Claude asks with `reply_to_ask` and sets the ask to **In progress**. The ask list shows **Claude asked a question**. Nora opens the ask and types her answer in the box at the bottom.

When a person replies to an **In progress** ask and Claude spoke last, the ask goes back to **New** and shows **Replied**. Claude's next `get_briefing` lists it under new asks with `needsYourReply: true` and the full thread. Replies on new asks just add to the thread. Done or archived asks have to be reopened before anyone can reply.

Then open **Review** in the app to approve, edit or send things back.

Other useful prompts:

- "Draft replies to all unreplied Google reviews for Crab O Clock."
- "Find 10 Richmond food creators for Yummy Red Bowl and shortlist the best 5."
- "Write the October recap for Poke Bros."
- "Generate November's checklist for every business."

## 4. Hourly scheduled task (Claude Code)

To have Claude clear the queue on its own, create a scheduled task in Claude Code (or a Cowork scheduled task) that runs hourly during working hours with the Nora HQ connector enabled. Paste this prompt:

```text
You are working Nora HQ's queue through the "Nora HQ" connector. Nothing you do is sent or posted. Every draft waits for Cameron or Nora to approve it.

1. Call get_briefing. Follow its rules exactly.
2. If there are no new asks, no sent-back drafts, no tasks due for Claude and no follow-ups due, stop and reply "Queue empty."
3. Revise every draft in draftsSentBack with revise_draft, addressing its reviewNote point by point.
4. For each new ask, oldest first:
   - Read the business with get_client_month (brand voice first).
   - Do the work as drafts (create_draft) linked with ask_id, and task_id where a checklist task fits.
   - Read the ask's thread first. If needsYourReply is true, Nora answered your questions there.
   - If the ask is unclear or missing information, don't guess. Call reply_to_ask with your questions and status in_progress.
   - Otherwise call update_ask with status done and a one- or two-line note on what you drafted.
5. Work through tasksForClaude the same way.
6. For each item in followUpsDue without a pendingFollowUpDraft, draft one short follow-up on the same channel.
7. If a business has needsMonthTasks for the current month, call generate_month_tasks.
8. Stop after about 25 drafts in one run. End with a short summary: drafts created, asks updated, questions left for Nora.

Never invent numbers, reviews, creators, handles or emails. Never contact do-not-contact creators. Never ask anyone for Google or Yelp reviews.
```

Suggested schedule: hourly, 8am–8pm on weekdays. Each run is just one Claude conversation, so it uses Cameron's plan limits and costs nothing extra.

## 5. Test locally with MCP Inspector

```bash
# terminal 1
MCP_TOKEN=dev-token npm run dev

# terminal 2
npx @modelcontextprotocol/inspector
```

In the Inspector:

- **Transport:** Streamable HTTP
- **URL:** `http://localhost:3000/api/mcp`
- **Authentication / headers:** `Authorization: Bearer dev-token`

Click **Connect**, then **Tools → List tools** and try `get_briefing` or `list_clients`. Writes run against your local database and show up in the app's Activity log as "claude".

Quick check with curl:

```bash
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## How it works

- `src/app/api/mcp/route.ts` checks the bearer token, then runs a stateless Streamable HTTP MCP server (`@modelcontextprotocol/sdk`) with JSON responses. Each POST gets a fresh server, so it runs fine on serverless. GET and DELETE return 405 because there are no sessions or server-sent streams.
- `src/lib/mcp/tools.ts` defines the tools. Every write goes through `src/lib/ops.ts` with actor `claude`, so validation and the activity log are the same as in the app. The tools add extra guardrails on top:
  - caption limits (2200 chars, 30 hashtags)
  - review replies can't ask anyone to change a rating
  - outreach can't ask for Google or Yelp reviews
  - do-not-contact creators are refused
  - emails only go to a creator's saved address
  - outreach stages above shortlisted are refused
  - deliverable tasks can't be marked done by Claude
  - duplicate drafts are refused
- `src/lib/mcp/rules.ts` holds the working rules. They're sent as the server's instructions and returned by `get_briefing`.
- `src/lib/mcp/queries.ts` holds the read queries. They never return connection tokens.

### Tools

| Tool | What it does |
| --- | --- |
| `get_briefing` | Start here: rules, new asks (with their conversation and `needsYourReply`), sent-back drafts, tasks due, follow-ups, per-business summary |
| `list_clients`, `get_client_month` | Businesses, brand voice, plan progress, tasks, outreach, metrics, posts |
| `list_asks` | Read asks with their conversation thread and `needsYourReply` (a person wrote after Claude) |
| `reply_to_ask` | Add a message to an ask's conversation: questions for Nora or a progress update (optionally set status) |
| `update_ask` | Set status, business, and a short summary note (the note replaces the previous one) |
| `list_tasks`, `create_task`, `update_task`, `generate_month_tasks` | Checklist |
| `list_drafts`, `create_draft`, `revise_draft` | Drafts for approval |
| `list_calendar`, `create_post`, `update_post` | Calendar ideas (no scheduling or publishing) |
| `search_creators`, `upsert_creator`, `upsert_outreach`, `list_followups_due` | Creator pipeline (sourced or shortlisted only) |
| `list_reviews` | Google reviews to reply to |
| `record_metrics`, `get_monthly_report` | Monthly numbers and recap data |
