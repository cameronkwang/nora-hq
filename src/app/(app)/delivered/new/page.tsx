import { and, desc, inArray, ne, or, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { allowedUsers, assigneeFor, requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { blobEnabled } from "@/lib/uploads";
import { personKey } from "@/components/ask-route";
import { DeliveryForm } from "@/components/delivery-form";
import { creatorOutreachAskIds } from "@/lib/ops-deliveries";
import { PageHeader, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

/** "Deliver to Nora" (or, from Nora, "Deliver to Cameron"). ?ask=<id> pre-picks the ask it answers. */
export default async function NewDeliveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const me = personKey(assigneeFor(user));
  const to = me === "nora" ? "Cameron" : "Nora";
  const toEmail = allowedUsers().find((u) => u.name.trim().toLowerCase().split(" ")[0] === to.toLowerCase())?.email ?? "";
  const db = await getDb();

  // Asks the delivery can answer: the ones the other person sent (open or recently finished), newest first.
  const [clients, asks] = await Promise.all([
    listClients(),
    db
      .select({ id: schema.asks.id, body: schema.asks.body, clientId: schema.asks.clientId })
      .from(schema.asks)
      .where(and(
        or(eq(schema.asks.createdBy, toEmail), eq(schema.asks.createdBy, to)),
        inArray(schema.asks.status, ["new", "in_progress", "done"]),
        ne(schema.asks.kind, "idea"),
      ))
      .orderBy(desc(schema.asks.updatedAt))
      .limit(40),
  ]);
  const pre = typeof sp.ask === "string" ? sp.ask : undefined;
  // A pre-picked ask that isn't in the recent list (an older one) still shows as the choice.
  let options = asks;
  if (pre && !asks.some((a) => a.id === pre)) {
    const [extra] = await db.select({ id: schema.asks.id, body: schema.asks.body, clientId: schema.asks.clientId }).from(schema.asks).where(eq(schema.asks.id, pre));
    if (extra) options = [extra, ...asks];
  }
  // Creator outreach never goes to Nora's Delivered inbox, so those asks aren't offered.
  if (to === "Nora") {
    const outreach = await creatorOutreachAskIds(options.map((a) => a.id));
    options = options.filter((a) => !outreach.has(a.id));
  }
  const label = (body: string) => {
    const line = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "Ask";
    return line.length > 70 ? `${line.slice(0, 69)}…` : line;
  };
  const preAsk = options.find((a) => a.id === pre);

  return (
    <div className="max-w-2xl">
      <PageHeader title={`Deliver to ${to}`} subtitle={`Finished work lands in ${to}’s Delivered tab${to === "Nora" ? " and on her Home" : ""}, with a notification.`} />
      <DeliveryForm
        to={to}
        clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))}
        asks={options.map((a) => ({ id: a.id, label: label(a.body) }))}
        defaultAskId={preAsk?.id}
        defaultClientId={preAsk?.clientId ?? (typeof sp.client === "string" ? sp.client : undefined)}
        directUpload={blobEnabled()}
      />
    </div>
  );
}
