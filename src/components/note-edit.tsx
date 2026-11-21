"use client";

import { useActionState } from "react";
import { deleteNoteAction, sendNoteAction, updateNoteAction } from "@/app/(app)/notes/actions";
import { ConfirmButton, SubmitButton } from "./client-form";

/** A saved private note: edit it, send it to Cameron (it leaves your notes and becomes an ask) or delete it. */
export function NoteEdit({ id, body }: { id: string; body: string }) {
  const [state, save] = useActionState(updateNoteAction, undefined);
  return (
    <form action={save} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={id} />
      <div>
        <label htmlFor="note-body" className="sr-only">Your note</label>
        <textarea id="note-body" name="body" required rows={8} defaultValue={body} className="input min-h-48 text-base" />
      </div>
      {state?.error && <p role="alert" className="status is-danger whitespace-normal">{state.error}</p>}
      <div className="ask-bar md:static md:border-0 md:p-0">
        <div className="flex flex-wrap gap-2">
          <SubmitButton variant="primary" className="flex-1 md:flex-none md:px-6">Save</SubmitButton>
          <SubmitButton formAction={sendNoteAction} pendingLabel="Sending…" className="flex-1 md:flex-none">Send to Cameron</SubmitButton>
          <ConfirmButton formAction={deleteNoteAction} confirm="Delete this note?" variant="ghost" size="md">Delete</ConfirmButton>
        </div>
      </div>
    </form>
  );
}
