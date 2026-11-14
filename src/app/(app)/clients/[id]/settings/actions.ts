"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { setOutreachAreas } from "@/lib/ops-onboarding";
import { setBusinessActive, setBusinessFacts } from "@/lib/ops-business";
import { FACT_KEYS, INFO_FACT_KEYS, type FactKey } from "@/lib/business-facts";
import type { FormState } from "../../actions";

/**
 * Settings → Public facts. An empty field clears that fact. "We looked" marks every fact that is still empty
 * (including website / Instagram / TikTok, which are edited under Details) as "not found".
 */
export async function saveBusinessFactsAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const field = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  const items: Array<{ fact: FactKey; value?: string; notFound?: boolean }> = INFO_FACT_KEYS.map((k) => ({ fact: k, value: field(k) }));
  if (fd.get("markRestNotFound")) for (const k of FACT_KEYS) items.push({ fact: k, notFound: true });
  try {
    const r = await setBusinessFacts(clientId, items, user.email);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/settings`);
    const missing = r.checklist.missing.length;
    return {
      ok: true,
      message: `${r.changed.length ? `Saved: ${r.changed.join("; ")}` : "Saved. Nothing changed."}${missing ? ` · ${missing} still missing` : ""}`.slice(0, 600),
      at: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

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

/** Active ⇄ Inactive (Inactive hides the business from Home, the sidebar and Claude's briefing; nothing is deleted). */
export async function setBusinessActiveAction(clientId: string, active: boolean) {
  const user = await requireUser();
  await setBusinessActive(clientId, active, user.email);
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/settings`);
  revalidatePath("/", "layout"); // Home + sidebar list businesses
}
