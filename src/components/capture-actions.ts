"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { OpsError } from "@/lib/ops";
import { captureAsk, parseCaptureRoute } from "@/lib/ops-capture";
import { attachmentsFromJson } from "@/lib/uploads";

export type QuickAskResult = { ok: true; message: string; href: string } | { ok: false; error: string };

/**
 * The Home composer's Send. Same path as the iPhone Shortcut (captureAsk): an ask routed by the chip,
 * or — for "Ad hoc task" — a task straight onto the other person's list. Files are already uploaded
 * by the browser; only our own upload URLs are trusted.
 */
export async function quickAskAction(input: { body: string; route: string; attachments?: unknown }): Promise<QuickAskResult> {
  const user = await requireUser();
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  const route = parseCaptureRoute(input?.route);
  const attachments = attachmentsFromJson(JSON.stringify(Array.isArray(input?.attachments) ? input.attachments : []));
  if (!body && !attachments.length) return { ok: false, error: "Write a quick note first." };
  if (body.length > 8000) return { ok: false, error: "That’s a bit long — keep it under 8000 characters." };
  if (!route) return { ok: false, error: "Pick who it’s for." };
  try {
    const r = await captureAsk({ text: body, route, attachments }, user.email);
    revalidatePath("/", "layout");
    return { ok: true, message: r.message, href: r.kind === "task" ? "/tasks" : `/asks/${r.id}` };
  } catch (e) {
    if (e instanceof OpsError) return { ok: false, error: e.message };
    throw e;
  }
}
