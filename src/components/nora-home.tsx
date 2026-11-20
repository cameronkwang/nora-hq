import Link from "next/link";
import type { ReactNode } from "react";
import { relativeTime } from "@/lib/dates";
import { CHECKLIST_TOTAL, checklistDone } from "@/lib/shoot-checklist";
import type { Delivery, Task } from "@/lib/schema";
import { listDeliveries } from "@/lib/ops-deliveries";
import { ensureFollowUps, loadNoraList, type ListShoot } from "@/lib/nora-list";
import { addReminder } from "@/app/(app)/tasks/actions";
import { TaskList, TaskRow } from "./task-row";
import { SwipeToDone } from "./swipe-done";
import { Card, Count, Status, Tag, buttonClass, clientLabel } from "./ui";

/**
 * Nora's Home is her list: her own tasks and reminders, grouped Today (overdue included), This week (through Sunday)
 * and No due date, with the shoots on her schedule in the same days. She ticks a task off or swipes it away on her
 * phone. Team-side volume (drafts to review, reels owed, creator outreach, payments) isn't here. An ask she sent
 * Cameron that's still open after a few days shows up as a reminder to follow up with him (lib/nora-list).
 * Anything newly delivered to her sits in a small card under the list. Cameron's Home is unchanged.
 */

const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

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

/** An ask waiting on Nora (Claude asked her something, or it was sent to her and isn't a task yet). */
export type NoraAsk = { id: string; title: string; at: Date; claudeAsked: boolean };

function ShootRow({ s, when }: { s: ListShoot; when: ReactNode }) {
  return (
    <HomeRow
      href={`/calendar/jobs/${s.id}`}
      title={
        <>
          <span className="emoji" aria-hidden>📸</span> Shoot at {s.businessName}
          {s.isFree && <Tag>Free</Tag>}
        </>
      }
      where={<span className="num">Shoot list {checklistDone(s.checklist)}/{CHECKLIST_TOTAL}</span>}
      when={when}
    />
  );
}

function Tasks({ tasks, names }: { tasks: Task[]; names: Map<string, string> }) {
  return (
    <TaskList>
      {tasks.map((t) => (
        <SwipeToDone key={t.id} id={t.id} title={t.title}>
          <TaskRow task={t} clientName={t.clientId ? names.get(t.clientId) : null} showAssignee={false} />
        </SwipeToDone>
      ))}
    </TaskList>
  );
}

/** "Add a reminder": a line of text and when it's due. Lands on her list. */
function AddReminder() {
  return (
    <form action={addReminder} className="mb-6 flex flex-wrap items-center gap-2">
      <label htmlFor="reminder-title" className="sr-only">Add a reminder</label>
      <input id="reminder-title" name="title" required maxLength={200} placeholder="Add a reminder" className="input min-w-0 flex-1 basis-56" autoComplete="off" />
      <label htmlFor="reminder-when" className="sr-only">When</label>
      <select id="reminder-when" name="when" defaultValue="today" className="input w-auto">
        <option value="today">Today</option>
        <option value="week">This week</option>
        <option value="none">No date</option>
      </select>
      <button type="submit" className={buttonClass("secondary")}>Add</button>
    </form>
  );
}

export async function NoraHome({ email, name, now, asks = [], names }: { email: string; name: string; now: string; asks?: NoraAsk[]; names: Map<string, string> }) {
  await ensureFollowUps(email, name, now);
  const [list, delivered] = await Promise.all([
    loadNoraList(now),
    listDeliveries({ recipient: "nora", unseenFirst: true, limit: 20 }),
  ]);
  // Delivered: shown only while something is unopened, so Home stays calm once she's picked everything up.
  const newDeliveries = delivered.filter((r) => !r.delivery.seenAt);
  const todayCount = asks.length + list.shootsToday.length + list.today.length;
  const weekCount = list.shootsWeek.length + list.week.length;

  return (
    <>
      <AddReminder />

      <Card title={<>Today{todayCount > 0 && <Count n={todayCount} />}</>} padded={false}>
        {todayCount === 0 ? (
          <p className="sec-note">Nothing due today.</p>
        ) : (
          <>
            {asks.length > 0 && (
              <ul className="list">
                {asks.map((a) => (
                  <HomeRow
                    key={a.id}
                    href={`/asks/${a.id}`}
                    title={a.title}
                    clamp
                    note={a.claudeAsked ? <Status tone="warn" small>Claude asked you something</Status> : <Status tone="info" small>Ask for you</Status>}
                    when={relativeTime(a.at)}
                  />
                ))}
              </ul>
            )}
            {list.shootsToday.length > 0 && (
              <ul className="list">
                {list.shootsToday.map((s) => (
                  <ShootRow key={s.id} s={s} when={<span className="font-medium text-text">Today</span>} />
                ))}
              </ul>
            )}
            {list.today.length > 0 && <Tasks tasks={list.today} names={names} />}
          </>
        )}
      </Card>

      <Card title={<>This week{weekCount > 0 && <span className="meta">{weekCount}</span>}</>} padded={false}>
        {weekCount === 0 ? (
          <p className="sec-note">Nothing else due by Sunday.</p>
        ) : (
          <>
            {list.shootsWeek.length > 0 && (
              <ul className="list">
                {list.shootsWeek.map((s) => (
                  <ShootRow key={`${s.id}-${s.day}`} s={s} when={dayName(s.day)} />
                ))}
              </ul>
            )}
            {list.week.length > 0 && <Tasks tasks={list.week} names={names} />}
          </>
        )}
      </Card>

      <Card title={<>No due date{list.noDate.length > 0 && <span className="meta">{list.noDate.length}</span>}</>} padded={false}>
        {list.noDate.length === 0 ? <p className="sec-note">Nothing here.</p> : <Tasks tasks={list.noDate} names={names} />}
      </Card>

      {list.later > 0 && (
        <p className="meta mt-4">
          <Link href="/tasks" className="link">
            {list.later} more due after this week →
          </Link>
        </p>
      )}

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

      {list.doneRecently.length > 0 && (
        <details className="mt-8">
          <summary className="meta cursor-pointer">Done recently ({list.doneRecently.length}). Tap the tick to undo.</summary>
          <TaskList>
            {list.doneRecently.map((t) => (
              <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} showAssignee={false} />
            ))}
          </TaskList>
        </details>
      )}
    </>
  );
}
