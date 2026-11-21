import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/dates";
import { blobEnabled } from "@/lib/uploads";
import { NoteForm, ReminderForm } from "@/components/note-form";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The "+" for Nora: write a note (keep it, or send it to Cameron) or set a reminder. */
export default async function NewNotePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const reminder = sp.kind === "reminder";
  return (
    <div className="max-w-2xl">
      <PageHeader title={reminder ? "New reminder" : "New note"} subtitle={reminder ? "It shows on Home and on your calendar until you tick it off." : "Keep it for yourself, or send it to Cameron."} />
      <nav aria-label="What to add" className="tabs mb-5">
        <Link href="/notes/new" aria-current={!reminder ? "page" : undefined}>Note</Link>
        <Link href="/notes/new?kind=reminder" aria-current={reminder ? "page" : undefined}>Reminder</Link>
      </nav>
      {reminder ? <ReminderForm today={today()} /> : <NoteForm directUpload={blobEnabled()} />}
    </div>
  );
}
