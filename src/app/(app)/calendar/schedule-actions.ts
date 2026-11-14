"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { addScheduleItem, deleteScheduleItem, importSchedule, markReelPosted, updateScheduleItem, type ImportResult } from "@/lib/ops-schedule";

export type ScheduleActionResult = { ok: true; message?: string } | { ok: false; error: string };

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the details and try again.";
  if (e instanceof OpsError) return e.message;
  console.error("[schedule] action failed", e);
  return "Something went wrong. Try again.";
}

function refresh() {
  revalidatePath("/calendar");
  revalidatePath("/clients/[id]", "page");
}

/** Paste → preview (dryRun) or import. Returns the preview so the sheet can show it; never echoes money. */
export async function importScheduleAction(text: string, dryRun: boolean): Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }> {
  const user = await requireUser();
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Paste Nora's list first." };
  try {
    const result = await importSchedule(text, user.email, { dryRun });
    if (!dryRun) refresh();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function addScheduleItemAction(input: { businessName: string; date: string | null; month: string; isFree: boolean; needsReel: boolean }): Promise<ScheduleActionResult> {
  const user = await requireUser();
  try {
    await addScheduleItem({ businessName: input.businessName, date: input.date || null, month: input.month, isFree: !!input.isFree, needsReel: !!input.needsReel }, user.email);
    refresh();
    return { ok: true, message: `Added ${input.businessName.trim()}.` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateScheduleItemAction(id: string, patch: { businessName?: string; date?: string | null; isFree?: boolean; needsReel?: boolean }): Promise<ScheduleActionResult> {
  const user = await requireUser();
  try {
    await updateScheduleItem(id, patch, user.email);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setReelPostedAction(id: string, posted: boolean): Promise<ScheduleActionResult> {
  const user = await requireUser();
  try {
    await markReelPosted(id, user.email, posted);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function deleteScheduleItemAction(id: string): Promise<ScheduleActionResult> {
  const user = await requireUser();
  try {
    await deleteScheduleItem(id, user.email);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
