"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { updateBusinessDetails } from "@/lib/ops-business";
import { SEND_FROM_KINDS, type SendFromKind } from "@/lib/schema";
import type { FormState } from "../../actions";

/**
 * Settings → Outreach profile: which account this business's creator outreach is sent from (its own, never Nora's)
 * and its standing offer for creators. Empty fields clear.
 */
export async function saveOutreachProfileAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const field = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  const picked = field("sendFromKind");
  // An unknown value is treated as "work it out from the account".
  const sendFromKind: SendFromKind | "" = (SEND_FROM_KINDS as readonly string[]).includes(picked) ? (picked as SendFromKind) : "";
  try {
    const r = await updateBusinessDetails(clientId, { sendFromKind, sendFrom: field("sendFrom"), creatorOffer: field("creatorOffer") }, user.email);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/settings`);
    revalidatePath("/review");
    return { ok: true, message: r.changed.length ? `Saved: ${r.changed.join("; ")}`.slice(0, 600) : "Saved. Nothing changed.", at: Date.now() };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "That doesn't look right." };
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
