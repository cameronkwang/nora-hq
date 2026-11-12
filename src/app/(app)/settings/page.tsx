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
import { Badge, Card, EmptyState, PageHeader, buttonClass, clientLabel, cx } from "@/components/ui";
import { ConfirmButton, SubmitButton } from "@/components/client-form";
import { CopyButton } from "@/components/copy-button";
import { SavedRepliesRow } from "@/components/reply-links";
import {
  checkRepliesAction, disconnectAction, refreshInstagramTokensAction, saveLocationsAction, syncInstagramViewsAction, syncReviewsAction,
} from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Flash({ tone, children }: { tone: "ok" | "warn" | "danger"; children: ReactNode }) {
  const cls = { ok: "border-ok/30 bg-ok-soft text-ok", warn: "border-warn/30 bg-warn-soft text-warn", danger: "border-danger/30 bg-danger-soft text-danger" }[tone];
  return <div role="status" className={cx("mb-6 rounded-lg border px-4 py-3 text-sm", cls)}>{children}</div>;
}

function ConnStatus({ conn }: { conn: ConnectionSummary | undefined }) {
  if (!conn) return <Badge>Not connected</Badge>;
  if (conn.status === "ok") return <Badge tone="ok">Connected</Badge>;
  if (conn.status === "expired") return <Badge tone="warn">Expired — reconnect</Badge>;
  return <Badge tone="danger">Problem</Badge>;
}

