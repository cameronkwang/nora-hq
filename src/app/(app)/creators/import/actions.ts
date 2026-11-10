"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { importCreators, previewCreatorImport, type ImportPreviewRow, type ImportResult } from "@/lib/ops-creators";
import type { OutreachChannel } from "@/lib/schema";
import type { RawImportRow } from "./parse";

export type ImportOutreachChoice = { clientId: string; channel: OutreachChannel } | null;

function message(e: unknown) {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Some rows couldn't be read.";
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Dry run for the preview table. Changes nothing. */
export async function previewImportAction(rows: RawImportRow[], outreach: ImportOutreachChoice): Promise<{ rows?: ImportPreviewRow[]; error?: string }> {
  await requireUser();
  try {
    return { rows: await previewCreatorImport(rows, outreach) };
  } catch (e) {
    return { error: message(e) };
  }
}

/** Saves one chunk; the screen calls this repeatedly and shows progress. */
export async function importChunkAction(rows: RawImportRow[], outreach: ImportOutreachChoice, last: boolean): Promise<{ result?: ImportResult; error?: string }> {
  const user = await requireUser();
  try {
    const result = await importCreators({ rows, outreach }, user.email);
    if (last) {
      revalidatePath("/creators");
      if (outreach) revalidatePath(`/clients/${outreach.clientId}`);
      revalidatePath("/");
    }
    return { result };
  } catch (e) {
    return { error: message(e) };
  }
}
