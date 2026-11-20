import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { allowedUsers, assigneeFor, requireUser } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/dates";
import { markSeen } from "@/lib/ops-deliveries";
import { AskAttachments } from "@/components/ask-attachments";
import { personKey } from "@/components/ask-route";
import { Status, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

function senderName(createdBy: string): string {
  if (createdBy === "claude") return "Claude";
  return allowedUsers().find((u) => u.email === createdBy)?.name.split(" ")[0] ?? "Cameron";
}

/**
 * One delivery: what it is, who sent it, the note, and the files full size (tap to open, then save or share). Opening it
 * as the person it's for marks it seen, which clears the count on the Inbox and Home.
 */
export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const [d] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, id));
  if (!d) notFound();
  const me = personKey(assigneeFor(user));
  const mine = d.recipient === me;
  if (mine && !d.seenAt) await markSeen(d.id, me);

  const [[ask], [client]] = await Promise.all([
    d.askId ? db.select({ id: schema.asks.id, body: schema.asks.body }).from(schema.asks).where(eq(schema.asks.id, d.askId)) : Promise.resolve([]),
    d.clientId ? db.select({ name: schema.clients.name, location: schema.clients.location }).from(schema.clients).where(eq(schema.clients.id, d.clientId)) : Promise.resolve([]),
  ]);
  const to = d.recipient === "nora" ? "Nora" : "Cameron";

  return (
    <div className="max-w-xl">
      <p className="crumb">
        <Link href="/delivered">Delivered</Link>
      </p>
      <h1 className="display mb-2 break-words">{d.title}</h1>
      <p className="meta mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span title={formatDate(d.createdAt, true)}>
          From {senderName(d.createdBy)}
          {!mine && ` to ${to}`} · {relativeTime(d.createdAt)}
        </span>
        {client && <span>{clientLabel(client)}</span>}
        {!mine && (d.seenAt ? <Status tone="ok" small>Opened {relativeTime(d.seenAt)}</Status> : <Status tone="neutral" small>Not opened yet</Status>)}
      </p>

      <div className="flex flex-col gap-5">
        {d.note && (
          <div className="border-t border-border pt-3">
            <p className="whitespace-pre-wrap break-words">{d.note}</p>
          </div>
        )}

        {d.attachments.length > 0 && (
          <div className="border-t border-border pt-3">
            <AskAttachments items={d.attachments} size="lg" />
            <p className="meta mt-3">Tap a file to open it full size, then save or share it from there.</p>
          </div>
        )}

        {ask && (
          <p className="notice meta">
            <span>
              For your ask:{" "}
              <Link href={`/asks/${ask.id}`} className="link">
                {ask.body.split("\n")[0].slice(0, 90)}
              </Link>
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
