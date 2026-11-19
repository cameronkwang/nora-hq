import Link from "next/link";
import { clientHealth, type ClientHealthRow, type HealthTone } from "@/lib/data";
import { cx } from "./ui";

/**
 * Home's client health strip: one row per active business, a colored dot and its single worst issue
 * ("Google not linked", "6 reviews unanswered", "Oct report not sent", "Opening in 12 days") or "All good".
 * The whole row is the link to the page that fixes it. Rows come from clientHealth() in lib/data.
 * Drawn as a ruled list with no visible title: colour lives in the dot only, the words are ink ("All good" is muted).
 */

const TONE: Record<HealthTone, string> = { danger: "is-danger", warn: "is-warn", info: "is-info", ok: "is-ok" };
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
    <section className={className}>
      {/* The title is for screen readers; on screen the strip is the first thing under the greeting and needs none. */}
      <header className="sr-only">
        <h2>Client health</h2>
      </header>
      <ul className="list is-ruled">
        {rows.map((r) => (
          <li key={r.clientId}>
            <Link href={r.href} className="row health-row" title={r.location ? `${r.name} · ${r.location}` : r.name}>
              <span className="row-title">
                {r.name}
                {r.location && <span className="font-normal text-muted"> · {r.location}</span>}
              </span>
              <span className={cx("status", TONE[r.tone])}>
                <span>
                  <span className="sr-only">{SAY[r.tone]}: </span>
                  {r.issue}
                  {r.more > 0 && <span className="text-muted"> · +{r.more} more</span>}
                </span>
              </span>
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chevron() {
  return (
    <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
