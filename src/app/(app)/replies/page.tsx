import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ensureDefaultReplies, listSavedReplies, type SavedReply } from "@/lib/ops-replies";
import { relativeTime } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { ConfirmButton, SubmitButton } from "@/components/client-form";
import { CopyButton } from "@/components/copy-button";
import { ReplyFields } from "@/components/reply-fields";
import { REPLY_CATEGORIES, REPLY_CATEGORY_LABEL, type ReplyCategory } from "@/components/reply-fill";
import { createReplyAction, deleteReplyAction, discardReplyAction, keepReplyAction, updateReplyAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function ReplyRow({ r }: { r: SavedReply }) {
  return (
    <li id={`r-${r.id}`} className="scroll-mt-20">
      <details className="group">
        <summary className="no-marker flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{r.title}</p>
            <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-muted group-open:hidden">{r.body}</p>
          </div>
          <span className="shrink-0 pt-0.5 text-xs text-muted tabular-nums">{r.useCount > 0 ? `Used ${r.useCount}×` : "Not used yet"}</span>
          <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" fill="currentColor">
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
          </svg>
        </summary>
        <form action={updateReplyAction} className="space-y-3 border-t border-border bg-surface-2/40 px-4 py-3">
          <input type="hidden" name="id" value={r.id} />
          <ReplyFields idPrefix={`e-${r.id}`} title={r.title} body={r.body} category={r.category} />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton>Save</SubmitButton>
            <CopyButton targetId={`e-${r.id}-body`} label="Copy text" />
            <ConfirmButton confirm={`Delete “${r.title}”?`} formAction={deleteReplyAction} size="md" className="sm:ml-auto">
              Delete
            </ConfirmButton>
          </div>
          <p className="text-xs text-muted">Updated {relativeTime(r.updatedAt)}</p>
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
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link href="/clients/noraeatsgood" className="text-muted hover:underline">← Nora&apos;s workspace</Link>
      </p>
      <PageHeader
        title="Saved replies"
        subtitle="One-tap messages for collabs, clients and outreach. Pick one from the Replies button in Review or on a collab request — names, businesses, dates and links fill in."
      />

      {msg && (
        <div role="status" className={cx("mb-4 rounded-lg px-4 py-3 text-sm", tone === "danger" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>
          {msg}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {suggested.length > 0 && (
          <Card title={<span className="flex items-center gap-2">Suggested by Claude <Badge tone="accent">{suggested.length}</Badge></span>}>
            <p className="mb-3 text-sm text-muted">Keep the ones you like (edit first if needed). Nothing is used until you keep it.</p>
            <ul className="flex flex-col gap-4">
              {suggested.map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-3">
                  <form action={keepReplyAction} className="space-y-3">
                    <input type="hidden" name="id" value={r.id} />
                    <ReplyFields idPrefix={`s-${r.id}`} title={r.title} body={r.body} category={r.category} />
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton pendingLabel="Keeping…" className="grow sm:grow-0">Keep</SubmitButton>
                      <ConfirmButton confirm={`Discard “${r.title}”?`} formAction={discardReplyAction} size="md" variant="secondary">
                        Discard
                      </ConfirmButton>
                    </div>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card padded={false}>
          <details>
            <summary className="no-marker flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-accent">
              + Add a saved reply
            </summary>
            <form action={createReplyAction} className="space-y-3 border-t border-border px-4 py-3">
              <ReplyFields idPrefix="new" />
              <SubmitButton pendingLabel="Adding…" className="w-full sm:w-auto">Add reply</SubmitButton>
            </form>
          </details>
        </Card>

        {groups.length === 0 ? (
          <EmptyState title="No saved replies yet">Add one above — it&apos;ll show up in the Replies button everywhere you write.</EmptyState>
        ) : (
          groups.map((g) => (
            <Card key={g.key} title={g.label} padded={false}>
              <ul className="divide-y divide-border">
                {g.rows.map((r) => (
                  <ReplyRow key={r.id} r={r} />
                ))}
              </ul>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
