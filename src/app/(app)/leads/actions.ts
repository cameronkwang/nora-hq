"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { LEAD_OPPORTUNITIES, type LeadOpportunity } from "@/lib/schema";
import { OpsError } from "@/lib/ops";
import {
  PITCH_CHANNELS,
  convertLead,
  deleteLead,
  requestLeadPitch,
  requestLeadResearch,
  updateLead,
  upsertLead,
  type PitchChannel,
} from "@/lib/ops-leads";
import { isStage } from "./shared";

export type LeadFormState = { ok?: boolean; error?: string; message?: string; at?: number; askId?: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const opt = (fd: FormData, k: string) => str(fd, k).trim() || null;
const opps = (fd: FormData): LeadOpportunity[] =>
  LEAD_OPPORTUNITIES.filter((o) => fd.getAll("opportunities").map(String).includes(o));

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => i.message).join(" ");
  if (e instanceof OpsError || e instanceof Error) return e.message;
  return "Something went wrong";
}

function refresh(id?: string) {
  revalidatePath("/leads");
  if (id) revalidatePath(`/leads/${id}`);
  revalidatePath("/asks");
  revalidatePath("/");
}

const safeBack = (raw: string, fallback = "/leads") => (raw.startsWith("/leads") && !raw.startsWith("//") ? raw : fallback);

/** Everything the add/edit form sends. Blank text fields are null (an edit clears them); numbers are parsed by ops. */
function leadFields(fd: FormData) {
  return {
    name: str(fd, "name").trim(),
    city: opt(fd, "city"),
    category: opt(fd, "category"),
    website: opt(fd, "website"),
    instagramHandle: opt(fd, "instagramHandle"),
    tiktokHandle: opt(fd, "tiktokHandle"),
    googleMapsUrl: opt(fd, "googleMapsUrl"),
    googleRating: opt(fd, "googleRating"),
    googleReviewCount: opt(fd, "googleReviewCount"),
    replyRate: opt(fd, "replyRate"),
    instagramFollowers: opt(fd, "instagramFollowers"),
    lastPostAt: opt(fd, "lastPostAt"),
    score: opt(fd, "score"),
    why: opt(fd, "why"),
    contactName: opt(fd, "contactName"),
    contactEmail: opt(fd, "contactEmail"),
    contactPhone: opt(fd, "contactPhone"),
    nextStepAt: opt(fd, "nextStepAt"),
    notes: opt(fd, "notes"),
  };
}

/* ───────── Hand work to Claude ───────── */

export async function findLeadsAction(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  let askId: string;
  try {
    askId = await requestLeadResearch(
      { area: str(fd, "area"), placeType: opt(fd, "placeType"), opportunities: opps(fd), count: str(fd, "count") || 10 },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e), at: Date.now() };
  }
  refresh();
  return { ok: true, askId, message: "Sent to Claude. New leads will show up here under Found.", at: Date.now() };
}

export async function askPitchAction(leadId: string, _prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  const channel = str(fd, "channel") as PitchChannel;
  if (!(PITCH_CHANNELS as readonly string[]).includes(channel)) return { error: "Pick how to reach them." };
  let askId: string;
  try {
    askId = await requestLeadPitch(leadId, channel, user.email, opt(fd, "note"));
  } catch (e) {
    return { error: errorMessage(e), at: Date.now() };
  }
  refresh(leadId);
  return { ok: true, askId, message: "Asked Claude. The pitch will land in Review for you to approve.", at: Date.now() };
}

/* ───────── Add / edit ───────── */

export async function createLeadAction(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  const fields = leadFields(fd);
  if (!fields.name) return { error: "Give the business a name." };
  let res: Awaited<ReturnType<typeof upsertLead>>;
  try {
    res = await upsertLead({ ...fields, opportunities: opps(fd), source: opt(fd, "source") ?? "manual" }, user.email);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(res.id);
  redirect(`/leads/${res.id}${res.created ? "?added=1" : "?merged=1"}`);
}

export async function updateLeadAction(leadId: string, _prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  const fields = leadFields(fd);
  if (!fields.name) return { error: "Name can't be empty." };
  try {
    await updateLead(leadId, { ...fields, opportunities: opps(fd) }, user.email);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(leadId);
  return { ok: true, message: "Saved.", at: Date.now() };
}

/** Next step + notes, the small form on the lead page. */
export async function saveFollowUpAction(leadId: string, _prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  try {
    await updateLead(leadId, { nextStepAt: opt(fd, "nextStepAt"), notes: opt(fd, "notes") }, user.email);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(leadId);
  return { ok: true, message: "Saved.", at: Date.now() };
}

/** Inline stage select (list, board and the lead page). Plain form; errors come back as ?error=. */
export async function moveLeadStageAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(fd, "id");
  const stage = str(fd, "stage");
  const back = safeBack(str(fd, "back"));
  let error = "";
  if (!isStage(stage)) error = "Pick a stage.";
  else {
    try {
      await updateLead(id, { stage }, user.email);
    } catch (e) {
      error = errorMessage(e);
    }
  }
  refresh(id);
  if (error) {
    const u = new URL(back, "http://x");
    u.searchParams.set("error", error);
    redirect(`${u.pathname}${u.search}`);
  }
  redirect(back);
}

/* ───────── Convert / delete ───────── */

export async function convertLeadAction(leadId: string, _prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireUser();
  let clientId: string;
  try {
    clientId = await convertLead(leadId, user.email, { services: opps(fd) });
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(leadId);
  revalidatePath("/clients");
  revalidatePath("/tasks");
  revalidatePath("/", "layout"); // the sidebar lists businesses
  redirect(`/clients/${clientId}`);
}

export async function deleteLeadAction(leadId: string): Promise<void> {
  const user = await requireUser();
  await deleteLead(leadId, user.email);
  refresh();
  revalidatePath("/review");
  redirect("/leads");
}
