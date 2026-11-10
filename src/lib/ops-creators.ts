import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { OpsError, upsertCreator, upsertOutreach } from "./ops";
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, cleanRow, type CleanImportRow, type ImportField, type RawImportRow } from "@/app/(app)/creators/import/parse";

/**
 * Bulk creator import (the /creators/import screen). Same conventions as lib/ops: zod-validated input,
 * `actor` is a user email or "claude". Each creator is saved through upsertCreator (so de-duping on
 * IG handle → TikTok handle → email, and its activity entry, are identical to adding one by hand),
 * and outreach goes through upsertOutreach (which refuses do-not-contact creators for contact stages).
 */

const RawRow = z.object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.string().max(5000).optional()])) as Record<ImportField, z.ZodOptional<z.ZodString>>);
const RawRows = z.array(RawRow).max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows at a time`);

export const ImportOutreach = z
  .object({ clientId: z.string().min(1), channel: z.enum(schema.OUTREACH_CHANNELS) })
  .nullish();

export type ImportPreviewRow =
  | { status: "new"; name: string; note?: string }
  | { status: "update"; name: string; existingName: string; note?: string }
  | { status: "skip"; name: string; note: string }
  | { status: "invalid"; note: string };

type Existing = Pick<schema.Creator, "id" | "name" | "instagramHandle" | "tiktokHandle" | "email" | "doNotContact">;

async function loadExisting() {
  const db = await getDb();
  const all: Existing[] = await db
    .select({
      id: schema.creators.id,
      name: schema.creators.name,
      instagramHandle: schema.creators.instagramHandle,
      tiktokHandle: schema.creators.tiktokHandle,
      email: schema.creators.email,
      doNotContact: schema.creators.doNotContact,
    })
    .from(schema.creators);
  const ig = new Map<string, Existing>(), tt = new Map<string, Existing>(), em = new Map<string, Existing>();
  for (const c of all) {
    if (c.instagramHandle) ig.set(c.instagramHandle, c);
    if (c.tiktokHandle) tt.set(c.tiktokHandle, c);
    if (c.email) em.set(c.email.toLowerCase(), c);
  }
  /** Same lookup order as upsertCreator: IG handle, then TikTok handle, then email. */
  return (r: CleanImportRow) =>
    (r.instagramHandle && ig.get(r.instagramHandle)) || (r.tiktokHandle && tt.get(r.tiktokHandle)) || (r.email && em.get(r.email)) || undefined;
}

/**
 * Read-only dry run: what importing these rows would do. Rows that repeat an earlier row's handle or
 * email are skipped (the first one wins), so a sheet with one line per business imports each creator once.
 */
export async function previewCreatorImport(input: RawImportRow[], outreach?: z.input<typeof ImportOutreach>): Promise<ImportPreviewRow[]> {
  const rows = RawRows.parse(input);
  const out = ImportOutreach.parse(outreach);
  const find = await loadExisting();
  const inOutreach = new Set<string>();
  if (out) {
    const db = await getDb();
    const rel = await db.select({ creatorId: schema.outreach.creatorId }).from(schema.outreach).where(eq(schema.outreach.clientId, out.clientId));
    for (const r of rel) inOutreach.add(r.creatorId);
  }
  const seen = new Map<string, number>();
  return rows.map((raw, i): ImportPreviewRow => {
    const res = cleanRow(raw);
    if ("error" in res) return { status: "invalid", note: res.error };
    const r = res.row;
    const keys = [r.instagramHandle && `ig:${r.instagramHandle}`, r.tiktokHandle && `tt:${r.tiktokHandle}`, r.email && `em:${r.email}`].filter(Boolean) as string[];
    const dupeOf = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
    if (dupeOf !== undefined) return { status: "skip", name: r.name, note: `Same creator as row ${dupeOf + 2}` };
    for (const k of keys) seen.set(k, i);
    const ex = find(r);
    let note: string | undefined;
    if (out && ex?.doNotContact) note = "Do not contact — outreach won't start";
    else if (out && ex && inOutreach.has(ex.id)) note = "Already in outreach — stage kept";
    return ex ? { status: "update", name: raw.name?.trim() ? r.name : ex.name, existingName: ex.name, note } : { status: "new", name: r.name };
  });
}

export const ImportChunk = z.object({
  rows: z.array(RawRow).min(1).max(50, "At most 50 rows per request"),
  outreach: ImportOutreach,
});

export type ImportResult = { created: number; updated: number; outreachStarted: number; failed: Array<{ name: string; error: string }> };

/**
 * Saves one chunk of rows (the screen sends 25 at a time so no request runs long).
 * Optional outreach: adds each creator to that business's pipeline as "Sourced" — never for a
 * do-not-contact creator, and an existing relationship's stage is left alone.
 */
export async function importCreators(input: z.input<typeof ImportChunk>, actor: string): Promise<ImportResult> {
  const v = ImportChunk.parse(input);
  const db = await getDb();
  if (v.outreach) {
    const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, v.outreach.clientId));
    if (!client) throw new OpsError("business not found");
  }
  const find = await loadExisting();
  const result: ImportResult = { created: 0, updated: 0, outreachStarted: 0, failed: [] };
  const touched: Array<{ id: string; dnc: boolean }> = [];

  for (const raw of v.rows) {
    const res = cleanRow(raw);
    if ("error" in res) {
      result.failed.push({ name: raw.name || raw.instagramHandle || raw.tiktokHandle || raw.email || "Row", error: res.error });
      continue;
    }
    const r = res.row;
    const ex = find(r);
    try {
      const id = await upsertCreator(
        {
          ...(ex ? { id: ex.id } : {}),
          // No name column (or a blank cell): keep the name we already have rather than "@handle".
          name: raw.name?.trim() || !ex ? r.name : ex.name,
          instagramHandle: r.instagramHandle,
          tiktokHandle: r.tiktokHandle,
          email: r.email,
          city: r.city,
          niche: r.niche,
          notes: r.notes,
          instagramFollowers: r.instagramFollowers,
          tiktokFollowers: r.tiktokFollowers,
          engagementRate: r.engagementRate,
          ...(ex ? {} : { source: "import" }),
        },
        actor,
      );
      if (ex) result.updated++;
      else result.created++;
      touched.push({ id, dnc: ex?.doNotContact ?? false });
    } catch (e) {
      result.failed.push({ name: r.name, error: e instanceof z.ZodError ? "Invalid values" : e instanceof Error ? e.message : "Couldn't save" });
    }
  }

  if (v.outreach && touched.length) {
    const ids = touched.map((t) => t.id);
    const existingRel = new Set(
      (
        await db
          .select({ creatorId: schema.outreach.creatorId })
          .from(schema.outreach)
          .where(and(eq(schema.outreach.clientId, v.outreach.clientId), inArray(schema.outreach.creatorId, ids)))
      ).map((r) => r.creatorId),
    );
    for (const t of touched) {
      if (t.dnc || existingRel.has(t.id)) continue;
      await upsertOutreach({ clientId: v.outreach.clientId, creatorId: t.id, channel: v.outreach.channel, stage: "sourced" }, actor);
      existingRel.add(t.id);
      result.outreachStarted++;
    }
  }
  return result;
}
