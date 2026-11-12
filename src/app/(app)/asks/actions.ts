"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OpsError, addAskMessage, updateAsk } from "@/lib/ops";
import { createRoutedAsk, triageAsk } from "@/lib/ops-asks";
import { ROUTE_FIELDS, isAskRoute } from "@/components/ask-route";
import { ASK_STATUSES, type AskStatus, type Attachment } from "@/lib/schema";
import { UploadError, attachmentsFromJson, filesFrom, saveUpload } from "@/lib/uploads";

export type AskFormState = { error?: string } | undefined;

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/**
 * New ask. Accepts attachments two ways:
 *  - "attachments": JSON of files the browser already uploaded via /api/upload (normal path)
 *  - "files": raw File entries (fallback; subject to the server action body limit)
 */
export async function createAskAction(_prev: AskFormState, formData: FormData): Promise<AskFormState> {
  const user = await requireUser();
  const body = str(formData.get("body"));
  const clientId = str(formData.get("clientId")) || null;
  if (!body) return { error: "Write a quick note first." };

  const attachments: Attachment[] = attachmentsFromJson(formData.get("attachments"));
  try {
    for (const f of filesFrom(formData, "files")) attachments.push(await saveUpload(f));
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }

  const routeIn = str(formData.get("route"));
  const route = isAskRoute(routeIn) ? routeIn : "auto";
  try {
    await createRoutedAsk({ body, clientId, attachments }, ROUTE_FIELDS[route], user.email);
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  // Back to Home with a short confirmation (and an "Add another" link).
  redirect(`/?sent=${route}`);
}

/** Re-route an ask from its page (the "Who's it for?" chips). Same function Claude's triage_ask uses. */
export async function routeAskAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const route = str(formData.get("route"));
  if (!id || !isAskRoute(route)) return;
  await triageAsk(id, ROUTE_FIELDS[route], user.email);
  revalidatePath("/", "layout");
}

export async function setAskStatus(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as AskStatus;
  if (!id || !ASK_STATUSES.includes(status)) return;
  await updateAsk(id, { status }, user.email);
  revalidatePath("/", "layout");
}

export async function setAskClient(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) return;
  await updateAsk(id, { clientId: str(formData.get("clientId")) || null }, user.email);
  revalidatePath("/", "layout");
}

export type AskReplyState = { error?: string; ok?: number } | undefined;

/** Nora/Cameron answers Claude (or adds a note) on an ask's conversation. */
export async function replyToAskAction(_prev: AskReplyState, formData: FormData): Promise<AskReplyState> {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  if (!id) return { error: "Something went wrong. Reload and try again." };
  if (!body) return { error: "Write a reply first." };
  if (body.length > 4000) return { error: "That’s a bit long — keep it under 4000 characters." };
  try {
    await addAskMessage(id, body, user.email);
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: Date.now() };
}
