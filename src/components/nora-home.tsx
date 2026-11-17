import Link from "next/link";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { relativeTime } from "@/lib/dates";
import { askThreadState, listAskMessagesFor } from "@/lib/ops";
import { reelsToPost, scheduleOn } from "@/lib/ops-schedule";
import { dealsOwed } from "@/lib/ops-deals";
import { CHECKLIST_TOTAL, checklistDone } from "@/lib/shoot-checklist";
import { Badge, Card, EmptyState } from "./ui";

/**
 * Nora's Home: her day, not the agency view. What she's shooting today and tomorrow (each job opens its
 * shoot checklist), the reels she still owes, whether collabs are paid (never amounts here), and the asks
 * she sent with whether Cameron or Claude answered. Cameron's Home is unchanged.
 */

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const ASK_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "accent" }> = {
  new: { label: "Sent", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "ok" },
};

export async function NoraHome({ email, name, now, skipAskIds = [] }: { email: string; name: string; now: string; skipAskIds?: string[] }) {
  const db = await getDb();
  const tomorrow = addDays(now, 1);
  const [todayJobs, tomorrowJobs, owedReels, owed, myAsks] = await Promise.all([
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

  return (
    <div className="flex flex-col gap-6">
      <Card title="Shoots" actions={<Link href="/calendar" className="text-xs text-accent hover:underline">Schedule</Link>} padded={false}>
        {todayJobs.length + tomorrowJobs.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing booked today or tomorrow.">
              <Link href="/calendar" className="text-accent hover:underline">See the whole schedule</Link>
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {[...todayJobs.map((j) => ({ j, when: "Today" })), ...tomorrowJobs.map((j) => ({ j, when: "Tomorrow" }))].map(({ j, when }) => {
              const done = checklistDone(j.checklist);
              return (
                <li key={j.id}>
                  <Link href={`/calendar/jobs/${j.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 active:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{j.businessName}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className={when === "Today" ? "font-semibold text-accent" : undefined}>{when}</span>
                        <span>· Shoot list {done}/{CHECKLIST_TOTAL}</span>
                        {j.isFree && <Badge tone="ok">Free</Badge>}
                      </span>
                    </span>
                    <span aria-hidden className="shrink-0 text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title={<>Reels to post{owedReels.length > 0 && <span className="font-normal text-muted"> · {owedReels.length}</span>}</>}
        actions={owedReels.length > 0 ? <Link href="/calendar?show=reels" className="text-xs text-accent hover:underline">All</Link> : undefined}
        padded={false}
      >
        {owedReels.length === 0 ? (
          <p className="p-4 text-sm text-muted">All caught up. No reels owed.</p>
        ) : (
          <ul className="divide-y divide-border">
            {owedReels.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link href={`/calendar/jobs/${r.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2 active:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-[15px]">📸 {r.businessName}</span>
                  <span className="shrink-0 text-xs text-muted">{r.date ? `shot ${dayName(r.date)}` : "no set day"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {owed.count > 0 && (
        <Link href="/deals" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2">
          <span className="text-[15px]">
            <span className="font-medium">
              {owed.count} collab{owed.count === 1 ? "" : "s"} not paid yet
            </span>
            {owed.overdueCount > 0 && <span className="text-danger"> · {owed.overdueCount} overdue</span>}
          </span>
          <span aria-hidden className="text-muted">›</span>
        </Link>
      )}

      <Card title="Your asks" actions={<Link href="/asks/new" className="text-xs text-accent hover:underline">New ask</Link>} padded={false}>
        {mine.length === 0 ? (
          <p className="p-4 text-sm text-muted">Anything you send with the + button shows up here, with whether Cameron or Claude has answered.</p>
        ) : (
          <ul className="divide-y divide-border">
            {mine.map((a) => {
              const thread = threads.get(a.id) ?? [];
              const state = askThreadState(a, thread.at(-1));
              const s = ASK_STATUS[a.status] ?? ASK_STATUS.new;
              return (
                <li key={a.id}>
                  <Link href={`/asks/${a.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 active:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{a.body.split("\n")[0]}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {state === "claude_asked" ? <Badge tone="warn">Claude asked you something</Badge> : <Badge tone={s.tone}>{s.label}</Badge>}
                        <span>{relativeTime(a.updatedAt)}</span>
                      </span>
                    </span>
                    <span aria-hidden className="shrink-0 text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
