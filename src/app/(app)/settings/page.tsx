import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { isCreatorClient, listClients } from "@/lib/data";
import { relativeTime } from "@/lib/dates";
import { listConnectionSummaries, type ConnectionSummary } from "@/lib/integrations/connections";
import { envStatus } from "@/lib/integrations/env";
import { appUrl, PROVIDER_LABEL, isOAuthProvider } from "@/lib/integrations/oauth";
import { instagramConfigured } from "@/lib/integrations/instagram";
import { googleOAuthConfigured } from "@/lib/integrations/google-auth";
import { listLocations, type GoogleLocation } from "@/lib/integrations/google";
import { Card, EmptyState, PageHeader, Status, buttonClass, clientLabel, cx } from "@/components/ui";
import { ConfirmButton, SubmitButton } from "@/components/client-form";
import { CopyButton } from "@/components/copy-button";
import { SavedRepliesRow } from "@/components/reply-links";
import { GoogleSyncList, GoogleSyncSummaryBadge } from "@/components/google-sync-status";
import { PaymentLineForm } from "@/components/payment-line-form";
import { getPaymentLine } from "@/lib/ops-payment";
import {
  checkRepliesAction, disconnectAction, refreshInstagramTokensAction, saveLocationsAction, syncInstagramViewsAction, syncReviewsAction,
} from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Flash({ tone, children }: { tone: "ok" | "warn" | "danger"; children: ReactNode }) {
  return (
    <div role="status" className="notice">
      <Status tone={tone}>{children}</Status>
    </div>
  );
}

function ConnStatus({ conn }: { conn: ConnectionSummary | undefined }) {
  if (!conn) return <Status tone="neutral" small>Not connected</Status>;
  if (conn.status === "ok") return <Status tone="ok" small>Connected</Status>;
  if (conn.status === "expired") return <Status tone="warn" small>Expired, reconnect</Status>;
  return <Status tone="danger" small>Problem</Status>;
}

function ConnMeta({ conn, renews }: { conn: ConnectionSummary; renews?: boolean }) {
  return (
    <div className="meta mt-0.5 space-y-0.5">
      <p>
        <span className="font-medium text-text">{conn.label}</span>
        {" · connected "}{relativeTime(conn.createdAt)}
        {conn.expiresAt && (
          <> · {conn.expiresAt.getTime() < Date.now() ? "expired " : "token expires "}{relativeTime(conn.expiresAt)}{renews && conn.expiresAt.getTime() > Date.now() ? " (renews automatically)" : ""}</>
        )}
      </p>
      {conn.lastError && conn.status !== "ok" && <p className="text-danger">{conn.lastError}</p>}
    </div>
  );
}

/** Plain <a> (not next/link) so the OAuth start route is never prefetched. One primary per screen: Connect is secondary. */
function ConnectLink({ href, connected, disabled }: { href: string; connected: boolean; disabled?: boolean }) {
  if (disabled) return <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-45")} aria-disabled>Connect</span>;
  return <a href={href} className={buttonClass("secondary", "sm")}>{connected ? "Reconnect" : "Connect"}</a>;
}

function Disconnect({ id, what }: { id: string; what: string }) {
  return (
    <form action={disconnectAction}>
      <input type="hidden" name="id" value={id} />
      <ConfirmButton confirm={`Disconnect ${what}? Saved tokens will be deleted.`} variant="ghost" size="sm">Disconnect</ConfirmButton>
    </form>
  );
}

/** Setup that is missing: a warning on hairlines (was a soft-coloured box). */
function SetupHint({ children }: { children: ReactNode }) {
  return (
    <p className="notice">
      <Status tone="warn">{children}</Status>
    </p>
  );
}

