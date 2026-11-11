"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { approveDraft, markDraftSent, rejectDraft, reviseDraft } from "@/lib/ops";
import { MANUAL_SEND_KINDS } from "@/components/draft-checks";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
/** Draft text keeps its own whitespace; only normalise line endings. */
const bodyOf = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/\r\n/g, "\n") : undefined);

/** Only same-site relative paths. */
function safeReturn(v: FormDataEntryValue | null, fallback = "/review") {
  const s = str(v);
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

/** Adds ?msg=&tone= (and optional extra params) to a return path. */
function withFlash(path: string, msg: string, tone: "ok" | "warn" | "danger", extra: Record<string, string> = {}) {
  const u = new URL(path, "http://x");
  u.searchParams.set("msg", msg.slice(0, 400));
  u.searchParams.set("tone", tone);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
}

function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const first = (e as { issues: Array<{ message?: string }> }).issues[0];
    return first?.message ?? "Invalid input";
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

function refresh() {
  revalidatePath("/", "layout");
}

/** Approve (or retry a failed send). Submits the body as edited on the page. */
export async function approveDraftAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const back = safeReturn(formData.get("returnTo"));
  const body = bodyOf(formData.get("body"));
  if (!id) redirect(back);
  if (body !== undefined && !body.trim()) redirect(withFlash(back, "The text is empty — write something before approving.", "danger"));

  let outcome: Awaited<ReturnType<typeof approveDraft>>;
  try {
    const postKey = str(formData.get("postKey")) || undefined;
    outcome = await approveDraft(id, user.email, { ...(body !== undefined ? { body } : {}), postKey });
  } catch (e) {
    refresh();
    redirect(withFlash(back, errorMessage(e), "danger"));
  }
  refresh();
  const kind = str(formData.get("kind"));
  const manual = outcome.status === "approved" && (MANUAL_SEND_KINDS as readonly string[]).includes(kind);
  redirect(
    withFlash(back, outcome.message, outcome.status === "failed" ? "danger" : manual ? "warn" : "ok", {
      ...(manual ? { next: id } : {}),
    }),
  );
}

export async function saveDraftAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const back = safeReturn(formData.get("returnTo"));
  const body = bodyOf(formData.get("body"));
  if (!id) redirect(back);
  if (body !== undefined && !body.trim()) redirect(withFlash(back, "The text is empty — nothing saved.", "danger"));
  try {
    await reviseDraft(id, { body }, user.email);
  } catch (e) {
    redirect(withFlash(back, errorMessage(e), "danger"));
  }
  refresh();
  redirect(withFlash(back, "Edit saved.", "ok"));
}

export async function rejectDraftAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const back = safeReturn(formData.get("returnTo"));
  const note = str(formData.get("note"));
  if (!id) redirect(back);
  try {
    await rejectDraft(id, user.email, note || undefined);
  } catch (e) {
    refresh();
    redirect(withFlash(back, errorMessage(e), "danger"));
  }
  refresh();
  redirect(withFlash(back, "Sent back. Claude will revise it the next time it checks the queue.", "ok"));
}

export async function markSentAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const back = safeReturn(formData.get("returnTo"));
  const kind = str(formData.get("kind"));
  if (!id) redirect(back);
  try {
    await markDraftSent(id, user.email);
  } catch (e) {
    redirect(withFlash(back, errorMessage(e), "danger"));
  }
  refresh();
  const msg =
    kind === "outreach_email" || kind === "outreach_dm"
      ? "Marked sent. Outreach stage updated and a follow-up is due in 5 days."
      : kind === "lead_email" || kind === "lead_dm"
        ? "Marked sent. The lead is now Contacted, with a follow-up in 5 days."
        : kind === "review_reply"
        ? "Marked sent. The review now shows as replied."
        : "Marked sent.";
  redirect(withFlash(back, msg, "ok"));
}
