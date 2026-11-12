"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { copyCollabContactToLead, requestCollabReply, setCollabStatus } from "@/lib/ops-collab";
import { COLLAB_REQUEST_STATUSES, type CollabRequestStatus } from "@/lib/schema";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const isStatus = (v: string): v is CollabRequestStatus => (COLLAB_REQUEST_STATUSES as readonly string[]).includes(v);

function back(id: string, q: string): never {
  redirect(`/collabs/${encodeURIComponent(id)}?${q}`);
}

/** Accept / Decline / Spam / Reviewing from the request page. */
export async function setCollabStatusAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  const status = str(fd.get("status"));
  if (!id || !isStatus(status)) return;
  try {
    await setCollabStatus(id, status, user.email);
  } catch (e) {
    if (e instanceof OpsError) back(id, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/", "layout");
  back(id, `done=${status}`);
}

/** "Ask Claude to draft a reply". */
export async function askCollabReplyAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  if (!id) return;
  let askId: string;
  try {
    askId = await requestCollabReply(id, user.email, str(fd.get("note")) || null);
  } catch (e) {
    if (e instanceof OpsError) back(id, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/", "layout");
  back(id, `drafting=${encodeURIComponent(askId)}`);
}

/** "Use form contact on lead" — a person chooses to trust the form's contact details. */
export async function copyCollabContactAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd.get("id"));
  if (!id) return;
  try {
    await copyCollabContactToLead(id, user.email);
  } catch (e) {
    if (e instanceof OpsError) back(id, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/", "layout");
  back(id, "copied=1");
}
