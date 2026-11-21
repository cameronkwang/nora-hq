import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError, createTask } from "./ops";
import { isSharedFileUrl } from "./uploads";

/**
 * Files Cameron sends to Nora: her Files tab. A file is uploaded first (api/files/upload), then recorded here with the
 * name she will see, its kind and an optional note. People only: there is deliberately no Claude (MCP) tool, since
 * contracts and invoices hold fees. The activity log gets the title, never the file.
 */

export const SendFileInput = z.object({
  url: z.string().max(1000),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(200).nullish(),
  sizeBytes: z.number().int().nonnegative().max(1_000_000_000).nullish(),
  title: z.string().trim().min(1, "Give it a name Nora will recognise.").max(140),
  kind: z.enum(schema.SHARED_FILE_KINDS).default("other"),
  note: z.string().trim().max(500).nullish(),
  /** "YYYY-MM-DD": also puts a reminder on Nora's list for that day. */
  remindOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function sendFile(input: z.input<typeof SendFileInput>, actor: string): Promise<string> {
  const parsed = SendFileInput.safeParse(input);
  if (!parsed.success) throw new OpsError(parsed.error.issues[0].message);
  const v = parsed.data;
  if (!isSharedFileUrl(v.url)) throw new OpsError("That file didn't upload properly. Choose it again.");
  const db = await getDb();
  const id = newId("file_");
  await db.insert(schema.sharedFiles).values({
    id, title: v.title, kind: v.kind, note: v.note || null, url: v.url, fileName: v.fileName,
    contentType: v.contentType || null, sizeBytes: v.sizeBytes ?? null, sentBy: actor,
  });
  await logActivity({ actor, action: "file.sent", entityType: "file", entityId: id, summary: `Sent Nora a file: ${v.title}` });
  if (v.remindOn) {
    await createTask({ title: `Look at "${v.title}" in Files`, details: v.note || null, assignee: "nora", dueDate: v.remindOn }, actor);
  }
  return id;
}

export async function listFiles(kind?: schema.SharedFileKind): Promise<schema.SharedFile[]> {
  const db = await getDb();
  return db.select().from(schema.sharedFiles).where(kind ? eq(schema.sharedFiles.kind, kind) : undefined).orderBy(desc(schema.sharedFiles.createdAt)).limit(300);
}

export async function getFile(id: string): Promise<schema.SharedFile | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.sharedFiles).where(eq(schema.sharedFiles.id, id));
  return row ?? null;
}

/** Files Nora has not opened yet: the count on her Files tab. */
export async function newFileCount(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sharedFiles).where(isNull(schema.sharedFiles.openedAt));
  return row?.n ?? 0;
}

/** The first time Nora opens a file. Later opens change nothing. */
export async function markFileOpened(id: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.sharedFiles).set({ openedAt: new Date() }).where(and(eq(schema.sharedFiles.id, id), isNull(schema.sharedFiles.openedAt)));
}

/** Takes a file out of Nora's Files tab. The stored file itself is deleted too when it lives in our Blob store. */
export async function removeFile(id: string, actor: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.delete(schema.sharedFiles).where(eq(schema.sharedFiles.id, id)).returning({ title: schema.sharedFiles.title, url: schema.sharedFiles.url });
  if (!row) return;
  if (row.url.startsWith("https://") && isSharedFileUrl(row.url)) {
    try {
      const { del } = await import("@vercel/blob");
      await del(row.url);
    } catch {
      // The row is gone, so the file is unreachable from HQ either way.
    }
  }
  await logActivity({ actor, action: "file.removed", entityType: "file", entityId: id, summary: `Removed a file from Nora's Files: ${row.title}` });
}
