import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { OpsError } from "./ops";

/**
 * Private notes ("Just me"). Each note belongs to the person who wrote it, and every read and write here is scoped to
 * that owner. Nothing is written to the activity log and there is no Claude (MCP) tool: a note stays between its
 * writer and HQ until they choose "Send to Cameron", which turns it into an ask (see notes/actions.ts).
 */

const Body = z.string().trim().min(1, "Write a few words first.").max(8000, "That note is too long.");
const Attachments = z.array(z.object({ url: z.string(), name: z.string(), contentType: z.string().optional() })).max(20).default([]);

export async function createNote(input: { body: string; attachments?: schema.Attachment[] }, owner: string): Promise<string> {
  const body = Body.safeParse(input.body);
  if (!body.success) throw new OpsError(body.error.issues[0].message);
  const db = await getDb();
  const id = newId("note_");
  await db.insert(schema.notes).values({ id, owner, body: body.data, attachments: Attachments.parse(input.attachments ?? []) });
  return id;
}

export async function listNotes(owner: string, limit = 100): Promise<schema.Note[]> {
  const db = await getDb();
  return db.select().from(schema.notes).where(eq(schema.notes.owner, owner)).orderBy(desc(schema.notes.updatedAt)).limit(limit);
}

export async function getNote(id: string, owner: string): Promise<schema.Note | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.notes).where(and(eq(schema.notes.id, id), eq(schema.notes.owner, owner)));
  return row ?? null;
}

export async function updateNote(id: string, bodyIn: string, owner: string): Promise<void> {
  const body = Body.safeParse(bodyIn);
  if (!body.success) throw new OpsError(body.error.issues[0].message);
  const db = await getDb();
  await db.update(schema.notes).set({ body: body.data, updatedAt: new Date() }).where(and(eq(schema.notes.id, id), eq(schema.notes.owner, owner)));
}

export async function deleteNote(id: string, owner: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.notes).where(and(eq(schema.notes.id, id), eq(schema.notes.owner, owner)));
}

/** The first non-empty line: a note's title in lists, and the reminder made from it. */
export function noteTitle(body: string): string {
  const line = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "Note";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
