import Link from "next/link";
import { listSavedReplies } from "@/lib/ops-replies";
import { Card, Status } from "./ui";

/**
 * Entry points to /replies (there's no nav item). Server components.
 *  <SavedRepliesCard />  — for Nora's workspace (/clients/noraeatsgood)
 *  <SavedRepliesRow />   — a one-line link row for Settings
 */

async function counts() {
  const rows = await listSavedReplies("all");
  return { active: rows.filter((r) => r.status === "active").length, suggested: rows.filter((r) => r.status === "suggested").length };
}

export async function SavedRepliesCard() {
  const { active, suggested } = await counts();
  return (
    <Card
      title="Saved replies"
      actions={<Link href="/replies" className="link-quiet -my-3 inline-flex min-h-11 items-center md:pointer-fine:my-0 md:pointer-fine:min-h-0">Manage</Link>}
      padded={false}
    >
      {/* Like SavedRepliesRow: the title on one line, what is waiting on a meta line under it, the chevron beside both. */}
      <Link href="/replies" className="row">
        <div className="min-w-0 flex-1">
          <p className="row-title is-plain">{active > 0 ? `${active} ready to use` : "Set up your one-tap replies"}</p>
          {suggested > 0 && <p><Status tone="warn" small>{suggested} suggested by Claude</Status></p>}
        </div>
        <svg viewBox="0 0 16 16" aria-hidden className="chev size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Link>
    </Card>
  );
}

export async function SavedRepliesRow() {
  const { active, suggested } = await counts();
  return (
    <Link href="/replies" className="row">
      <div className="min-w-0 flex-1">
        <p className="row-title">Saved replies</p>
        <p className="meta whitespace-normal">One-tap messages for collabs, clients and outreach · {active} saved</p>
      </div>
      {suggested > 0 && <Status tone="warn" small>{suggested} to review</Status>}
      <svg viewBox="0 0 16 16" aria-hidden className="chev size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Link>
  );
}
