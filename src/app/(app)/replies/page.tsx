import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ensureDefaultReplies, listSavedReplies, type SavedReply } from "@/lib/ops-replies";
import { relativeTime } from "@/lib/dates";
import { Card, Count, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmButton, SubmitButton } from "@/components/client-form";
import { CopyButton } from "@/components/copy-button";
import { ReplyFields } from "@/components/reply-fields";
import { REPLY_CATEGORIES, REPLY_CATEGORY_LABEL, type ReplyCategory } from "@/components/reply-fill";
import { createReplyAction, deleteReplyAction, discardReplyAction, keepReplyAction, updateReplyAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const CHEVRON = (
  <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function ReplyRow({ r }: { r: SavedReply }) {
  return (
    <li id={`r-${r.id}`} className="scroll-mt-20">
      <details className="group">
        <summary className="no-marker flex min-h-11 cursor-pointer items-baseline gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium group-hover:underline group-hover:decoration-1 group-hover:underline-offset-[3px]">{r.title}</p>
            <p className="meta mt-0.5 line-clamp-2 whitespace-pre-line group-open:hidden">{r.body}</p>
          </div>
          <span className="meta shrink-0 tabular-nums">{r.useCount > 0 ? `Used ${r.useCount}×` : "Not used yet"}</span>
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 self-center text-faint transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <form action={updateReplyAction} className="space-y-4 pb-6 pt-1">
          <input type="hidden" name="id" value={r.id} />
          <ReplyFields idPrefix={`e-${r.id}`} title={r.title} body={r.body} category={r.category} />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton variant="secondary">Save</SubmitButton>
            <CopyButton targetId={`e-${r.id}-body`} label="Copy text" variant="ghost" />
            <ConfirmButton confirm={`Delete “${r.title}”?`} formAction={deleteReplyAction} size="md" className="sm:ml-auto">
              Delete
            </ConfirmButton>
          </div>
          <p className="meta">Updated {relativeTime(r.updatedAt)}</p>
        </form>
      </details>
    </li>
  );
}

export default async function RepliesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  await ensureDefaultReplies();
  const all = await listSavedReplies("all");
  const suggested = all.filter((r) => r.status === "suggested");
  const active = all.filter((r) => r.status === "active");
  const groups: Array<{ key: ReplyCategory | "none"; label: string; rows: SavedReply[] }> = [
    ...REPLY_CATEGORIES.map((c) => ({ key: c, label: REPLY_CATEGORY_LABEL[c], rows: active.filter((r) => r.category === c) })),
    { key: "none" as const, label: "Other", rows: active.filter((r) => !r.category || !(REPLY_CATEGORIES as readonly string[]).includes(r.category)) },
  ].filter((g) => g.rows.length > 0);
  const msg = one(sp.msg);
  const tone = one(sp.tone);

  return (
    <div className="max-w-3xl">
      <PageHeader
        crumb={<Link href="/clients/noraeatsgood">Nora&apos;s workspace</Link>}
        title="Saved replies"
        subtitle="One-tap messages for collabs, clients and outreach. Pick one from the Replies button in Review or on a collab request; names, businesses, dates and links fill in."
      />

      {msg && (
        <p role="status" className="notice mb-2">
          <span className={tone === "danger" ? "status is-danger" : "status is-ok"}>{msg}</span>
        </p>
      )}

      {suggested.length > 0 && (
        <Card title={<>Suggested by Claude<Count n={suggested.length} /></>} padded={false}>
          <p className="sec-note">Keep the ones you like (edit first if needed). Nothing is used until you keep it.</p>
          <ul className="list">
            {suggested.map((r) => (
              <li key={r.id} className="py-5">
                <form action={keepReplyAction} className="space-y-4">
                  <input type="hidden" name="id" value={r.id} />
                  <ReplyFields idPrefix={`s-${r.id}`} title={r.title} body={r.body} category={r.category} />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton variant="secondary" pendingLabel="Keeping…" className="grow sm:grow-0">Keep</SubmitButton>
                    <ConfirmButton confirm={`Discard “${r.title}”?`} formAction={discardReplyAction} size="md" variant="ghost">
                      Discard
                    </ConfirmButton>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <details className="sec g-fold">
        <summary className="sec-head">
          <span className="title">Add a saved reply</span>
          {CHEVRON}
        </summary>
        <form action={createReplyAction} className="sec-body space-y-4 pb-2">
          <ReplyFields idPrefix="new" />
          <SubmitButton pendingLabel="Adding…" className="max-sm:w-full">Add reply</SubmitButton>
        </form>
      </details>

      {groups.length === 0 ? (
        <Card>
          <EmptyState title="No saved replies yet">Add one above. It&apos;ll show up in the Replies button everywhere you write.</EmptyState>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.key} title={<>{g.label}<span className="meta num">{g.rows.length}</span></>} padded={false}>
            <ul className="list">
              {g.rows.map((r) => (
                <ReplyRow key={r.id} r={r} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
