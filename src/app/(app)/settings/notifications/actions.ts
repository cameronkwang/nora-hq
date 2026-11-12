"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { createCalendarFeed, removePushDevice, revokeCalendarFeed, setPushTopics } from "@/lib/ops-notify";

const PATH = "/settings/notifications";
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/** Per-device topic toggles. Returns the saved topics, or an error message. */
export async function setTopicsAction(id: string, topics: string[]): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await setPushTopics(String(id), Array.isArray(topics) ? topics : [], user.email);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    if (e instanceof OpsError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "issues" in e) return { ok: false, error: "Unknown notification type." };
    throw e;
  }
}

export async function removeDeviceAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) return;
  try {
    await removePushDevice(id, user.email);
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
  }
  revalidatePath(PATH);
}

export type NewFeedState = { token?: string; error?: string; at?: number };

/** Makes a new calendar link (the old one stops working). The raw token comes back once, in this response only. */
export async function createCalendarFeedAction(_prev: NewFeedState, _formData: FormData): Promise<NewFeedState> {
  const user = await requireUser();
  try {
    const r = await createCalendarFeed(user.email);
    revalidatePath(PATH);
    return { token: r.token, at: Date.now() };
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message, at: Date.now() };
    throw e;
  }
}

export async function revokeCalendarFeedAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) return;
  try {
    await revokeCalendarFeed(id, user.email);
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
  }
  revalidatePath(PATH);
}
