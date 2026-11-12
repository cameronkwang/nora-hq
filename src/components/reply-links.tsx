import Link from "next/link";
import { listSavedReplies } from "@/lib/ops-replies";
import { Badge, Card } from "./ui";

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
      actions={<Link href="/replies" className="-my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline md:min-h-0">Manage</Link>}
      padded={false}
    >
      <Link href="/replies" className="flex min-h-11 flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-surface-2">
        <span>{active > 0 ? `${active} ready to use` : "Set up your one-tap replies"}</span>
        {suggested > 0 && <Badge tone="accent">{suggested} suggested by Claude</Badge>}
        <span className="ml-auto text-muted" aria-hidden>→</span>
      </Link>
    </Card>
  );
}

export async function SavedRepliesRow() {
  const { active, suggested } = await counts();
  return (
    <Link href="/replies" className="flex min-h-11 items-center gap-3 rounded-lg px-1 py-2 hover:bg-surface-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Saved replies</p>
        <p className="text-xs text-muted">One-tap messages for collabs, clients and outreach · {active} saved</p>
      </div>
      {suggested > 0 && <Badge tone="accent">{suggested} to review</Badge>}
      <span className="text-muted" aria-hidden>→</span>
    </Link>
  );
}
