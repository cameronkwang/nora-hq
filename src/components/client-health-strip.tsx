import Link from "next/link";
import { clientHealth, type ClientHealthRow, type HealthTone } from "@/lib/data";
import { cx } from "./ui";

/**
 * A business's health on Home's Businesses ledger: a coloured dot and its single worst issue ("Google not linked",
 * "6 reviews unanswered", "Oct report not sent", "Opening in 12 days") or "All good". Rows come from clientHealth()
 * in lib/data. An issue is the link to the page that fixes it; "All good" is a quiet word with nothing to open.
 * Colour lives in the dot only, the words are ink ("All good" is muted).
 */

const TONE: Record<HealthTone, string> = { danger: "is-danger", warn: "is-warn", info: "is-info", ok: "is-ok" };
/** Said to screen readers in place of the dot's color. */
const SAY: Record<HealthTone, string> = { danger: "Problem", warn: "Needs attention", info: "Heads-up", ok: "OK" };

/** Every active business's health, by business id. A failure here never takes Home down: the lines are left out. */
export async function loadClientHealth(): Promise<Map<string, ClientHealthRow>> {
  const rows = await clientHealth().catch((e) => {
    console.error("[health] client health failed", e);
    return [] as ClientHealthRow[];
  });
  return new Map(rows.map((r) => [r.clientId, r]));
}

export function HealthLine({ row, className }: { row: ClientHealthRow; className?: string }) {
  const words = (
    <span>
      <span className="sr-only">{SAY[row.tone]}: </span>
      {row.issue}
      {row.more > 0 && <span className="text-muted"> · +{row.more} more</span>}
    </span>
  );
  if (row.tone === "ok") return <span className={cx("status", TONE.ok, className)}>{words}</span>;
  return (
    <Link href={row.href} className={cx("status ledger-health", TONE[row.tone], className)}>
      {words}
    </Link>
  );
}
