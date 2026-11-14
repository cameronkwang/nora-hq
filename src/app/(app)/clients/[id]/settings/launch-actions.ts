"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { setLaunch } from "@/lib/ops-launch";
import type { FormState } from "../../actions";

function refresh(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/settings`);
  revalidatePath("/tasks");
  revalidatePath("/", "layout"); // Home's health strip shows "Opening in N days"
}

/**
 * Settings → Pre-launch: "Not open yet" + the opening day. While a business isn't open it works the launch checklist;
 * monthly-plan tasks start on opening day.
 */
export async function saveLaunchAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const date = fd.get("openingDate");
  try {
    const r = await setLaunch(clientId, { prelaunch: fd.get("prelaunch") === "on", openingDate: typeof date === "string" ? date : null }, user.email);
    refresh(clientId);
    return { ok: true, message: r.message || "Saved.", at: Date.now() };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "That doesn't look right." };
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

/** Business page → "They're open": switches Pre-launch off (the opening day stays on record). The monthly plan applies from then on. */
export async function markOpenAction(clientId: string, openingDate: string | null) {
  const user = await requireUser();
  await setLaunch(clientId, { prelaunch: false, openingDate }, user.email);
  refresh(clientId);
}
