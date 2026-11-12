"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { markReportSent, requestReportDrafts, sendClientReport, setClientOwnerEmail } from "@/lib/ops-reports";
import type { ActionFormState } from "@/components/client-form";

const msg = (e: unknown) => (e instanceof z.ZodError ? e.issues[0]?.message ?? "Check the input." : e instanceof Error ? e.message : "Something went wrong");
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

function refresh(clientId?: string) {
  revalidatePath("/reports");
  revalidatePath("/review");
  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/settings`);
  }
}

/** Email the approved external report to the owner. Human only (ops checks too). */
export async function sendReportAction(reportId: string, clientId: string, _prev: ActionFormState): Promise<ActionFormState> {
  const user = await requireUser();
  try {
    const r = await sendClientReport(reportId, user.email);
    refresh(clientId);
    return r.status === "failed" ? { error: r.message, at: Date.now() } : { ok: r.status === "sent", message: r.message, at: Date.now() };
  } catch (e) {
    return { error: msg(e), at: Date.now() };
  }
}

/** Sent it by hand from their own email. */
export async function markReportSentAction(reportId: string, clientId: string, _prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  try {
    await markReportSent(reportId, user.email, str(fd, "sentTo") || null);
    refresh(clientId);
    return { ok: true, message: "Marked sent.", at: Date.now() };
  } catch (e) {
    return { error: msg(e), at: Date.now() };
  }
}

/** Drops an ask for Claude to draft both reports for that month. */
export async function requestReportAction(clientId: string, month: string, _prev: ActionFormState): Promise<ActionFormState> {
  const user = await requireUser();
  try {
    const r = await requestReportDrafts(clientId, month, user.email);
    revalidatePath("/asks");
    refresh(clientId);
    return { ok: true, message: r.created ? "Asked Claude — the drafts show up here and in Review." : "Claude already has this on its list.", at: Date.now() };
  } catch (e) {
    return { error: msg(e), at: Date.now() };
  }
}

/** Business settings → "Owner email". */
export async function setOwnerEmailAction(clientId: string, _prev: ActionFormState, fd: FormData): Promise<ActionFormState> {
  const user = await requireUser();
  try {
    await setClientOwnerEmail(clientId, str(fd, "ownerEmail") || null, user.email);
    refresh(clientId);
    return { ok: true, message: "Saved.", at: Date.now() };
  } catch (e) {
    return { error: msg(e), at: Date.now() };
  }
}
