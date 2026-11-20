import Link from "next/link";
import type { ReactNode } from "react";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { relativeTime } from "@/lib/dates";
import { askThreadState, listAskMessagesFor } from "@/lib/ops";
import { reelsToPost, scheduleOn } from "@/lib/ops-schedule";
import { dealsOwed } from "@/lib/ops-deals";
import { CHECKLIST_TOTAL, checklistDone } from "@/lib/shoot-checklist";
import type { Delivery } from "@/lib/schema";
import { listDeliveries } from "@/lib/ops-deliveries";
import { Card, Count, EmptyState, Status, Tag, clientLabel } from "./ui";

/**
 * Nora's Home: her day, not the agency view. Anything newly delivered to her (a flyer, edited photos) on top, what she's shooting today and tomorrow (each job opens its
 * shoot checklist), the reels she still owes, whether collabs are paid (never amounts here), and the asks
 * she sent with whether Cameron or Claude answered. Cameron's Home is unchanged.
 */

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const ASK_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" }> = {
  new: { label: "Sent", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "ok" },
};

export function Chevron({ className = "chev" }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * One thing on Home (an ask, a draft, a shoot, a reel): title, one more fact, where, when. One line wide, two lines
 * narrow, the whole row is the link. `clamp` is for a title that is free text (an ask's first line): one line with an
 * ellipsis wide, two lines narrow. Shared by Cameron's Home and Nora's.
 */
export function HomeRow({ href, title, note, where, when, clamp }: { href: string; title: ReactNode; note?: ReactNode; where?: ReactNode; when?: ReactNode; clamp?: boolean }) {
  return (
    <li>
      <Link href={href} className="row approve-row">
        <span className={clamp ? "approve-main is-clamp" : "approve-main"}>
          <span className="row-title" title={clamp && typeof title === "string" ? title : undefined}>{title}</span>
          {note && <span className="approve-note max-lg:hidden">{note}</span>}
        </span>
        <span className="row-meta">
          {note && <span className="lg:hidden">{note}</span>}
          {where && <span className="meta where">{where}</span>}
          {when && <span className="meta when">{when}</span>}
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

/**
 * One delivery in a list (the Delivered tab, Nora's Home, an ask). For the person it's for: "New" until they open it.
 * For the sender: "Opened" or "Not opened yet".
 */
export function DeliveryRow({
  d,
  client,
  viewer,
  when,
}: {
  d: Delivery;
  client?: { name: string; location: string | null } | null;
  viewer: "nora" | "cameron" | null;
  when?: string;
}) {
  const mine = d.recipient === viewer;
  const n = d.attachments.length;
  const note = mine
    ? !d.seenAt && <Status tone="info" small>New</Status>
    : d.seenAt
      ? <Status tone="ok" small>Opened</Status>
      : <Status tone="neutral" small>Not opened yet</Status>;
  const files = n ? `${n} file${n === 1 ? "" : "s"}` : "Note";
  return (
    <HomeRow
      href={`/delivered/${d.id}`}
      title={d.title}
      clamp
      note={note || undefined}
      where={client ? `${clientLabel(client)} · ${files}` : files}
      when={when}
    />
  );
}

export async function NoraHome({ email, name, now, skipAskIds = [] }: { email: string; name: string; now: string; skipAskIds?: string[] }) {
  const db = await getDb();
  const tomorrow = addDays(now, 1);
  const [delivered, todayJobs, tomorrowJobs, owedReels, owed, myAsks] = await Promise.all([
    listDeliveries({ recipient: "nora", unseenFirst: true, limit: 20 }),
    scheduleOn(now),
    scheduleOn(tomorrow),
    reelsToPost(now),
    dealsOwed(now),
    db
      .select()
      .from(schema.asks)
      .where(and(or(eq(schema.asks.createdBy, email), eq(schema.asks.createdBy, name)), ne(schema.asks.status, "archived"), ne(schema.asks.kind, "idea")))
      .orderBy(desc(schema.asks.updatedAt))
      .limit(6),
  ]);
  // Asks already under "For you" (Claude asked her something) aren't listed twice.
  const skip = new Set(skipAskIds);
  const mine = myAsks.filter((a) => !skip.has(a.id));
  const threads = await listAskMessagesFor(mine.map((a) => a.id));
  // Delivered: shown only while something is unopened, so Home stays calm once she's picked everything up.
  const newDeliveries = delivered.filter((r) => !r.delivery.seenAt);

  return (
    <>
      {newDeliveries.length > 0 && (
        <Card
          title={<>Delivered to you<Count n={newDeliveries.length} label={`${newDeliveries.length} new`} /></>}
          actions={<Link href="/delivered" className="link-quiet">All →</Link>}
          padded={false}
        >
          <ul className="list">
            {newDeliveries.slice(0, 5).map(({ delivery: d, client }) => (
              <DeliveryRow key={d.id} d={d} client={client} viewer="nora" when={relativeTime(d.createdAt)} />
            ))}
          </ul>
        </Card>
      )}

      <Card title="Shoots" actions={<Link href="/calendar" className="link-quiet">Schedule →</Link>} padded={false}>
        {todayJobs.length + tomorrowJobs.length === 0 ? (
          <EmptyState title="Nothing booked today or tomorrow.">
            <Link href="/calendar" className="link">See the whole schedule</Link>
          </EmptyState>
        ) : (
          <ul className="list">
            {[...todayJobs.map((j) => ({ j, when: "Today" })), ...tomorrowJobs.map((j) => ({ j, when: "Tomorrow" }))].map(({ j, when }) => (
              <HomeRow
                key={j.id}
                href={`/calendar/jobs/${j.id}`}
                title={
                  <>
                    {j.businessName}
                    {j.isFree && <Tag>Free</Tag>}
                  </>
                }
                where={<span className="num">Shoot list {checklistDone(j.checklist)}/{CHECKLIST_TOTAL}</span>}
                when={when === "Today" ? <span className="font-medium text-text">Today</span> : when}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={<>Reels to post{owedReels.length > 0 && <Count n={owedReels.length} />}</>}
        actions={owedReels.length > 0 ? <Link href="/calendar?show=reels" className="link-quiet">All →</Link> : undefined}
        padded={false}
      >
        {owedReels.length === 0 ? (
          <p className="sec-note">All caught up. No reels owed.</p>
        ) : (
          <ul className="list">
            {owedReels.slice(0, 5).map((r) => (
              <HomeRow
                key={r.id}
                href={`/calendar/jobs/${r.id}`}
                title={
                  <>
                    <span className="emoji" aria-hidden>📸</span> {r.businessName}
                  </>
                }
                where={r.date ? `shot ${dayName(r.date)}` : "no set day"}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Paid or not, never an amount: one row between hairlines that opens the deals. */}
      {owed.count > 0 && (
        <Link href="/deals" className="notice mt-10 items-center hover:underline max-md:mt-8">
          <Status tone={owed.overdueCount > 0 ? "danger" : "warn"} className="font-medium">
            <span>
              {owed.count} collab{owed.count === 1 ? "" : "s"} not paid yet
              {owed.overdueCount > 0 && <span className="font-normal text-muted"> · {owed.overdueCount} overdue</span>}
            </span>
          </Status>
          <Chevron />
        </Link>
      )}

      <Card title="Your asks" actions={<Link href="/asks/new" className="link-quiet">New ask →</Link>} padded={false}>
        {mine.length === 0 ? (
          <p className="sec-note">Anything you send with the + button shows up here, with whether Cameron or Claude has answered.</p>
        ) : (
          <ul className="list">
            {mine.map((a) => {
              const thread = threads.get(a.id) ?? [];
              const state = askThreadState(a, thread.at(-1));
              const s = ASK_STATUS[a.status] ?? ASK_STATUS.new;
              return (
                <HomeRow
                  key={a.id}
                  href={`/asks/${a.id}`}
                  title={a.body.split("\n")[0]}
                  clamp
                  note={state === "claude_asked" ? <Status tone="warn" small>Claude asked you something</Status> : <Status tone={s.tone} small>{s.label}</Status>}
                  when={relativeTime(a.updatedAt)}
                />
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
