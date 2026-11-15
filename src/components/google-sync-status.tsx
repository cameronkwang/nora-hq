import Link from "next/link";
import type { ReactNode } from "react";
import { relativeTime } from "@/lib/dates";
import { googleSyncInfo, type GoogleSyncInfo } from "@/lib/google-status";
import { findConnection } from "@/lib/integrations/connections";
import type { Client } from "@/lib/schema";
import { Status, Tag, buttonClass, clientLabel, cx } from "./ui";

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

/**
 * The status in one paragraph: a dot and the words, when it last synced, what to do, and (optional) the link that
 * fixes it. `prefix` e.g. "Google reviews".
 *  - layout "line" (default): one meta line that wraps.
 *  - layout "stack": for a side column under its own section title: the status, a muted line, then the action as a
 *    button. The prefix is then only read out (the title above already shows it).
 */
export function GoogleSyncLine({
  info, clientId, prefix, action = true, onSettings = false, layout = "line", className,
}: {
  info: GoogleSyncInfo;
  clientId: string;
  prefix?: ReactNode;
  /** Show the "fix it" link. Off where the line already sits next to the control that fixes it. */
  action?: boolean;
  onSettings?: boolean;
  layout?: "line" | "stack";
  className?: string;
}) {
  const fix = action ? googleSyncFixHref(info, clientId, onSettings) : null;
  const when = info.at ? `${info.state === "error" ? "tried" : info.stale ? "last synced" : "synced"} ${relativeTime(info.at)}` : null;

  if (layout === "stack") {
    return (
      <p className={cx("side-status", className)}>
        {prefix && <span className="sr-only">{prefix}: </span>}
        <Status tone={info.tone} className="font-medium">{info.label}</Status>
        {(when || info.hint || info.error) && (
          <span className="note">
            {when && <span>{when}</span>}
            {info.hint && <span>{info.hint}</span>}
            {info.error && <span className="break-words">{info.error}</span>}
          </span>
        )}
        {fix && <Link href={fix.href} className={buttonClass("secondary")}>{fix.label}</Link>}
      </p>
    );
  }

  return (
    <p className={cx("meta flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5", className)}>
      {prefix && <span className="font-medium text-text">{prefix}</span>}
      <Status tone={info.tone} small>{info.label}</Status>
      {when && <span>{when}</span>}
      {info.hint && <span>{info.hint}</span>}
      {info.error && <span className="min-w-0 break-words text-text">{info.error}</span>}
      {fix && (
        <Link href={fix.href} className="link tap-target">
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
 * Account-level status for the Google card in Settings. With a working connection it counts businesses that are
 * really syncing ("2 of 3 businesses syncing") instead of claiming "Connected".
 */
export function GoogleSyncSummaryBadge({ clients, connection }: { clients: SyncClient[]; connection: { status: string } | null | undefined }) {
  if (!connection) return <Tag bare>Not connected</Tag>;
  if (connection.status === "expired") return <Status tone="warn" small>Expired: reconnect</Status>;
  if (connection.status !== "ok") return <Status tone="danger" small>Problem</Status>;
  const n = clients.length;
  const good = clients.filter((c) => !googleSyncInfo(c, true).needsAttention).length;
  if (n === 0) return <Status tone="ok" small>Signed in</Status>;
  if (good === n) return <Status tone="ok" small>{n === 1 ? "Syncing" : `All ${n} businesses syncing`}</Status>;
  return <Status tone="warn" small>{good} of {n} {n === 1 ? "business" : "businesses"} syncing</Status>;
}

/** Every business with its own status line (Settings → Google Business Profile). A plain list on hairlines. */
export function GoogleSyncList({ clients, connected }: { clients: SyncClient[]; connected: boolean }) {
  if (clients.length === 0) return null;
  return (
    <ul className="list is-ruled">
      {clients.map((c) => (
        <li key={c.id} className="flex flex-col gap-0.5 py-2.5">
          <Link href={`/clients/${c.id}`} className="self-start font-medium hover:underline">{clientLabel(c)}</Link>
          <GoogleSyncLine info={googleSyncInfo(c, connected)} clientId={c.id} onSettings />
        </li>
      ))}
    </ul>
  );
}
