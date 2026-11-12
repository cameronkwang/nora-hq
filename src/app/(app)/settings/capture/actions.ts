"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { createCaptureToken, revokeCaptureToken } from "@/lib/ops-capture";

export type NewTokenState = { token?: string; label?: string; error?: string; at?: number };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/** Makes a key for the signed-in person. The raw key comes back once, in this response only. */
export async function createCaptureTokenAction(_prev: NewTokenState, formData: FormData): Promise<NewTokenState> {
  const user = await requireUser();
  const label = str(formData.get("label")) || `${user.name}'s iPhone`;
  try {
    const r = await createCaptureToken(user.email, label, user.email);
    revalidatePath("/settings/capture");
    return { token: r.token, label: r.label, at: Date.now() };
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message, at: Date.now() };
    if (e && typeof e === "object" && "issues" in e) return { error: "Give it a short name (under 60 characters).", at: Date.now() };
    throw e;
  }
}

export async function revokeCaptureTokenAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) return;
  try {
    await revokeCaptureToken(id, user.email);
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
  }
  revalidatePath("/settings/capture");
}
