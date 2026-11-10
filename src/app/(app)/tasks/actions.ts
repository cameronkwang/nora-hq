"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { createTask, deleteTask, updateTask } from "@/lib/ops";
import { isMonth } from "@/lib/dates";
import type { Assignee, Platform, TaskStatus } from "@/lib/schema";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => str(v) || null;

/** Only same-site relative paths. */
function safeReturn(v: FormDataEntryValue | null, fallback: string) {
  const s = str(v);
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

function withParam(path: string, key: string, value: string) {
  const u = new URL(path, "http://x");
  u.searchParams.set(key, value);
  return `${u.pathname}${u.search}`;
}

function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const first = (e as { issues: Array<{ path?: unknown[]; message?: string }> }).issues[0];
    const field = first?.path?.join(".");
    return field ? `${field}: ${first?.message}` : (first?.message ?? "Invalid input");
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

function refresh() {
  revalidatePath("/", "layout");
}

/** Checkbox toggle: done=1 marks done, anything else reopens as "todo". */
export async function toggleTaskDone(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) return;
  await updateTask(id, { status: str(formData.get("done")) === "1" ? "done" : "todo" }, user.email);
  refresh();
}

export async function setTaskStatus(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as TaskStatus;
  if (!id) return;
  await updateTask(id, { status }, user.email);
  refresh();
}

/** Quick add from /tasks (or any page that passes returnTo). */
export async function quickAddTask(formData: FormData) {
  const user = await requireUser();
  const back = safeReturn(formData.get("returnTo"), "/tasks");
  try {
    await createTask(
      {
        title: str(formData.get("title")),
        clientId: opt(formData.get("clientId")),
        dueDate: opt(formData.get("dueDate")),
        assignee: (opt(formData.get("assignee")) ?? "unassigned") as Assignee,
        platform: opt(formData.get("platform")) as Platform | null,
        askId: opt(formData.get("askId")),
      },
      user.email,
    );
  } catch (e) {
    redirect(withParam(back, "error", errorMessage(e)));
  }
  refresh();
  redirect(withParam(back, "added", "1"));
}

/** Full edit from /tasks/[id]. */
export async function saveTask(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (!id) redirect("/tasks");
  const back = safeReturn(formData.get("returnTo"), "/tasks");
  const clientId = opt(formData.get("clientId"));
  let deliverableId = opt(formData.get("deliverableId"));

  // A deliverable only counts for its own business; drop it if the business changed.
  if (deliverableId) {
    const db = await getDb();
    const [dl] = await db.select({ clientId: schema.deliverables.clientId }).from(schema.deliverables).where(eq(schema.deliverables.id, deliverableId));
    if (!dl || dl.clientId !== clientId) deliverableId = null;
  }
  const month = str(formData.get("month"));

  try {
    await updateTask(
      id,
      {
        title: str(formData.get("title")),
        details: opt(formData.get("details")),
        clientId,
        platform: opt(formData.get("platform")) as Platform | null,
        status: (opt(formData.get("status")) ?? "todo") as TaskStatus,
        assignee: (opt(formData.get("assignee")) ?? "unassigned") as Assignee,
        dueDate: opt(formData.get("dueDate")),
        deliverableId,
        ...(isMonth(month) ? { month } : {}),
      },
      user.email,
    );
  } catch (e) {
    redirect(withParam(`/tasks/${id}`, "error", errorMessage(e)));
  }
  refresh();
  redirect(withParam(back, "saved", "1"));
}

export async function deleteTaskAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (id) await deleteTask(id, user.email);
  refresh();
  redirect(withParam(safeReturn(formData.get("returnTo"), "/tasks"), "deleted", "1"));
}
