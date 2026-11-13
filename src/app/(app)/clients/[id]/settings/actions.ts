"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { setOutreachAreas } from "@/lib/ops-onboarding";
import type { FormState } from "../../actions";

/** Settings → Creator search areas: chip picks (`outreachArea`) + free text (`outreachAreasOther`). Empty clears it. */
export async function setOutreachAreasAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const chips = fd.getAll("outreachArea").filter((v): v is string => typeof v === "string");
  const other = fd.get("outreachAreasOther");
  try {
    const saved = await setOutreachAreas({ clientId, areas: [...chips, typeof other === "string" ? other : ""] }, user.email);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/settings`);
    return { ok: true, message: saved ? `Saved: ${saved}` : "Cleared.", at: Date.now() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
