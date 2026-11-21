"use server";

import { revalidatePath } from "next/cache";
import { assigneeFor, requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { removeFile, sendFile } from "@/lib/ops-files";

export type SendFilePayload = {
  url: string;
  fileName: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  title: string;
  kind: string;
  note?: string | null;
  remindOn?: string | null;
};

/** Records a file the browser just uploaded, so it shows in Nora's Files. Cameron's side only. */
export async function sendFileAction(payload: SendFilePayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (assigneeFor(user) === "nora") return { ok: false, error: "Only Cameron sends files here." };
  try {
    await sendFile({ ...payload, kind: payload.kind as "contract" | "invoice" | "other", remindOn: payload.remindOn || null }, user.name);
  } catch (e) {
    if (e instanceof OpsError) return { ok: false, error: e.message };
    return { ok: false, error: "Couldn't send it. Try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeFileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (assigneeFor(user) === "nora") return;
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await removeFile(id, user.name);
  revalidatePath("/", "layout");
}
