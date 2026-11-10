"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { createTask, deleteTask, updateTask } from "@/lib/ops";
import { bulkDeleteTasks, bulkUpdateTasks } from "@/lib/ops-tasks";
import { listClients } from "@/lib/data";
import { buildImportPreview, type ImportPreview } from "./csv";
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

/* ───────── Client-called actions (board, table, bulk bar, import). They return a result instead of redirecting. ───────── */

export type ActionResult = { ok: true; count?: number } | { ok: false; error: string };

const EDITABLE = ["title", "status", "assignee", "clientId", "platform", "dueDate"] as const;
export type EditableTaskField = (typeof EDITABLE)[number];

/**
 * One field from an inline editor (table cell, board card). `refresh` re-renders the page with fresh data —
 * the board wants that; the table doesn't (rows would jump around mid-edit).
 */
export async function editTaskField(id: string, field: EditableTaskField, value: string, refreshAfter = false): Promise<ActionResult> {
  const user = await requireUser();
  if (typeof id !== "string" || !id || !(EDITABLE as readonly string[]).includes(field) || typeof value !== "string") {
    return { ok: false, error: "Invalid edit" };
  }
  const v = value.trim();
  try {
    if (field === "title") {
      if (!v) return { ok: false, error: "Title can’t be empty" };
      await updateTask(id, { title: v }, user.email);
    } else if (field === "status") await updateTask(id, { status: v as TaskStatus }, user.email);
    else if (field === "assignee") await updateTask(id, { assignee: (v || "unassigned") as Assignee }, user.email);
    else if (field === "platform") await updateTask(id, { platform: (v || null) as Platform | null }, user.email);
    else if (field === "dueDate") await updateTask(id, { dueDate: v || null }, user.email);
    else {
      // A deliverable only counts for its own business; drop the link when the business changes.
      const db = await getDb();
      const [t] = await db.select({ clientId: schema.tasks.clientId }).from(schema.tasks).where(eq(schema.tasks.id, id));
      if (!t) return { ok: false, error: "Task not found" };
      const clientId = v || null;
      await updateTask(id, { clientId, ...(t.clientId !== clientId ? { deliverableId: null } : {}) }, user.email);
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  if (refreshAfter) refresh();
  return { ok: true };
}

export type BulkOp = "done" | "assign" | "next_month" | "delete";

export async function bulkTasksAction(ids: string[], op: BulkOp, value?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!Array.isArray(ids)) return { ok: false, error: "Invalid selection" };
  try {
    let count: number;
    if (op === "delete") count = await bulkDeleteTasks(ids, user.email);
    else if (op === "done") count = await bulkUpdateTasks(ids, { status: "done" }, user.email);
    else if (op === "assign") count = await bulkUpdateTasks(ids, { assignee: value as Assignee }, user.email);
    else if (op === "next_month") count = await bulkUpdateTasks(ids, { nextMonth: true }, user.email);
    else return { ok: false, error: "Unknown action" };
    refresh();
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function previewTaskImport(csv: string): Promise<ImportPreview> {
  await requireUser();
  if (typeof csv !== "string") return { rows: [], fileError: "Nothing to import.", ignoredHeaders: [] };
  return buildImportPreview(csv, await listClients({ includeArchived: true }));
}

/** Re-validates on the server, imports only the valid rows. */
export async function importTasks(csv: string): Promise<ActionResult> {
  const user = await requireUser();
  const preview = await previewTaskImport(csv);
  if (preview.fileError) return { ok: false, error: preview.fileError };
  const valid = preview.rows.filter((r) => r.errors.length === 0);
  if (valid.length === 0) return { ok: false, error: "No valid rows to import." };
  let count = 0;
  try {
    for (const r of valid) {
      await createTask(
        { title: r.title, clientId: r.clientId, dueDate: r.dueDate, assignee: r.assignee, platform: r.platform, details: r.details },
        user.email,
      );
      count++;
    }
  } catch (e) {
    refresh();
    return { ok: false, error: `Imported ${count}, then stopped: ${errorMessage(e)}` };
  }
  refresh();
  return { ok: true, count };
}
