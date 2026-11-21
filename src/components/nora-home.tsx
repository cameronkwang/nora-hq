import Link from "next/link";
import type { ReactNode } from "react";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { monthOfDate } from "@/lib/dates";
import { listSchedule, reelsToPost } from "@/lib/ops-schedule";
import { CHECKLIST_TOTAL, checklistDone } from "@/lib/shoot-checklist";
import { NoteRows, loadNoteRows } from "./note-rows";
import { TaskList, TaskRow } from "./task-row";
import { Card, Count, EmptyState, Tag } from "./ui";

/**
 * Nora's Home is a notes-and-reminders page, not the agency view: her reminders (tick them off), what is coming up
 * on her calendar this week (each shoot opens its checklist), the reels she still owes, and her notes: the private
 * ones and the ones she sent to Cameron, with whether he has answered. No money, no drafts, no business tools.
 * Cameron's Home is unchanged.
 */

/** How far ahead "Coming up" looks, and how many reminders and notes Home lists before "All". */
const COMING_UP_DAYS = 7;
const REMINDERS_MAX = 30;
const NOTES_MAX = 6;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
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

export async function NoraHome({ email, name, now, names, skipAskIds = [] }: { email: string; name: string; now: string; names: Map<string, string>; skipAskIds?: string[] }) {
  const db = await getDb();
  const until = addDays(now, COMING_UP_DAYS);
  const months = [...new Set([monthOfDate(now), monthOfDate(until)])];
  const [reminders, schedule, owedReels, notes] = await Promise.all([
    db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.assignee, "nora"), ne(schema.tasks.status, "done")))
      // Dated ones first, soonest (or most overdue) at the top; undated ones after, oldest first.
      .orderBy(sql`${schema.tasks.dueDate} asc nulls last`, asc(schema.tasks.createdAt))
      .limit(REMINDERS_MAX),
    Promise.all(months.map((m) => listSchedule(m))),
    reelsToPost(now),
    loadNoteRows(email, name, NOTES_MAX, skipAskIds),
  ]);
  const comingUp = schedule
    .flat()
    .filter((j) => j.date && j.date >= now && j.date <= until)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const when = (d: string) => (d === now ? <span className="font-medium text-text">Today</span> : d === addDays(now, 1) ? "Tomorrow" : dayName(d));

  return (
    <>
      <Card
        title={<>Reminders{reminders.length > 0 && <Count n={reminders.length} />}</>}
        actions={<Link href="/notes/new?kind=reminder" className="link-quiet">New reminder →</Link>}
        padded={false}
      >
        {reminders.length === 0 ? (
          <p className="sec-note">Nothing to remember right now. Tap + to add a reminder.</p>
        ) : (
          <TaskList>
            {reminders.map((t) => (
              <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} showWho={false} />
            ))}
          </TaskList>
        )}
      </Card>

      <Card title="Coming up" actions={<Link href="/calendar" className="link-quiet">Calendar →</Link>} padded={false}>
        {comingUp.length === 0 ? (
          <EmptyState title="Nothing booked this week.">
            <Link href="/calendar" className="link">See the whole calendar</Link>
          </EmptyState>
        ) : (
          <ul className="list">
            {comingUp.map((j) => (
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
                when={when(j.date!)}
              />
            ))}
          </ul>
        )}
      </Card>

      {owedReels.length > 0 && (
        <Card title={<>Reels to post<Count n={owedReels.length} /></>} actions={<Link href="/calendar?show=reels" className="link-quiet">All →</Link>} padded={false}>
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
        </Card>
      )}

      <Card title="Notes" actions={<Link href="/notes" className="link-quiet">All →</Link>} padded={false}>
        {notes.length === 0 ? (
          <p className="sec-note">Tap + to write a note. Keep it for yourself or send it to Cameron.</p>
        ) : (
          <NoteRows rows={notes} />
        )}
      </Card>
    </>
  );
}
