"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isMonth } from "@/lib/dates";
import { schema } from "@/lib/db";
import {
  createTask,
  deleteDeliverable,
  generateMonthTasks,
  updateClient,
  upsertDeliverable,
  upsertMetric,
} from "@/lib/ops";
import { onboardClient, SERVICES, type Service } from "@/lib/ops-onboarding";
import { parseBusinessInput } from "@/lib/onboard-parse";

/** Result shape for forms wired through <ActionForm> (useActionState). */
export type FormState = { ok?: boolean; error?: string; message?: string; at?: number };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const opt = (fd: FormData, k: string) => str(fd, k).trim() || null;

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

function refresh(clientId?: string) {
  revalidatePath("/clients");
  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/settings`);
  }
  revalidatePath("/", "layout"); // sidebar lists businesses
}

/* ───────── Businesses ───────── */

/**
 * New client (/clients/new): one field takes the name or a pasted Instagram/TikTok/Maps/website link
 * (parsed again here so it works without JS). Creates the business with its plan, Getting started checklist
 * and Claude's research ask; from a lead it also marks the lead Won. Lands on the business page.
 */
export async function onboardAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseBusinessInput(str(fd, "q"));
  const name = (parsed.kind === "name" ? parsed.name : str(fd, "name")).trim();
  if (!name) return { error: parsed.kind === "name" ? "Give the business a name." : "Add the business name too." };
  const services = fd.getAll("services").filter((v): v is Service => typeof v === "string" && (SERVICES as readonly string[]).includes(v));
  if (services.length === 0) return { error: "Pick at least one service." };
  const leadId = opt(fd, "leadId");
  let id: string;
  try {
    id = await onboardClient(
      {
        name,
        location: opt(fd, "location"),
        instagramHandle: parsed.kind === "instagram" ? parsed.handle : opt(fd, "instagramHandle"),
        tiktokHandle: parsed.kind === "tiktok" ? parsed.handle : opt(fd, "tiktokHandle"),
        website: parsed.kind === "website" ? parsed.url : opt(fd, "website"),
        googleMapsUrl: parsed.kind === "maps" ? parsed.url : opt(fd, "googleMapsUrl"),
        copyPlanFrom: opt(fd, "copyPlanFrom"),
        services,
        leadId,
      },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(id);
  revalidatePath("/tasks");
  revalidatePath("/asks");
  if (leadId) {
    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
  }
  redirect(`/clients/${id}?welcome=1${leadId ? "&lead=1" : ""}`);
}

/** Older "Add business" form signature — same flow as New client. */
export async function createClientAction(prev: FormState, fd: FormData): Promise<FormState> {
  return onboardAction(prev, fd);
}

export async function updateClientAction(clientId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = str(fd, "name").trim();
  if (!name) return { error: "Name can't be empty." };
  try {
    await updateClient(
      clientId,
      {
        name,
        location: opt(fd, "location"),
        brand: opt(fd, "brand"),
        instagramHandle: opt(fd, "instagramHandle"),
        tiktokHandle: opt(fd, "tiktokHandle"),
        website: opt(fd, "website"),
        googleLocation: opt(fd, "googleLocation"),
        brandVoice: opt(fd, "brandVoice"),
        notes: opt(fd, "notes"),
      },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(clientId);
  return { ok: true, message: "Saved.", at: Date.now() };
}

export async function setArchivedAction(clientId: string, archived: boolean) {
  const user = await requireUser();
  await updateClient(clientId, { archived }, user.email);
  refresh(clientId);
}

/* ───────── Monthly plan ───────── */

export async function generateChecklistAction(clientId: string, month: string) {
  const user = await requireUser();
  if (!isMonth(month)) return;
  await generateMonthTasks(clientId, month, user.email);
  refresh(clientId);
  revalidatePath("/tasks");
}

const platformOf = (v: string) => (schema.PLATFORMS as readonly string[]).includes(v) ? (v as schema.Platform) : "other";

export async function saveDeliverableAction(clientId: string, deliverableId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const title = str(fd, "title").trim();
  if (!title) return { error: "Give it a title." };
  const target = Number(str(fd, "targetPerMonth") || "0");
  if (!Number.isInteger(target) || target < 0) return { error: "Target must be a whole number (0 = as needed)." };
  try {
    await upsertDeliverable(
      {
        id: deliverableId ?? undefined,
        clientId,
        title,
        platform: platformOf(str(fd, "platform")),
        targetPerMonth: target,
        ...(deliverableId ? { active: fd.get("active") === "on" } : {}),
      },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(clientId);
  return { ok: true, message: deliverableId ? "Saved." : "Added to the plan.", at: Date.now() };
}

export async function deleteDeliverableAction(clientId: string, deliverableId: string) {
  const user = await requireUser();
  await deleteDeliverable(deliverableId, user.email);
  refresh(clientId);
}

/* ───────── Tasks ───────── */

export async function quickAddTaskAction(clientId: string, month: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const title = str(fd, "title").trim();
  if (!title) return { error: "What needs doing?" };
  const assignee = str(fd, "assignee");
  const platform = str(fd, "platform");
  const dueDate = opt(fd, "dueDate");
  try {
    await createTask(
      {
        clientId,
        title,
        month: isMonth(month) ? month : undefined,
        dueDate,
        assignee: (schema.ASSIGNEES as readonly string[]).includes(assignee) ? (assignee as schema.Assignee) : "unassigned",
        platform: platform ? platformOf(platform) : null,
      },
      user.email,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(clientId);
  revalidatePath("/tasks");
  return { ok: true, message: "Task added.", at: Date.now() };
}

/* ───────── Metrics ───────── */

const METRIC_FIELDS = ["views", "reach", "followers", "engagements"] as const;

export async function saveMetricsAction(clientId: string, month: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!isMonth(month)) return { error: "Bad month." };
  let saved = 0;
  try {
    for (const p of ["instagram", "tiktok"] as const) {
      const vals: Record<string, number | null> = {};
      let any = false;
      for (const f of METRIC_FIELDS) {
        const raw = str(fd, `${p}_${f}`).replace(/[,\s]/g, "");
        if (!raw) { vals[f] = null; continue; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return { error: `${p === "instagram" ? "Instagram" : "TikTok"} ${f}: enter a whole number.` };
        vals[f] = Math.round(n);
        any = true;
      }
      // Skip platforms with nothing entered and no existing row (don't create empty rows).
      if (!any && fd.get(`${p}_present`) !== "1") continue;
      await upsertMetric({ clientId, month, platform: p, ...vals, source: "manual" }, user.email);
      saved++;
    }
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh(clientId);
  return saved ? { ok: true, message: "Numbers saved.", at: Date.now() } : { error: "Enter at least one number." };
}
