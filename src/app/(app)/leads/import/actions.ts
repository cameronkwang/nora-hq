"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { importLeads, previewLeadImport, type LeadImportPreviewRow, type LeadImportResult } from "@/lib/ops-leads";
import type { RawLeadRow } from "../shared";

function message(e: unknown) {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Some rows couldn't be read.";
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Dry run for the preview. Changes nothing. */
export async function previewLeadImportAction(rows: RawLeadRow[]): Promise<{ rows?: LeadImportPreviewRow[]; error?: string }> {
  await requireUser();
  try {
    return { rows: await previewLeadImport(rows) };
  } catch (e) {
    return { error: message(e) };
  }
}

/** Saves one chunk; the screen calls this repeatedly and shows progress. */
export async function importLeadChunkAction(rows: RawLeadRow[], last: boolean): Promise<{ result?: LeadImportResult; error?: string }> {
  const user = await requireUser();
  try {
    const result = await importLeads(rows, user.email);
    if (last) revalidatePath("/leads");
    return { result };
  } catch (e) {
    return { error: message(e) };
  }
}
