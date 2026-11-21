import { requireUser } from "@/lib/auth";
import { NoteRows, loadNoteRows } from "@/components/note-rows";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Every note: the ones kept private and the ones sent to Cameron, newest first. */
export default async function NotesPage() {
  const user = await requireUser();
  const rows = await loadNoteRows(user.email, user.name, 100);
  return (
    <div>
      <PageHeader title="Notes" subtitle="Yours, and the ones you sent to Cameron." actions={<LinkButton href="/notes/new" size="sm">New note</LinkButton>} />
      {rows.length === 0 ? (
        <EmptyState title="No notes yet.">Tap + to write one. Keep it for yourself or send it to Cameron.</EmptyState>
      ) : (
        <NoteRows rows={rows} ruled />
      )}
    </div>
  );
}
