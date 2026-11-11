import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { AskInput, OpsError, createTask } from "./ops";

/**
 * Ask routing ("triage"). Same conventions as lib/ops: zod-validated input, `actor` is a user email
 * or "claude", one activity entry per call. Used by the app (Nora/Cameron re-routing with chips)
 * and by Claude's triage_ask tool.
 *
 * kind:   auto (not sorted yet) · request · idea · update (FYI) · question
 * forWho: auto (let Claude route) · claude · cameron · nora · anyone
 *
 * Routing a request to Cameron or Nora puts a task on their list (once per ask and person).
 */

export const TriageInput = z.object({
  kind: z.enum(schema.ASK_KINDS),
  forWho: z.enum(schema.ASK_FOR),
  clientId: z.string().nullish(),
  note: z.string().max(4000).nullish(),
});

const PEOPLE = ["cameron", "nora"] as const;
type Person = (typeof PEOPLE)[number];
const isPerson = (v: string): v is Person => (PEOPLE as readonly string[]).includes(v);

const KIND_LABEL: Record<schema.AskKind, string> = { auto: "unsorted", request: "request", idea: "idea", update: "FYI", question: "question" };
const FOR_LABEL: Record<schema.AskFor, string> = { auto: "Claude to sort", claude: "Claude", cameron: "Cameron", nora: "Nora", anyone: "anyone" };
const name = (p: Person) => (p === "cameron" ? "Cameron" : "Nora");

/** First line of the ask, trimmed to ~80 chars — the title of the task it becomes. */
export function askTaskTitle(body: string): string {
  const line = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "Ask";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

async function assertClient(clientId: string) {
  const db = await getDb();
  const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!c) throw new OpsError(`No business with id "${clientId}"`);
}

/** Creates the person's task for a routed request unless that ask already has one for them. Returns the task id if created. */
async function ensurePersonTask(ask: schema.Ask, person: Person, actor: string): Promise<string | null> {
  const db = await getDb();
  const [existing] = await db.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(eq(schema.tasks.askId, ask.id), eq(schema.tasks.assignee, person))).limit(1);
  if (existing) return null;
  const firstLine = askTaskTitle(ask.body);
  return createTask({
    title: firstLine,
    details: ask.body.trim() !== firstLine ? ask.body.trim() : null,
    clientId: ask.clientId,
    assignee: person,
    askId: ask.id,
  }, actor);
}

/**
 * Sort an ask: what it is and who should act on it. Idempotent — re-running with the same values
 * changes nothing and never creates a second task.
 */
export async function triageAsk(askId: string, input: z.input<typeof TriageInput>, actor: string) {
  const v = TriageInput.parse(input);
  const db = await getDb();
  const [cur] = await db.select().from(schema.asks).where(eq(schema.asks.id, askId));
  if (!cur) throw new OpsError(`ask ${askId} not found`);
  if (v.clientId) await assertClient(v.clientId);

  const set: Partial<typeof schema.asks.$inferInsert> = { kind: v.kind, forWho: v.forWho, updatedAt: new Date() };
  if (v.clientId !== undefined) set.clientId = v.clientId || null;
  if (v.note !== undefined && v.note !== null && v.note.trim()) set.claudeNote = v.note.trim();
  const [row] = await db.update(schema.asks).set(set).where(eq(schema.asks.id, askId)).returning();

  const taskId = v.kind === "request" && isPerson(v.forWho) ? await ensurePersonTask(row, v.forWho, actor) : null;

  // Re-routed away from a person (or no longer a request): take the ask off their list. Only tasks they
  // haven't touched (still "todo") are removed; anything they started stays theirs to finish or delete.
  const keep = v.kind === "request" && isPerson(v.forWho) ? v.forWho : null;
  const dropFrom = PEOPLE.filter((p) => p !== keep);
  const dropped = await db.delete(schema.tasks)
    .where(and(eq(schema.tasks.askId, askId), inArray(schema.tasks.assignee, dropFrom), eq(schema.tasks.status, "todo")))
    .returning({ assignee: schema.tasks.assignee });
  const droppedFor = [...new Set(dropped.map((t) => t.assignee).filter(isPerson))].map(name);

  const changed = cur.kind !== row.kind || cur.forWho !== row.forWho;
  if (changed || taskId || droppedFor.length || set.clientId !== undefined || set.claudeNote) {
    await logActivity({
      actor,
      action: "ask.triaged",
      entityType: "ask",
      entityId: askId,
      clientId: row.clientId,
      summary: `Ask sorted: ${KIND_LABEL[row.kind]} for ${FOR_LABEL[row.forWho]}${taskId && isPerson(v.forWho) ? ` — added a task for ${name(v.forWho)}` : ""}${droppedFor.length ? ` — removed it from ${droppedFor.join(" and ")}'s tasks` : ""}`,
    });
  }
  return { ask: row, taskId };
}

/** New ask with an optional up-front route (the "Who's it for?" chips). One activity entry. */
export async function createRoutedAsk(
  input: z.input<typeof AskInput>,
  route: { kind: schema.AskKind; forWho: schema.AskFor },
  actor: string,
) {
  const v = AskInput.parse(input);
  const r = TriageInput.pick({ kind: true, forWho: true }).parse(route);
  if (v.clientId) await assertClient(v.clientId);
  const db = await getDb();
  const id = newId("ask_");
  const [row] = await db.insert(schema.asks).values({
    id, clientId: v.clientId || null, body: v.body.trim(), attachments: v.attachments, createdBy: actor, kind: r.kind, forWho: r.forWho,
  }).returning();
  const routed = r.kind === "auto" && r.forWho === "auto" ? "" : ` (${KIND_LABEL[r.kind]} for ${FOR_LABEL[r.forWho]})`;
  await logActivity({ actor, action: "ask.created", entityType: "ask", entityId: id, clientId: row.clientId, summary: `New ask${routed}: ${v.body.slice(0, 80)}` });
  const taskId = r.kind === "request" && isPerson(r.forWho) ? await ensurePersonTask(row, r.forWho, actor) : null;
  return { id, taskId };
}
