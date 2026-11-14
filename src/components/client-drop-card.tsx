import { formatDate, relativeTime } from "@/lib/dates";
import { INTAKE_LANG_TAG } from "@/lib/intake-copy";
import { getDropLinkStatus, type DropLinkStatus } from "@/lib/ops-drop";
import { DropSharePanel } from "./drop-share-panel";
import { Badge, Card } from "./ui";

/**
 * "Owner drop link" card for a business page (server component):
 *   <ClientDropCard clientId={client.id} clientName={client.name} />
 * A long-lived private link the owner keeps on their phone: they send a photo of a flyer plus "what's the deal,
 * when does it end", and it lands as an ask for Claude to turn into a post + Story. The team copies the link (with a
 * ready-to-text message in English, 简体 and 繁體), makes a new one, or turns it off here. Nothing is ever sent by the app.
 */
export async function ClientDropCard({
  clientId, clientName, inactive = false, className,
}: {
  clientId: string; clientName: string;
  /** The business is Inactive: its link is paused (the owner sees "link expired") until it's Active again. */
  inactive?: boolean;
  className?: string;
}) {
  const status: DropLinkStatus = await getDropLinkStatus(clientId).catch((e) => {
    console.error("[drop] status failed", e);
    return { live: null, hadLink: false };
  });
  const live = status.live;

  return (
    <Card title="Owner drop link" className={className} actions={live ? (inactive ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">On</Badge>) : status.hadLink ? <Badge>Off</Badge> : null}>
      <p className="mb-3 text-sm text-muted">
        A private link the owner keeps on their phone. They snap a flyer or deal and say when it ends; it arrives as an ask and Claude drafts a post + Story for you to approve.
      </p>
      {live && inactive && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">The link is paused while this business is Inactive. It works again when you switch it back to Active.</p>}
      {live ? (
        <p className="mb-3 text-sm">
          Link made {formatDate(live.createdAt)} ·{" "}
          {live.useCount === 0 ? "nothing sent yet" : `${live.useCount} sent${live.lastUsedAt ? `, last ${relativeTime(live.lastUsedAt)}` : ""}`}
          {live.lang && live.useCount > 0 && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-muted">Uses {INTAKE_LANG_TAG[live.lang]}</span>}
        </p>
      ) : (
        status.hadLink && <p className="mb-3 text-sm">The last link was turned off.</p>
      )}
      <DropSharePanel clientId={clientId} clientName={clientName} live={!!live} lang={live?.lang ?? null} />
    </Card>
  );
}
