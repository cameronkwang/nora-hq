"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  createSavedReply, deleteSavedReply, discardSuggestedReply, keepSuggestedReply, listSavedReplies, recordReplyUse, updateSavedReply,
} from "@/lib/ops-replies";
import { REPLY_CATEGORIES, type ReplyCategory } from "@/components/reply-fill";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const category = (v: FormDataEntryValue | null): ReplyCategory | null => {
  const s = str(v);
  return (REPLY_CATEGORIES as readonly string[]).includes(s) ? (s as ReplyCategory) : null;
};

function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    return (e as { issues: Array<{ message?: string }> }).issues[0]?.message ?? "Invalid input";
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

function back(msg: string, tone: "ok" | "danger", anchor = ""): never {
  const u = new URL("/replies", "http://x");
  u.searchParams.set("msg", msg.slice(0, 300));
  u.searchParams.set("tone", tone);
  redirect(`${u.pathname}${u.search}${anchor}`);
}

export async function createReplyAction(formData: FormData) {
  const user = await requireUser();
  try {
    await createSavedReply({ title: str(formData.get("title")), body: str(formData.get("body")), category: category(formData.get("category")) }, user.email);
  } catch (e) {
    back(errorMessage(e), "danger");
  }
  revalidatePath("/replies");
  back("Saved reply added.", "ok");
}

export async function updateReplyAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  try {
    await updateSavedReply(id, { title: str(formData.get("title")), body: str(formData.get("body")), category: category(formData.get("category")) }, user.email);
  } catch (e) {
    back(errorMessage(e), "danger");
  }
  revalidatePath("/replies");
  back("Saved.", "ok", `#r-${id}`);
}

export async function deleteReplyAction(formData: FormData) {
  const user = await requireUser();
  try {
    await deleteSavedReply(str(formData.get("id")), user.email);
  } catch (e) {
    back(errorMessage(e), "danger");
  }
  revalidatePath("/replies");
  back("Deleted.", "ok");
}

export async function keepReplyAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  try {
    await keepSuggestedReply(id, user.email, { title: str(formData.get("title")) || undefined, body: str(formData.get("body")) || undefined, category: formData.has("category") ? category(formData.get("category")) : undefined });
  } catch (e) {
    back(errorMessage(e), "danger");
  }
  revalidatePath("/replies");
  back("Kept — it's in your saved replies now.", "ok");
}

export async function discardReplyAction(formData: FormData) {
  const user = await requireUser();
  try {
    await discardSuggestedReply(str(formData.get("id")), user.email);
  } catch (e) {
    back(errorMessage(e), "danger");
  }
  revalidatePath("/replies");
  back("Discarded.", "ok");
}

/* ── Used by <ReplyPicker> (client) ── */

export type PickerReply = { id: string; title: string; body: string; category: string | null };

export async function loadPickerRepliesAction(): Promise<PickerReply[]> {
  await requireUser();
  const rows = await listSavedReplies("active");
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, category: r.category }));
}

export async function recordReplyUseAction(id: string): Promise<void> {
  await requireUser();
  if (typeof id !== "string" || !id) return;
  await recordReplyUse(id);
}
