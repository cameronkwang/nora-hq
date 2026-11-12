"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { approveDraft, markDraftSent, rejectDraft, reviseDraft } from "@/lib/ops";
import { markReportSent, reportForDraft, sendClientReport } from "@/lib/ops-reports";
import { BULK_APPROVE_KINDS, MANUAL_SEND_KINDS } from "@/components/draft-checks";
import { getDraft } from "./queries";

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
    const draft = kind === "report" ? await getDraft(id) : null;
    const reportId = draft && typeof draft.meta.reportId === "string" ? draft.meta.reportId : "";
    // An external report sent by hand: record it on the report too (which also closes the draft).
    // reportForDraft refuses unless that report points back at this very draft.
    if (draft && reportId) await markReportSent((await reportForDraft(draft)).id, user.email);
    else await markDraftSent(id, user.email);
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
        : kind === "report"
        ? "Marked sent. The report is filed as sent."
        : "Marked sent.";
  redirect(withFlash(back, msg, "ok"));
}

/* ───────────── Fast approvals (focus mode, keyboard, bulk): return an outcome instead of redirecting ───────────── */

export type QuickOutcome = {
  ok: boolean;
  /** Draft status afterwards (when known). */
  status?: string;
  message: string;
  /** Approved but still needs a manual send (copy & post / mark sent). */
  manual?: boolean;
};

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cleanBody = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n") : undefined);

async function quickApprove(id: string, actor: string, body: string | undefined, postKey: string | undefined): Promise<QuickOutcome> {
  if (body !== undefined && !body.trim()) return { ok: false, message: "The text is empty — write something before approving." };
  try {
    const out = await approveDraft(id, actor, { ...(body !== undefined ? { body } : {}), postKey });
    const cur = out.status === "approved" ? await getDraft(id) : null;
    const manual = out.status === "approved" && !!cur && (MANUAL_SEND_KINDS as readonly string[]).includes(cur.kind);
    return { ok: out.status !== "failed", status: out.status, message: out.message, manual };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** Approve one draft without leaving the page. The client calls router.refresh() afterwards. */
export async function approveDraftQuickAction(input: { id: string; body?: string; postKey?: string }): Promise<QuickOutcome> {
  const user = await requireUser();
  const id = clean(input?.id);
  if (!id) return { ok: false, message: "Missing draft" };
  return quickApprove(id, user.email, cleanBody(input.body), clean(input.postKey) || undefined);
}

/** Send a draft back to Claude without leaving the page. */
export async function rejectDraftQuickAction(input: { id: string; note?: string }): Promise<QuickOutcome> {
  const user = await requireUser();
  const id = clean(input?.id);
  if (!id) return { ok: false, message: "Missing draft" };
  try {
    await rejectDraft(id, user.email, clean(input.note) || undefined);
    return { ok: true, status: "rejected", message: "Sent back. Claude will revise it the next time it checks the queue." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/**
 * One item of a bulk approve. Bulk is ONLY for Google review replies — refused for every other kind,
 * whatever the client sends. The client calls this once per draft, sequentially, then router.refresh().
 */
export async function bulkApproveReplyAction(input: { id: string; body?: string }): Promise<QuickOutcome> {
  const user = await requireUser();
  const id = clean(input?.id);
  const draft = id ? await getDraft(id) : null;
  if (!draft) return { ok: false, message: "That draft doesn't exist anymore." };
  if (!(BULK_APPROVE_KINDS as readonly string[]).includes(draft.kind)) return { ok: false, message: "Only Google review replies can be approved in bulk — open this one and approve it on its own." };
  if (draft.status !== "needs_review") return { ok: false, message: "Already handled." };
  return quickApprove(id, user.email, cleanBody(input.body), undefined);
}

/**
 * "Send to owner" for an approved external report draft. sendClientReport (ops-reports) emails the approved
 * report to the business owner's saved email; a person must click it — Claude never can.
 */
export async function sendReportAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const back = safeReturn(formData.get("returnTo"));
  const draft = id ? await getDraft(id) : null;
  if (!draft || draft.kind !== "report") redirect(withFlash(back, "That report draft doesn't exist anymore.", "danger"));
  if (draft.status !== "approved") redirect(withFlash(back, "Approve the report before sending it.", "danger"));
  const reportId = typeof draft.meta.reportId === "string" ? draft.meta.reportId : "";
  if (!reportId) redirect(withFlash(back, "This draft isn't linked to a report.", "danger"));
  if (draft.meta.audience === "internal") redirect(withFlash(back, "Internal reports are never sent to the owner.", "danger"));
  let out: Awaited<ReturnType<typeof sendClientReport>>;
  try {
    const rep = await reportForDraft(draft); // the report must point back at this draft — meta.reportId alone isn't trusted
    out = await sendClientReport(rep.id, user.email);
  } catch (e) {
    refresh();
    redirect(withFlash(back, errorMessage(e), "danger"));
  }
  refresh();
  redirect(withFlash(back, out.message, out.status === "sent" ? "ok" : out.status === "failed" ? "danger" : "warn"));
}