const CHEV = (
  <svg viewBox="0 0 16 16" aria-hidden className="chev size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A row that opens another settings page: title, one muted line, a chevron. */
function LinkRow({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <Link href={href} className="row">
      <div className="min-w-0 flex-1">
        <p className="row-title">{title}</p>
        <p className="meta whitespace-normal">{note}</p>
      </div>
      {CHEV}
    </Link>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const [clients, connections, paymentLine] = await Promise.all([listClients(), listConnectionSummaries(), getPaymentLine()]);
  const env = envStatus();
  const igReady = instagramConfigured();
  const googleReady = googleOAuthConfigured();
  const base = appUrl();
  const google = connections.find((c) => c.provider === "google" && !c.clientId);
  const gmail = connections.find((c) => c.provider === "gmail" && !c.clientId);
  const igByClient = new Map(connections.filter((c) => c.provider === "instagram" && c.clientId).map((c) => [c.clientId!, c]));
  // Managed businesses only (Nora's own workspace has no Google listing): each gets its own review-sync line.
  const businesses = clients.filter((c) => !isCreatorClient(c));

  let locations: GoogleLocation[] | null = null;
  let locationsError: string | null = null;
  if (google && google.status !== "expired") {
    const r = await listLocations();
    if (r.ok) locations = r.locations;
    else locationsError = r.error;
  }

  const connected = one(sp.connected);
  const connectedClient = clients.find((c) => c.id === one(sp.client));
  const error = one(sp.error);
  const msg = one(sp.msg);
  const tone = (["ok", "warn", "danger"].includes(one(sp.tone)) ? one(sp.tone) : "ok") as "ok" | "warn" | "danger";
  const mcpUrl = `${base ?? "https://<your APP_URL>"}/api/mcp`;
  const mcpSet = env.find((e) => e.name === "MCP_TOKEN")?.set ?? false;
  const cronSet = env.find((e) => e.name === "CRON_SECRET")?.set ?? false;
  const missingRequired = env.filter((e) => e.required && !e.set);

  return (
    <>
      <PageHeader title="Settings" subtitle="Connected accounts, automation and the Claude connector." />

      <div className="mb-10 empty:hidden max-md:mb-8">
        {connected && isOAuthProvider(connected) && (
          <Flash tone="ok">{PROVIDER_LABEL[connected]} connected{connectedClient ? ` for ${clientLabel(connectedClient)}` : ""}.</Flash>
        )}
        {error && <Flash tone="danger">{error}</Flash>}
        {msg && <Flash tone={tone}>{msg}</Flash>}
        {missingRequired.length > 0 && (
          <Flash tone="warn">
            Missing setup: {missingRequired.map((e) => e.name).join(", ")}. See the checklist at the bottom and docs/setup.md.
          </Flash>
        )}
      </div>

      <div className="flex flex-col gap-10 max-md:gap-8">
        {/* Quick capture, notifications, saved replies: each opens its own page */}
        <ul className="list is-ruled">
          <li><LinkRow href="/settings/capture" title="Quick capture" note="Send asks from your iPhone’s Share button or Siri." /></li>
          <li><LinkRow href="/settings/notifications" title="Notifications & calendar" note="Phone alerts and your calendar link" /></li>
          <li><SavedRepliesRow /></li>
        </ul>

        {/* Instagram */}
        <Card
          title="Instagram"
          padded={false}
          actions={igByClient.size > 0 ? (
            <div className="flex flex-wrap gap-2">
              <form action={refreshInstagramTokensAction}><SubmitButton variant="ghost" size="sm" pendingLabel="Renewing…">Renew tokens</SubmitButton></form>
              <form action={syncInstagramViewsAction}><SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">Sync views now</SubmitButton></form>
            </div>
          ) : undefined}
        >
          <p className="sec-note">
            Connect each business&apos;s Instagram (Business or Creator account) to auto-publish scheduled posts, reply to comments and pull monthly views.
          </p>
          {!igReady && <SetupHint>Add IG_APP_ID and IG_APP_SECRET first (docs/setup.md, step 5). Until then, post manually and enter views by hand.</SetupHint>}
          {clients.length === 0 ? (
            <EmptyState title="No businesses yet"><Link href="/clients" className="link">Add a business</Link> to connect its Instagram.</EmptyState>
          ) : (
            <ul className="list">
              {clients.map((c) => {
                const conn = igByClient.get(c.id);
                return (
                  <li key={c.id} className="ps-row">
                    <div className="ps-row-main">
                      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <Link href={`/clients/${c.id}`} className="row-title tap-target min-w-0 hover:underline [overflow-wrap:anywhere]">{clientLabel(c)}</Link>
                        <ConnStatus conn={conn} />
                      </p>
                      {conn ? <ConnMeta conn={conn} renews /> : (
                        <p className="meta mt-0.5">{c.instagramHandle ? `Log in as @${c.instagramHandle} when Instagram asks.` : "Log in with this business's Instagram account when asked."}</p>
                      )}
                    </div>
                    <div className="ps-row-end">
                      {conn && (
                        <form action={syncInstagramViewsAction}>
                          <input type="hidden" name="clientId" value={c.id} />
                          <SubmitButton variant="ghost" size="sm" pendingLabel="Syncing…">Sync views</SubmitButton>
                        </form>
                      )}
                      <ConnectLink href={`/api/oauth/instagram/start?client=${encodeURIComponent(c.id)}`} connected={!!conn} disabled={!igReady} />
                      {conn && <Disconnect id={conn.id} what={`${conn.label} from ${c.name}`} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="meta border-t border-border pt-3">
            Tip: log out of Instagram in this browser (or use a private window) before connecting the next account, otherwise Instagram reuses the last login.
          </p>
        </Card>

        {/* Nora's own accounts; their stats live on /stats */}
        <Card title="Nora’s accounts (@noraeatsgood)">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
            <p className="min-w-0 flex-[1_1_20rem] text-muted">Nora&apos;s own Instagram and TikTok, for follower growth, top posts and the media kit on My stats. Read-only.</p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/oauth/instagram/start?purpose=creator" className={buttonClass("secondary", "sm")}>Connect Instagram</a>
              <a href="/api/oauth/tiktok/start" className={buttonClass("secondary", "sm")}>Connect TikTok</a>
              <Link href="/stats" className={buttonClass("ghost", "sm")}>My stats →</Link>
            </div>
          </div>
          {/* How Nora gets paid: one line, printed on a deal's "Request payment" text. */}
          <div id="payment" className="mt-5 scroll-mt-4 border-t border-border pt-5">
            <PaymentLineForm line={paymentLine} />
          </div>
        </Card>

        <div className="grid gap-10 max-md:gap-8 min-[1200px]:grid-cols-2 min-[1200px]:gap-x-16">
          {/* Google Business Profile */}
          <div id="google" className="min-w-0 scroll-mt-4">
            <Card
              className="!mt-0"
              title="Google Business Profile"
              padded={false}
              actions={google ? (
                <form action={syncReviewsAction}><SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">Sync reviews</SubmitButton></form>
              ) : undefined}
            >
              <p className="sec-note">One Google account that manages all the businesses&apos; profiles. Used to pull reviews and post approved replies.</p>
              {!googleReady && <SetupHint>Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (docs/setup.md, step 6).</SetupHint>}
              <div className="ps-row">
                <div className="ps-row-main">
                  {/* Counts businesses that are really syncing; the account being signed in says nothing about any one of them. */}
                  <GoogleSyncSummaryBadge clients={businesses} connection={google} />
                  {google && <ConnMeta conn={google} />}
                </div>
                <div className="ps-row-end">
                  <ConnectLink href="/api/oauth/google/start" connected={!!google} disabled={!googleReady} />
                  {google && <Disconnect id={google.id} what="Google Business Profile" />}
                </div>
              </div>
              {/* Per business: what the last sync actually found. */}
              <GoogleSyncList clients={businesses} connected={!!google} />
              <p className="meta mt-3">Google keeps API quota at 0 until it approves your access request. If syncing says so, see docs/setup.md.</p>
            </Card>
          </div>

          {/* Gmail */}
          <Card
            title="Gmail outreach inbox"
            padded={false}
            actions={gmail ? (
              <form action={checkRepliesAction}><SubmitButton variant="secondary" size="sm" pendingLabel="Checking…">Check replies</SubmitButton></form>
            ) : undefined}
          >
            <p className="sec-note">Approved lead pitches go out from this mailbox. A creator email goes out from here only when this mailbox is that business&apos;s saved sender (business Settings → Outreach profile). Replies move creators to “Replied”.</p>
            {!googleReady && <SetupHint>Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and enable the Gmail API (docs/setup.md, step 7).</SetupHint>}
            <div className="ps-row">
              <div className="ps-row-main">
                <ConnStatus conn={gmail} />
                {gmail && <ConnMeta conn={gmail} />}
              </div>
              <div className="ps-row-end">
                <ConnectLink href="/api/oauth/gmail/start" connected={!!gmail} disabled={!googleReady} />
                {gmail && <Disconnect id={gmail.id} what="the Gmail outreach inbox" />}
              </div>
            </div>
            <p className="meta border-t border-border pt-3">Every email gets a footer with the sender name and “reply ‘stop’ to opt out”. Replies of “stop” mark the creator do-not-contact automatically.</p>
          </Card>
        </div>

        {/* Location mapping */}
        <div id="google-locations" className="scroll-mt-4">
          <Card className="!mt-0" title="Google locations → businesses">
            {!google ? (
              <EmptyState title="Connect Google Business Profile first">Then pick which Google listing belongs to each business here.</EmptyState>
            ) : (
              <form action={saveLocationsAction} className="flex flex-col gap-5">
                {locationsError && (
                  <p className="notice">
                    <Status tone="danger">Couldn&apos;t load your Google locations: {locationsError} You can still paste each location name (accounts/…/locations/…) by hand.</Status>
                  </p>
                )}
                {locations && locations.length === 0 && (
                  <p className="text-muted">This Google account doesn&apos;t manage any Business Profiles yet. Ask each restaurant to add it as a manager, then reload.</p>
                )}
                <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                  {clients.filter((c) => !isCreatorClient(c)).map((c) => {
                    const id = `loc-${c.id}`;
                    const current = c.googleLocation ?? "";
                    const known = locations?.some((l) => l.name === current);
                    return (
                      <div key={c.id} className="min-w-0">
                        <label className="label" htmlFor={id}>{clientLabel(c)}</label>
                        {locations && locations.length > 0 ? (
                          <select id={id} name={`loc_${c.id}`} defaultValue={current} className="input">
                            <option value="">Not linked</option>
                            {current && !known && <option value={current}>{current} (not found in this account)</option>}
                            {locations.map((l) => (
                              <option key={l.name} value={l.name}>{l.title}{l.address ? ` · ${l.address}` : ""}</option>
                            ))}
                          </select>
                        ) : (
                          <input id={id} name={`loc_${c.id}`} defaultValue={current} placeholder="accounts/123/locations/456" className="input font-mono" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div><SubmitButton variant="secondary" pendingLabel="Saving…">Save locations</SubmitButton></div>
              </form>
            )}
          </Card>
        </div>

        <div className="grid gap-10 max-md:gap-8 min-[1200px]:grid-cols-2 min-[1200px]:gap-x-16">
          {/* Claude connector */}
          <Card title="Claude connector" actions={mcpSet ? <Status tone="ok" small>Token set</Status> : <Status tone="warn" small>MCP_TOKEN missing</Status>}>
            <div className="flex flex-col gap-4">
              <p className="text-muted">Lets Claude (on Cameron&apos;s subscription) read asks and write drafts here. Claude never sends anything: you approve every outbound item.</p>
              <div>
                <p className="label">Connector URL</p>
                <div className="flex min-w-0 items-baseline gap-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">{mcpUrl}</code>
                  <CopyButton text={mcpUrl} size="sm" />
                </div>
                {!base && <p className="mt-1"><Status tone="warn" small className="is-wrap">Set APP_URL so this shows your real address.</Status></p>}
              </div>
              <ol className="ps-steps-list">
                <li><span aria-hidden className="n">1</span><span>In Claude, open Settings → Connectors → Add custom connector.</span></li>
                <li><span aria-hidden className="n">2</span><span>Name it “Nora HQ” and paste the URL above.</span></li>
                <li><span aria-hidden className="n">3</span><span>Add a request header <code className="font-mono text-[0.92em]">Authorization</code> with value <code className="font-mono text-[0.92em]">Bearer &lt;MCP_TOKEN&gt;</code> (the value from Vercel).</span></li>
                <li><span aria-hidden className="n">4</span><span>In a chat, enable the connector and say “check Nora HQ for new asks”.</span></li>
              </ol>
            </div>
          </Card>

          {/* Scheduled jobs */}
          <Card title="Scheduled jobs" padded={false} actions={cronSet ? <Status tone="ok" small>CRON_SECRET set</Status> : <Status tone="warn" small>CRON_SECRET missing</Status>}>
            <ul className="list">
              <li className="row">
                <div className="min-w-0 flex-1">
                  <p className="row-title">Publish</p>
                  <p className="meta whitespace-normal">Every 15 min (GitHub Actions): posts approved, scheduled Instagram posts.</p>
                </div>
              </li>
              <li className="row">
                <div className="min-w-0 flex-1">
                  <p className="row-title">Sync</p>
                  <p className="meta whitespace-normal">Hourly (GitHub Actions) and daily (Vercel Cron): renews Instagram tokens, pulls Google reviews, Instagram views for this month (and last month on the 1st–3rd), and Gmail replies.</p>
                </div>
              </li>
            </ul>
            <p className="meta border-t border-border pt-3">GitHub needs repository secrets APP_URL and CRON_SECRET (docs/setup.md, step 8). Every “Sync” button on this page runs the same jobs on demand.</p>
          </Card>
        </div>

        {/* Environment checklist */}
        <Card title="Environment checklist" padded={false}>
          <p className="sec-note">Shows only whether each variable is set; values are never displayed. Set them in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
          <ul className="list ps-env">
            {env.map((e) => (
              <li key={e.name} className="ps-row">
                <div className="ps-row-main">
                  <p className="flex flex-wrap items-baseline gap-x-3">
                    <code>{e.name}</code>
                    <span className="meta">{e.group}{e.required ? "" : " · optional"}</span>
                  </p>
                  <p className="meta">{e.purpose} · docs/setup.md, {e.doc}</p>
                </div>
                <div className="ps-row-end">
                  {e.set ? <Status tone="ok" small>Set</Status> : e.required ? <Status tone="danger" small>Missing</Status> : <Status tone="neutral" small>Not set</Status>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