function ConnMeta({ conn, renews }: { conn: ConnectionSummary; renews?: boolean }) {
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted">
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

/** Plain <a> (not next/link) so the OAuth start route is never prefetched. */
function ConnectLink({ href, connected, disabled }: { href: string; connected: boolean; disabled?: boolean }) {
  if (disabled) return <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")} aria-disabled>Connect</span>;
  return <a href={href} className={buttonClass(connected ? "secondary" : "primary", "sm")}>{connected ? "Reconnect" : "Connect"}</a>;
}

function Disconnect({ id, what }: { id: string; what: string }) {
  return (
    <form action={disconnectAction}>
      <input type="hidden" name="id" value={id} />
      <ConfirmButton confirm={`Disconnect ${what}? Saved tokens will be deleted.`} variant="ghost" size="sm">Disconnect</ConfirmButton>
    </form>
  );
}

function SetupHint({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">{children}</p>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const [clients, connections] = await Promise.all([listClients(), listConnectionSummaries()]);
  const env = envStatus();
  const igReady = instagramConfigured();
  const googleReady = googleOAuthConfigured();
  const base = appUrl();
  const google = connections.find((c) => c.provider === "google" && !c.clientId);
  const gmail = connections.find((c) => c.provider === "gmail" && !c.clientId);
  const igByClient = new Map(connections.filter((c) => c.provider === "instagram" && c.clientId).map((c) => [c.clientId!, c]));

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

      <div className="flex flex-col gap-6">
        {/* Quick capture (iPhone Shortcut keys) */}
        <Link href="/settings/capture" className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-2">
          <span className="min-w-0">
            <span className="block font-medium">Quick capture</span>
            <span className="block text-sm text-muted">Send asks from your iPhone’s Share button or Siri.</span>
          </span>
          <span aria-hidden className="text-muted">→</span>
        </Link>

        {/* Phone notifications + private calendar link */}
        <Link href="/settings/notifications" className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-2">
          <span className="min-w-0">
            <span className="block font-medium">Notifications &amp; calendar</span>
            <span className="block text-sm text-muted">Phone alerts and your calendar link</span>
          </span>
          <span aria-hidden className="text-muted">→</span>
        </Link>

        {/* Saved replies */}
        <div className="rounded-xl border border-border bg-surface px-3 py-1">
          <SavedRepliesRow />
        </div>

        {/* Instagram */}
        <Card
          title="Instagram"
          actions={igByClient.size > 0 ? (
            <div className="flex flex-wrap gap-2">
              <form action={refreshInstagramTokensAction}><SubmitButton variant="ghost" size="sm" pendingLabel="Renewing…">Renew tokens</SubmitButton></form>
              <form action={syncInstagramViewsAction}><SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">Sync views now</SubmitButton></form>
            </div>
          ) : undefined}
        >
          <p className="mb-3 text-sm text-muted">
            Connect each business&apos;s Instagram (Business or Creator account) to auto-publish scheduled posts, reply to comments and pull monthly views.
          </p>
          {!igReady && <div className="mb-3"><SetupHint>Add IG_APP_ID and IG_APP_SECRET first (docs/setup.md, step 5). Until then, post manually and enter views by hand.</SetupHint></div>}
          {clients.length === 0 ? (
            <EmptyState title="No businesses yet"><Link href="/clients" className="underline">Add a business</Link> to connect its Instagram.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {clients.map((c) => {
                const conn = igByClient.get(c.id);
                return (
                  <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{clientLabel(c)}</Link>
                        <ConnStatus conn={conn} />
                      </div>
                      {conn ? <ConnMeta conn={conn} renews /> : (
                        <p className="mt-1 text-xs text-muted">{c.instagramHandle ? `Log in as @${c.instagramHandle} when Instagram asks.` : "Log in with this business's Instagram account when asked."}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
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
          <p className="mt-3 text-xs text-muted">
            Tip: log out of Instagram in this browser (or use a private window) before connecting the next account, otherwise Instagram reuses the last login.
          </p>
        </Card>

        {/* Nora's own accounts — stats live on /stats */}
        <Card title="Nora's accounts (@noraeatsgood)">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">Nora&apos;s own Instagram and TikTok, for follower growth, top posts and the media kit on My stats. Read-only.</p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <a href="/api/oauth/instagram/start?purpose=creator" className={buttonClass("secondary", "sm")}>Connect Instagram</a>
              <a href="/api/oauth/tiktok/start" className={buttonClass("secondary", "sm")}>Connect TikTok</a>
              <Link href="/stats" className={buttonClass("ghost", "sm")}>My stats →</Link>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Google Business Profile */}
          <Card
            title="Google Business Profile"
            actions={google ? (
              <form action={syncReviewsAction}><SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">Sync reviews</SubmitButton></form>
            ) : undefined}
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">One Google account that manages all the restaurants&apos; profiles. Used to pull reviews and post approved replies.</p>
              {!googleReady && <SetupHint>Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (docs/setup.md, step 6).</SetupHint>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <ConnStatus conn={google} />
                  {google && <ConnMeta conn={google} />}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <ConnectLink href="/api/oauth/google/start" connected={!!google} disabled={!googleReady} />
                  {google && <Disconnect id={google.id} what="Google Business Profile" />}
                </div>
              </div>
              <p className="text-xs text-muted">Google keeps API quota at 0 until it approves your access request — if syncing says so, see docs/setup.md.</p>
            </div>
          </Card>

          {/* Gmail */}
          <Card
            title="Gmail outreach inbox"
            actions={gmail ? (
              <form action={checkRepliesAction}><SubmitButton variant="secondary" size="sm" pendingLabel="Checking…">Check replies</SubmitButton></form>
            ) : undefined}
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">The mailbox creator emails are sent from. Approved outreach emails go out from here, and replies move creators to “Replied”.</p>
              {!googleReady && <SetupHint>Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and enable the Gmail API (docs/setup.md, step 7).</SetupHint>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <ConnStatus conn={gmail} />
                  {gmail && <ConnMeta conn={gmail} />}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <ConnectLink href="/api/oauth/gmail/start" connected={!!gmail} disabled={!googleReady} />
                  {gmail && <Disconnect id={gmail.id} what="the Gmail outreach inbox" />}
                </div>
              </div>
              <p className="text-xs text-muted">Every email gets a footer with the sender name and “reply ‘stop’ to opt out”. Replies of “stop” mark the creator do-not-contact automatically.</p>
            </div>
          </Card>
        </div>

        {/* Location mapping */}
        <Card title="Google locations → businesses">
          {!google ? (
            <EmptyState title="Connect Google Business Profile first">Then pick which Google listing belongs to each business here.</EmptyState>
          ) : (
            <form action={saveLocationsAction} className="flex flex-col gap-4">
              {locationsError && (
                <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                  Couldn&apos;t load your Google locations: {locationsError} You can still paste each location name (accounts/…/locations/…) by hand.
                </p>
              )}
              {locations && locations.length === 0 && (
                <p className="text-sm text-muted">This Google account doesn&apos;t manage any Business Profiles yet. Ask each restaurant to add it as a manager, then reload.</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {clients.filter((c) => !isCreatorClient(c)).map((c) => {
                  const id = `loc-${c.id}`;
                  const current = c.googleLocation ?? "";
                  const known = locations?.some((l) => l.name === current);
                  return (
                    <div key={c.id} className="min-w-0">
                      <label className="label" htmlFor={id}>{clientLabel(c)}</label>
                      {locations && locations.length > 0 ? (
                        <select id={id} name={`loc_${c.id}`} defaultValue={current} className="input">
                          <option value="">— Not linked —</option>
                          {current && !known && <option value={current}>{current} (not found in this account)</option>}
                          {locations.map((l) => (
                            <option key={l.name} value={l.name}>{l.title}{l.address ? ` — ${l.address}` : ""}</option>
                          ))}
                        </select>
                      ) : (
                        <input id={id} name={`loc_${c.id}`} defaultValue={current} placeholder="accounts/123/locations/456" className="input font-mono text-xs" />
                      )}
                    </div>
                  );
                })}
              </div>
              <div><SubmitButton pendingLabel="Saving…">Save locations</SubmitButton></div>
            </form>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Claude connector */}
          <Card title="Claude connector" actions={mcpSet ? <Badge tone="ok">Token set</Badge> : <Badge tone="warn">MCP_TOKEN missing</Badge>}>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted">Lets Claude (on Cameron&apos;s subscription) read asks and write drafts here. Claude never sends anything — you approve every outbound item.</p>
              <div>
                <p className="label">Connector URL</p>
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-xs">{mcpUrl}</code>
                  <CopyButton text={mcpUrl} size="sm" />
                </div>
                {!base && <p className="mt-1 text-xs text-warn">Set APP_URL so this shows your real address.</p>}
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>In Claude, open Settings → Connectors → Add custom connector.</li>
                <li>Name it “Nora HQ” and paste the URL above.</li>
                <li>Add a request header <code className="rounded bg-surface-2 px-1">Authorization</code> with value <code className="rounded bg-surface-2 px-1">Bearer &lt;MCP_TOKEN&gt;</code> (the value from Vercel).</li>
                <li>In a chat, enable the connector and say “check Nora HQ for new asks”.</li>
              </ol>
            </div>
          </Card>

          {/* Scheduled jobs */}
          <Card title="Scheduled jobs" actions={cronSet ? <Badge tone="ok">CRON_SECRET set</Badge> : <Badge tone="warn">CRON_SECRET missing</Badge>}>
            <ul className="flex flex-col gap-2 text-sm">
              <li><span className="font-medium">Publish</span> <span className="text-muted">— every 15 min (GitHub Actions): posts approved, scheduled Instagram posts.</span></li>
              <li><span className="font-medium">Sync</span> <span className="text-muted">— hourly (GitHub Actions) and daily (Vercel Cron): renews Instagram tokens, pulls Google reviews, Instagram views for this month (and last month on the 1st–3rd), and Gmail replies.</span></li>
            </ul>
            <p className="mt-3 text-xs text-muted">GitHub needs repository secrets APP_URL and CRON_SECRET (docs/setup.md, step 8). Every “Sync” button on this page runs the same jobs on demand.</p>
          </Card>
        </div>

        {/* Environment checklist */}
        <Card title="Environment checklist" padded={false}>
          <p className="px-4 pt-4 text-xs text-muted">Shows only whether each variable is set — values are never displayed. Set them in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
          <ul className="divide-y divide-border">
            {env.map((e) => (
              <li key={e.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-medium">{e.name}</code>
                    <span className="text-xs text-muted">{e.group}{e.required ? "" : " · optional"}</span>
                  </p>
                  <p className="text-xs text-muted">{e.purpose} — docs/setup.md, {e.doc}</p>
                </div>
                {e.set ? <Badge tone="ok">Set</Badge> : e.required ? <Badge tone="danger">Missing</Badge> : <Badge>Not set</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
