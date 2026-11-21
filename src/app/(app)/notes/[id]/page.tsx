import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { getNote } from "@/lib/ops-notes";
import { NoteEdit } from "@/components/note-edit";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const note = await getNote(id, user.email);
  if (!note) notFound();
  return (
    <div className="max-w-2xl">
      <PageHeader crumb={<Link href="/notes">Notes</Link>} title="Note" subtitle={`Just you · saved ${formatDate(note.updatedAt)}`} />
      <NoteEdit id={note.id} body={note.body} />
      {note.attachments.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {note.attachments.map((a) => (
            <li key={a.url}>
              <a href={a.url} target="_blank" rel="noopener" className="block size-24 overflow-hidden rounded-lg border border-border bg-surface-2">
                {a.contentType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center p-1 text-center text-xs text-muted">{a.name}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
