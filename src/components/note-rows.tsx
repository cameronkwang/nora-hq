import { and, desc, eq, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { relativeTime } from "@/lib/dates";
import { askThreadState, listAskMessagesFor } from "@/lib/ops";
import { listNotes, noteTitle } from "@/lib/ops-notes";
import { HomeRow } from "./nora-home";
import { Status, cx } from "./ui";

export type NoteRow = { key: string; href: string; title: string; at: Date; state: "mine" | "sent" | "replied" | "asked" | "done" };

/**
 * A person's notes, newest first: the private ones ("Just you") together with the ones they sent to Cameron, which
 * are asks and so carry whether anyone has answered. `skipAskIds` leaves out asks already shown elsewhere on a page.
 */
export async function loadNoteRows(email: string, name: string, limit: number, skipAskIds: string[] = []): Promise<NoteRow[]> {
  const db = await getDb();
  const [notes, asks] = await Promise.all([
    listNotes(email, limit),
    db
      .select()
      .from(schema.asks)
      .where(and(or(eq(schema.asks.createdBy, email), eq(schema.asks.createdBy, name)), ne(schema.asks.status, "archived"), ne(schema.asks.kind, "idea")))
      .orderBy(desc(schema.asks.updatedAt))
      .limit(limit),
  ]);
  const skip = new Set(skipAskIds);
  const sent = asks.filter((a) => !skip.has(a.id));
  const threads = await listAskMessagesFor(sent.map((a) => a.id));
  const rows: NoteRow[] = [
    ...notes.map((n) => ({ key: n.id, href: `/notes/${n.id}`, title: noteTitle(n.body), at: n.updatedAt, state: "mine" as const })),
    ...sent.map((a) => {
      const thread = threads.get(a.id) ?? [];
      const last = thread.at(-1);
      const asked = askThreadState(a, last) === "claude_asked";
      const replied = !!a.claudeNote || thread.some((m) => m.author !== email && m.author !== name);
      const state: NoteRow["state"] = a.status === "done" ? "done" : asked ? "asked" : replied ? "replied" : "sent";
      return { key: a.id, href: `/asks/${a.id}`, title: noteTitle(a.body), at: a.updatedAt, state };
    }),
  ];
  return rows.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, limit);
}

const STATE: Record<NoteRow["state"], React.ReactNode> = {
  mine: <Status tone="neutral" small>Just you</Status>,
  sent: <Status tone="ink" small>Sent to Cameron</Status>,
  replied: <Status tone="info" small>Answered</Status>,
  asked: <Status tone="warn" small>A question for you</Status>,
  done: <Status tone="ok" small>Done</Status>,
};

export function NoteRows({ rows, ruled }: { rows: NoteRow[]; ruled?: boolean }) {
  return (
    <ul className={cx("list", ruled && "is-ruled")}>
      {rows.map((r) => (
        <HomeRow key={r.key} href={r.href} title={r.title} clamp note={STATE[r.state]} when={relativeTime(r.at)} />
      ))}
    </ul>
  );
}
