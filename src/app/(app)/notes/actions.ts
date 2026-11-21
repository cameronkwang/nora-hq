"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assigneeFor, requireUser } from "@/lib/auth";
import { OpsError, createTask } from "@/lib/ops";
import { createRoutedAsk } from "@/lib/ops-asks";
import { createNote, deleteNote, getNote, noteTitle, updateNote } from "@/lib/ops-notes";
import { ROUTE_FIELDS } from "@/components/ask-route";
import { ASSIGNEES, type Assignee, type Attachment } from "@/lib/schema";
import { attachmentsFromJson } from "@/lib/uploads";

export type NoteFormState = { error?: string } | undefined;

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const me = (name: string): Assignee => ((ASSIGNEES as readonly string[]).includes(name) ? (name as Assignee) : "unassigned");

/**
 * The "+" form. intent "save" keeps the note for its writer only; intent "send" sends it to Cameron, which makes it
 * an ask (Claude helps in the background, as with every ask). Either way an optional date also puts a reminder on
 * the writer's own list.
 */
export async function createNoteAction(_prev: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const user = await requireUser();
  const body = str(formData.get("body"));
  const send = str(formData.get("intent")) === "send";
  const remindOn = str(formData.get("remindOn"));
  if (!body) return { error: "Write a few words first." };
  if (remindOn && !isDate(remindOn)) return { error: "Pick the reminder day again." };
  const attachments: Attachment[] = attachmentsFromJson(formData.get("attachments"));
  try {
    if (send) await createRoutedAsk({ body, clientId: null, attachments }, ROUTE_FIELDS.auto, user.email);
    else await createNote({ body, attachments }, user.email);
    if (remindOn) await createTask({ title: noteTitle(body), details: body.trim() === noteTitle(body) ? null : body, assignee: me(assigneeFor(user)), dueDate: remindOn }, user.email);
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/?sent=${send ? "auto" : "note"}`);
}

/** A reminder is a task on your own list with a day on it. */
export async function createReminderAction(_prev: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const user = await requireUser();
  const title = str(formData.get("title"));
  const dueDate = str(formData.get("dueDate"));
  if (!title) return { error: "What should it remind you about?" };
  if (dueDate && !isDate(dueDate)) return { error: "Pick the day again." };
  await createTask({ title: title.slice(0, 200), assignee: me(assigneeFor(user)), dueDate: dueDate || null }, user.email);
  revalidatePath("/", "layout");
  redirect("/?sent=reminder");
}

export async function updateNoteAction(_prev: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  if (!id) return { error: "That note isn't here any more." };
  try {
    await updateNote(id, body, user.email);
  } catch (e) {
    if (e instanceof OpsError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect("/notes");
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData.get("id"));
  if (id) await deleteNote(id, user.email);
  revalidatePath("/", "layout");
  redirect("/notes");
}

/** "Send to Cameron" on a saved note: it becomes an ask (with its photos) and leaves the private notes. */
export async function sendNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData.get("id"));
  const note = id ? await getNote(id, user.email) : null;
  if (!note) redirect("/notes");
  const body = str(formData.get("body")) || note.body;
  await createRoutedAsk({ body, clientId: null, attachments: note.attachments }, ROUTE_FIELDS.auto, user.email);
  await deleteNote(note.id, user.email);
  revalidatePath("/", "layout");
  redirect("/?sent=auto");
}
