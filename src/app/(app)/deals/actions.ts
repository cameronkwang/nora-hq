"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import {
  addDeliverable, addShot, createDeal, deleteDeal, deleteDeliverable, removeShot, requestShotList, setDealStatus, setPaymentStatus,
  toggleShot, updateDeal, updateDeliverable, zonedLocalToDate, type DealInputT,
} from "@/lib/ops-deals";
import { CREATOR_WORKSPACE_ID } from "@/lib/ops-collab";
import { DEAL_COMP, DEAL_STATUSES, DELIVERABLE_KINDS, PAYMENT_STATUSES, type DealStatus, type PaymentStatus, type ShotItem } from "@/lib/schema";
import type { ActionFormState } from "@/components/client-form";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const oneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

function message(e: unknown): string | null {
  if (e instanceof OpsError) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form.";
  return null;
}

function refresh(id?: string) {
  revalidatePath("/deals");
  if (id) {
    revalidatePath(`/deals/${id}`);
    revalidatePath(`/deals/${id}/visit`);
  }
  revalidatePath(`/clients/${CREATOR_WORKSPACE_ID}`);
  revalidatePath("/calendar"); // a job made into a deal shows Paid / Not paid on Nora's schedule
}

/** Runs a form action; ops/validation errors come back to the page as ?error=. */
async function guard(back: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const m = message(e);
    if (m) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(m)}`);
    throw e;
  }
}

const backTo = (fd: FormData, id: string) => {
  const b = str(fd.get("back"));
  return b.startsWith(`/deals/${id}`) ? b.split("?")[0] : `/deals/${id}`;
};

/** "$1,250.50" / "600" → cents. Empty → null. */
function parseDollars(v: string): number | null {
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new OpsError("Amount: use dollars, like 600 or 1250.50.");
  return Math.round(Number(s) * 100);
}

/* ───────────────────────── Create ───────────────────────── */

/** "Create deal" on an accepted collab request: prefilled from the request, then Claude gets the shot list ask. */
export async function createDealFromCollabAction(fd: FormData) {
  const user = await requireUser();
  const requestId = str(fd.get("collabRequestId"));
  if (!requestId) return;
  let id = "";
  let created = false;
  try {
    const r = await createDeal({ collabRequestId: requestId }, user.email);
    id = r.id;
    created = r.created;
  } catch (e) {
    const m = message(e);
    if (m) redirect(`/collabs/${encodeURIComponent(requestId)}?error=${encodeURIComponent(m)}`);
    throw e;
  }
  refresh(id);
  revalidatePath(`/collabs/${requestId}`);
  redirect(`/deals/${id}${created ? "?new=1" : ""}`);
}

/** "Add a deal" on /deals — for collabs that didn't come through the form. */
export async function createDealAction(fd: FormData) {
  const user = await requireUser();
  const businessName = str(fd.get("businessName"));
  let id = "";
  await guard("/deals", async () => {
    id = (await createDeal({ businessName }, user.email)).id;
  });
  refresh(id);
  redirect(`/deals/${id}?new=1`);
}

/* ───────────────────────── Edit ───────────────────────── */

export async function saveDealAction(_prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  const id = str(fd.get("id"));
  if (!id) return { error: "Missing deal." };
  try {
    const comp = str(fd.get("compType"));
    const visit = str(fd.get("visitAt"));
    const visitAt = visit ? zonedLocalToDate(visit) : null;
    if (visit && !visitAt) return { error: "Visit: pick a date and time.", at: Date.now() };
    const patch: Partial<DealInputT> = {
      businessName: str(fd.get("businessName")),
      compType: oneOf(DEAL_COMP, comp) ? comp : undefined,
      amountCents: parseDollars(str(fd.get("amount"))),
      usageRights: str(fd.get("usageRights")),
      terms: str(fd.get("terms")),
      visitAt,
      contactName: str(fd.get("contactName")),
      contactEmail: str(fd.get("contactEmail")),
      contactPhone: str(fd.get("contactPhone")),
      address: str(fd.get("address")),
      menuNotes: str(fd.get("menuNotes")),
      dietaryNotes: str(fd.get("dietaryNotes")),
      filmingNotes: str(fd.get("filmingNotes")),
      notes: str(fd.get("notes")),
    };
    if (fd.has("paymentDueDate")) patch.paymentDueDate = str(fd.get("paymentDueDate")) || null;
    await updateDeal(id, patch, user.email);
  } catch (e) {
    const m = message(e);
    if (m) return { error: m, at: Date.now() };
    throw e;
  }
  refresh(id);
  return { ok: true, message: "Saved.", at: Date.now() };
}

/**
 * Status / payment buttons bind their value (`formAction={setDealStatusToAction.bind(null, "shot")}`) rather than
 * relying on the clicked button's name/value, which isn't included in the FormData a function action receives.
 */
export async function setDealStatusToAction(status: string, fd: FormData) {
  fd.set("status", status);
  return setDealStatusAction(fd);
}

export async function setPaymentToAction(status: string, fd: FormData) {
  fd.set("paymentStatus", status);
  return setPaymentAction(fd);
}

export async function setDealStatusAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const status = str(fd.get("status"));
  if (!id || !oneOf<DealStatus>(DEAL_STATUSES, status)) return;
  await guard(backTo(fd, id), () => setDealStatus(id, status, user.email));
  refresh(id);
}

export async function setPaymentAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const status = str(fd.get("paymentStatus"));
  if (!id || !oneOf<PaymentStatus>(PAYMENT_STATUSES, status)) return;
  await guard(backTo(fd, id), () => setPaymentStatus(id, status, user.email, { dueDate: str(fd.get("dueDate")) || null }));
  refresh(id);
}

export async function deleteDealAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  if (!id) return;
  await guard(`/deals/${id}`, () => deleteDeal(id, user.email));
  refresh();
  redirect("/deals");
}

/* ───────────────────────── Deliverables ───────────────────────── */

export async function addDeliverableAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("dealId"));
  const kind = str(fd.get("kind"));
  if (!id || !oneOf(DELIVERABLE_KINDS, kind)) return;
  await guard(`/deals/${id}`, () => addDeliverable(id, { kind, dueDate: str(fd.get("dueDate")) || null }, user.email));
  refresh(id);
}

export async function saveDeliverableAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const dealId = str(fd.get("dealId"));
  if (!id || !dealId) return;
  const kind = str(fd.get("kind"));
  const postUrl = str(fd.get("postUrl"));
  await guard(`/deals/${dealId}`, () => updateDeliverable(id, {
    kind: oneOf(DELIVERABLE_KINDS, kind) ? kind : undefined,
    dueDate: str(fd.get("dueDate")) || null,
    postUrl: postUrl || null,
    posted: fd.get("posted") === "on" || !!postUrl,
    disclosureOk: fd.get("disclosureOk") === "on",
  }, user.email));
  refresh(dealId);
}

export async function deleteDeliverableAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const dealId = str(fd.get("dealId"));
  if (!id || !dealId) return;
  await guard(`/deals/${dealId}`, () => deleteDeliverable(id, user.email));
  refresh(dealId);
}

/* ───────────────────────── Shot list (called from the client, optimistic) ───────────────────────── */

export async function toggleShotAction(dealId: string, shotId: string, done: boolean): Promise<{ shots?: ShotItem[]; error?: string }> {
  const user = await requireUser();
  try {
    const shots = await toggleShot(dealId, shotId, user.email, done);
    refresh(dealId);
    return { shots };
  } catch (e) {
    return { error: message(e) ?? "Couldn’t save that tick — try again." };
  }
}

export async function addShotAction(dealId: string, text: string): Promise<{ shot?: ShotItem; error?: string }> {
  const user = await requireUser();
  try {
    const shot = await addShot(dealId, text, user.email);
    refresh(dealId);
    return { shot };
  } catch (e) {
    return { error: message(e) ?? "Couldn’t add that shot — try again." };
  }
}

export async function removeShotAction(dealId: string, shotId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await removeShot(dealId, shotId, user.email);
    refresh(dealId);
    return {};
  } catch (e) {
    return { error: message(e) ?? "Couldn’t remove that shot." };
  }
}

/** "Ask Claude for a shot list" (again). */
export async function askShotListAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  if (!id) return;
  await guard(`/deals/${id}`, () => requestShotList(id, user.email, str(fd.get("note")) || null));
  refresh(id);
  redirect(`/deals/${id}?asked=1`);
}
