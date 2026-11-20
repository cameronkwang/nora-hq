"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assigneeFor, requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { deliver, markAllSeen } from "@/lib/ops-deliveries";
import { personKey } from "@/components/ask-route";
import { attachmentsFromJson } from "@/lib/uploads";

export type DeliverFormState = { error?: string } | undefined;

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/**
 * "Deliver": hand finished work to the other person (Cameron → Nora, or Nora → Cameron). The browser uploads the files
 * first (/api/upload) and posts their URLs as JSON in "attachments"; only our own file URLs are kept.
 */
export async function deliverAction(_prev: DeliverFormState, formData: FormData): Promise<DeliverFormState> {
  const user = await requireUser();
  const me = personKey(assigneeFor(user));
  const recipient = me === "nora" ? "cameron" : "nora";
  const askId = str(formData.get("askId")) || null;
  try {
    await deliver({
      recipient,
      title: str(formData.get("title")),
      note: str(formData.get("note")) || null,
      attachments: attachmentsFromJson(formData.get("attachments")),
      clientId: str(formData.get("clientId")) || null,
      askId,
      closeAsk: !!askId && formData.get("closeAsk") === "on",
    }, user.email);
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message };
    if (e && typeof e === "object" && "issues" in e) {
      const first = (e as { issues: { message: string }[] }).issues[0];
      return { error: first?.message ?? "Check the form and try again." };
    }
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(askId ? `/asks/${askId}?delivered=1` : "/delivered?sent=1");
}

/** "Mark all as seen" on the Delivered tab: the viewer's own deliveries only. */
export async function markAllSeenAction() {
  const user = await requireUser();
  const me = personKey(assigneeFor(user));
  if (!me) return;
  await markAllSeen(me);
  revalidatePath("/", "layout");
}
