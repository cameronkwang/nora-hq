"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { OpsError } from "@/lib/ops";
import { recordManualSnapshot, tagMediaClient } from "@/lib/ops-creator";
import { syncCreatorInstagram } from "@/lib/integrations/creator-instagram";
import { syncCreatorTikTok } from "@/lib/integrations/tiktok";

export type ActionState = { ok?: string; error?: string } | null;

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
/** "12,400" / "12.4k" / "1.2M" → number. Empty → undefined. */
function parseCount(raw: string): number | undefined | "bad" {
  const s = raw.replace(/[\s,]/g, "").toLowerCase();
  if (!s) return undefined;
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return "bad";
  const n = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) ? Math.round(n) : "bad";
}

const msg = (e: unknown) => (e instanceof OpsError || e instanceof Error ? e.message : "Couldn't save");

/** "Log today's numbers": followers (+ optional views) for each platform she filled in. */
export async function logNumbersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const date = today();
  const done: string[] = [];
  try {
    for (const p of ["instagram", "tiktok"] as const) {
      const followers = parseCount(str(formData.get(`${p}_followers`)));
      const views = parseCount(str(formData.get(`${p}_views`)));
      if (followers === "bad" || views === "bad") return { error: "Use plain numbers, like 12400 or 12.4k." };
      if (followers === undefined) {
        if (views !== undefined) return { error: `Add ${p === "instagram" ? "Instagram" : "TikTok"} followers too.` };
        continue;
      }
      await recordManualSnapshot(p, date, { followers, views: views ?? null }, user.email);
      done.push(p === "instagram" ? "Instagram" : "TikTok");
    }
  } catch (e) {
    return { error: msg(e) };
  }
  if (!done.length) return { error: "Type at least one follower count." };
  revalidatePath("/stats");
  // Redirect so the confirmation survives the form moving (the big first-time card folds away once there's data).
  redirect(`/stats?msg=${encodeURIComponent(`Saved ${done.join(" and ")} for today.`)}`);
}

export async function tagPostAction(mediaId: string, clientId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await tagMediaClient(mediaId, clientId || null, user.email);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/stats");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  return { ok: "Saved" };
}

export async function syncStatsAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  await requireUser();
  const deadline = Date.now() + 50_000;
  const [ig, tt] = await Promise.all([syncCreatorInstagram({ force: true, deadline }), syncCreatorTikTok({ force: true })]);
  revalidatePath("/stats");
  const parts: string[] = [];
  const errors: string[] = [];
  for (const [name, r] of [["Instagram", ig], ["TikTok", tt]] as const) {
    if (r.ok) parts.push(`${name} synced${r.warnings?.length ? ` (${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"}: ${r.warnings[0]})` : ""}`);
    else if (!r.notConfigured) errors.push(`${name}: ${r.error}`);
  }
  if (errors.length) return { error: [...parts, ...errors].join(". ") };
  return parts.length ? { ok: `${parts.join(". ")}.` } : { error: "Nothing to sync yet — connect Instagram or TikTok first." };
}
