import Link from "next/link";
import { clientHealth, type ClientHealthRow, type HealthTone } from "@/lib/data";
import { Card, cx } from "./ui";

/**
 * Home's client health strip: one row per active business, a colored dot and its single worst issue
 * ("Google not linked", "6 reviews unanswered", "Oct report not sent", "Opening in 12 days") or "All good".
 * The whole row is the link to the page that fixes it. Rows come from clientHealth() in lib/data.
 */

const DOT: Record<HealthTone, string> = { danger: "bg-danger", warn: "bg-warn", info: "bg-info", ok: "bg-ok" };
const TEXT: Record<HealthTone, string> = { danger: "text-danger", warn: "text-warn", info: "text-info", ok: "text-muted" };
/** Said to screen readers in place of the dot's color. */
const SAY: Record<HealthTone, string> = { danger: "Problem", warn: "Needs attention", info: "Heads-up", ok: "OK" };

/** Self-contained: loads its own rows. A failure here never takes Home down; the strip is simply left out. */
export async function ClientHealth({ className }: { className?: string }) {
  const rows = await clientHealth().catch((e) => {
    console.error("[health] client health failed", e);
    return [] as ClientHealthRow[];
  });
  return <ClientHealthStrip rows={rows} className={className} />;
}

export function ClientHealthStrip({ rows, className }: { rows: ClientHealthRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <Card title="Client health" padded={false} className={className}>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.clientId}>
            <Link href={r.href} className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
              <span aria-hidden className={cx("size-2.5 shrink-0 rounded-full", DOT[r.tone])} />
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                <span className="block truncate text-sm font-medium sm:w-56 sm:shrink-0">
                  {r.name}
                  {r.location && <span className="font-normal text-muted"> · {r.location}</span>}
                </span>
                <span className={cx("block text-sm sm:min-w-0 sm:flex-1 sm:truncate", TEXT[r.tone])}>
                  <span className="sr-only">{SAY[r.tone]}: </span>
                  {r.issue}
                  {r.more > 0 && <span className="text-muted"> · +{r.more} more</span>}
                </span>
              </span>
              <span aria-hidden className="shrink-0 text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
