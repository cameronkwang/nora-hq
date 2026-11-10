"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { setMetricCells, type CellResult } from "@/lib/ops-numbers";

export type SaveCellsResult = { results: CellResult[] } | { error: string };

/** Autosave from the Numbers sheet. One call per batch of edited (or pasted) cells. */
export async function saveNumbersAction(cells: unknown[]): Promise<SaveCellsResult> {
  const user = await requireUser();
  if (!Array.isArray(cells) || cells.length === 0) return { results: [] };
  try {
    const results = await setMetricCells(cells, user.email);
    // Business pages read the same table.
    const ids = new Set(cells.map((c) => (c && typeof c === "object" && "clientId" in c ? String((c as { clientId: unknown }).clientId) : "")));
    for (const id of ids) if (id) revalidatePath(`/clients/${id}`);
    revalidatePath("/");
    return { results };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save" };
  }
}
