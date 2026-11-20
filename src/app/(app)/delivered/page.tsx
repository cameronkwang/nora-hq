import { assigneeFor, requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { listDeliveries } from "@/lib/ops-deliveries";
import { personKey } from "@/components/ask-route";
import { DeliveryRow } from "@/components/nora-home";
import { Button, EmptyState, LinkButton, PageHeader, Status } from "@/components/ui";
import { markAllSeenAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Inbox → Delivered. Nora: finished work for her (a flyer, edited photos, a caption), unopened ones first.
 * Cameron: everything he and Claude delivered, with whether it's been opened, plus "Deliver to Nora".
 */
export default async function DeliveredPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const me = personKey(assigneeFor(user));
  const nora = me === "nora";
  const rows = await listDeliveries(nora ? { recipient: "nora", unseenFirst: true } : {});
  const unseenMine = rows.filter((r) => r.delivery.recipient === me && !r.delivery.seenAt).length;
  const other = nora ? "Cameron" : "Nora";

  return (
    <div>
      <PageHeader
        title="Delivered"
        subtitle={
          nora
            ? "Finished work from Cameron and Claude. Open one to see it and save the files."
            : "Finished work handed to Nora, and whether she’s opened it."
        }
        actions={<LinkButton href="/delivered/new" variant={nora ? "secondary" : "primary"}>Deliver to {other}</LinkButton>}
      />

      {sp.sent === "1" && (
        <p role="status" className="notice mb-4">
          <Status tone="ok" className="whitespace-normal">Delivered. It’s waiting in {other}’s Delivered tab.</Status>
        </p>
      )}

      {rows.length === 0 ? (
        <div className="border-t border-border pt-1">
          <EmptyState title={nora ? "Nothing delivered yet." : "Nothing delivered to Nora yet."}>
            {nora
              ? "When Cameron or Claude finishes something for you, like a new flyer, it lands here and you get a notification."
              : "Finished something she asked for? Deliver it here and it shows up on her Home."}
          </EmptyState>
        </div>
      ) : (
        <ul className="list is-ruled">
          {rows.map(({ delivery: d, client }) => (
            <DeliveryRow key={d.id} d={d} client={client} viewer={me} when={relativeTime(d.createdAt)} />
          ))}
        </ul>
      )}

      {unseenMine > 1 && (
        <form action={markAllSeenAction} className="mt-4">
          <Button type="submit" variant="ghost">Mark all as seen</Button>
        </form>
      )}
    </div>
  );
}
