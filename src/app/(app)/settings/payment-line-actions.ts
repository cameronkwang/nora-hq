"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { savePaymentLine } from "@/lib/ops-payment";
import type { ActionFormState } from "@/components/client-form";

/** Saves how Nora gets paid (Settings → Nora, or the first time she requests payment on a deal). */
export async function savePaymentLineAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const raw = fd.get("line");
  try {
    const saved = await savePaymentLine(typeof raw === "string" ? raw : "", user.email);
    revalidatePath("/settings");
    revalidatePath("/deals/[id]", "page");
    return { ok: true, message: saved ? "Saved." : "Cleared.", at: Date.now() };
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message, at: Date.now() };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Check the text.", at: Date.now() };
    throw e;
  }
}
