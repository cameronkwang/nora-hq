import Link from "next/link";
import type { ReactNode } from "react";
import { relativeTime } from "@/lib/dates";
import { googleSyncInfo, type GoogleSyncInfo } from "@/lib/google-status";
import { findConnection } from "@/lib/integrations/connections";
import type { Client } from "@/lib/schema";
import { Badge, clientLabel, cx } from "./ui";

/**
 * Per-business Google review sync status: what the last sync actually found for THIS business
 * ("124 reviews · synced 2h ago", "0 reviews · check it's the right listing", "Sync failed", "Not linked").
 * Replaces the single account-wide "Connected" badge, which said nothing about any one business.
 * Server-component safe (no hooks).
 */

/** Where to fix each state. `onSettings`: already on Settings' Google card, so links that only lead there are left out. */
export function googleSyncFixHref(info: GoogleSyncInfo, clientId: string, onSettings = false): { href: string; label: string } | null {
  const card = (label: string) => (onSettings ? null : { href: "/settings#google", label });
  switch (info.state) {
    case "unlinked": return { href: "/settings#google-locations", label: "Link it" };
    case "empty": return { href: "/settings#google-locations", label: "Change listing" };
    case "disconnected": return card("Connect Google");
    case "error":
    case "never": return card("Open Settings");
    default: return info.stale ? card("Open Settings") : { href: `/reviews?client=${encodeURIComponent(clientId)}`, label: "See reviews" };
  }
}

/** One line: [badge] when · hint · (optional) action link. `prefix` e.g. "Google reviews". */
export function GoogleSyncLine({
  info, clientId, prefix, action = true, onSettings = false, className,
}: {
  info: GoogleSyncInfo;
  clientId: string;
  prefix?: ReactNode;
  /** Show the "fix it" link. Off where the line already sits next to the control that fixes it. */
  action?: boolean;
  onSettings?: boolean;
  className?: string;
}) {
  const fix = action ? googleSyncFixHref(info, clientId, onSettings) : null;
  const when = info.at ? `${info.state === "error" ? "tried" : info.stale ? "last synced" : "synced"} ${relativeTime(info.at)}` : null;
  return (
    <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted", className)}>
      {prefix && <span className="font-medium text-text">{prefix}</span>}
      <Badge tone={info.tone}>{info.label}</Badge>
      {when && <span>{when}</span>}
      {info.hint && <span className={info.tone === "warn" ? "text-warn" : undefined}>{info.hint}</span>}
      {info.error && <span className="min-w-0 break-words text-danger">{info.error}</span>}
      {fix && (
        <Link href={fix.href} className="inline-flex items-center font-medium text-accent hover:underline pointer-coarse:min-h-11">
          {fix.label}
        </Link>
      )}
    </p>
  );
}

type SyncClient = Pick<Client, "id" | "name" | "location" | "googleLocation" | "googleSyncAt" | "googleSyncStatus" | "googleSyncCount" | "googleSyncError">;

/**
 * Self-contained line for one business (looks up whether Google is connected itself):
 *   <ClientGoogleSync client={client} prefix="Google reviews" />
 * Renders nothing for Nora's own workspace, which has no Google listing.
 */
export async function ClientGoogleSync({ client, ...rest }: { client: SyncClient & Pick<Client, "kind"> } & Omit<Parameters<typeof GoogleSyncLine>[0], "info" | "clientId">) {
  if (client.kind === "creator") return null;
  const connected = await findConnection("google", null).then((c) => !!c, () => false);
  return <GoogleSyncLine info={googleSyncInfo(client, connected)} clientId={client.id} {...rest} />;
}

/**
 * Account-level badge for the Google card in Settings. With a working connection it counts businesses that are
 * really syncing ("2 of 3 businesses syncing") instead of claiming "Connected".
 */
export function GoogleSyncSummaryBadge({ clients, connection }: { clients: SyncClient[]; connection: { status: string } | null | undefined }) {
  if (!connection) return <Badge>Not connected</Badge>;
  if (connection.status === "expired") return <Badge tone="warn">Expired — reconnect</Badge>;
  if (connection.status !== "ok") return <Badge tone="danger">Problem</Badge>;
  const n = clients.length;
  const good = clients.filter((c) => !googleSyncInfo(c, true).needsAttention).length;
  if (n === 0) return <Badge tone="ok">Signed in</Badge>;
  if (good === n) return <Badge tone="ok">{n === 1 ? "Syncing" : `All ${n} businesses syncing`}</Badge>;
  return <Badge tone="warn">{good} of {n} {n === 1 ? "business" : "businesses"} syncing</Badge>;
}

/** Every business with its own status line (Settings → Google Business Profile). */
export function GoogleSyncList({ clients, connected }: { clients: SyncClient[]; connected: boolean }) {
  if (clients.length === 0) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {clients.map((c) => (
        <li key={c.id} className="flex flex-col gap-1 px-3 py-2.5">
          <Link href={`/clients/${c.id}`} className="self-start text-sm font-medium hover:underline">{clientLabel(c)}</Link>
          <GoogleSyncLine info={googleSyncInfo(c, connected)} clientId={c.id} onSettings />
        </li>
      ))}
    </ul>
  );
}
